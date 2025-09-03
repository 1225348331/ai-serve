import lancedb from '@lancedb/lancedb';
import * as arrow from 'apache-arrow';
import path from 'path';
import { EmbeddingConfig, EmbeddingTool } from './Embedding';

const dbDir = path.join(__dirname, '../../lancedb');

const embeddingTool = new EmbeddingTool();

export class VectorDB {
	db?: lancedb.Connection;
	table?: lancedb.Table;
	processFiles: Map<string, string[]> = new Map();

	constructor() {}

	async initdb() {
		try {
			this.db = await lancedb.connect(dbDir);
			return this.db;
		} catch (error) {
			throw new Error(`初始化数据库连接失败: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	async closedb() {
		try {
			if (!this.db) await this.initdb();
			if (this.db) {
				this.db.close();
				this.db = undefined;
			}
		} catch (error) {
			throw new Error(`关闭数据库连接失败: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	async initTable(tableName: string, embeddingsDimensions = EmbeddingConfig.embeddingsDimensions) {
		console.log(tableName);
		try {
			if (!this.db) await this.initdb();
			if (this.db) {
				const tables = await this.db.tableNames();
				if (tables.includes(tableName)) {
					this.table = await this.db.openTable(tableName);
				} else {
					const schema = new arrow.Schema([
						new arrow.Field('id', new arrow.Utf8()),
						new arrow.Field('file_name', new arrow.Utf8()),
						new arrow.Field('text', new arrow.Utf8()),
						new arrow.Field(
							'vector',
							new arrow.FixedSizeList(embeddingsDimensions, new arrow.Field('vector', new arrow.Float32()))
						),
						new arrow.Field('start_offset', new arrow.Int32()),
						new arrow.Field('end_offset', new arrow.Int32()),
					]);
					this.table = await this.db.createEmptyTable(tableName, schema, { mode: 'create' });
				}
			}
		} catch (error) {
			throw new Error(`初始化表 ${tableName} 失败: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	async insertVector(tableName: string, embeddings: IChunkVectorData[]) {
		try {
			if (!this.table) await this.initTable(tableName);
			if (this.table) {
				const data = embeddings.map((item, index) => ({
					id: `chunk_${index}_${Date.now()}`,
					...item,
				}));

				await this.table.add(data);
			}
			await this.closedb();
		} catch (error) {
			throw new Error(`插入向量数据失败: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	async createTableIndex(tableName: string) {
		try {
			if (!this.db) this.db = await this.initdb();
			this.table = await this.db.openTable(tableName);
			await this.table.createIndex('vector');
			await this.closedb();
		} catch (error) {
			throw new Error(`创建表索引失败: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	async deleteFile(tableName: string, fileName: string) {
		try {
			if (!this.db) this.db = await this.initdb();
			this.table = await this.db.openTable(tableName);
			await this.table.delete(`file_name = '${fileName}'`);
			await this.closedb();
		} catch (error) {
			throw new Error(`删除文件 ${fileName} 失败: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	async searchText({ text, limit, tableName }: { text: string; limit: number; tableName: string }) {
		try {
			if (!this.db) this.db = await this.initdb();
			this.table = await this.db.openTable(tableName);
			const vectorRes = await embeddingTool.getEmbeddings([{ text, file_name: '', start_offset: 0, end_offset: 0 }]);
			let results = [];
			if (vectorRes.length && vectorRes[0]) {
				results = await this.table
					.search(vectorRes[0].vector as lancedb.IntoVector)
					.limit(limit)
					.toArray();
			}
			await this.closedb();
			return results;
		} catch (error) {
			throw new Error(`搜索文本失败: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	async insertFile(tableName: string, fileName: string) {
		try {
			const embeddings = await embeddingTool.embeddingFile(fileName);
			await this.insertVector(tableName, embeddings as IChunkVectorData[]);
			let processFiles = this.processFiles.get(tableName);
			if (processFiles?.length && processFiles.includes(fileName)) {
				processFiles = processFiles.filter((item) => item != fileName);
				this.processFiles.set(tableName, processFiles);
			}
			console.log(fileName, '嵌入成功');
		} catch (error) {
			throw new Error(`嵌入文件 ${fileName} 失败: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	async selectFile(tableName: string) {
		try {
			if (!this.db) this.db = await this.initdb();
			this.table = await this.db.openTable(tableName);
			const fileName = await this.table.query().select(['file_name']).toArray();
			let uniqueFilenames = [...new Set(fileName.map((row) => row.file_name))].map((item) => {
				return {
					filename: item,
					status: 'success',
				};
			});
			const processfiles = (this.processFiles.get(tableName) || []).map((item) => {
				return {
					filename: item,
					status: 'waiting',
				};
			});

			return uniqueFilenames.concat(processfiles);
		} catch (error) {
			throw new Error(`查询文件列表失败: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	processFile(tableName: string, fileName: string) {
		// 获取现有数组或创建一个新数组
		const fileList = this.processFiles.get(tableName) || [];
		// 添加新文件名
		fileList.push(fileName);
		// 更新Map
		this.processFiles.set(tableName, fileList);
	}
}
