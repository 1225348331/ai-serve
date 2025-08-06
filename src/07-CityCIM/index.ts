import { Annotation, StateGraph, START, END } from '@langchain/langgraph';
import { SSEControl, wrapStep } from '../../utils/AI/SSE';
import { SqlDatabase } from 'langchain/sql_db';
import { createSqlQueryChain } from 'langchain/chains/sql_db';
import { DataSource } from 'typeorm';
import { ChatPromptTemplate, PromptTemplate } from '@langchain/core/prompts';
import { getLLM } from '../../utils/AI/LLM';

// 自然语言转sql
const text2sql = async (question: string) => {
	// 创建数据库连接
	const datasource = new DataSource({
		type: 'postgres',
		host: '2.40.17.51',
		port: 54321,
		username: 'postgres',
		password: 'sch123@abcd',
		database: 'gucheng',
		schema: 'sde',
	});

	await datasource.initialize();

	const db = await SqlDatabase.fromDataSourceParams({
		appDataSource: datasource,
	});

	const model = getLLM();

	// 创建自定义提示模板
	const prompt = ChatPromptTemplate.fromMessages([
		[
			'system',
			`
你是一个专业的数据库查询助手。请根据用户的问题仅生成对应的 SQL 查询语句。
除非用户在问题中指定了要获取的具体示例数量，否则使用MySQL的LIMIT子句最多查询{top_k}个结果。
可以通过排序返回数据库中最具信息量的数据。用双引号(\"\")包裹列名作为分隔标识符。
用户可能会出现属性或者名称错误，请根据实际情况进行修正。
注意只使用下方表格中可见的列名，避免查询不存在的列，并注意各列所属的表。
注意所有SQL查询结果中必须要携带objectid和layer_id字段
注意所有关于朝代的SQL语句，请使用%
	使用以下格式：
		Question: "问题内容" 
		SQLQuery: "要运行的SQL查询" 
		SQLResult: "SQL查询结果" 
		Answer: "最终答案" 
	仅使用以下表：{table_info} 
	Question: {input}
	
	注意：
		1. 只返回 SQL 查询语句，不要返回任何其他内容
		2. 不要使用 markdown 格式
		3. 不要添加任何注释或说明
		4. 确保 SQL 语句以分号结尾
	`,
		],
		['human', '{input}'],
	]);

	// 创建 SQL 查询链
	const chain = await createSqlQueryChain({
		llm: model,
		db: db,
		dialect: 'postgres',
		k: 1000,
		prompt: prompt,
	});

	const stream = chain.streamEvents(
		{
			question: question,
		},
		{
			version: 'v2',
		},
		{
			includeNames: ['StrOutputParser'],
		}
	);

	return { stream, db, datasource };
};

// 定义状态图节点信息
const GraphState = Annotation.Root({
	input: Annotation<string>({
		reducer: (x, y) => y ?? x,
	}),
	SSE: Annotation<SSEControl>({
		reducer: (x, y) => y ?? x,
	}),
	nodeResult: Annotation<NodeDataOptions[]>({
		reducer: (x, y) => x.concat(y),
		default: () => [],
	}),
	sql: Annotation<string>({
		reducer: (x, y) => y ?? x,
	}),
	queryResult: Annotation<string>({
		reducer: (x, y) => y ?? x,
	}),
	db: Annotation<SqlDatabase>({
		reducer: (x, y) => y ?? x,
	}),
	datasource: Annotation<DataSource>({
		reducer: (x, y) => y ?? x,
	}),
});

const builder = new StateGraph(GraphState);

type start = typeof START;
type end = typeof END;
type state = typeof GraphState.State;

// 查询数据库数据
builder.addNode(
	'SQL语句生成',
	wrapStep<state>(async (state, info) => {
		const { stream, db, datasource } = await text2sql(state.input);
		let result = '';
		for await (const chunk of stream) {
			if (chunk.data.chunk) {
				state.SSE.sendNodeData({
					status: 'process',
					stepName: info.runName!,
					data: {
						type: 'string',
						data: chunk.data.chunk,
					},
				});
			}
			if (chunk.data.output) {
				result = chunk.data.output;
			}
		}

		return {
			nodeResult: {
				type: 'string',
				data: result,
			},
			sql: result,
			db,
			datasource,
		};
	})
);

builder.addNode(
	'数据库查询结果',
	wrapStep<state>(async (state, info) => {
		const { db, datasource } = state;

		const queryResult = await db.run(state.sql);

		// 关闭数据库连接
		await datasource.destroy();

		return {
			nodeResult: {
				type: 'string',
				data: queryResult,
			},
			queryResult,
		};
	})
);

// 构建结果
builder.addNode(
	'AI回复',
	wrapStep<state>(async (state, info) => {
		console.log(state.queryResult);
		// AI提示词
		const AIPrompt = PromptTemplate.fromTemplate(`
以下数据为数据库中数据，请参考以下JSON数据，回答用户问题，可进行稍微发散性回答
JSON数据内容如下：
{queryResult}
用户问题如下：
{question}

## 请严格按照以下要求生成：
- 不要生成与回答无关的话术
- 若JSON数据存在图片和视频链接，链接需要加 http://2.40.7.238:8888/cim_file/ZRRW，不得随意创造或编造链接
- 若JSON数据存在图片链接，必须用严格按照以下格式渲染<img src="图片链接" width = "300" height = "200" alt="图片名称" align=center />
- 若JSON数据存在视频链接，视频必须严格按照以下格式渲染[视频描述](视频链接)
- 直接输出纯Markdown格式内容，不要包含任何代码块标记
- 要求格式美观，从二级标题开始渲染
`);
		const model = getLLM();

		const AIChain = AIPrompt.pipe(model);

		const stream = await AIChain.stream({
			queryResult: state.queryResult,
			question: state.input,
		});

		let result = '';
		for await (const chunk of stream) {
			state.SSE.sendNodeData({
				status: 'process',
				stepName: info.runName!,
				data: {
					type: 'string',
					data: chunk.content,
				},
			});
			result += chunk.content;
		}

		return {
			nodeResult: {
				type: 'string',
				data: result,
			},
		};
	})
);

// 设置节点关系
builder.addEdge('__start__', 'SQL语句生成' as end);
builder.addEdge('SQL语句生成' as start, '数据库查询结果' as end);
builder.addEdge('数据库查询结果' as start, 'AI回复' as end);
builder.addEdge('AI回复' as start, '__end__');


const CIMAgent = builder.compile();

export { CIMAgent };
