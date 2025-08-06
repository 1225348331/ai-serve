import { HumanMessage } from '@langchain/core/messages';
import fs from 'fs';
import { fileParse } from './FileParse/index';
import path from 'path';
import type { SSEControl } from './SSE';

// 图片扩展名
export const imageExtensions = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp'];

// 视频扩展名
export const videoExtensions = ['mp4'];

/**
 * 生成包含文本、文件和图片的 HumanMessage
 * @param text 用户输入的文本内容
 * @param fileList 文件列表，可能包含图片和其他文件
 * @param sseControl SSE控制器
 * @returns 返回构建好的 HumanMessage
 */
export const createHumanMessage = async (text: string, fileList: string[] = [], sseControl?: any) => {
	// 初始化消息内容数组，首先添加文本内容
	const content: any[] = [
		{
			type: 'text',
			text: text || '', // 确保即使没有文本也有空字符串
		},
	];

	// 如果没有文件列表，直接返回只包含文本的消息
	if (!fileList || fileList.length === 0) {
		return new HumanMessage({ content });
	}

	const fileMessages = await Promise.all(
		fileList.map(async (filename) => {
			const extname = path.extname(filename).slice(1).toLowerCase();

			// 如果是图片文件
			if (imageExtensions.includes(extname)) {
				const imageUrl = await readImage(filename);
				if (imageUrl) {
					return {
						type: 'image_url',
						image_url: {
							url: imageUrl,
						},
					};
				}
				return null;
			}

			// 如果是视频文件
			if (videoExtensions.includes(extname)) {
				const videoUrl = await readVideo(filename);
				if (videoUrl) {
					return {
						type: 'video_url',
						video_url: {
							url: videoUrl,
						},
					};
				}
				return null;
			}

			// 其他类型文件
			const fileData = await readFile(filename, sseControl);
			if (!fileData) throw new Error('解析内容为空');
			if (fileData) {
				return {
					type: 'text',
					text: `
          附件: ${filename}
          解析内容：
          ${JSON.stringify(fileData)}
          `, // 可以自定义文件描述
				};
			} else {
				return null;
			}
		})
	);

	// 过滤掉无效的文件消息
	const validFileMessages = fileMessages.filter((msg) => msg !== null);

	// 将type为text的文件消息放在前面
	validFileMessages.sort((a, b) => {
		if (a.type === 'text' && b.type !== 'text') {
			return -1; // a排在b前面
		}
		if (a.type !== 'text' && b.type === 'text') {
			return 1; // a排在b后面
		}
		return 0; // 保持原顺序
	});

	// 合并所有内容
	content.push(...validFileMessages);

	return new HumanMessage({ content });
};

/**
 * 读取图片并转换为base64
 * @param filename 图片文件名
 * @returns 返回base64编码的图片或null
 */
export const readImage = async (filename: string) => {
	const filePath = path.join(__dirname, `../../upload/data/${filename}`);
	try {
		const fileData = fs.readFileSync(filePath);
		const extname = path.extname(filePath).slice(1);
		return `data:image/${extname};base64,${fileData.toString('base64')}`;
	} catch (error) {
		console.error('读取图片错误:', error);
		return null;
	}
};

/**
 * 读取视频并转换为base64
 * @param filename 视频文件名
 * @returns 返回base64编码的视频或null
 */
export const readVideo = async (filename: string) => {
	const filePath = path.join(__dirname, `../../upload/data/${filename}`);
	try {
		const fileData = fs.readFileSync(filePath);
		const extname = path.extname(filePath).slice(1);

		// 常见视频类型的MIME映射
		const mimeTypes: Record<string, string> = {
			mp4: 'video/mp4',
			webm: 'video/webm',
			ogg: 'video/ogg',
			mov: 'video/quicktime',
			avi: 'video/x-msvideo',

			// mp4: 'image/mp4',
			// webm: 'image/webm',
			// ogg: 'image/ogg',
			// mov: 'image/quicktime',
			// avi: 'image/x-msvideo',
		};

		const mimeType = mimeTypes[extname.toLowerCase()] || `video/${extname}`;

		return `data:${mimeType};base64,${fileData.toString('base64')}`;
	} catch (error) {
		console.error('读取视频错误:', error);
		return null;
	}
};

/**
 * 读取文件并转换为base64
 * @param filename 文件名
 * @param sseControl SSE控制器
 * @returns 返回文件数据
 */
export const readFile = async (filename: string, sseControl?: SSEControl) => {
	try {
		const fileData = await fileParse(filename, sseControl);
		return fileData;
	} catch (error) {
		throw new Error(error as string);
	}
};
