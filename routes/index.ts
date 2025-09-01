import express, { type Request, type Response } from 'express';
import { destr } from 'destr';
import { SSEControl } from '../utils/AI/SSE';
import { fileUploadMiddleware } from '../middleware/fileUpload';
import { robotChat } from '../src/01-RobotChat';
import { getError } from '../utils/errUtils';
import { addMessage, getOrCreateConversation, pool } from '../utils/AI/db/ChatHistory';
import { crossSectionAgent } from '../src/02-CrossSection';
import contentParseAgent from '../src/03-ContentParse';
import { text2imageAgent } from '../src/04-Text2Image';
import { text2videoAgent } from '../src/05-Text2Video';
import { robotChatGenerateWord } from '../src/06-RobotChatWord';
import { CIMAgent } from '../src/07-CityCIM';
import { SiteSeekAgent } from '../src/08-SiteSeek/index';
import { UAVCompareAgent } from '../src/09-UAVCompare';
import { policyAnalysisAgent } from '../src/10-PolicyAnalysis';
import { HeatmapAnalysisAgent } from '../src/11-HeatmapAnalysis';
import { KunShanAgent } from '../src/12-kunshan';
import { reportAgent } from '../src/13-Report';
import { geocode } from './geocode';
import path from 'path';
import fs from 'fs/promises';
import { rentAgent } from '../src/14-RentChat';
import { KunshanSiteSeekAgent } from '../src/15-kunshanSiteSeek';
import { fileParse } from '../utils/AI/FileParse';

const router = express.Router();
const rentJsonPath = path.join(__dirname, './rent.json');

// 首页路由
router.get('/', (req, res) => {
	res.send('恭喜你找到了八月小辉辉的express应用');
});

// 文件上传接口
router.post('/upload', fileUploadMiddleware, async (req: Request, res: Response) => {
	if (req.fields && req.fields.rent) {
		const geocodePromise = req.files?.map((item) => {
			return geocode(item.filename);
		})!;
		const geocodeData = await Promise.all(geocodePromise);

		if (geocodeData.some((item) => !item?.location?.lng)) {
			res.status(200).json({
				code: 500,
				data: '文件名不存在地址信息',
			});
			return;
		}

		// 追加数据到 rent.json
		try {
			// 先读取现有数据
			let existingData: { filename: string }[] = [];
			try {
				const data = await fs.readFile(rentJsonPath, 'utf8');
				existingData = JSON.parse(data);
			} catch (readError) {
				// 如果文件不存在或为空，则使用空数组
				console.log('创建新的 rent.json 文件或读取现有文件时出错，将创建新文件');
			}

			existingData = existingData.filter((item) => !req.files?.map((file) => file.filename)?.includes(item.filename));

			// 将新数据追加到现有数据中
			const updatedData = [...existingData, ...geocodeData];

			// 写入更新后的数据
			await fs.writeFile(rentJsonPath, JSON.stringify(updatedData, null, 2), 'utf8');

			console.log('geocodeData 已成功追加到 rent.json');
		} catch (writeError) {
			console.error('写入文件时出错:', writeError);
			res.json({
				code: 500,
				data: `写入文件时出错:${writeError}`,
			});
			throw writeError; // 重新抛出错误以便外层 catch 捕获
		}
	}
	res.json({
		success: true,
		message: '文件上传成功',
		fields: req.fields,
		files: req.files?.map((file) => ({
			fieldname: file.fieldname,
			filename: file.filename,
			mimetype: file.mimetype,
			size: file.size,
			path: file.path,
		})),
	});
});

// 聊天对话接口
router.post('/chat', async (req, res) => {
	const { userContent, id, application_type, params } = req.body;
	if (!userContent || !application_type || !params) {
		res.status(500).send('必填字段不能为空');
		return;
	}

	const sseControl = new SSEControl(res);
	try {
		await robotChat({ sseControl, userContent, application_type, id, params });
	} catch (error) {
		sseControl.sendData({
			status: 'error',
			stepName: '基本对话',
			data: {
				type: 'string',
				data: getError(error),
			},
		});
	} finally {
		sseControl.endSSE();
	}
});

