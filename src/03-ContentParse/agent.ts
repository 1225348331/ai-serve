import { ChatPromptTemplate } from '@langchain/core/prompts';
import { getLLM } from '../../utils/AI/LLM';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { z } from 'zod';
import zodToJsonSchema from 'zod-to-json-schema';

// 初始化LLM模型，设置温度为0.5以获得更稳定的输出
const llm = getLLM({
	temperature: 0.5,
});

// 定义信息提取的Zod模式
const extractInfo = z
	.object({
		// 地址名称
		address: z.string().describe('工单投诉位置'),
	})
	.describe('信息提取参数');

// 将Zod模式转换为JSON Schema
const schema = zodToJsonSchema(extractInfo);

// 转义JSON Schema中的大括号，用于模板字符串
const escapedSchema = JSON.stringify(schema).replace(/{/g, '{{').replace(/}/g, '}}');

// 创建提示模板
const promptTemplate = ChatPromptTemplate.fromTemplate(`
你是一个12345工单结构化地址提取专家，能够从复杂工单中提取工单投诉位置，要求如下：
- 仅返回JSON数据，不得使用代码块
- 若不能提取工单位置，则该字段为空字符串
- 提取的地址要求规范化,避免模糊的位置如附近、方向等字眼，能够被百度地图api能够进行地理编码

JSON数据Schema描述如下：
${escapedSchema}

用户信息如下：
{question}
`);

// 构建处理链：模板 -> LLM -> 字符串输出解析器
const agent = promptTemplate.pipe(llm).pipe(new StringOutputParser());

export { agent };
