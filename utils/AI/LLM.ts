import { ChatOpenAI } from '@langchain/openai';
import { ChatDeepSeek } from '@langchain/deepseek';

// 定义LLM配置参数类型
interface LLMConfig {
	model: string;
	baseURL: string;
	apiKey: string;
	temperature: number;
}

/**
 * 获取语言模型实例
 * @param params 自定义配置参数
 * @param hasImage 是否包含图片
 * @param hasVideo 是否包含视频
 * @returns 返回配置好的ChatOpenAI实例
 */
export const getLLM = (
	params: Partial<LLMConfig> = {
		model: 'deepseek-v3-250324',
		baseURL: 'https://ark.cn-beijing.volces.com/api/v3',
		apiKey: '8e1bf446-de08-422c-8168-a38781acbfec',
		temperature: 0.6,
	},
	hasImage = false,
	hasVideo = false
): ChatOpenAI => {
	// 基础配置
	let config: LLMConfig = {
		model: hasImage ? 'doubao-1-5-vision-pro-32k-250115' : 'deepseek-v3-250324',
		baseURL: 'https://ark.cn-beijing.volces.com/api/v3',
		apiKey: '8e1bf446-de08-422c-8168-a38781acbfec',
		temperature: 0.6,
	};

	// 如果有视频则使用阿里云百炼配置
	if (hasVideo) {
		config = {
			model: 'qwen-vl-max-latest',
			baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
			apiKey: 'sk-fde43b36b22b407887a1c10b81e5b6a2',
			temperature: 0.6,
		};
	}

	// 合并自定义参数
	config = { ...config, ...params };

	// 创建并返回ChatOpenAI实例
	return new ChatOpenAI({
		model: config.model,
		configuration: {
			baseURL: config.baseURL,
			apiKey: config.apiKey,
		},
		streamUsage: true,
		temperature: config.temperature,
	});
};

export const getReasonLLM = (
	params: Partial<LLMConfig> = {
		model: 'deepseek-r1-250528',
		baseURL: 'https://ark.cn-beijing.volces.com/api/v3',
		apiKey: '8e1bf446-de08-422c-8168-a38781acbfec',
		temperature: 0.6,
	}
): ChatOpenAI => {
	// 基础配置
	let config: LLMConfig = {
		model: 'deepseek-r1-250528',
		baseURL: 'https://ark.cn-beijing.volces.com/api/v3',
		apiKey: '8e1bf446-de08-422c-8168-a38781acbfec',
		temperature: 0.6,
	};

	// 合并自定义参数
	config = { ...config, ...params };

	// 创建并返回ChatOpenAI实例
	return new ChatDeepSeek({
		model: config.model,
		apiKey: config.apiKey,
		configuration: {
			baseURL: config.baseURL,
		},
		streamUsage: true,
		temperature: config.temperature,
	});
};