// 创建新对话接口
router.get('/createConversation', async (req: Request, res: Response) => {
	const { application_type } = req.query;
	if (!application_type) {
		res.json({
			code: 500,
			data: 'application_type必填参数不能为空',
		});
		return;
	}

	const conversationId = await getOrCreateConversation(null, application_type as string);
	res.json({
		code: 200,
		data: conversationId,
	});
});

// 获取所有会话列表接口
router.get('/getConversationList', async (req: Request, res: Response) => {
	try {
		const sql = `
      SELECT 
        c.id,
        c.application_type,
        COALESCE(
          (SELECT m.original_content 
          FROM messages m 
          WHERE m.conversation_id = c.id 
          AND m.role = 'user' 
          ORDER BY m.created_at ASC 
          LIMIT 1),
          '新会话'
        ) AS title,
        c.created_at AS time,
        (SELECT COUNT(*) 
        FROM messages m 
        WHERE m.conversation_id = c.id) AS message_count
      FROM 
        conversations c
      ORDER BY 
        c.created_at DESC;
    `;
		const result = await pool.query(sql);
		result.rows.forEach((item) => {
			item.title = (destr(item.title) as UserChatMessage)[0].value || '新会话';
		});
		res.json({
			code: 200,
			data: result.rows,
		});
	} catch (error) {
		res.json({
			code: 500,
			data: getError(error),
		});
	}
});

// 删除会话接口
router.post('/deleteConversation', async (req: Request, res: Response) => {
	const { id } = req.body;
	if (!id) {
		res.status(500).send('id不能为空');
		return;
	}

	try {
		// 开始事务
		await pool.query('BEGIN');

		// 删除消息
		await pool.query('DELETE FROM messages WHERE conversation_id = $1', [id]);

		// 删除会话
		await pool.query('DELETE FROM conversations WHERE id = $1', [id]);

		// 提交事务
		await pool.query('COMMIT');

		res.send({
			code: 200,
			data: '会话删除成功',
		});
	} catch (err) {
		// 出错时回滚
		await pool.query('ROLLBACK');
		res.json({
			code: 500,
			data: err,
		});
	}
});

// 获取会话消息列表接口
router.get('/getMessageList', async (req: Request, res: Response) => {
	const { id } = req.query;
	if (!id) res.status(500).send('id不能为空');

	const sql = `
    SELECT 
      id,
      role,
      original_content as content,
      created_at as timestamp
    FROM 
      messages
    WHERE 
      conversation_id = $1
    ORDER BY 
      created_at ASC;
  `;

	const result = await pool.query(sql, [id]);
	result.rows.forEach((item) => {
		item.content = destr(item.content);
	});

	res.json({
		code: 200,
		data: result.rows,
	});
});

/** 横断面生成 */
router.post('/cross-section', async (req, res, next) => {
	const { userContent, id } = req.body;
	if (!userContent || !id) throw new Error('必填参数不能为空');
	const sseControl = new SSEControl(res);
	const data = await crossSectionAgent.invoke({
		input: userContent[0].value,
		fileList: userContent[1].value,
		SSE: sseControl,
	});
	try {
		await addMessage(id, 'user', userContent, userContent);
		await addMessage(id, 'assistant', data.nodeResult, data.nodeResult);
	} catch (error) {
		sseControl.sendNodeData({
			status: 'error',
			stepName: '结果保存',
			data: {
				type: 'string',
				data: getError(error),
			},
		});
	} finally {
		sseControl.endSSE();
	}
});

/** 提示词专家 */
router.post('/chat-prompt-generate', async function (req, res, next) {
	const { userContent, id, application_type, params } = req.body;
	if (!userContent || !application_type || !params) {
		res.status(500).send('必填字段不能为空');
	}
	const sseControl = new SSEControl(res);
	try {
		const systemPrompt = `
你是一位大模型提示词生成专家，请根据用户的需求编写一个智能助手的提示词，来指导大模型进行内容生成，要求：
1. 以 Markdown 格式输出
2. 贴合用户需求，描述智能助手的定位、能力、知识储备
3. 提示词应清晰、精确、易于理解，在保持质量的同时，尽可能简洁
4. 只输出提示词，不要输出多余解释
		`;
		await robotChat({ sseControl, userContent, application_type, id, systemPrompt, params });
	} catch (error) {
		sseControl.sendData({
			status: 'error',
			stepName: '基本对话',
			data: {
				type: 'string',
				data: getError(error),
			},
		});
	} finally {
		sseControl.endSSE();
	}
});

