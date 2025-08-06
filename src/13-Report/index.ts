import { StringOutputParser } from '@langchain/core/output_parsers';
import { SSEControl, wrapStep } from '../../utils/AI/SSE';
import { getLLM } from '../../utils/AI/LLM';
import { ChatPromptTemplate } from '@langchain/core/prompts';
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

// AI回复
builder.addNode(
	'AI回复',
	wrapStep<State>(async (state, info) => {
		const text = await fileParse('用地评价报告.docx');

		const systemPrompt = ChatPromptTemplate.fromTemplate(`
现在我在地图上选择了一个地块，地块信息如下，请你帮我总结归纳关键信息

{fileParse}
		`);

		const llm = getLLM();

		const chain = systemPrompt.pipe(llm).pipe(new StringOutputParser());

		const stream = await chain.stream({
			fileParse: text,
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
		const fileName = '用地评价报告';

		let message = '';

		message += `

[用地评价报告word版](http://localhost:3300/${fileName}.docx)
		`;

		return {
			nodeResult: {
				type: 'string',
				data: message,
			},
		};
	})
);

builder.addEdge('__start__', 'AI回复' as end);
builder.addEdge('AI回复' as start, '报告生成' as end);
builder.addEdge('报告生成' as start, '__end__');

const reportAgent = builder.compile();

export { reportAgent };
