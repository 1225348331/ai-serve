import {Annotation, StateGraph, START, END, Command} from '@langchain/langgraph';
import {SSEControl, wrapStep} from '../../utils/AI/SSE';
import {ChatPromptTemplate} from '@langchain/core/prompts';
import {z} from 'zod';
import data from './data.json';
import {getLLM} from '../../utils/AI/LLM';
import {JsonOutputParser} from '@langchain/core/output_parsers';
import zodToJsonSchema from 'zod-to-json-schema';
import {recommendStream, recoverSqlStream, text2sqlStream} from './utils';
import pool from './utils/db';
import destr from 'destr';
import {getError} from '../../utils/errUtils';

const GraphState = Annotation.Root({
	question: Annotation<string>({reducer: (x, y) => y ?? x}),
	SSE: Annotation<SSEControl>({reducer: (x, y) => y ?? x}),
	nodeResult: Annotation<NodeDataOptions[]>({
		reducer: (x, y) => x.concat(y),
		default: () => [],
	}),
	// 地块选择结果
	land: Annotation<string[]>({reducer: (x, y) => y ?? x, default: () => []}),
	// sql语句
	sql: Annotation<{ name: string; data: string }[]>({reducer: (x, y) => y ?? x}),
	// sql迭代反思信息
	recoverInfo: Annotation<{ name: string; data: string }[]>({reducer: (x, y) => y ?? x}),
	// sql查询
	queryResult: Annotation<{ name: string; data: any[]; error?: any }[]>({reducer: (x, y) => y ?? x}),
});

const builder = new StateGraph(GraphState);

type start = typeof START;
type end = typeof END;
type state = typeof GraphState.State;

// 地块选择
builder.addNode('地块选择', wrapStep<state>(async (state) => {
	const landTableZod = z.array(z.enum(data.landTables as [string, ...string[]])).describe('地块表名');

	const prompt = ChatPromptTemplate.fromTemplate(`
	##请你从用户问题中确定主体对象，提取结构化数据，如果未指定主体，则提取全部可选对象
	
	###主体对象提取规则
	- 仅提取描述中明确出现的地块名称关键字
	- 若未出现描述中的地块名称关键字，则必须全部提取可选对象
	
	###输出要求
	严格输出JSON数据,不得携带任何无关内容，不得使用代码块，JSONSCHEMA描述如下：
	{schema}

	###用户问题
	{question}
		`);

	const llm = getLLM({temperature: 0});

	const chain = prompt.pipe(llm).pipe(new JsonOutputParser());

	const land = await chain.invoke({
		schema: zodToJsonSchema(landTableZod),
		question: state.question,
	});

	return {
		land,
		nodeResult: {
			type: 'string',
			data: JSON.stringify(land),
		},
	};
}));

// 生成SQL语句
builder.addNode('SQL语句生成', wrapStep<state>(async (state, info) => {
	const landData = state.land.map((item) => {
		return {
			name: item,
			data: '',
		};
	});

	const promiseArr = state.land.map((landName, index) =>
		text2sqlStream(state.question, landName).then(async (stream) => {
			for await (const chunk of stream) {
				landData[index]!.data += chunk;
				state.SSE.sendNodeData({
					status: 'process',
					stepName: info.runName!,
					data: {
						type: 'siteseek-sql-array',
						data: landData,
					},
				});
			}
		})
	);

	await Promise.all(promiseArr);

	return {
		sql: landData,
		nodeResult: {
			type: 'siteseek-sql-array',
			data: landData,
		},
	};
}));