/** 翻译通 */
router.post('/chat-translate', async function (req, res, next) {
	const { userContent, id, application_type, params } = req.body;
	if (!userContent || !application_type || !params) {
		res.status(500).send('必填字段不能为空');
	}
	const sseControl = new SSEControl(res);
	try {
		const systemPrompt =
			'你是一个中英文翻译专家，将用户输入的中文翻译成英文，或将用户输入的英文翻译成中文。对于非中文内容，它将提供中文翻译结果。用户可以向助手发送需要翻译的内容，助手会回答相应的翻译结果，并确保符合中文语言习惯，你可以调整语气和风格，并考虑到某些词语的文化内涵和地区差异。同时作为翻译家，需将原文翻译成具有信达雅标准的译文。"信" 即忠实于原文的内容与意图；"达" 意味着译文应通顺易懂，表达清晰；"雅" 则追求译文的文化审美和语言的优美。目标是创作出既忠于原作精神，又符合目标语言文化和读者审美的翻译。';
		await robotChat({ sseControl, userContent, application_type, id, systemPrompt, params });
	} catch (error) {
		sseControl.sendData({
			status: 'error',
			stepName: '基本对话',
			data: {
				type: 'string',
				data: getError(error),
			},
		});
	} finally {
		sseControl.endSSE();
	}
});

/** 文案大纲生成 */
router.post('/chat-outline-generate', async function (req, res, next) {
	const { userContent, id, application_type, params } = req.body;
	if (!userContent || !application_type || !params) {
		res.status(500).send('必填字段不能为空');
	}
	const sseControl = new SSEControl(res);
	try {
		const systemPrompt = `
你是一位文本大纲生成专家，擅长根据用户的需求创建一个有条理且易于扩展成完整文章的大纲，你拥有强大的主题分析能力，能准确提取关键信息和核心要点。具备丰富的文案写作知识储备，熟悉各种文体和题材的文案大纲构建方法。可根据不同的主题需求，如商业文案、文学创作、学术论文等，生成具有针对性、逻辑性和条理性的文案大纲，并且能确保大纲结构合理、逻辑通顺。该大纲应该包含以下部分：
引言：介绍主题背景，阐述撰写目的，并吸引读者兴趣。
主体部分：第一段落：详细说明第一个关键点或论据，支持观点并引用相关数据或案例。
第二段落：深入探讨第二个重点，继续论证或展开叙述，保持内容的连贯性和深度。
第三段落：如果有必要，进一步讨论其他重要方面，或者提供不同的视角和证据。
结论：总结所有要点，重申主要观点，并给出有力的结尾陈述，可以是呼吁行动、提出展望或其他形式的收尾。
创意性标题：为文章构思一个引人注目的标题，确保它既反映了文章的核心内容又能激发读者的好奇心。
		`;
		await robotChat({ sseControl, userContent, application_type, id, systemPrompt, params });
	} catch (error) {
		sseControl.sendData({
			status: 'error',
			stepName: '基本对话',
			data: {
				type: 'string',
				data: getError(Error),
			},
		});
	} finally {
		sseControl.endSSE();
	}
});

/** 文生图 */
router.post('/text2image', async (req, res, next) => {
	const { userContent, id } = req.body;
	if (!userContent || !id) throw new Error('必填参数不能为空');
	const sseControl = new SSEControl(res);
	const data = await text2imageAgent.invoke({
		input: userContent[0].value,
		SSE: sseControl,
	});
	await addMessage(id, 'user', userContent, userContent);
	await addMessage(id, 'assistant', data.nodeResult, data.nodeResult);
	sseControl.endSSE();
});

/** 文生视频 */
router.post('/text2video', async (req, res, next) => {
	const { userContent, id } = req.body;
	if (!userContent || !id) throw new Error('必填参数不能为空');
	const sseControl = new SSEControl(res);
	const data = await text2videoAgent.invoke({
		input: userContent[0].value,
		SSE: sseControl,
	});
	await addMessage(id, 'user', userContent, userContent);
	await addMessage(id, 'assistant', data.nodeResult, data.nodeResult);
	sseControl.endSSE();
});

