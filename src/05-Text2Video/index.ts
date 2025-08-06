import { Annotation, StateGraph, START, END } from '@langchain/langgraph';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { SSEControl, wrapStep } from '../../utils/AI/SSE';

const apiKey = 'sk-fde43b36b22b407887a1c10b81e5b6a2'; // 确保API密钥安全存储

// 创建视频生成任务
const createTask = (prompt: string): Promise<string> => {
	return new Promise((resolve) => {
		axios
			.post(
				'https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis',
				{
					model: 'wanx2.1-t2v-turbo',
					input: {
						prompt,
					},
					parameters: {
						size: '1280 * 720',
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
				const taskId = response.data.output.task_id;
				resolve(taskId);
			});
	});
};

// 轮询任务状态
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
					resolve(response.data.output);
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

// 下载视频到本地
async function downloadVideo(videoUrl: string): Promise<string> {
	const dir = path.join(__dirname, '../../upload/data');
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true });
	}

	const timestamp = new Date().getTime();
	const fileName = `${timestamp}_text2video.mp4`;
	const filePath = path.join(dir, fileName);

	await axios({
		method: 'get',
		url: videoUrl,
		responseType: 'stream',
	})
		.then((response) => {
			const writer = fs.createWriteStream(filePath);
			response.data.pipe(writer);

			return new Promise((resolve, reject) => {
				writer.on('finish', () => {
					resolve(true);
				});
				writer.on('error', reject);
			});
		})
		.catch((error) => {
			console.error('下载失败:', error.message);
		});

	return fileName;
}

// 定义状态图结构
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

// 创建视频生成任务节点
builder.addNode(
	'创建视频生成任务',
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

// 执行视频生成任务节点
builder.addNode(
	'执行视频任务生成',
	wrapStep<state>(async (state, info) => {
		state.SSE.sendNodeData({
			status: 'process',
			stepName: info.runName!,
			data: {
				type: 'text2video',
				data: {
					video_url: '',
				},
			},
		});

		const result = await pollTaskStatus(state.taskId);
		const filename = await downloadVideo(result.video_url);

		return {
			nodeResult: {
				type: 'text2video',
				data: {
					...result,
					video_url: filename,
				},
			},
		};
	})
);

// 设置状态图边
builder.addEdge('__start__', '创建视频生成任务' as end);
builder.addEdge('创建视频生成任务' as start, '执行视频任务生成' as end);
builder.addEdge('执行视频任务生成' as start, '__end__');

const text2videoAgent = builder.compile();

export { text2videoAgent };
