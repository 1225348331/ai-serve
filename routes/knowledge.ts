import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import { VectorDB } from '../utils/AI/LanceDB';
import { getError } from '../utils/errUtils';
import { getAllKnowledgeClassification, insertKnowledgeClassificationName } from '../utils/AI/db/Knowledge';
import { SSEControl } from '../utils/AI/SSE';
import { robotChat } from '../src/01-RobotChat';
import { omit } from 'lodash';
import { fileParse } from '../utils/AI/FileParse';

const router = express.Router();

const db = new VectorDB();

// 统一错误处理中间件
const asyncHandler =
	(fn: (req: Request, res: Response, next: NextFunction) => Promise<any>) =>
	(req: Request, res: Response, next: NextFunction) => {
		Promise.resolve(fn(req, res, next)).catch(next);
	};

/* GET users listing. */
router.get('/', (req: Request, res: Response, next: NextFunction) => {
	try {
		res.send('respond with a resource');
	} catch (error) {
		next(error);
	}
});

/** 获取知识库分类 */
router.get(
	'/getAllKnowledgeClassification',
	asyncHandler(async (req: Request, res: Response) => {
		const data = await getAllKnowledgeClassification();
		res.status(200).json({
			code: 200,
			data,
		});
	})
);

/** 新增知识库分类 */
router.get(
	'/insertKnowledgeClassification',
	asyncHandler(async (req: Request, res: Response) => {
		const { cnname } = req.query;

		if (!cnname) {
			return res.status(400).json({
				code: 400,
				message: '缺少必要参数: cnname',
			});
		}

		const data = await insertKnowledgeClassificationName(cnname as string);
		await db.initTable(data);
		res.status(200).json({
			code: 200,
			data,
		});
	})
);

/* 嵌入文件 */
router.post(
	'/embeddingFiles',
	asyncHandler(async (req: Request, res: Response) => {
		const { fileNames, tableName } = req.body;

		if (!fileNames || !Array.isArray(fileNames) || !fileNames.length || !tableName) {
			return res.status(400).json({
				code: 400,
				message: '缺失必填参数: fileNames (array) and tableName',
			});
		}

		(fileNames as string[]).forEach((item) => {
			db.processFile(tableName, item);
		});

		res.status(200).json({
			code: 200,
			message: '文件处理中...',
		});

		// const promisesArr = (fileNames as string[]).map((fileName) => {
		// 	return new Promise<{ fileName: string; status: boolean; error?: string }>(async (resolve) => {
		// 		try {
		// 			await db.insertFile(tableName, fileName);
		// 			resolve({ fileName, status: true });
		// 		} catch (error) {
		// 			console.error(`Error embedding file ${fileName}:`, error);
		// 			resolve({
		// 				fileName,
		// 				status: false,
		// 				error: getError(error),
		// 			});
		// 		}
		// 	});
		// });

		// const results = await Promise.all(promisesArr);

		// if (results.some((item) => !item.status)) {
		// 	res.status(207).json({
		// 		// 207 Multi-Status 表示部分请求成功
		// 		code: 207,
		// 		data: results,
		// 		message: '部分文件处理失败',
		// 	});
		// } else {
		// 	res.status(200).json({
		// 		code: 200,
		// 		data: results,
		// 		message: '所有文件处理成功',
		// 	});
		// }
	})
);

/** 获取知识库文件 */
router.get(
	'/getTableFiles',
	asyncHandler(async (req: Request, res: Response) => {
		const { tableName } = req.query;

		if (!tableName) {
			return res.status(400).json({
				code: 400,
				message: '缺少必要参数: tableName',
			});
		}

		const data = await db.selectFile(tableName as string);
		res.status(200).json({
			code: 200,
			data,
		});
	})
);

/** 删除知识库文件 */
router.get(
	'/deleteTableFile',
	asyncHandler(async (req: Request, res: Response) => {
		const { fileName, tableName } = req.query;

		if (!fileName || !tableName) {
			return res.status(400).json({
				code: 400,
				message: '缺少必要参数: fileName 或 tableName',
			});
		}

		await db.deleteFile(tableName as string, fileName as string);
		res.status(200).json({
			code: 200,
			data: '删除成功',
		});
	})
);

// 聊天对话接口
router.post('/chat', async (req, res) => {
	const { userContent, id, application_type, params } = req.body;
	if (!userContent || !application_type || !params || !params.tableName) {
		res.status(500).send('必填字段不能为空');
		return;
	}
	const sseControl = new SSEControl(res);
	const question = userContent[0].value as string;
	const retrieved_chunks = await db.searchText({
		text: question,
		limit: 10,
		tableName: params.tableName,
	});

	const text = JSON.stringify(retrieved_chunks.map((item) => omit(item, 'vector')))
		.replaceAll('{', '{{')
		.replaceAll('}', '}}');

	const systemPrompt = `
# 任务
你是一位在线客服，你的首要任务是通过巧妙的话术回复用户的问题，你需要根据「参考资料」来回答接下来的「用户问题」，这些信息在 <context></context> XML tags 之内，你需要根据参考资料给出准确，简洁的回答。

你的回答要满足以下要求：
    1. 回答内容必须在参考资料范围内，尽可能简洁地回答问题，不能做任何参考资料以外的扩展解释。
    2. 回答中需要根据客户问题和参考资料保持与客户的友好沟通。
    3. 如果参考资料不能帮助你回答用户问题，告知客户无法回答该问题，并引导客户提供更加详细的信息。
    4. 为了保密需要，委婉地拒绝回答有关参考资料的文档名称或文档作者等问题。
		5. 尽可能的详细回答，1000字左右
		6. 思考过程不得携带任何chunk,page等英文字符，用文件名+片段代替

# 任务执行
现在请你根据提供的参考资料，遵循限制来回答用户的问题，你的回答需要准确和完整。

# 参考资料
<context>
  {{ ${text} }}
</context>

# 引用要求
1. 当可以回答时，在句子末尾适当引用相关参考资料，每个参考资料引用格式必须使用<reference>标签对，例如: <reference data-ref="{{file_name}}"></reference>
2. 当告知客户无法回答时，不允许引用任何参考资料
3. 'data-ref' 字段表示对应参考资料的 file_name
	`;

	try {
		await robotChat({ sseControl, userContent, application_type, id, params, systemPrompt });
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

/** 获取知识库文件解析结果 */
router.get('/fileContent', async (req, res) => {
	const { fileName } = req.query;
	const content = await fileParse(fileName as string);

	res.status(200).send({
		code: 200,
		data: content,
	});
});

// 全局错误处理中间件
router.use((err: any, req: Request, res: Response, next: NextFunction) => {
	console.error('全局错误捕获:', err);

	const statusCode = err.statusCode || 500;
	const message = err.message || '服务器内部错误';

	res.status(statusCode).json({
		code: statusCode,
		message: message,
		...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
	});
});

export default router;
