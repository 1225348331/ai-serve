interface IChunkData {
	file_name: string;
	text: string;
	start_offset: number;
	end_offset: number;
}

interface IChunkVectorData {
	file_name: string;
	text: string;
	start_offset: number;
	end_offset: number;
	vector: number[];
}
