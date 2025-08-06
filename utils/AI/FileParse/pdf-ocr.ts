import Tesseract from 'tesseract.js';
import { SSEControl } from '../SSE';

/**
 * 使用OCR解析PDF扫描件
 * @param {string} filePath - PDF文件路径
 * @param {SSEControl} sseControl - SSE控制对象用于发送进度更新
 * @returns {Promise<Array<{page: number, content: string}>>} 返回每页的识别结果数组
 */
export async function pdfOCRParse(
	filePath: string,
	sseControl: SSEControl
): Promise<Array<{ page: number; content: string }>> {
	sseControl && // 发送OCR开始通知
		sseControl.sendNodeData({
			stepName: '文件OCR',
			status: 'start',
			duration: 0,
			data: {
				type: 'string',
				data: '',
			},
		});

	// 动态导入pdf-to-img模块
	const { pdf } = await import('pdf-to-img');
	const document = await pdf(filePath, { scale: 2 });
	// 存储base64图片数组
	const base64Arr: string[] = [];
	// 存储所有识别的文字结果
	const allText: string[] = [];

	// 发送处理中通知
	sseControl && sseControl.sendNodeData({
		stepName: '文件OCR',
		status: 'process',
		data: {
			type: 'string',
			data: '该文件为扫描件类文件,正在进行OCR识别...',
		},
	});

	// 将PDF每页转换为base64图片
	for await (const image of document) {
		const base64Image = 'data:image/png;base64,' + image.toString('base64');
		base64Arr.push(base64Image);
	}

	// 并发处理所有图片的OCR识别
	const promises = base64Arr.map(async (base64Image, i) => {
		// 调用Tesseract进行中文识别
		const result = await Tesseract.recognize(base64Image, 'chi_sim');

		// 将识别结果存入数组，并移除空格
		allText[i] = result.data.text.replaceAll(' ', '');
	});

	// 等待所有OCR任务完成
	await Promise.all(promises);

	// 发送完成通知
	sseControl && sseControl.sendNodeData({
		stepName: '文件OCR',
		status: 'success',
		data: {
			type: 'string',
			data: `文件解析完成,共识别${base64Arr.length}页`,
		},
	});

	// 返回格式化后的结果
	return allText.map((content, page) => ({
		page,
		content,
	}));
}
