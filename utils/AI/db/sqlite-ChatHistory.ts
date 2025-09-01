import Database from 'better-sqlite3'; // 导入 better-sqlite3
import { destr } from 'destr'; // 导入安全的 JSON 解析器
import { HumanMessage, AIMessage, ToolMessage } from '@langchain/core/messages'; // 导入 LangChain 消息类型

// 初始化 SQLite 数据库
let db: Database.Database | null = null;

/**
 * 初始化 SQLite 数据库连接
 * @param dbPath 数据库文件的路径
 * @param memory 是否使用内存数据库
 */
function initializeDatabase(dbPath: string = './data/AI.db', memory: boolean = false): void {
	db = memory ? new Database(':memory:') : new Database(dbPath);

	// 启用 WAL 模式以获得更好的并发性
	db.pragma('journal_mode = WAL');

	// 如果不存在，则创建表
	db.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      application_type TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id INTEGER NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'tool')),
      content TEXT NOT NULL,
      original_content TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(conversation_id) REFERENCES conversations(id)
    );
    
    CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_conversations_created_at ON conversations(created_at);
  `);

	console.log('conversations 数据表初始化成功...');
	console.log('messages 数据表初始化成功...');
}

/**
 * 获取或创建会话记录
 * @param id 会话 ID（可选，如果为 null 则创建新的会话）
 * @param application_type 应用类型标识符
 * @returns 会话 ID（现有或新创建的）
 */
function getOrCreateConversation(id: number | null, application_type: string): number {
	if (!db) throw new Error('数据库未初始化');

	// 检查会话是否存在
	if (id !== null) {
		const checkStmt = db.prepare('SELECT id FROM conversations WHERE id = ?');
		const checkRes = checkStmt.get(id) as { id: number };
		if (checkRes) return checkRes.id;
	}

	// 创建新的会话
	const insertStmt = db.prepare('INSERT INTO conversations (application_type) VALUES (?)');
	const insertRes = insertStmt.run(application_type);
	return insertRes.lastInsertRowid as number;
}

/**
 * 向会话中添加消息
 * @param conversationId 会话 ID
 * @param role 消息角色（user/assistant/tool）
 * @param content 消息内容（将被 JSON 字符串化）
 * @param original_content 原始消息内容（将被 JSON 字符串化）
 */
function addMessage(
	conversationId: number,
	role: 'user' | 'assistant' | 'tool',
	content: any,
	original_content: any
): void {
	if (!db) throw new Error('数据库未初始化');

	const stmt = db.prepare(
		'INSERT INTO messages (conversation_id, role, content, original_content) VALUES (?, ?, ?, ?)'
	);
	stmt.run(conversationId, role, JSON.stringify(content), JSON.stringify(original_content));
}

/**
 * 获取会话历史
 * @param conversationId 会话 ID
 * @param limit 要检索的消息数量（默认 6）
 * @returns LangChain 兼容的消息对象数组
 */
function getConversationHistory(conversationId: number, limit: number = 6): (HumanMessage | AIMessage | ToolMessage)[] {
	if (!db) throw new Error('数据库未初始化');

	// 查询最近的消息（按创建时间降序排列）
	const stmt = db.prepare(
		'SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT ?'
	);
	const res = stmt.all(conversationId, limit);

	// 处理结果：反转顺序（回到按时间顺序排列）并转换为 LangChain 消息
	return res.reverse().map((item: any) => {
		// 安全地解析 JSON 内容（支持 JSON 字符串或纯字符串）
		const content = destr(item.content) as ChatMessage[];

		// 根据角色返回适当的消息对象
		if (item.role === 'user') {
			return new HumanMessage({ content });
		}

		if (item.role === 'assistant') {
			// 处理助手消息特殊结构（可能包含多步数据）
			const getAssistantContent = (content: any): string => {
				if (!Array.isArray(content)) {
					return content;
				}

				const basicConversation = content.find((msgItem) => msgItem.stepName === '基本对话');
				if (!basicConversation?.data) {
					return '';
				}

				if (basicConversation.data.type === 'string') {
					return basicConversation.data.data;
				}

				const { message = '', thinkMessage = '' } = basicConversation.data.data || {};
				return message + thinkMessage;
			};

			return new AIMessage({ content: getAssistantContent(content) });
		}

		// 工具消息（使用 @ts-ignore 来绕过类型检查）
		// @ts-ignore
		return new ToolMessage({ content });
	});
}

/**
 * 清理旧的会话
 * @param maxAgeDays 最大保留天数（默认 30）
 */
function cleanupOldConversations(maxAgeDays: number = 30): void {
	if (!db) throw new Error('数据库未初始化');

	// 计算截止日期（SQLite 使用儒略日）
	const cutoffDate = new Date();
	cutoffDate.setDate(cutoffDate.getDate() - maxAgeDays);
	const julianCutoff = cutoffDate.getTime() / 86400000 + 2440587.5; // 转换为儒略日

	const stmt = db.prepare('DELETE FROM conversations WHERE julianday(created_at) < ?');
	stmt.run(julianCutoff);
}

/**
 * 关闭数据库连接
 */
function closeDatabase(): void {
	if (db) {
		db.close();
		db = null;
	}
}

initializeDatabase();

// 导出模块功能
export {
	initializeDatabase,
	closeDatabase,
	getOrCreateConversation,
	addMessage,
	getConversationHistory,
	cleanupOldConversations,
	db as database,
};
