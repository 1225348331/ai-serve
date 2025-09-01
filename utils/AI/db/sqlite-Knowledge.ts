import Database from 'better-sqlite3'; // 导入 better-sqlite3
import { pinyin } from 'pinyin-pro'; // 导入拼音转换库

// 初始化 SQLite 数据库连接
let db: Database.Database | null = null;

/**
 * 初始化数据库
 * @param dbPath 数据库文件路径（默认在当前目录创建 conversations.db）
 * @param memory 是否使用内存数据库（默认 false）
 */
function initializeDatabase(dbPath: string = './data/AI.db', memory: boolean = false): void {
	// 创建数据库连接（内存或文件）
	db = memory ? new Database(':memory:') : new Database(dbPath);

	// 启用 WAL 模式提高并发性能
	db.pragma('journal_mode = WAL');

	// 创建知识库分类表（如果不存在）
	db.exec(`
    CREATE TABLE IF NOT EXISTS knowledgeclassification (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cnname TEXT NOT NULL UNIQUE,  -- 中文名称（唯一）
      name TEXT NOT NULL,           -- 英文/拼音名称
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    
    CREATE INDEX IF NOT EXISTS idx_knowledge_cnname ON knowledgeclassification(cnname);
  `);

	console.log("knowledgeclassification 数据表初始化成功...")
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

/**
 * 获取知识库分类的英文名称
 * @param cnname 中文名称
 * @returns 对应的英文名称，如果不存在则返回空字符串
 */
function getKnowledgeClassificationName(cnname: string): string {
	if (!db) throw new Error('数据库未初始化');

	// 准备查询语句
	const stmt = db.prepare('SELECT name FROM knowledgeclassification WHERE cnname = ?');
	const row = stmt.get(cnname) as { name: string };

	return row?.name || '';
}

/**
 * 插入新的知识库分类
 * @param cnname 中文名称
 * @returns 生成的英文名称（拼音_时间戳格式）
 * @throws 如果插入失败会抛出错误
 */
function insertKnowledgeClassificationName(cnname: string): string {
	if (!db) throw new Error('数据库未初始化');

	try {
		// 1. 将中文转换为拼音（去掉音调，用下划线分隔）
		const namePinyin = pinyin(cnname, {
			toneType: 'none',
			separator: '_',
			v: true,
		});

		// 2. 添加时间戳确保唯一性（格式：拼音_时间戳）
		const timestamp = Date.now();
		const enname = `${namePinyin}_${timestamp}`;

		// 3. 插入到数据库（使用事务确保原子性）
		const insertStmt = db.prepare('INSERT INTO knowledgeclassification (cnname, name) VALUES (?, ?)');

		db.transaction(() => {
			insertStmt.run(cnname, enname);
		})();

		// 4. 返回生成的英文名称
		return enname;
	} catch (error) {
		console.error('插入知识库分类失败:', error);
		throw error;
	}
}

/**
 * 获取所有知识库分类
 * @returns 包含所有分类的数组
 */
function getAllKnowledgeClassification() {
	if (!db) throw new Error('数据库未初始化');

	const stmt = db.prepare('SELECT * FROM knowledgeclassification');
	return stmt.all();
}

initializeDatabase();

// 导出模块功能
export {
	initializeDatabase,
	closeDatabase,
	getKnowledgeClassificationName,
	insertKnowledgeClassificationName,
	getAllKnowledgeClassification,
	db as database,
};
