import { Annotation, StateGraph, START, END } from '@langchain/langgraph';
// import { extractPoints, type extractInfoParams } from './extract-points';
import { agent } from './agent';
import { SSEControl, wrapStep } from '../../utils/AI/SSE';
import geoCode from './geocode';

/**
 * 状态图节点信息
 */
const GraphState = Annotation.Root({
	input: Annotation<UserChatMessage>({
		reducer: (x, y) => y ?? x,
	}),
	SSE: Annotation<SSEControl>({
		reducer: (x, y) => y ?? x,
	}),
	nodeResult: Annotation<NodeDataOptions[]>({
		reducer: (x, y) => x.concat(y),
		default: () => [],
	}),
	address: Annotation<string>({
		reducer: (x, y) => y ?? x,
	}),
	fileList: Annotation<string[]>({
		reducer: (x, y) => y ?? x,
	}),
});

// Define the State type based on GraphState
type State = typeof GraphState.State;
type start = typeof START;
type end = typeof END;

const builder = new StateGraph(GraphState);

builder.addNode(
	'提取位置信息',
	wrapStep<State>(async (state, info) => {
		const question = state.input[0].value;
		const fileList = state.input[1].value;

		if (!fileList.length) {
			let message = '';
			const stream = await agent.stream({
				question: question,
			});

			for await (const chunk of stream) {
				message += chunk;
				state.SSE.sendNodeData({
					status: 'process',
					stepName: info.runName!,
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
				address: JSON.parse(message).address,
			};
		} else {
			return {
				nodeResult: {
					type: 'string',
					data: '检测到上传的是文件类型',
				},
			};
		}
	})
);

builder.addNode(
	'地理编码',
	wrapStep<State>(async (state, info) => {
		if (state.address) {
			const result = await geoCode(state.address);
			return {
				nodeResult: {
					type: 'string',
					data: result ? JSON.stringify(result) : '地理编码无结果,换个说法试试',
				},
			};
		}
	})
);

builder.addEdge(START, '提取位置信息' as end);
builder.addEdge('提取位置信息' as start, '地理编码' as end);
builder.addEdge('地理编码' as start, END);

const contentParseAgent = builder.compile();

export default contentParseAgent;
