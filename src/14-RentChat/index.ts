import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { JsonOutputParser, StringOutputParser } from '@langchain/core/output_parsers';
import { SSEControl, wrapStep } from '../../utils/AI/SSE';
import { getLLM } from '../../utils/AI/LLM';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { Annotation, START, END, StateGraph } from '@langchain/langgraph';
import { fileParse } from '../../utils/AI/FileParse';
import { geocode, type IGeoCodeData } from '../../routes/geocode';
import { z } from 'zod';
import zodToJsonSchema from 'zod-to-json-schema';
import fs from 'fs/promises';
import path from 'path';
import destr from 'destr';
import { createHumanMessage } from '../../utils/AI/CreateHumanMessage';
import { markdownToDocx } from '../06-RobotChatWord/generateWord';

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
	// 问题地址化结果
	addressResult: Annotation<IGeoCodeData>(),
	// 模板结果
	fileResult: Annotation<string[]>(),
	// 聊天结果
	chatResult: Annotation<string>(),
});

type State = typeof GraphState.State;

const builder = new StateGraph(GraphState);

// 地址提取
builder.addNode(
	'地址提取',
	wrapStep<State>(async (state, info) => {
		const question = state.userContent[0].value;
		const data = await geocode(question);

		return {
			addressResult: data,
			nodeResult: {
				type: 'string',
				data: data.address,
			},
		};
	})
);

// 缓冲区分析
builder.addNode(
	'缓冲区分析',
	wrapStep<State>(async (state, info) => {
		const schema = z
			.object({
				buffer: z.number().describe('缓冲区公里数'),
			})
			.describe('缓冲区结构化数据');

		const prompt = ChatPromptTemplate.fromTemplate(`
你是一个结构化数据提取专家

### 输出要求
- 严格输出JSON格式，不得携带任何**代码块 **和无关内容，JSONSCHEMA内容描述如下：
{schema}

### 用户问题如下
{question}
`);

		const llm = getLLM();

		const chain = prompt.pipe(llm).pipe(new JsonOutputParser());

		const dataRes = (await chain.invoke({
			question: state.userContent[0].value,
			schema: JSON.stringify(zodToJsonSchema(schema)),
		})) as { buffer: number };

		const filePath = path.join(__dirname, '../../routes/rent.json');

		const fileData = await fs.readFile(filePath, 'utf-8');
		const rentData = destr(fileData) as (IGeoCodeData & { filename: string })[];

		const rentFileName = rentData
			.filter((item) => {
				const dis = calculateDistance(item.location, state.addressResult.location);
				return dis < dataRes.buffer * 1000;
			})
			.map((item) => item.filename);

		return {
			fileResult: rentFileName,
			nodeResult: {
				type: 'string',
				data: rentFileName.length ? rentFileName.join(',') : '无可参考租赁文件',
			},
		};
	})
);

