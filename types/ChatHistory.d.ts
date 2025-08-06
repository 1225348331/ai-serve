interface ChatMessage {
	status: 'start' | 'process' | 'success' | 'error';
	stepName: string;
	duration: number;
	data?: {
		type: string;
		data: any;
	};
}

type UserChatMessage = [{ type: 'string'; value: string }, { type: 'file'; value: string[] }];

type NodeStatus = 'start' | 'process' | 'success' | 'error';
type DataType =
	| 'string'
	| 'think-string'
	| 'object'
	| 'array'
	| 'echarts'
	| 'echarts-array'
	| 'text2image'
	| 'text2video'
	| 'image'
	| 'image-array'
	| 'siteseek-table-array'
	| 'siteseek-sql-array'
	| 'siteseek-chart-string'
	| 'siteseek-chart-array';

interface NodeDataOptions {
	status: NodeStatus;
	stepName: string;
	duration?: number;
	data: {
		type: DataType;
		data: any;
	} | null;
}

interface RobotChatOptions {
	sseControl: SSEControl; // SSE控制实例
	userContent: [{ type: 'string'; value: string }, { type: 'file'; value: string[] }]; // 用户输入内容
	id: number; // 用户/会话ID
	application_type: string; // 应用类型标识
	systemPrompt?: string; // 可选系统提示语
}
