import axios from 'axios';
import { readFile } from './CreateHumanMessage';
import { getError } from '../errUtils';
import * as math from 'mathjs';

function normalizeVector(vector: number[]) {
	const norm = math.norm(vector);
	return math.divide(vector, norm);
}

export const EmbeddingConfig = {
	embeddingsUrl: 'https://api.siliconflow.cn/v1/embeddings', // 嵌入地址
	embeddingsModel: 'BAAI/bge-m3', // 嵌入模型
	embeddingsKey: 'sk-latepjlmkqhnysxwvqlcbpabfsfshtsvyvaqcbjavtnjlvbp', // 嵌入Key
	embeddingsDimensions: 1024, // 嵌入维度
	chunkSize: 1024, // 文本分块大小
	chunkOverlap: 128, // 块间重叠字符数
};

export class EmbeddingTool {
	constructor() {}

	/** 解析文件 */
	async parseFile(fileName: string) {
		const fileData = readFile(fileName);
		return fileData;
	}

	/** 文本分割 */
	chunkText(text: string, fileName: string) {
		const chunks = [];
		for (let start = 0; start < text.length; start += EmbeddingConfig.chunkSize - EmbeddingConfig.chunkOverlap) {
			const end = Math.min(start + EmbeddingConfig.chunkSize, text.length);
			const chunk = text.slice(start, end);
			chunks.push({
				file_name: fileName,
				text: chunk,
				start_offset: start,
				end_offset: end,
			});
		}

		return chunks;
	}

	/** 获取文本嵌入向量 */
	async getEmbeddings(texts: IChunkData[]) {
		try {
			const batchSize = 60;
			const results = [];

			for (let i = 0; i < texts.length; i += batchSize) {
				const batch = texts.slice(i, i + batchSize);
				const response = await axios.post(
					EmbeddingConfig.embeddingsUrl,
					{
						model: EmbeddingConfig.embeddingsModel,
						input: batch.map((t) => t.text?.trim()).filter((item) => item.length),
						dimensions: EmbeddingConfig.embeddingsDimensions,
					},
					{
						headers: {
							Authorization: `Bearer ${EmbeddingConfig.embeddingsKey}`,
							'Content-Type': 'application/json',
						},
					}
				);

				results.push(
					...(response.data.data as { embedding: number[] }[]).map((embedding, index) => ({
						...batch[index],
						vector: normalizeVector(embedding.embedding),
					}))
				);
			}

			return results;
		} catch (error) {
			throw new Error(`嵌入生成失败: ${getError(error)}`);
		}
	}

	/** 嵌入文件 */
	async embeddingFile(fileName: string) {
		const fileData = await this.parseFile(fileName);
		const chunks = this.chunkText(JSON.stringify(fileData), fileName);
		console.log(`${fileName}  文档分块完成，共${chunks.length}个区块`);
		const embeddings = await this.getEmbeddings(chunks);
		console.log(`${fileName}  向量生成完成`);
		return embeddings;
	}
}
