import { StringOutputParser } from '@langchain/core/output_parsers';
import { SSEControl, wrapStep } from '../../utils/AI/SSE';
import { getLLM } from '../../utils/AI/LLM';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { destr } from 'destr';
import { markdownToDocx } from './generateWord';
import * as z from 'zod';
import zodToJsonSchema from 'zod-to-json-schema';
import writeJsonToExcel from './generateExcel';
import { Annotation, START, END, StateGraph } from '@langchain/langgraph';
import { fileParse } from '../../utils/AI/FileParse';

type start = typeof START;
type end = typeof END;

/**
 * 状态图节点信息
 */
const GraphState = Annotation.Root({
	userContent: Annotation<[{ value: string }, { value: string[] }]>({
		reducer: (x, y) => y ?? x,
	}),
	SSE: Annotation<SSEControl>({
		reducer: (x, y) => y ?? x,
	}),
	nodeResult: Annotation<NodeDataOptions[]>({
		reducer: (x, y) => x.concat(y),
		default: () => [],
	}),
	// 文件解析内容
	fileParse: Annotation<string>(),
	// ai分析内容
	aiAnswer: Annotation<string>(),
});

type State = typeof GraphState.State;

const builder = new StateGraph(GraphState);

// 文件解析
builder.addNode(
	'文件解析',
	wrapStep<State>(async (state, info) => {
		const fileList = state.userContent[1]!.value;
		if (!fileList[0]) return;
		const text = await fileParse(fileList[0]);

		return {
			fileParse: text,
			nodeResult: {
				type: 'string',
				data: text,
			},
		};
	})
);

// AI回复
builder.addNode(
	'AI回复',
	wrapStep<State>(async (state, info) => {
		const schema = z
			.array(
				z
					.object({
						要点摘要: z.string().describe('要点摘要'),
						关键词: z.string().describe('关键词'),
						条款分类: z.string().describe('条款分类'),
						发文单位: z.string().describe('发文单位'),
						生效日期: z.string().describe('生效日期'),
					})
					.describe('单个政策要点信息')
			)
			.describe('所有政策要求');

		const systemPrompt = ChatPromptTemplate.fromTemplate(`
你是一个政策解析专家，能够根据政策文件提取 要点摘要、关键词、条款分类、发文单位、生效日期

JSONSCHEMA描述如下：
{jsonschema}

政策内容如下：
{fileParse}

请严格参考以下要求：
- 请严格返回 JSON 格式，并且使用JSON代码块进行包裹
- 不得返回任何不相关的内容
		`);

		const llm = getLLM();

		const chain = systemPrompt.pipe(llm).pipe(new StringOutputParser());

		const stream = await chain.stream({
			fileParse: state.fileParse,
			jsonschema: zodToJsonSchema(schema),
		});

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
			aiAnswer: message,
			nodeResult: {
				type: 'string',
				data: message,
			},
		};
	})
);

// 报告生成
builder.addNode(
	'报告生成',
	wrapStep<State>(async (state) => {
		const content = state.aiAnswer.replaceAll('```json', '').replaceAll('```', '');
		const fileName = Date.now().toString();

		await markdownToDocx(state.aiAnswer, fileName + '.docx');
		await writeJsonToExcel(destr(content), fileName + '.xlsx');

		let message = '';

		message += `

[政策文件报告word版](${process.env.FILEADDRESS}/${fileName}.docx)

[政策文件报告excel版](${process.env.FILEADDRESS}/${fileName}.xlsx)
		`;

		return {
			nodeResult: {
				type: 'string',
				data: message,
			},
		};
	})
);

builder.addEdge('__start__', '文件解析' as end);
builder.addEdge('文件解析' as start, 'AI回复' as end);
builder.addEdge('AI回复' as start, '报告生成' as end);
builder.addEdge('报告生成' as start, '__end__');

const policyAnalysisAgent = builder.compile();

export { policyAnalysisAgent };