/** 航道图像理解 */
router.post('/waterway-image-understand', async function (req, res, next) {
	const { userContent, id, application_type } = req.body;
	if (!userContent || !application_type) {
		res.status(500).send('必填字段不能为空');
	}
	const sseControl = new SSEControl(res);
	try {
		const systemPrompt = `
## 你是一河道图片理解专家，能够理解图片内容，能够生成800字对图片的内容理解描述，同时要求考虑是否有异常情况

### 需要包含的要求如下：
- 需要描述图片中的文字，一般包含时间和地点
- 若出现船只，请准确描述船只数量
- 若出现航道驳岸，则需要判定航道驳岸是否正常，是否存在破损等情况
- 若存在航道标识牌，需要判定航道标识牌是否倾倒等现象
- 需要判定航道中间是否存在围堰桩等异物
- 是否存在其他航道异常事件

### 注意事项如下：
- 要求报告大纲层次分明
		`;
		await robotChatGenerateWord({ sseControl, userContent, application_type, id, systemPrompt });
	} catch (error) {
		sseControl.sendData({
			status: 'error',
			stepName: '基本对话',
			data: {
				type: 'string',
				data: getError(error),
			},
		});
	} finally {
		sseControl.endSSE();
	}
});

/** 无人机报告生成 */
router.post('/uav-report-generate', async function (req, res, next) {
	const { userContent, id, application_type } = req.body;
	if (!userContent || !application_type) {
		res.status(500).send('必填字段不能为空');
	}
	const sseControl = new SSEControl(res);
	try {
		const systemPrompt = `
## 角色定位
你是一名专业的无人机巡查报告生成专家，擅长通过无人机巡查视频生成结构化报告。

## 能力要求
1. 准确理解并提取巡查视频中的关键信息
2. 按照标准模板组织报告内容

## 输出要求
生成完整的工地巡查报告，包含以下内容：

### 工地巡查报告

#### 一、基本信息

#### 二、巡查结果

#### 三、问题分析与建议

## 注意事项
1. 使用专业术语但保持可读性
2. 数据需具体量化
3. 建议应具有可操作性
4. 保持客观中立的表述
5. 不得胡编乱造信息，必须基于视频内容
		`;
		await robotChatGenerateWord({ sseControl, userContent, application_type, id, systemPrompt });
	} catch (error) {
		sseControl.sendData({
			status: 'error',
			stepName: '基本对话',
			data: {
				type: 'string',
				data: getError(error),
			},
		});
	} finally {
		sseControl.endSSE();
	}
});

/** 古城文物保护 */
router.post('/cim-chat', async (req, res) => {
	const { userContent, id } = req.body;
	if (!userContent || !id) {
		res.status(500).json('必填参数不能为空');
		return;
	}
	const sseControl = new SSEControl(res);
	const data = await CIMAgent.invoke({
		input: userContent[0].value,
		SSE: sseControl,
	});
	await addMessage(id, 'user', userContent, userContent);
	await addMessage(id, 'assistant', data.nodeResult, data.nodeResult);
	sseControl.endSSE();
});

/** 选址推荐 */
router.post('/site-seek', async (req, res) => {
	const { userContent, id } = req.body;
	if (!userContent || !id) {
		res.status(500).json('必填参数不能为空');
		return;
	}
	const sseControl = new SSEControl(res);
	try {
		const data = await SiteSeekAgent.invoke(
			{
				question: userContent[0].value,
				SSE: sseControl,
			},
			{
				recursionLimit: 50,
			}
		);
		await addMessage(id, 'user', userContent, userContent);
		await addMessage(id, 'assistant', data.nodeResult, data.nodeResult);
	} catch (error) {
	} finally {
		sseControl.endSSE();
	}
});

/** 智能识别 */
router.post('/uav-compare', async (req, res) => {
	const { userContent, id } = req.body;
	if (!userContent || !id) {
		res.status(500).json('必填参数不能为空');
		return;
	}
	const sseControl = new SSEControl(res);
	try {
		const data = await UAVCompareAgent.invoke({
			input: userContent,
			SSE: sseControl,
		});
		await addMessage(id, 'user', userContent, userContent);
		await addMessage(id, 'assistant', data.nodeResult, data.nodeResult);
	} catch (error) {
	} finally {
		sseControl.endSSE();
	}
});

