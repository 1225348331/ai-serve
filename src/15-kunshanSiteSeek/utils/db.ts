import { Pool } from 'pg';

// 创建数据库连接
const pool = new Pool({
	host: '172.28.59.172',
	port: 54321,
	user: 'sde',
	password: 'sch123@abcd',
	database: 'sdeks',
});

export default pool;
