import { Annotation, StateGraph, START, END } from '@langchain/langgraph';
import { SSEControl, wrapStep } from '../../utils/AI/SSE';
import { SqlDatabase } from 'langchain/sql_db';
import { DataSource } from 'typeorm';
import { ChatPromptTemplate, PromptTemplate } from '@langchain/core/prompts';
import { getLLM } from '../../utils/AI/LLM';
import { StringOutputParser } from '@langchain/core/output_parsers';
import * as z from 'zod';
import zodToJsonSchema from 'zod-to-json-schema';
import XLSX from 'xlsx';
import path from 'path';

// 定义状态图节点信息
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
	data: Annotation<
		{
			content: string;
			name: string;
			address: string;
			lon: string;
			lat: string;
			sz2000X: string;
			sz2000Y: string;
		}[]
	>,
});

const builder = new StateGraph(GraphState);

type start = typeof START;
type end = typeof END;
type state = typeof GraphState.State;

// 坐标解析
builder.addNode(
	'坐标解析',
	wrapStep<state>(async (state, info) => {
		// 文件路径
		const filename = state.input[1].value[0];
		if (!filename) throw new Error('未获取到上传文件');
		const filepath = path.join(__dirname, '../../upload/data', filename);
		// 读取Excel文件
		const workbook = XLSX.readFile(filepath);

		// 假设数据在第一个工作表
		const firstSheetName = workbook.SheetNames[0]!;
		const worksheet = workbook.Sheets[firstSheetName];

		// 将工作表转换为JSON
		const data = XLSX.utils.sheet_to_json(worksheet!);

		return {
			nodeResult: {
				type: 'string',
				data: `数据解析成功，共${data.length}条数据`,
			},
			data,
		};
	})
);

// 坐标落图
builder.addNode(
	'坐标落图',
	wrapStep<state>(async (state, info) => {
		return {
			nodeResult: {
				type: 'point-map',
				data: state.data,
			},
		};
	})
);

// 热力展示
builder.addNode(
	'热力展示',
	wrapStep<state>(async (state, info) => {
		return {
			nodeResult: {
				type: 'heatmap-map',
				data: state.data,
			},
		};
	})
);

// 设置节点关系
builder.addEdge('__start__', '坐标解析' as end);
builder.addEdge('坐标解析' as start, '坐标落图' as end);
builder.addEdge('坐标落图' as start, '热力展示' as end);
builder.addEdge('热力展示' as start, '__end__');

const HeatmapAnalysisAgent = builder.compile();

export { HeatmapAnalysisAgent };