// AI回复
builder.addNode(
	'AI回复',
	wrapStep<State>(async (state, info) => {
		const rentFilePath = path.join(__dirname, '../../routes/rent.json');
		const data = await fs.readFile(rentFilePath, 'utf-8');
		const rentData = (destr(data) as { filename: string; content?: string }[]).filter((item) => item.content);
		const couldUseFileData = state.fileResult
			.map((filename) => {
				const fileData = rentData.find((item) => item.filename === filename);
				return fileData ? `${filename},内容如下：\n${fileData.content}` : null;
			})
			.filter((content) => content != null)
			.map((item) => {
				return {
					type: 'text',
					text: item,
				};
			});

		const humanMessage = new HumanMessage({
			content: [
				{
					type: 'text',
					text: state.userContent[0].value,
				},
				...couldUseFileData,
			],
		});

		const systemMessage = new SystemMessage({
			content: `
# 角色与任务
你是一名专业的房地产评估师。请根据用户提出的具体问题和提供的相关文件（如房产信息、区域数据、市场报告等），生成一份结构完整、数据准确、分析专业的资产租金咨询报告。报告必须严格遵循下方提供的模板结构和格式要求，确保所有章节完整，并使用专业的房地产评估语言进行撰写。

# 报告生成规则
1.  **信息提取与整合**：仔细分析用户问题描述和提供的任何文件内容，提取所有与评估对象相关的信息，包括但不限于资产基本信息、区域特征、市场状况和可比案例数据。
2.  **数据补充与推理**：对于文件中未明确提供但报告模板要求的内容（例如，某些区域概况、社会因素等），你可以基于提供的其他信息、常识和房地产评估的一般规律进行合理的推断和补充，但必须确保其逻辑性和专业性。所有推断内容应基于提供的证据。
3.  **模板完整性**：必须生成模板中列出的所有章节和子章节。如果某些部分确实缺乏信息，可以注明“根据现有资料，该方面信息暂缺”或进行合理的定性描述，但不得遗漏任何章节。
4.  **日期处理**：报告完成时间、评估基准日期、报告有效期等所有日期相关字段，应基于当前日期（2025年8月25日）自动计算和填写。有效期通常为报告出具日起壹年。
5.  **货币与单位**：租金、面积等数值需明确单位（如元/平方米/月，平方米）。如果用户提供的文件中有单位，遵循文件；若无，使用行业通用单位。

# 输出格式要求
最终的输出必须严格遵循以下模板。不要添加任何额外的解释、开场白或结束语。

# 报告模板  
资产租金咨询报告生成模板

## 报告元数据
**报告类型**：资产租金咨询报告  
**报告完成时间**：2025年8月25日

---

## 1 咨询对象概况

### 1.1 基本信息
- **名称**：[根据用户输入和文件提取资产名称]  
- **坐落**：[根据用户输入和文件提取具体地址]  
- **面积**：[根据用户输入和文件提取面积及单位，如：100平方米]  
- **楼层**：[根据用户输入和文件提取所在楼层，如：第5层]  
- **用途**：[根据用户输入和文件提取资产用途，如：办公、零售、住宅等]

---

## 2 咨询对象描述

### 2.1 咨询对象区域描述

#### 2.1.1 区域概况
[综合用户提供的区域资料，描述所在区域的基本情况，如商务区、住宅区、混合用途区等，及其主要特点和发展水平]

#### 2.1.2 社会因素
[基于可用信息，描述人口结构、收入水平、社区特点、文化氛围等社会因素]

#### 2.1.3 交通条件
[描述附近的公共交通站点（地铁、公交）、主要道路干线、交通拥堵情况、通达性等]

#### 2.1.4 基础设施条件
[描述供水、供电、排水、通信网络等基础设施的完备性和可靠性]

#### 2.1.5 公共设施条件
[描述周边学校、医院、公园、图书馆、体育场馆等公共设施的分布、数量和品质]

#### 2.1.6 商服繁华程度
[描述周边商业发展水平，如购物中心、超市、餐馆、银行的数量和人流密度]

#### 2.1.7 城市规划限制
[根据资料推断或说明，描述用地性质、建筑高度限制、容积率要求、未来的城市发展或改造计划等]

#### 2.1.8 区域环境因素
[描述周边的自然环境，如是否临水、靠山，以及气候条件等]

#### 2.1.9 区域环境质量
[描述噪音水平、空气质量、绿化覆盖率、清洁程度等环境质量指标]

#### 2.1.10 区域内住宅集聚状况
[描述周边住宅区的密度、主要类型（高端小区、普通公寓等）、社区分布特点]

---

## 3 咨询时点
**评估基准日期**：2025年8月25日

---

## 4 咨询目的
为[根据用户问题提取具体用途，如：租赁决策、财务核算、法律纠纷等]提供租金价格参考

---

## 5 租金调查

### 5.1 比较对象的确定
基于资产现状、区位、面积、用途等因素，选定以下三套可比案例：

- **比较案例1**：[从用户提供的文件或根据区域和市场情况推断出的一个可比案例的简要描述，包括物业类型和核心特点]  
- **比较案例2**：[从用户提供的文件或根据区域和市场情况推断出的一个可比案例的简要描述]  
- **比较案例3**：[从用户提供的文件或根据区域和市场情况推断出的一个可比案例的简要描述]

### 5.2 比较对象租金调查

| 比较案例 | 租金水平             | 面积       | 区位特点             | 其他相关因素                     |
|----------|----------------------|------------|----------------------|----------------------------------|
| 案例1    | [如：5.0元/平方米/天] | [填入面积] | [简述区位优劣]       | [如：装修等级、租约条款、空置率等] |
| 案例2    | [填入案例2的租金]     | [填入面积] | [简述区位优劣]       | [如：装修等级、租约条款、空置率等] |
| 案例3    | [填入案例3的租金]     | [填入面积] | [简述区位优劣]       | [如：装修等级、租约条款、空置率等] |

---

## 6 租金结论
[基于以上所有分析，特别是可比案例的租金水平，进行综合修正和调整（如因素修正法），最终给出一个合理的租金建议范围或具体数值，并简要说明理由。例如：综合考量咨询对象的区位、自身条件及市场可比案例，建议月租金范围为人民币XX元至XX元（或XX元/平方米/月）。]

---

## 7 咨询报告应用有效期
**有效期**：自报告出具之日起壹年（2025年8月25日至 2026年8月24日）
      `,
		});

		const prompt = ChatPromptTemplate.fromMessages([systemMessage, humanMessage]);

		const llm = getLLM();

		const chain = prompt.pipe(llm).pipe(new StringOutputParser());

		const stream = await chain.stream({});

		let message = '';

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

		const fileName = `租金评估报告-${Date.now().toString()}`;
		await markdownToDocx(message, `${fileName}.docx`);

		message += `

[租金评估报告word版](${process.env.FILEADDRESS}/${fileName}.docx)
				`;

		return {
			chatResult: message,
			nodeResult: {
				type: 'string',
				data: message,
			},
		};
	})
);

builder.addEdge('__start__', '地址提取' as end);
builder.addEdge('地址提取' as start, '缓冲区分析' as end);
builder.addEdge('缓冲区分析' as start, 'AI回复' as end);
builder.addEdge('AI回复' as start, '__end__');

const rentAgent = builder.compile();

/**
 * 计算两个投影坐标系点之间的欧几里得距离
 * @param point1 第一个点的坐标 [x1, y1]
 * @param point2 第二个点的坐标 [x2, y2]
 * @returns 两点之间的距离
 */
function calculateDistance(point1: IGeoCodeData['location'], point2: IGeoCodeData['location']): number {
	const { lng: x1, lat: y1 } = point1;
	const { lng: x2, lat: y2 } = point2;

	// 计算坐标差值
	const dx = x2 - x1;
	const dy = y2 - y1;

	// 使用欧几里得距离公式
	return Math.sqrt(dx * dx + dy * dy);
}

export { rentAgent };
