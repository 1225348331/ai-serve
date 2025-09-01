import { Pool } from 'pg'; // 导入PostgreSQL连接池
import { pinyin } from 'pinyin-pro';

// 创建PostgreSQL连接池配置
const pool = new Pool({
	host: process.env.PGHOST, // 数据库主机地址
	port: process.env.PGPORT ? +process.env.PGPORT : 5432, // 数据库端口
	user: process.env.PGUSER, // 数据库用户名
	password: process.env.PGPASSWORD, // 数据库密码
	database: process.env.PGDATABASE, // 数据库名称
});

/**
 * 获取英文名称
 */
async function getKnowledgeClassificationName(cnname: string) {
	const client = await pool.connect(); // 从连接池获取客户端
	try {
		const row = await client.query('SELECT name FROM knowledgeclassification WHERE cnname = $1', [cnname]);

		return row.rows[0]?.name ? row.rows[0].name : '';
	} finally {
		client.release(); // 确保释放客户端回连接池
	}
}

/**
 * 插入知识库分类
 */
async function insertKnowledgeClassificationName(cnname: string): Promise<string> {
	const client = await pool.connect(); // 从连接池获取客户端
	try {
		// 1. 将中文转换为拼音（去掉音调）
		const namePinyin = pinyin(cnname, {
			toneType: 'none',
			separator: '_',
			v: true,
		});

		// 2. 添加时间戳确保唯一性（格式：拼音_时间戳）
		const timestamp = Date.now();
		const enname = `${namePinyin}_${timestamp}`;

		// 3. 插入到数据库
		await client.query('INSERT INTO knowledgeclassification (cnname, name) VALUES ($1, $2)', [cnname, enname]);

		// 4. 返回生成的英文名称
		return enname;
	} catch (error) {
		// 错误处理
		console.error('插入知识库分类失败:', error);
		throw error;
	} finally {
		client.release(); // 确保释放客户端回连接池
	}
}

/**
 * 获取所有中文
 */
async function getAllKnowledgeClassification() {
	const client = await pool.connect(); // 从连接池获取客户端
	try {
		const row = await client.query('SELECT * FROM knowledgeclassification');
		return row.rows;
	} finally {
		client.release(); // 确保释放客户端回连接池
	}
}

// 导出模块功能
export { getKnowledgeClassificationName, insertKnowledgeClassificationName, getAllKnowledgeClassification, pool };