/** 智能定位 */
router.post('/content-parse', async (req, res) => {
	const { userContent, id } = req.body;
	if (!userContent || !id) {
		res.status(500).json('必填参数不能为空');
		return;
	}
	const sseControl = new SSEControl(res);
	try {
		const data = await contentParseAgent.invoke({
			input: userContent,
			SSE: sseControl,
		});
		await addMessage(id, 'user', userContent, userContent);
		await addMessage(id, 'assistant', data.nodeResult, data.nodeResult);
	} catch (error) {
	} finally {
		sseControl.endSSE();
	}
});

/** 政策文件解析 */
router.post('/policy-analysis', async function (req, res, next) {
	const { userContent, id, application_type } = req.body;
	if (!userContent || !application_type) {
		res.status(500).send('必填字段不能为空');
	}
	const sseControl = new SSEControl(res);
	try {
		const data = await policyAnalysisAgent.invoke({
			userContent,
			SSE: sseControl,
		});
		await addMessage(id, 'user', userContent, userContent);
		await addMessage(id, 'assistant', data.nodeResult, data.nodeResult);
	} catch (error) {
	} finally {
		sseControl.endSSE();
	}
});

/** AI热力分析 */
router.post('/heatmap-analysis', async (req, res) => {
	const { userContent, id } = req.body;
	if (!userContent || !id) {
		res.status(500).json('必填参数不能为空');
		return;
	}
	const sseControl = new SSEControl(res);
	try {
		const data = await HeatmapAnalysisAgent.invoke({
			input: userContent,
			SSE: sseControl,
		});
		await addMessage(id, 'user', userContent, userContent);
		await addMessage(id, 'assistant', data.nodeResult, data.nodeResult);
	} catch (error) {
	} finally {
		sseControl.endSSE();
	}
});

/** 昆山分析 */
router.post('/kunshan-analysis', async (req, res) => {
	const { userContent, params } = req.body;
	if (!userContent || !params || !params.area) {
		res.status(500).send('必填字段不能为空');
		return;
	}

	const question = userContent[0].value;
	const area = params.area;

	const sseControl = new SSEControl(res);
	try {
		await KunShanAgent({ SSE: sseControl, question, area });
	} catch (error) {
		sseControl.sendData(getError(error));
	} finally {
		sseControl.endSSE();
	}
});

/** 安全巡检 */
router.post('/safe-inspect', async (req, res) => {
	const { userContent, id, application_type, params } = req.body;
	if (!userContent || !application_type || !params) {
		res.status(500).send('必填字段不能为空');
		return;
	}

	function generateYearMonthArray(
		startYear: number,
		startMonth: number,
		endYear: number,
		endMonth: number,
		exclude: string[] = []
	): string[] {
		const result: string[] = [];

		let currentYear = startYear;
		let currentMonth = startMonth;

		while (currentYear < endYear || (currentYear === endYear && currentMonth <= endMonth)) {
			const monthStr = currentMonth.toString().padStart(2, '0');
			const yearMonth = `${currentYear}${monthStr}月`;

			if (!exclude.includes(yearMonth)) {
				result.push(yearMonth);
			}

			// 移动到下一个月
			currentMonth++;
			if (currentMonth > 12) {
				currentMonth = 1;
				currentYear++;
			}
		}

		return result;
	}

	const yearMonthArray = generateYearMonthArray(2025, 1, 2025, 6, ['202505月']);

	userContent[1].value = yearMonthArray.map((item) => `${item}度安检报告.docx`);

	const sseControl = new SSEControl(res);

	try {
		await robotChat({ sseControl, userContent, application_type, id, params });
	} catch (error) {
		sseControl.sendData({
			status: 'error',
			stepName: '基本对话',
			data: {
				type: 'string',
				data: getError(error),
			},
		});
	} finally {
		sseControl.endSSE();
	}
});

/** 用地评价报告 */
router.post('/report-analysis', async (req, res) => {
	const { userContent, id } = req.body;
	if (!userContent || !id) {
		res.status(500).json('必填参数不能为空');
		return;
	}
	const sseControl = new SSEControl(res);
	try {
		const data = await reportAgent.invoke({
			userContent: userContent,
			SSE: sseControl,
		});
	} catch (error) {
	} finally {
		sseControl.endSSE();
	}
});

