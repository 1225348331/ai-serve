import fs from 'fs';
import markdownIt from 'markdown-it';
import htmlToDocx from 'html-to-docx';
import path from 'path';

/**
 * 将Markdown文本转换为DOCX文档
 * @param markdownText - 需要转换的Markdown文本
 * @param outputFileName - 输出的DOCX文件名
 */
export async function markdownToDocx(markdownText: string, outputFileName: string): Promise<void> {
	// 创建Markdown解析器实例，启用HTML支持
	const md = markdownIt({ html: true });

	// 将Markdown转换为HTML
	const html = md.render(markdownText);

	// 将HTML转换为DOCX格式的Buffer
	const fileBuffer = await htmlToDocx(html);

	// 拼接输出文件完整路径
	const outputPath = path.join(__dirname, `../../upload/data/${outputFileName}`);

	// 将DOCX文件写入磁盘
	fs.writeFileSync(outputPath, Buffer.from(fileBuffer as ArrayBuffer));

	console.log(`Word文档已生成: ${outputPath}`);
}
