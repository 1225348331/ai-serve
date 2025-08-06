import type { LangGraphRunnableConfig } from '@langchain/langgraph';
import type { Response } from 'express';

interface WithSSE {
	SSE: SSEControl;
}

export const startSSE = (res: Response): void => {
	// 设置流式响应头
	res.setHeader('Content-Type', 'text/event-stream');
	res.setHeader('Cache-Control', 'no-cache');
	res.setHeader('Connection', 'keep-alive');
};

export const sendSSEData = (res: Response, data: any): void => {
	res.write(`data: ${JSON.stringify(data)}\n\n`); // SSE 格式
};

export const endSSE = (res: Response): void => {
	res.end(); // 流结束后关闭连接
};

export class SSEControl {
	private res: Response;
	private time: number = 0;

	constructor(res: Response) {
		this.res = res;
		this.startSSE();
	}

	startSSE(): void {
		// 设置流式响应头
		this.res.setHeader('Content-Type', 'text/event-stream');
		this.res.setHeader('Cache-Control', 'no-cache');
		this.res.setHeader('Connection', 'keep-alive');
	}

	sendData(data: any): void {
		this.res.write(`data: ${JSON.stringify(data)}\n\n`); // SSE 格式
	}

	endSSE(): void {
		this.res.end(); // 流结束后关闭连接
	}

	/**
	 * 发送节点数据
	 * @param  options - 发送节点数据的选项对象
	 * @param  options.status - 节点状态，必须是以下值之一：
	 * @param  options.stepName - 节点名称
	 * @param  options.duration - 节点执行时长(毫秒)
	 * @param  options.data - 节点数据对象
	 * @param  options.data.type - 数据类型
	 * @param  options.data.data - 实际数据内容
	 */
	sendNodeData(options: NodeDataOptions): void {
		if (options.status === 'start') this.time = Date.now();
		if (['success', 'error'].includes(options.status)) {
			options.duration = Number(((Date.now() - this.time) / 1000).toFixed(2));
		}
		this.sendData(options);
	}
}

/**
 * 装饰器 - 工作流节点
 * @param fn 节点处理函数
 * @returns 包装后的节点处理函数
 */
export function wrapStep<T extends WithSSE>(fn: (state: T, info: LangGraphRunnableConfig) => Promise<any>) {
	return async (state: T, info: LangGraphRunnableConfig) => {
		try {
			state.SSE.sendNodeData({
				status: 'start',
				stepName: info.runName!,
				data: null,
			});

			const result = await fn(state, info);

			const nodeData = {
				status: 'success',
				stepName: info.runName,
				data: result.nodeResult ? result.nodeResult : null,
			};

			// @ts-ignore
			state.SSE.sendNodeData(nodeData);

			return { ...result, nodeResult: nodeData };
		} catch (error) {
			state.SSE.sendData({
				status: 'error',
				stepName: info.runName,
				data: {
					type: 'string',
					data: error instanceof Error ? error.message : String(error),
				},
			});
			return { state };
		}
	};
}
