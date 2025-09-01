import path from 'path';

export interface IGeoCodeData {
	name: string;
	address: string;
	location: {
		lng: number;
		lat: number;
		CGCS2000X: number;
		CGCS2000Y: number;
	};
	filename: string;
}

export const geocode = async (filename: string) => {
	const baseName = path.basename(filename, path.extname(filename));
	// 准备要发送的数据
	const postData = {
		message: baseName,
		city: '姑苏区',
	};

	// 发起POST请求
	const data = await fetch(`${process.env.POIGEOCODE}/poiSearch-new`, {
		method: 'POST', // 指定请求方法为POST
		headers: {
			'Content-Type': 'application/json', // 设置请求头为JSON格式
		},
		body: JSON.stringify(postData), // 将数据转换为JSON字符串
	})
		.then((response) => {
			if (!response.ok) {
				throw new Error('Network response was not ok');
			}
			return response.json();
		})
		.then((data) => {
			return { ...(data as any), filename };
		})
		.catch((error) => {
			console.log(error)
			return null
		});
	return data as IGeoCodeData;
};
