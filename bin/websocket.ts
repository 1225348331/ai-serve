// websocket.ts
import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'http';
import fs from 'fs/promises';
import { fileParse } from '../utils/AI/FileParse';
import destr from 'destr';
import path from 'path';
import { db } from '../routes/knowledge';

const rentJsonPath = path.join(__dirname, '../routes/rent.json');

let wss: WebSocketServer;

interface ClientInfo {
	ws: WebSocket;
	clientId: string | number;
}

const clients: Map<string | number, ClientInfo> = new Map();

export function setupWebSocket(server: Server) {
	wss = new WebSocketServer({ server });
	console.log('WebSocket已经初始化...');

	wss.on('connection', (ws, req) => {
		// 从 URL 查询参数中获取 clientId
		const url = new URL(req.url || '', `http://${req.headers.host}`);
		const clientId = +url.searchParams.get('clientId')!;
		// 为每个客户端分配唯一ID
		clients.set(clientId, { ws, clientId });
		console.log(`新客户端连接: ${clientId}, 当前连接数: ${clients.size}`);

		ws.on('close', () => {
			clients.delete(clientId);
			console.log(`客户端断开: ${clientId}, 剩余连接数: ${clients.size}`);
		});

		ws.on('message', async (data) => {
			const {
				filename,
				clientId: messageClientId,
				type,
				tableName,
			} = destr<{ filename: string; clientId: string; type: string; tableName?: string }>(data.toString());
			try {
				const targetClientId = messageClientId || clientId;

				console.log(`收到文件解析请求: ${filename} from ${targetClientId}`);

				// 如果是知识库解析
				if (tableName) {
					await db.insertFile(tableName, filename);
				} else {
					const content = await fileParse(filename);

					// 更新rent.json文件
					const fileData = await fs.readFile(rentJsonPath, 'utf-8');
					const rentData = destr(fileData) as { filename: string; content: string }[];

					rentData.forEach((item) => {
						if (item.filename === filename) {
							item.content = content;
						}
					});

					await fs.writeFile(rentJsonPath, JSON.stringify(rentData, null, 2), 'utf8');
				}

				// 查找目标客户端并发送消息
				const client = clients.get(targetClientId);
				if (client) {
					client.ws.send(JSON.stringify(`${type}/${filename}: 解析成功`));
				} else {
					console.warn(`客户端 ${targetClientId} 已断开，无法发送消息`);
				}
			} catch (error) {
				console.error('文件解析错误:', error);

				// 更新rent.json文件为解析失败状态
				const fileData = await fs.readFile(rentJsonPath, 'utf-8');
				const rentData = destr(fileData) as { filename: string; content: string }[];

				rentData.forEach((item) => {
					if (item.filename === filename) {
						item.content = '解析失败';
					}
				});

				await fs.writeFile(rentJsonPath, JSON.stringify(rentData, null, 2), 'utf8');

				// 发送错误消息
				const client = clients.get(clientId);
				if (client) {
					client.ws.send(`${type}/${filename}:解析失败，请重新尝试`);
				}
			}
		});
	});

	return wss;
}

export function getWebSocketServer() {
	if (!wss) {
		throw new Error('WebSocket server not initialized');
	}
	return wss;
}

// 辅助函数：向特定客户端发送消息
export function sendToClient(clientId: string, message: any) {
	const client = clients.get(clientId);
	if (client) {
		client.ws.send(JSON.stringify(message));
		return true;
	}
	return false;
}
