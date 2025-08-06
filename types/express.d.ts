// types/express.d.ts
import { Request } from 'express';

declare module 'express' {
	interface Request {
		fields?: { [key: string]: string };
		files?: Array<{
			fieldname: string;
			encoding: string;
			mimetype?: string;
			filename: string;
			path: string;
			size: number;
		}>;
	}
}
