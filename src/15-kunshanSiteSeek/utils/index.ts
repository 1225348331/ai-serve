import type { PoolClient } from 'pg';
import data from '../data.json';
import pool from './db';
import { getLLM } from '../../../utils/AI/LLM';
import { ChatPromptTemplate, PromptTemplate } from '@langchain/core/prompts';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { z } from 'zod';
import zodToJsonSchema from 'zod-to-json-schema';

const schema = 'sde';

// 获取表格信息
export const getTableInfo = async (tableName: string, db: PoolClient) => {
	let tableInfo = '';

	// 获取表结构
	const tableSql = `
            SELECT 
                'CREATE TABLE "' || n.nspname || '"."' || c.relname || '" (' || E'\n' ||
                string_agg(
                    '  "' || a.attname || '" ' || 
                    pg_catalog.format_type(a.atttypid, a.atttypmod) || 
                    case when a.attnotnull then ' NOT NULL' else '' end ||
                    case when a.atthasdef then ' DEFAULT ' || pg_catalog.pg_get_expr(d.adbin, d.adrelid) else '' end,
                    ',' || E'\n'
                ) || E'\n' || ');' AS create_table
            FROM 
                pg_catalog.pg_class c
            JOIN 
                pg_catalog.pg_namespace n ON n.oid = c.relnamespace
            JOIN 
                pg_catalog.pg_attribute a ON a.attrelid = c.oid
            LEFT JOIN 
                pg_catalog.pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
            WHERE 
                n.nspname = '${schema}' AND 
                c.relname = '${tableName}' AND
                a.attnum > 0 AND 
                NOT a.attisdropped
            GROUP BY 
                n.nspname, c.relname;
        `;
	const tableResult = (await db.query(tableSql)).rows;
	const tableDef = tableResult[0]?.create_table || '';

	// 获取列名（排除shape列）
	const getColumnsSql = `
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_schema = '${schema}' 
                AND table_name = '${tableName}'
                AND column_name != 'shape'
            ORDER BY ordinal_position
        `;
	const columnsResult = (await db.query(getColumnsSql)).rows;
	const columnsArray = columnsResult as { column_name: string }[];
	const columns = columnsArray.map((col) => `"${col.column_name}"`).join(', ');

	// 获取示例数据
	const detailSql = `SELECT ${columns} FROM ${schema}.${tableName} LIMIT 3;`;
	const detailResult = (await db.query(detailSql)).rows;
	const data = detailResult as Record<string, string>[];

	let detail = columnsArray.map((col) => `${col.column_name}`).join(' ');
	detail += '\n';
	data.forEach((item) => {
		columnsArray.forEach((column) => {
			detail += item[column.column_name];
			detail += ' ';
		});
		detail += '\n';
	});

	// 拼接表信息
	tableInfo += `\n\n===== 表名: ${tableName} =====\n`;
	tableInfo += tableDef + '\n';
	tableInfo += detailSql + '\n';
	tableInfo += detail;

	return tableInfo;
};

