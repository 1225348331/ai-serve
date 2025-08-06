import { Pool } from 'pg';

// 创建数据库连接
const pool = new Pool({
	host: '2.40.7.239',
	port: 5432,
	user: 'postgres',
	password: 'pg@szschy',
	database: 'sdecim',
});

export default pool;
