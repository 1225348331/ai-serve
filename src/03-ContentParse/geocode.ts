import axios from 'axios';

const geoCode = async (address: string) => {
	const key = 'rfhXv5ZvJUynw1mEW2t8C2ZMPFyCe5L5';

	// 地点检索
	// const api_url = `https://api.map.baidu.com/place/v2/search?query=${encodeURIComponent(
	// 	address
	// )}&output=json&ak=${key}&region=苏州&coord_type=2&city_limit=true`;

	// 地理编码
	const api_url = `https://api.map.baidu.com/geocoding/v3/?address=${encodeURIComponent(address)}&output=json&ak=${
		key
	}&city=苏州市&ret_coordtype=gcj02ll&extension_analys_level=1`;

	const response = await axios.get(api_url);

	if (response.data.status == 0 && response.data.result) {
		return response.data.result.location;
	}
};


export default geoCode