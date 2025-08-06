import { Pool } from 'pg'; // 导入PostgreSQL连接池
import { destr } from 'destr'; // 导入安全的JSON解析器
import { HumanMessage, AIMessage, ToolMessage } from '@langchain/core/messages'; // 导入LangChain的消息类型

// 创建PostgreSQL连接池配置
const pool = new Pool({
	host: process.env.PGHOST, // 数据库主机地址
	port: process.env.PGPORT ? +process.env.PGPORT : 5432, // 数据库端口
	user: process.env.PGUSER, // 数据库用户名
	password: process.env.PGPASSWORD, // 数据库密码
	database: process.env.PGDATABASE, // 数据库名称
});

/**
 * 获取或创建对话记录
 * @param id 对话ID（可选，为null时创建新对话）
 * @param application_type 应用类型标识
 * @returns 返回对话ID（已存在的或新建的）
 */
async function getOrCreateConversation(id: number | null, application_type: string): Promise<number> {
	const client = await pool.connect(); // 从连接池获取客户端
	try {
		// 检查对话是否已存在
		const checkRes = await client.query('SELECT id FROM conversations WHERE id = $1', [id]);

		// 如果对话已存在，直接返回ID
		if (checkRes.rows.length > 0) {
			return checkRes.rows[0].id;
		}

		// 创建新对话并返回生成的ID
		const insertRes = await client.query('INSERT INTO conversations (application_type) VALUES ($1) RETURNING id', [
			application_type,
		]);

		return insertRes.rows[0].id;
	} finally {
		client.release(); // 确保释放客户端回连接池
	}
}

/**
 * 添加消息到指定对话
 * @param conversationId 对话ID
 * @param role 消息角色（用户/助手/工具）
 * @param content 消息内容（将被JSON序列化）
 * @param original_content 原始消息内容（将被JSON序列化）
 */
async function addMessage(
	conversationId: number,
	role: 'user' | 'assistant' | 'tool',
	content: any,
	original_content: any
): Promise<void> {
	await pool.query('INSERT INTO messages (conversation_id, role, content, original_content) VALUES ($1, $2, $3, $4)', [
		conversationId,
		role,
		JSON.stringify(content),
		JSON.stringify(original_content),
	]);
}

/**
 * 获取对话历史记录
 * @param conversationId 对话ID
 * @param limit 获取的消息数量限制（默认6条）
 * @returns 返回LangChain兼容的消息对象数组
 */
async function getConversationHistory(
	conversationId: number,
	limit: number = 6
): Promise<(HumanMessage | AIMessage | ToolMessage)[]> {
	// 查询最新的消息记录（按创建时间倒序）
	const res = await pool.query(
		'SELECT role, content FROM messages WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT $2',
		[conversationId, limit]
	);

	// 处理查询结果：反转顺序（变回时间正序）并转换为LangChain消息对象
	return res.rows.reverse().map((item) => {
		// 安全解析JSON内容（支持包含JSON的字符串或纯字符串）
		const content = destr(item.content) as ChatMessage[];

		// 根据角色类型返回对应的消息对象
		if (item.role === 'user') {
			return new HumanMessage({ content }); // 用户消息
		}

		if (item.role === 'assistant') {
			// 处理助手消息的特殊结构（可能包含多步骤数据）
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

		// 工具消息（使用@ts-ignore忽略类型检查）
		// @ts-ignore
		return new ToolMessage({ content });
	});
}

/**
 * 清理过期对话记录
 * @param maxAgeDays 最大保留天数（默认30天）
 */
async function cleanupOldConversations(maxAgeDays: number = 30): Promise<void> {
	await pool.query("DELETE FROM conversations WHERE created_at < NOW() - INTERVAL '$1 days'", [maxAgeDays]);
}

// 导出模块功能
export { getOrCreateConversation, addMessage, getConversationHistory, cleanupOldConversations, pool };
