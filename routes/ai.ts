import express, { type Request, type Response } from 'express';
import { getError } from '../utils/errUtils';
import TurndownService from 'turndown';
import { getLocalVisionLLm } from '../utils/AI/LLM';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { SSEControl } from '../utils/AI/SSE';

const router = express.Router();
const turndownService = new TurndownService();

// 首页路由
router.get('/', (req, res) => {
	res.send('恭喜你找到了AI入口');
});

// 信息萃取
router.post('/info-extract', async (req, res, next) => {
	const { webUrl } = req.body;

	const sseControl = new SSEControl(res);

	const propmt = ChatPromptTemplate.fromTemplate(`
你是一个网页内容总结归纳小能手，请帮我总结以下网页内容：

网页内容如下：
{content}
		
`);

	const llm = getLocalVisionLLm({});

	const chain = propmt.pipe(llm).pipe(new StringOutputParser());

	fetch(webUrl)
		.then((res) => res.text())
		.then(async (data) => {
			const stream = await chain.stream({
				content: turndownService.turndown(data).slice(0, 20000),
			});

			for await (const chunk of stream) {
				sseControl.sendData({ data: chunk });
			}
		})
		.catch((err) => {
			res.json({
				code: 500,
				data: getError(err),
			});
		});
});

export default router;
