import { parseOfficeAsync } from 'officeparser';
import path from 'path';
import { exec } from 'child_process';
import fs from 'fs';
import { promisify } from 'util';
import { pdfOCRParse } from './pdf-ocr';

const execPromise = promisify(exec);

// 支持的office文件类型
const supportedTypes = ['docx', 'pptx', 'xlsx', 'odt', 'odp', 'ods', 'pdf'] as const;

// 需要转换的旧格式映射
const needConvertTypes = {
	doc: 'docx',
	xls: 'xlsx',
} as const;

// 所有支持的格式（包含需要转换的旧格式）
const legacyTypes = Object.keys(needConvertTypes) as (keyof typeof needConvertTypes)[];
const allSupportedTypes = [...supportedTypes, ...legacyTypes];

/**
 * 检查LibreOffice是否安装
 */
async function checkLibreOfficeInstalled(): Promise<boolean> {
	try {
		await execPromise('soffice --version');
		return true;
	} catch (err) {
		console.error('LibreOffice未安装或未添加到PATH:', `${err instanceof Error ? err.message : String(err)}`);
		return false;
	}
}

/**
 * 使用LibreOffice转换文件格式
 * @param inputPath 输入文件路径
 * @param outputFormat 目标格式
 * @returns 转换后的文件路径
 */
async function convertFileWithLibreOffice(inputPath: string, outputFormat: string): Promise<string> {
	const outputDir = path.dirname(inputPath);
	const outputPath = path.join(outputDir, `${path.basename(inputPath, path.extname(inputPath))}.${outputFormat}`);

	try {
		// 执行转换命令
		await execPromise(`soffice --headless --convert-to ${outputFormat} --outdir "${outputDir}" "${inputPath}"`);

		// 检查转换后的文件是否存在
		if (!fs.existsSync(outputPath)) {
			throw new Error(`转换后的文件未生成: ${outputPath}`);
		}

		return outputPath;
	} catch (err) {
		throw new Error(`文件转换失败: ${err instanceof Error ? err.message : String(err)}`);
	}
}

/**
 * 检查PDF是否为扫描件（基于文件内容）
 * @param filePath 文件路径
 * @returns 是否是扫描件
 */
async function isScannedPDF(filePath: string): Promise<boolean> {
	try {
		// 尝试用普通方式解析PDF
		const text = await parseOfficeAsync(filePath);

		// 如果解析出的文本很少或没有，可能是扫描件
		if (!text || text.trim().length < 50) {
			return true;
		}

		return false;
	} catch (err) {
		// 如果解析失败，可能是扫描件
		return true;
	}
}

/**
 * office格式解析主函数
 * @param fileName 文件名
 * @param sseControl SSE控制器
 * @returns 解析后的数据
 */
export async function officeParse(fileName: string, sseControl?: any){
	const extname = path.extname(fileName).toLowerCase().slice(1) as
		| keyof typeof needConvertTypes
		| (typeof supportedTypes)[number];

	if (!allSupportedTypes.includes(extname)) {
		throw new Error(`不支持的office文件格式： ${extname}`);
	}

	const filePath = path.join(__dirname, '../../../upload/data/', fileName);
	let fileToParse = filePath;

	try {
		// 处理需要转换的旧格式
		if (legacyTypes.includes(extname as keyof typeof needConvertTypes)) {
			console.time('转换时间');
			const isLibreOfficeInstalled = await checkLibreOfficeInstalled();
			if (!isLibreOfficeInstalled) {
				throw new Error('需要LibreOffice来转换旧格式文件，但未检测到安装');
			}
			// 目标格式
			const targetFormat = needConvertTypes[extname as keyof typeof needConvertTypes];
			console.log(`正在将 ${extname} 转换为 ${targetFormat}...`);
			fileToParse = await convertFileWithLibreOffice(filePath, targetFormat);
			console.log(`转换完成，新文件路径: ${fileToParse}`);
			console.timeEnd('转换时间');
		}

		// 处理PDF文件
		if (extname === 'pdf') {
			// 检查是否为扫描件
			const isScanned = await isScannedPDF(fileToParse);
			if (isScanned) {
				console.log('检测到PDF为扫描件，使用OCR解析...');
				return await pdfOCRParse(fileToParse, sseControl);
			}
		}

		// 解析文件
		const data = await parseOfficeAsync(fileToParse);

		return data;
	} catch (err) {
		throw new Error(`解析文件时出错： ${err instanceof Error ? err.message : String(err)}`);
	}
}

export { allSupportedTypes };
