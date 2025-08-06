import fs from 'fs';
import path from 'path';

const allSupportedTypes = ['txt', 'md'] as const;

type SupportedFileType = (typeof allSupportedTypes)[number];

// 通用文件解析
export const commonParse = async (fileName: string): Promise<string> => {
	try {
		// 获取文件扩展名
		const extname = path.extname(fileName).toLowerCase().slice(1) as SupportedFileType;

		if (!allSupportedTypes.includes(extname)) {
			throw new Error(`不支持的文件格式： ${extname}`);
		}

		const filePath = path.join(__dirname, '../../../upload/data', fileName);

		// 同步读取文件内容
		const data = fs.readFileSync(filePath, 'utf8');

		return data;
	} catch (err) {
		throw new Error(`通用文件解析时出错: ${err instanceof Error ? err.message : String(err)}`);
	}
};

export { allSupportedTypes };