// text2sqlAgent
export const text2sqlStream = async (question: string, landTable: string) => {
	// 获取所有表名
	const allTableName = data.landTables
		.filter((item) => item == landTable)
		// @ts-ignore
		.concat(data.allNeedTables.map((item) => item.name));
	// db
	const db = await pool.connect();
	// 表信息
	const tableInfoArr = await Promise.all(allTableName.map((tableName) => getTableInfo(tableName, db)));
	const tableInfo = tableInfoArr.join('\n');

	db.release();

	const model = getLLM({ temperature: 0 });

	const prompt = ChatPromptTemplate.fromMessages([
		[
			'system',
			`
	你是一个专业的数据库查询助手。请根据用户的问题仅生成对应的 SQL 查询语句。
	除非用户在问题中指定了要获取的具体示例数量，否则使用MySQL的LIMIT子句最多查询10个结果。
	可以通过排序返回数据库中最具信息量的数据。切勿查询表的所有列，必须仅查询回答问题所需的列，并用双引号(\"\")包裹列名作为分隔标识符。
	用户可能会出现属性或者名称错误，请根据实际情况进行修正。
	
	请严格注意以下要求：
	- **注意只使用下方表格中可见的列名，避免查询不存在的列，并注意各列所属的表 **。
	- 注意表中的shape字段为空间几何类型,若进行操作请进行空间函数操作，**地块相关面积必须使用st_area函数来计算地块面积 **
	- 查询结果中不得携带shape字段,且objectid不得重复
	- 若出现附近、周围等模糊限定词,优先使用1000m的缓冲区
	- 若出现容积率限定词,请将[{landTable}]和[控制性详细规划]做空间相交,相交的[控制性详细规划]的容积率即为[{landTable}]的容积率（控制性详细规划的容积率在最小容积率和最大容积率之间）
	- 出现“街道”字样优先考虑街道表、出现“道路”字样优先考虑[道路]表
	- 查询结果中地块编号不能重复，且提到的关键列结果需保留，如问题中提到虎丘、需保留街道列
	- 最终结果的主体必须是{landTable}表
	- **禁止使用ST_Azimuth函数,方向判断请利用比较坐标实现 **
	
	可用的表结构如下：
	{allTablesInfo}
	
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

	const chain = prompt.pipe(model).pipe(new StringOutputParser());

	const stream = await chain.stream({
		input: question,
		allTablesInfo: tableInfo,
		landTable,
	});

	return stream;
};

// 选址推荐Agent
export const recommendStream = async (queryResult: any[], question: string) => {
	const schema = z
		.array(
			z
				.object({
					objectid: z.string().describe(''),
					dkid: z.string().describe('地块编号'),
					name: z.string().describe('地块名称'),
					rate: z.number().describe('推荐分数，百分制'),
					reason: z.string().describe('推荐理由'),
				})
				.describe('推荐地块信息，按照推荐分数，倒序')
		)
		.describe('推荐地块数组');

	const jsonschema = zodToJsonSchema(schema);

	// AI提示词
	const AIPrompt = PromptTemplate.fromTemplate(`
作为专业的地块推荐系统，请基于用户需求和地块数据，智能筛选并推荐5个最优地块，注意如果待分析数据不足5，则按照实际数量进行推荐。

### 评分规则：
1. **核心需求匹配度**（权重50%）：  
   - 完全贴合用户核心诉求（如位置、用途、预算等）计为 50 分基准  
   - 部分契合时，按实际匹配程度动态核算（例如匹配 80% 对应 40 分）
2. **地块综合条件**（权重30%）：  
   - 从交通便捷度、周边配套完善度、区域规划前景等多维度综合评估，满分 30 分
3. **市场稀缺性**（权重20%）：  
   - 依据同类地块在当前市场的稀缺程度评定，满分 20 分
   
### 推荐标准：
1. 优先推荐核心需求匹配度高的地块，确保推荐的 5 个地块整体匹配度呈梯度合理分布，且均满足核心需求匹配度 60% 以上，其中：  
	 - 前 2 个推荐：核心需求完全匹配，综合表现处于第一梯队 
   - 中间 2 个推荐：核心需求匹配度 80% 以上，综合竞争力较强
   - 第 5 个推荐：核心需求匹配度 60% 以上，具备独特比较优势
2. 明显不符合用户核心需求的地块不予推荐：  

### 推荐要求：
1. 每个地块的推荐理由需包含：
	 - 核心优势（直接呼应用户核心需求）
	 - 至少 2 个差异化亮点（如独特交通优势、专属政策支持等）
2. **评分需真实反映地块间的竞争差距，避免呈现规律性递减的分数（如 95、90、85 这类模式化分数），体现各地块真实竞争力层级**
3. 严格输出5个地块

### 输出格式
严格输出JSON数据,不得携带任何无关内容，不得使用代码块，JSONSCHEMA描述如下：
{jsonschema}

### 待分析数据：
{queryResult}

### 用户需求：
{question}
`);

	const model = getLLM();

	const AIChain = AIPrompt.pipe(model).pipe(new StringOutputParser());

	const stream = await AIChain.stream({
		queryResult: queryResult,
		question: question,
		jsonschema: jsonschema,
	});

	return stream;
};

// sql修复Agent
export const recoverSqlStream = async (sql: string, error: string, landTable: string, question: string) => {
	// 获取所有表名
	const allTableName = data.landTables
		.filter((item) => item == landTable)
		// @ts-ignore
		.concat(data.allNeedTables.map((item) => item.name));
	// db
	const db = await pool.connect();
	// 表信息
	const tableInfoArr = await Promise.all(allTableName.map((tableName) => getTableInfo(tableName, db)));
	const tableInfo = tableInfoArr.join('\n');

	db.release();

	const llm = getLLM();
	const recoverSqlPrompt = ChatPromptTemplate.fromTemplate(`
你是专业的Postgres SQL数据库修复专家，能精准修复SQL语句错误并优化查询结果。请修复以下SQL语句错误，若查询结果不足5条，则适当放宽条件确保结果数量大于5：

用户问题：
{question}

可用表结构：
{tableInfo}

SQL语句：
{sql}

错误信息：
{error}

修复后的SQL需满足：
1.优先修复语法/结构错误
2.若修复后结果可能不足5条，则放宽查询条件
3.仅返回修正后的SQL语句
4.以分号结尾
5.不包含注释或解释
6.禁止使用代码块或markdown格式
7.不得使用insert、delete等影响数据的语句
`);

	const recoverSqlChain = recoverSqlPrompt.pipe(llm).pipe(new StringOutputParser());

	return await recoverSqlChain.stream({ sql, error, tableInfo, question });
};

// 将number转为2位小数
export function formatNumberToTwoDecimals(obj: Record<string, string | number | null>) {
	const formattedObj = { ...obj };

	for (const key in obj) {
		if (obj.hasOwnProperty(key)) {
			const value = obj[key];

			// 处理数字类型
			if (typeof value === 'number') {
				formattedObj[key] = parseFloat(value.toFixed(2));
			}
			// 处理字符串形式的数字
			else if (typeof value === 'string' && !isNaN(Number(value)) && value.trim() !== '') {
				const numValue = parseFloat(value);
				formattedObj[key] = numValue.toFixed(2);
			}
		}
	}

	return formattedObj;
}
