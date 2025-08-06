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
		// 中线采样间隔（米）
		midSampleDis: z.number().describe('中线采样间隔'),
		// 横切面采样间隔（米）
		crossSampleDis: z.number().describe('横切面采样间隔'),

		// 标准断面参数
		sectionParams: z
			.object({
				bottomWidth: z.number().describe('底宽'), // 底宽（米）
				bottomHeight: z.number().describe('底标高'), // 底标高（米）
				topWidth: z.number().describe('面宽'), // 面宽（米）
				slope: z.number().describe('坡比'), // 坡比
			})
			.describe('标准断面相关参数'),

		// 维护断面参数（坡比不超过1）
		maintainParams: z
			.object({
				bottomWidth: z.number().describe('底宽'), // 底宽（米）
				bottomHeight: z.number().describe('底标高'), // 底标高（米）
				topWidth: z.number().describe('面宽'), // 面宽（米）
				slope: z.number().max(1).describe('坡比'), // 坡比（≤1）
			})
			.describe('维护断面相关参数'),

		// 桩号信息
		stationDescription: z
			.object({
				stationText: z.string().describe('桩点名称'), // 桩点名称（如"I2"）
				stationNumber: z.array(z.number().describe('桩点编号')), // 桩点编号数组（如[300]）
			})
			.describe('桩号相关参数'),

		// 水位参数
		waterParams: z
			.object({
				maxWaterZ: z.number().describe('最高水位'), // 最高水位（米）
				minWaterZ: z.number().describe('最低水位'), // 最低水位（米）
			})
			.describe('水位相关参数'),
	})
	.describe('信息提取参数');

// 将Zod模式转换为JSON Schema
const schema = zodToJsonSchema(extractInfo);

// 转义JSON Schema中的大括号，用于模板字符串
const escapedSchema = JSON.stringify(schema).replace(/{/g, '{{').replace(/}/g, '}}');

// 创建提示模板
const promptTemplate = ChatPromptTemplate.fromTemplate(`
你是一个河流横截面信息提取专家，请从用户输入信息中，提取中线采样间隔数值、横切面采样间隔的数值、标准断面相关数值、维护断面相关数值、桩号相关数值，要求如下：
- 若无相关信息，则相应字段值为null，但对象本身一定不为null
- 提取的数值必须以米为基准
- 仅返回JSON对象数据
- 桩号规则如下，假设桩号为I2+300,则I2为桩点名称，300为桩点编号
- 坡度一定小于1

JSON数据Schema描述如下：
${escapedSchema}

用户信息如下：
{question}
`);

// 构建处理链：模板 -> LLM -> 字符串输出解析器
const agent = promptTemplate.pipe(llm).pipe(new StringOutputParser());

export { agent };
