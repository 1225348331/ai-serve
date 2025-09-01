import { SSEControl } from '../SSE';
import path from 'path';
import { parsePdf } from 'pdf2md-js';

/**
 * 使用OCR解析PDF扫描件
 */
export async function pdfOCRParse(filePath: string, sseControl?: SSEControl) {
	console.time('OCR时间:');

	const result = await parsePdf(filePath, {
		apiKey: '8e1bf446-de08-422c-8168-a38781acbfec',
		model: 'doubao-1.5-vision-pro-32k-250115',
		outputDir: path.join(__dirname, '../../../upload/data'),
		onProgress: ({ current, total, taskStatus }) => {
			sseControl &&
				sseControl.sendNodeData({
					stepName: '文件OCR',
					status: 'start',
					duration: 0,
					data: {
						type: 'string',
						data: `Processed: ${current}, Total pages: ${total}, Task status: ${taskStatus}`,
					},
				});
		},
	});

	console.timeEnd('OCR时间:');

	return result.content;
}