/** 租金评估文件列表 */
router.get('/rentFileList', async (req, res) => {
	const data = await fs.readFile(rentJsonPath, 'utf8');
	const existingData = JSON.parse(data);

	res.json({
		code: 200,
		data: (existingData as { filename: string; content?: string }[]).map((item) => {
			return {
				filename: item.filename,
				status: item.content ? (item.content != '解析失败' ? 'success' : 'failed') : 'waiting',
			};
		}),
	});
});

/** 租金评估文件删除接口 */
router.post('/rentFileDelete', async (req, res) => {
	try {
		const { filename } = req.body;

		// 验证文件名是否存在
		if (!filename) {
			res.status(200).json({
				code: 500,
				message: '文件名不能为空',
			});
			return;
		}

		// 读取现有数据
		const data = await fs.readFile(rentJsonPath, 'utf8');
		const existingData = JSON.parse(data) as { filename: string }[];

		// 检查文件是否存在
		const fileIndex = existingData.findIndex((item) => item.filename === filename);
		if (fileIndex === -1) {
			res.json({
				code: 500,
				message: '文件不存在',
			});
			return;
		}

		// 从数组中删除文件记录
		existingData.splice(fileIndex, 1);

		// 写回更新后的数据
		await fs.writeFile(rentJsonPath, JSON.stringify(existingData, null, 2));

		res.json({
			code: 200,
			message: '文件删除成功',
			data: filename,
		});
	} catch (error) {
		console.error('删除文件时出错:', error);
		res.status(500).json({
			code: 500,
			message: '服务器内部错误',
		});
	}
});

/** 租金文件解析 */
router.post('/rentFileParse', async (req, res) => {
	const { filename } = req.body;
	const data = await fs.readFile(rentJsonPath, 'utf-8');
	const rentData = destr(data) as { filename: string; content: string }[];
	const hasFile = rentData.some((item) => item.filename == filename);
	if (hasFile) {
		res.json({
			code: 200,
			data: '已检测到文件,开始执行OCR任务',
		});
		fileParse(filename)
			.then(async (content) => {
				const fileData = await fs.readFile(rentJsonPath, 'utf-8');
				const rentData = destr(fileData) as { filename: string; content: string }[];
				rentData.forEach((item) => {
					if (item.filename == filename) {
						item.content = content;
					}
				});
				await fs.writeFile(rentJsonPath, JSON.stringify(rentData, null, 2), 'utf8');
			})
			.catch(async () => {
				const fileData = await fs.readFile(rentJsonPath, 'utf-8');
				const rentData = destr(fileData) as { filename: string; content: string }[];
				rentData.forEach((item) => {
					if (item.filename == filename) {
						item.content = '解析失败';
					}
				});
				await fs.writeFile(rentJsonPath, JSON.stringify(rentData, null, 2), 'utf8');
			});
	} else {
		res.json({
			code: 500,
			data: '未检测到文件',
		});
	}
});

/** 租金评估 */
router.post('/rent-analysis', async (req, res) => {
	const { userContent, id } = req.body;
	if (!userContent || !id) {
		res.status(500).json('必填参数不能为空');
		return;
	}
	const sseControl = new SSEControl(res);

	try {
		const data = await rentAgent.invoke({
			userContent,
			SSE: sseControl,
		});
		await addMessage(id, 'user', userContent, userContent);
		await addMessage(id, 'assistant', data.nodeResult, data.nodeResult);
	} catch (error) {
	} finally {
		sseControl.endSSE();
	}
});

/** 昆山选址推荐 */
router.post('/kunshan-site-seek', async (req, res) => {
	const { userContent, id } = req.body;
	if (!userContent || !id) {
		res.status(500).json('必填参数不能为空');
		return;
	}
	const sseControl = new SSEControl(res);
	try {
		const data = await KunshanSiteSeekAgent.invoke(
			{
				question: userContent[0].value,
				SSE: sseControl,
			},
			{
				recursionLimit: 50,
			}
		);
		await addMessage(id, 'user', userContent, userContent);
		await addMessage(id, 'assistant', data.nodeResult, data.nodeResult);
	} catch (error) {
	} finally {
		sseControl.endSSE();
	}
});

export default router;
