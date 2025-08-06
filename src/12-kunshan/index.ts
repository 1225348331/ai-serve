import { SSEControl } from '../../utils/AI/SSE';
import { PromptTemplate } from '@langchain/core/prompts';
import { getLLM } from '../../utils/AI/LLM';
import { StringOutputParser } from '@langchain/core/output_parsers';
import * as z from 'zod';
import zodToJsonSchema from 'zod-to-json-schema';
import { Pool } from 'pg';
import destr from 'destr';

const tableInfo = [
	{
		type: '房屋',
		tablename: 'fw_a',
		column: ['图元名称', '院落面积', '层数'].join(','),
	},
	{
		type: '院落',
		tablename: 'yl_a',
		column: ['院落名称', '院落面积', '类型'].join(','),
	},
	{
		type: '道路',
		tablename: 'combined_roads',
		column: ['道路名称', '道路类型'].join(','),
	},
	{
		type: '水系',
		tablename: 'hl_l',
		column: ['河流名称', '长度', '等级'].join(','),
	},
];

/** 提取信息 */
const extractInfo = async (question: string) => {
	const schema = z.array(z.enum(['房屋', '院落', '道路', '水系'])).describe('类型');

	// AI提示词
	const AIPrompt = PromptTemplate.fromTemplate(`
根据用户的描述提取结构化数据。

用户描述：{question}，

JSON数据Schema描述如下:
{jsonschema}。

注意：不得携带任何代码块信息和语法
`);

	const model = getLLM();

	const AIChain = AIPrompt.pipe(model).pipe(new StringOutputParser());

	const result = await AIChain.invoke({
		question,
		jsonschema: JSON.stringify(zodToJsonSchema(schema)).replaceAll('{', '{{').replaceAll('}', '}}'),
	});

	return destr(result);
};

const dbQuery = async (type: string[], area: string) => {
	// 修改过滤逻辑，使用 includes 检查 type 数组中是否包含当前项的类型
	const filterResult = tableInfo.filter((item) => type.includes(item.type));

	// 表名称 - 注意现在可能有多个表匹配
	const tableNames = filterResult.map((item) => item.tablename);
	const columnNames = filterResult.map((item) => item.column);

	// 创建数据库连接
	const pool = new Pool({
		host: '222.92.185.58',
		port: 50031,
		user: 'postgres',
		password: 'sch123@abcd',
		database: 'kunshantest',
	});

	const client = await pool.connect();

	// 因为可能有多个表需要查询，我们使用 Promise.all 并行查询
	const queryPromises = tableNames.map((tableName, index) => {
		return client.query(`
            SELECT ${columnNames[index]}, COUNT(*) OVER() AS total_count
            FROM "sde"."${tableName}"
            WHERE st_intersects(
                shape, 
                st_geometry(
                    '${area}',
                    4490
                )
            );
        `);
	});

	const results = await Promise.all(queryPromises);

	// 合并所有查询结果
	const combinedResults = results.flatMap((result) => result.rows);

	return combinedResults;
};

const aiAnswer = async ({ queryResult, question, SSE }: { queryResult: any; question: string; SSE: SSEControl }) => {
	// AI提示词
	const AIPrompt = PromptTemplate.fromTemplate(`
你是一个数据库助手，负责根据用户问题和SQL查询结果生成自然语言回答。请遵循以下规则：

1. **理解上下文**：
   - 用户问题："[用户问题原文]"
   - 数据库结果：[此处粘贴查询结果，格式需为JSON/表格/数值/列表，非SQL代码]

2. **回答逻辑**：
   - ✅ **有结果时**：用简洁口语解释数据含义，避免数据库术语（如"列名"、"NULL"），重要数值需高亮。
   - ❌ **无结果时**：明确告知用户未找到数据，提供可能原因（如条件错误、数据缺失）。
   - 📊 **多数据时**：总结趋势或关键点（如最大值、异常值），避免直接罗列原始数据。

3. **格式要求**：
   - 首句直接回答问题
   - 复杂数据用👉箭头或**加粗**标重点
   - 结尾带一个友好表情符号

4. **禁用行为**：
   - ✖ 提及SQL语法或表结构
   - ✖ 主观推测数据原因
   - ✖ 无法回答问题时自行假设

---
**当前任务**：
问题："{question}"
结果：{queryResult}
`);

	const model = getLLM();

	const AIChain = AIPrompt.pipe(model);

	const stream = await AIChain.stream({
		queryResult,
		question,
	});

	SSE.sendNodeData({
		status: 'start',
		stepName: '基本对话',
		data: { type: 'string', data: '' },
	});

	let message = '';

	for await (const chunk of stream) {
		if (chunk.content) {
			message += chunk.content;
			SSE.sendNodeData({
				status: 'process',
				stepName: '基本对话',
				data: { type: 'string', data: chunk.content },
			});
		}
	}

	SSE.sendNodeData({
		status: 'success',
		stepName: '基本对话',
		data: { type: 'string', data: message },
	});
};

const KunShanAgent = async ({ question, SSE, area }: { question: string; SSE: SSEControl; area: string }) => {
	const type = await extractInfo(question);
	const queryResult = await dbQuery(type as string[], area);
	await aiAnswer({ queryResult, question, SSE });
};

export { KunShanAgent };
