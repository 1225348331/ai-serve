import { commonParse, allSupportedTypes as commonTypes } from './commonParse';
import { officeParse, allSupportedTypes as officeTypes } from './officeParse';
import path from 'path';

// 合并所有支持的文件类型（使用Set去重）
const allSupportedTypes = [...new Set([...commonTypes, ...officeTypes])] as string[];

/**
 * 文件解析函数
 * @param fileName 文件名
 * @param sseControl SSE控制器（可选）
 * @returns 返回解析结果
 * @throws 当文件类型不支持时抛出错误
 */
const fileParse = async (fileName: string, sseControl?: any) => {
	// 获取文件扩展名（去掉点并转为小写）
	const extension = path.extname(fileName).toLowerCase().slice(1);

	// 检查是否支持该文件类型
	if (!allSupportedTypes.includes(extension)) {
		throw new Error(`不支持的文件类型: ${extension}`);
	}

	// 根据文件类型选择解析器
	if ((officeTypes as string[]).includes(extension)) {
		return await officeParse(fileName, sseControl);
	} else {
		return await commonParse(fileName);
	}
};

// 导出函数和支持的类型
export { fileParse, allSupportedTypes };
