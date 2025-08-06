import { Annotation, StateGraph, START, END } from '@langchain/langgraph';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { SSEControl, wrapStep } from '../../utils/AI/SSE';

// 确保API密钥以环境变量的形式存储
const apiKey = 'sk-fde43b36b22b407887a1c10b81e5b6a2';

/**
 * 创建图像生成任务
 * @param prompt 生成提示词
 */
const createTask = (prompt: string): Promise<string> => {
	return new Promise((resolve) => {
		axios
			.post(
				'https://dashscope.aliyuncs.com/api/v1/services/aigc/text2image/image-synthesis',
				{
					model: 'wanx2.1-t2i-turbo',
					input: { prompt },
					parameters: {
						size: '1024 * 1024',
						n: 1,
					},
				},
				{
					headers: {
						'X-DashScope-Async': 'enable',
						Authorization: `Bearer ${apiKey}`,
						'Content-Type': 'application/json',
					},
				}
			)
			.then((response) => {
				resolve(response.data.output.task_id);
			});
	});
};

/**
 * 轮询任务状态
 * @param taskId 任务ID
 * @param interval 轮询间隔（毫秒），默认1秒
 * @param timeout 超时时间（毫秒），默认1000秒
 * @returns 任务成功的结果
 * @throws 如果任务失败或超时，抛出错误
 */
async function pollTaskStatus(taskId: string, interval = 1000, timeout = 1000000): Promise<any> {
	const startTime = Date.now();

	return new Promise((resolve, reject) => {
		const poll = async () => {
			try {
				if (Date.now() - startTime > timeout) {
					reject(new Error(`轮询超时（${timeout}ms）`));
					return;
				}

				const response = await axios.get(`https://dashscope.aliyuncs.com/api/v1/tasks/${taskId}`, {
					headers: { Authorization: `Bearer ${apiKey}` },
				});

				const status = response.data.output.task_status;
				if (status === 'SUCCEEDED') {
					resolve(response.data.output.results[0]);
				} else if (status === 'FAILED' || status === 'CANCELED') {
					reject(new Error(`任务失败或取消: ${status}`));
				} else {
					setTimeout(poll, interval);
				}
			} catch (error) {
				reject(error);
			}
		};

		poll();
	});
}

// 定义状态图节点信息
const GraphState = Annotation.Root({
	input: Annotation<string>({
		reducer: (x, y) => y ?? x,
	}),
	SSE: Annotation<SSEControl>({
		reducer: (x, y) => y ?? x,
	}),
	taskId: Annotation<string>({
		reducer: (x, y) => y ?? x,
	}),
	nodeResult: Annotation<NodeDataOptions[]>({
		reducer: (x, y) => x.concat(y),
		default: () => [],
	}),
});

const builder = new StateGraph(GraphState);

type start = typeof START;
type end = typeof END;
type state = typeof GraphState.State;

// 创建图像生成任务节点
builder.addNode(
	'创建图像生成任务',
	wrapStep<state>(async (state) => {
		const taskId = await createTask(state.input);
		return {
			nodeResult: {
				type: 'string',
				data: '图像生成任务创建成功',
			},
			taskId,
		};
	})
);

// 执行图像生成任务节点
builder.addNode(
	'执行图像任务生成',
	wrapStep<state>(async (state, info) => {
		state.SSE.sendNodeData({
			status: 'process',
			stepName: info.runName!,
			data: {
				type: 'text2image',
				data: { url: '' },
			},
		});

		const result = await pollTaskStatus(state.taskId);
		const timestamp = new Date().getTime();
		const filename = `${timestamp}_text2image.png`;
		const response = await axios.get(result.url, { responseType: 'arraybuffer' });

		fs.writeFileSync(path.join(__dirname, `../../upload/data/${filename}`), response.data);

		return {
			nodeResult: {
				type: 'text2image',
				data: {
					...result,
					url: filename,
				},
			},
		};
	})
);

// 设置节点关系
builder.addEdge('__start__', '创建图像生成任务' as end);
builder.addEdge('创建图像生成任务' as start, '执行图像任务生成' as end);
builder.addEdge('执行图像任务生成' as start, '__end__');

const text2imageAgent = builder.compile();

export { text2imageAgent };
