import { Annotation, StateGraph, START, END } from '@langchain/langgraph';
import { extractPoints, type extractInfoParams } from './extract-points';
import { agent } from './agent';
import { SSEControl, wrapStep } from '../../utils/AI/SSE';

type start = typeof START;
type end = typeof END;

/**
 * 状态图节点信息
 */
const GraphState = Annotation.Root({
	input: Annotation<string>({
		reducer: (x, y) => y ?? x,
	}),
	fileList: Annotation<string[]>({
		reducer: (x, y) => y ?? x,
	}),
	sampleInfo: Annotation<extractInfoParams>({
		reducer: (x, y) => y ?? x,
	}),
	SSE: Annotation<SSEControl>({
		reducer: (x, y) => y ?? x,
	}),
	nodeResult: Annotation<NodeDataOptions[]>({
		reducer: (x, y) => x.concat(y),
		default: () => [],
	}),
});

// Define the State type based on GraphState
type State = typeof GraphState.State;

const builder = new StateGraph(GraphState);

// 提取采样点信息
builder.addNode(
	'提取采样点信息',
	wrapStep<State>(async (state, info) => {
		const stream = await agent.stream({
			question: state.input,
		});

		let message = '';

		for await (const chunk of stream) {
			message += chunk;
			state.SSE.sendData({
				status: 'process',
				stepName: info.runName,
				data: {
					type: 'string',
					data: chunk,
				},
			});
		}

		const result = JSON.parse(message.replace(/^```json/, '').replace(/```$/, ''));

		return {
			nodeResult: {
				type: 'string',
				data: message,
			},
			sampleInfo: result,
		};
	})
);

// 剖面信息提取
builder.addNode(
	'剖面信息提取',
	wrapStep<State>(async (state) => {
		// 严格的校验逻辑
		const { crossSampleDis, midSampleDis, stationDescription } = state.sampleInfo;
		const hasStationNumbers = stationDescription?.stationNumber?.length! > 0;

		// 检查必须条件
		if (!crossSampleDis) {
			throw Error('必须提供横截面采样间隔才能生成剖面图');
		}

		if (!midSampleDis && !hasStationNumbers) {
			throw Error('必须提供中线采样间隔或桩点编号才能生成剖面图');
		}

		// 如果条件满足，执行提取
		const result = await extractPoints(state.sampleInfo, state.fileList);
		return {
			nodeResult: {
				type: 'section-echarts-array',
				data: result,
			},
		};
	})
);

builder.addEdge('__start__', '提取采样点信息' as end);
builder.addEdge('提取采样点信息' as start, '剖面信息提取' as end);
builder.addEdge('剖面信息提取' as start, '__end__');

const crossSectionAgent = builder.compile();

export { crossSectionAgent };