// 判断是否需要迭代
builder.addNode('判断是否需要迭代', async (state: state) => {
	const db = await pool.connect();

	let queryResult = state.sql.map((item) => {
		return {
			name: item.name,
		};
	}) as { name: string; data?: any; error?: any }[];

	try {
		queryResult = await Promise.all(
			state.sql.map((item) =>
				db
					.query(item.data)
					.then((sqlRes) => {
						if (sqlRes.rows.length < 5) {
							return {
								name: item.name,
								data: '',
								error: '查询结果小于5'
							}
						} else {
							return {
								name: item.name,
								data: sqlRes.rows,
							};
						}
					})
					.catch((err) => {
						return {
							name: item.name,
							data: '',
							error: getError(err),
						};
					})
			)
		);
	} finally {
		db.release();
	}

	const hasError = queryResult.some((item) => item.error);

	if (hasError) {
		return new Command({
			update: {queryResult},
			goto: 'sql迭代修复',
		});
	} else {
		return new Command({
			update: {queryResult},
			goto: '数据库查询结果',
		});
	}
}, {ends: ['sql迭代修复', '数据库查询结果']});

// sql迭代修复
builder.addNode('sql迭代修复', wrapStep<state>(async (state, info) => {
	const sqlArr = state.queryResult.map((item) => {
		if (item.error) {
			return {
				name: item.name,
				data: '',
			};
		} else {
			return state.sql.filter((sqlItem) => sqlItem.name == item.name)[0]!;
		}
	});

	const streamArr = state.queryResult
		.filter((item) => item.error)
		.map((item) =>
			recoverSqlStream(
				state.sql.filter((sql) => sql.name == item.name)[0]!.data!,
				item.error,
				item.name,
				state.question
			).then(async (stream) => {
				for await (const chunk of stream) {
					sqlArr.filter((queryItem) => queryItem.name == item.name)[0]!.data += chunk;
					state.SSE.sendNodeData({
						status: 'process',
						stepName: info.runName!,
						data: {
							type: 'siteseek-sql-array',
							data: sqlArr,
						},
					});
				}
			})
		);

	await Promise.all(streamArr);

	return {
		sql: sqlArr,
		nodeResult: {
			type: 'siteseek-sql-array',
			data: sqlArr,
		},
	};
}));

// 数据库查询结果
builder.addNode('数据库查询结果', wrapStep<state>(async (state) => {
	const db = await pool.connect();

	let queryResult = state.sql.map((item) => {
		return {
			name: item.name,
		};
	}) as { name: string; data?: any[]; error?: any }[];

	try {
		queryResult = await Promise.all(
			state.sql.map((item) =>
				db
					.query(item.data)
					.then((sqlRes) => {
						return {
							name: item.name,
							data: sqlRes.rows,
						};
					})
					.catch((err) => {
						return {
							name: item.name,
							error: getError(err),
						};
					})
			)
		);
	} finally {
		db.release();
	}

	return {
		queryResult,
		nodeResult: {
			type: 'siteseek-table-array',
			data: queryResult,
		},
	};
}));

// AI回复
builder.addNode('AI回复', wrapStep<state>(async (state, info) => {
	const answserData = state.land.map((item) => {
		return {
			name: item,
			data: '',
		};
	});

	const queryResult = state.queryResult.filter((item) => item.data.length);

	await Promise.all(
		queryResult.map((item, index) =>
			recommendStream(item.data, state.question).then(async (stream) => {
				for await (const chunk of stream) {
					answserData[index]!.data += chunk;
					state.SSE.sendNodeData({
						status: 'process',
						stepName: info.runName!,
						data: {
							type: 'siteseek-chart-string',
							data: JSON.stringify(answserData),
						},
					});
				}
			})
		)
	);

	return {
		nodeResult: {
			type: 'siteseek-chart-array',
			data: answserData.map((item) => {
				return {
					name: item.name,
					data: destr(item.data),
				};
			}),
		},
	};
}));

// 设置节点关系
builder.addEdge('__start__', '地块选择' as end);
builder.addEdge('地块选择' as start, 'SQL语句生成' as end);
builder.addEdge('SQL语句生成' as start, '判断是否需要迭代' as end);
builder.addEdge('sql迭代修复' as start, '判断是否需要迭代' as end);
builder.addEdge('数据库查询结果' as start, 'AI回复' as end);
builder.addEdge('AI回复' as start, '__end__');

const SiteSeekAgent = builder.compile();

export {SiteSeekAgent};
