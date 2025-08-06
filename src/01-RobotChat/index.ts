import { SSEControl } from '../../utils/AI/SSE';
import { getLLM, getReasonLLM } from '../../utils/AI/LLM';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { createHumanMessage, imageExtensions, videoExtensions } from '../../utils/AI/CreateHumanMessage';
import { getOrCreateConversation, addMessage, getConversationHistory } from '../../utils/AI/db/ChatHistory';
import { destr } from 'destr';
import path from 'path';
import { SystemMessage } from '@langchain/core/messages';
import { getError } from '../../utils/errUtils';

interface RobotChatOptions {
	sseControl: SSEControl; // SSE控制实例
	userContent: [{ type: 'string'; value: string }, { type: 'file'; value: string[] }]; // 用户输入内容
	id: number; // 用户/会话ID
	application_type: string; // 应用类型标识
	params: {
		contextLink: boolean;
		online: boolean;
		think: boolean;
	};
	systemPrompt?: string; // 可选系统提示语
}

interface ThinkResponse {
	message: string;
	thinkMessage: string;
}

/**
 * AI对话处理函数
 * @param options 包含SSE控制、用户内容、会话ID等参数的对象
 */
export const robotChat = async (options: RobotChatOptions) => {
	try {
		const { sseControl, userContent, id, application_type, systemPrompt, params } = options;

		// 解析用户输入
		const question = userContent[0].value as string;
		const fileList = userContent[1].value as string[];

		// 获取或创建对话记录
		const conversationId = await getOrCreateConversation(id, application_type);

		// 获取最近的10条历史消息
		const history = await getConversationHistory(conversationId, 10);

		// 创建用户消息对象
		const humanMessage = await createHumanMessage(question, fileList, sseControl);

		// 构建消息上下文（历史消息 + 新用户消息）
		const messages = [...(params.contextLink ? history : []), humanMessage];
		if (systemPrompt) messages.unshift(new SystemMessage(systemPrompt));

		// 检查历史消息中是否包含图片
		const historyHasImage = history.some((hisItem) => {
			if (hisItem.getType() === 'human') {
				const content = destr(hisItem.content) as ChatMessage[];
				return content.some((item: any) => ['image_url'].includes(item.type));
			}
			return false;
		});

		// 检查当前文件列表中是否包含图片
		const fileListHasImage = fileList.some((fileItem) => {
			const extname = path.extname(fileItem).slice(1).toLowerCase();
			return imageExtensions.includes(extname);
		});

		// 检查历史消息中是否包含视频
		const historyHasVideo = history.some((hisItem) => {
			if (hisItem.getType() === 'human') {
				const content = destr(hisItem.content) as ChatMessage[];
				return content.some((item: any) => ['video_url'].includes(item.type));
			}
			return false;
		});

		// 检查当前文件列表中是否包含视频
		const fileListHasVideo = fileList.some((fileItem) => {
			const extname = path.extname(fileItem).slice(1).toLowerCase();
			return videoExtensions.includes(extname);
		});

		// 综合判断是否包含多媒体内容
		const hasImage = historyHasImage || fileListHasImage;
		const hasVideo = historyHasVideo || fileListHasVideo;

		// 根据内容类型获取合适的LLM模型
		const model = params.think ? getReasonLLM() : getLLM({}, hasImage, hasVideo);

		// 构建对话模板
		const promptTemplate = ChatPromptTemplate.fromMessages(messages);

		// 创建处理链：模板 -> 模型 -> 输出解析器
		const chain = promptTemplate.pipe(model);

		const dataType = !params.think ? 'string' : 'think-string';

		// 发送处理开始通知
		sseControl.sendNodeData({
			status: 'start',
			stepName: '基本对话',
			data: { type: dataType, data: !params.think ? '' : { message: '', thinkMessage: '' } },
		});

		// 流式处理AI响应
		const stream = await chain.stream(messages);
		let message = !params.think ? '' : { message: '', thinkMessage: '' };
		// 逐块处理流式响应
		for await (const chunk of stream) {
			let content = params.think
				? {
						message: chunk.content,
						thinkMessage: chunk.additional_kwargs.reasoning_content,
				  }
				: chunk.content;

			if (!params.think && content) {
				message += content as string;
			} else if (params.think) {
				if (chunk.content) (message as ThinkResponse).message += chunk.content;
				if (chunk.additional_kwargs.reasoning_content)
					(message as ThinkResponse).thinkMessage += chunk.additional_kwargs.reasoning_content;
			}
			sseControl.sendData({
				status: 'process',
				stepName: '基本对话',
				data: { type: dataType, data: content },
			});
		}

		// 构建成功响应消息
		const successMessage = {
			status: 'success',
			stepName: '基本对话',
			data: { type: dataType, data: message },
		} as NodeDataOptions;

		// 发送最终响应
		sseControl.sendNodeData(successMessage);

		// 将对话记录保存到数据库
		await addMessage(conversationId, 'user', humanMessage.content, userContent);
		await addMessage(conversationId, 'assistant', [successMessage], [successMessage]);
	} catch (error) {
		throw new Error(getError(error));
	}
};

export default {
	robotChat,
};
