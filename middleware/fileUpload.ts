import Busboy from 'busboy';
import path from 'path';
import fs from 'fs';
import type { NextFunction, Request, Response } from 'express';

// 上传文件存储目录
const uploadDir = path.join(__dirname, '../upload/data');

// 确保上传目录存在
if (!fs.existsSync(uploadDir)) {
	fs.mkdirSync(uploadDir, { recursive: true });
}

// 文件上传中间件
export function fileUploadMiddleware(req: Request, res: Response, next: NextFunction) {
	const busboy = Busboy({
		headers: req.headers,
		defParamCharset: 'utf-8',
	});

	// 存储普通字段
	const fields: Record<string, string> = {};

	// 存储文件信息
	const files: Array<{
		fieldname: string;
		encoding: string;
		filename: string;
		path: string;
		size: number;
	}> = [];

	// 处理表单字段
	busboy.on('field', (fieldname, val) => {
		fields[fieldname] = val;
	});

	// 处理文件上传
	busboy.on('file', (fieldname, file, { filename, encoding }) => {
		// 统一处理文件扩展名为小写
		const ext = path.extname(filename).toLowerCase();
		const baseName = path.basename(filename, path.extname(filename));
		const savedFilename = `${baseName}${ext}`;
		const savePath = path.join(uploadDir, savedFilename);

		// 创建文件写入流
		const writeStream = fs.createWriteStream(savePath);
		file.pipe(writeStream);

		// 记录文件信息
		const fileInfo = {
			fieldname,
			encoding,
			filename: savedFilename,
			path: savePath,
			size: 0,
		};
		files.push(fileInfo);

		// 计算文件大小
		file.on('data', (data: Buffer) => {
			fileInfo.size += data.length;
		});

		// 文件写入完成
		writeStream.on('finish', () => {
			// 可以在这里添加文件校验逻辑
		});
	});

	// 所有上传完成
	busboy.on('finish', () => {
		req.fields = fields;
		req.files = files;
		next();
	});

	// 错误处理
	busboy.on('error', (err: Error) => {
		console.error('文件上传错误:', err);
		next(err);
	});

	// 将请求流导入busboy解析
	req.pipe(busboy);
}
