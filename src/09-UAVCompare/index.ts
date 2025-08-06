import { Annotation, StateGraph, START, END } from '@langchain/langgraph';
import { SSEControl, wrapStep } from '../../utils/AI/SSE';
import { exec } from 'child_process';
import { getLLM } from '../../utils/AI/LLM';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { createHumanMessage } from '../../utils/AI/CreateHumanMessage';
import { SystemMessage } from '@langchain/core/messages';
import { StringOutputParser } from '@langchain/core/output_parsers';
import path from 'path';
import { fileURLToPath } from 'url';

// 获取当前文件目录
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** 生成图像 */
function generateImage(imagePath: string, bboxString: string) {
	// 获取当前文件的绝对路径（解决中文路径问题）
	const pythonScriptPath = path.resolve(__dirname, 'generateImage.py');
	imagePath = path.resolve(__dirname, '../../upload/data/', imagePath);
	console.log(`python ${pythonScriptPath} "${imagePath}" "${bboxString}"`);
	return new Promise((resolve, reject) => {
		const pythonProcess = exec(`python ${pythonScriptPath} "${imagePath}" "${bboxString}"`, (error, stdout, stderr) => {
			if (error) {
				return reject(error);
			}
			try {
				const result = JSON.parse(stdout);
				if (result.success) {
					resolve(result.output_path);
				} else {
					reject(new Error(result.error));
				}
			} catch (e) {
				reject(new Error(`Failed to parse Python output: ${stdout}`));
			}
		});
	});
}

// 定义状态图节点信息
const GraphState = Annotation.Root({
	input: Annotation<[{ value: string }, { value: string[] }]>({
		reducer: (x, y) => y ?? x,
	}),
	SSE: Annotation<SSEControl>({
		reducer: (x, y) => y ?? x,
	}),
	nodeResult: Annotation<NodeDataOptions[]>({
		reducer: (x, y) => x.concat(y),
		default: () => [],
	}),
	bbox: Annotation<string>({
		reducer: (x, y) => y ?? x,
	}),
});

const builder = new StateGraph(GraphState);

type start = typeof START;
type end = typeof END;
type state = typeof GraphState.State;

// 目标检测
builder.addNode(
	'目标检测',
	wrapStep<state>(async (state, info) => {
		const llm = getLLM({
			model: 'doubao-1.5-vision-pro-250328',
		});

		const question = state.input[0].value;
		const fileList = state.input[1].value;
		const humanMessage = await createHumanMessage(question, fileList);
		const systemMessage = new SystemMessage(`
你是一个目标识别专家,能够根据用户问题,识别图像中的目标物,返回目标物中的坐标
严格注意：
1.请确保坐标值准确
2.仅返回坐标值，坐标值以<bbox>x_min y_min x_max y_max</bbox>的形式输出,必须用bbox标签进行包裹
3.请勿返回代码块
4.若无目标物，则仅返回"无目标物"
			`);

		const prompt = ChatPromptTemplate.fromMessages([systemMessage, humanMessage]);

		const chain = prompt.pipe(llm).pipe(new StringOutputParser());

		const stream = await chain.stream({});

		let message = '';

		for await (const chunk of stream) {
			message += chunk;
			state.SSE.sendNodeData({
				stepName: info.runName!,
				status: 'process',
				data: {
					type: 'string',
					data: chunk,
				},
			});
		}

		return {
			nodeResult: {
				type: 'string',
				data: message,
			},
			bbox: message,
		};
	})
);

// 生成图像
builder.addNode(
	'图像生成',
	wrapStep<state>(async (state, info) => {
		if (state.bbox != '无目标物') {
			const imagePath = state.input[1].value[0];
			if (!imagePath) throw new Error('请上传至少一张图片');
			const imageFileName = await generateImage(imagePath, state.bbox);
			return {
				nodeResult: {
					type: 'image',
					data: imageFileName,
				},
			};
		} else {
			return {
				nodeResult: {
					type: 'string',
					data: '未识别到相关物体，请重新描述或者重新上传图片',
				},
			};
		}
	})
);




builder.addEdge(START, '目标检测' as start);
builder.addEdge('目标检测' as start, '图像生成' as end);
builder.addEdge('图像生成' as start, END);

const UAVCompareAgent = builder.compile();

export { UAVCompareAgent };