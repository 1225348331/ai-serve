import Tesseract from 'tesseract.js';
import { SSEControl } from '../SSE';
import path from 'path';
import fs from 'fs';

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
	// 发送OCR开始通知
	sseControl &&
		sseControl.sendNodeData({
			stepName: '文件OCR',
			status: 'start',
			duration: 0,
			data: {
				type: 'string',
				data: '',
			},
		});

	// 动态导入pdf-to-image-generator模块
	const { PDFToImage } = await import('pdf-to-image-generator');

	// 存储所有识别的文字结果
	const allText: string[] = [];

	// 发送处理中通知
	sseControl &&
		sseControl.sendNodeData({
			stepName: '文件OCR',
			status: 'process',
			data: {
				type: 'string',
				data: '该文件为扫描件类文件,正在进行OCR识别...',
			},
		});

	// 转换选项
	const options = {
		outputFolderName: 'temp_images', // 临时图片文件夹
		viewportScale: 2, // 缩放因子，提高分辨率
	};

	// 加载PDF文件
	const pdf = await new PDFToImage().load(filePath);

	// 监听进度事件
	pdf.on('progress', (data) => {
		sseControl &&
			sseControl.sendNodeData({
				stepName: '文件OCR',
				status: 'process',
				data: {
					type: 'string',
					data: `正在处理第 ${data.currentPage}/${data.totalPages} 页 (${data.progress.toFixed(1)}%)`,
				},
			});
	});

	// 转换PDF为图片
	const conversionResult = await pdf.convert(options);

	// 存储OCR识别的Promise数组
	const ocrPromises: Promise<void>[] = [];

	// 对每张图片进行OCR识别
	conversionResult.forEach((image, index) => {
		const ocrPromise = (async () => {
			try {
				const imageName = image.name!;

				// 构建base64数据URL
				const base64Image = await readImage(imageName);

				// 调用Tesseract进行中文识别
				const result = await Tesseract.recognize(base64Image, 'chi_sim');

				// 将识别结果存入数组，并移除空格
				allText[index] = result.data.text.replaceAll(' ', '');
			} catch (error) {
				console.error(`第 ${index + 1} 页OCR识别失败:`, error);
				allText[index] = ''; // 失败时置为空字符串
			}
		})();

		ocrPromises.push(ocrPromise);
	});

	// 等待所有OCR任务完成
	await Promise.all(ocrPromises);

	// 清理临时生成的图片文件
	await pdf.removeGeneratedImagesOnDisk();

	// 发送完成通知
	sseControl &&
		sseControl.sendNodeData({
			stepName: '文件OCR',
			status: 'success',
			data: {
				type: 'string',
				data: `文件解析完成,共识别${conversionResult.length}页`,
			},
		});

	// 返回格式化后的结果
	return allText.map((content, index) => ({
		page: index + 1, // 页码从1开始
		content,
	}));
}

/**
 * 读取图片并转换为base64
 * @param filename 图片文件名
 * @returns 返回base64编码的图片或null
 */
export const readImage = async (filename: string) => {
	const filePath = path.join(__dirname, `../../../temp_images/${filename}`);
	try {
		const fileData = fs.readFileSync(filePath);
		const extname = path.extname(filePath).slice(1);
		return `data:image/${extname};base64,${fileData.toString('base64')}`;
	} catch (error) {
		console.error('读取图片错误:', error);
		return null;
	}
};
