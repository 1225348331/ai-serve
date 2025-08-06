import path from 'path';
import lineReader from 'line-reader';
import fs from 'fs';

// 断面参数接口
interface SectionParams {
	bottomWidth: number; // 河底宽度（米）
	bottomHeight: number; // 河底高度（米）
	topWidth: number; // 顶部宽度（米）
	slope: number; // 斜坡坡度
}

// 水位参数接口
interface WaterParams {
	maxWaterZ: number; // 最高水位（米）
	minWaterZ: number; // 最低水位（米）
}

// 三维坐标点接口
interface Point3D {
	x: number;
	y: number;
	z: number;
}

// 中线采样点接口（带方向信息）
interface MidlinePoint extends Point3D {
	directionX: number;
	directionY: number;
	accumulatedDistance: number;
}

// 断面采样点接口（含标准高程和维护高程）
interface SectionPoint extends Point3D {
	standardZ: number;
	maintainZ: number;
	dis: number;
	maxWaterZ: number;
	minWaterZ: number;
}

// 交点信息接口
interface IntersectionPoint {
	x: number;
	z: number;
	standardZ: number;
}

// 填挖方计算结果接口
interface FillCutResult {
	fillArea: number;
	cutArea: number;
	intersectionPoints: IntersectionPoint[];
}

// 断面结果接口
interface SectionResult {
	title: string;
	data: SectionPoint[];
	fillArea: number;
	cutArea: number;
	fillVolume: number;
	cutVolume: number;
	effectiveLength: number;
}

// 提取信息参数
export interface extractInfoParams {
	/** 中线采样间隔 */
	midSampleDis?: number;
	/** 横切面采样间隔 */
	crossSampleDis: number;
	/** 标准断面参数 */
	sectionParams?: SectionParams;
	/** 维护断面参数 */
	maintainParams?: SectionParams;
	/** 桩号信息 */
	stationDescription?: { stationNumber?: number[] };
	/** 通航水位信息 */
	waterParams?: WaterParams;
}

/**
 * 读取指定文件并解析为点云数据
 * @param fileName 要读取的文件名
 * @returns 包含三维坐标点的数组
 */
const readFile = (fileName: string): Promise<Point3D[]> => {
	return new Promise((resolve) => {
		const filePath = path.join(__dirname, `../../upload/data/${fileName}`);

		// 检查文件是否存在
		if (!fs.existsSync(filePath)) {
			resolve([]);
		}

		const data: Point3D[] = [];
		lineReader.eachLine(filePath, (line: string, last: boolean) => {
			if (line) {
				const lineData = line.split(',');
				data.push({
					x: parseFloat(lineData[0]!),
					y: parseFloat(lineData[1]!),
					z: parseFloat(lineData[2]!),
				});
			}
			if (last) {
				resolve(data);
			}
		});
	});
};

/**
 * 计算两点之间的平面距离（忽略z轴）
 * @param a 第一个点
 * @param b 第二个点
 * @returns 两点之间的距离
 */
const distance = (a: { x: number; y: number }, b: { x: number; y: number }): number => {
	return Math.sqrt(Math.pow(b.x - a.x, 2) + Math.pow(b.y - a.y, 2));
};

/**
 * 根据采样点位置计算断面z值
 * @param lateralDist 距离中线的横向距离（带符号）
 * @param sectionParams 断面参数
 * @returns 计算得到的高程z值
 */
function calculateZValue(lateralDist: number, sectionParams: SectionParams): number {
	const { bottomWidth, bottomHeight, topWidth, slope } = sectionParams;
	const halfBottom = bottomWidth / 2;
	const halfTop = topWidth / 2;
	const absDist = Math.abs(lateralDist);

	if (absDist <= halfBottom) {
		return bottomHeight; // 河底区域
	} else if (absDist <= halfTop) {
		// 斜坡区域
		const slopeLength = halfTop - halfBottom; // 斜坡水平长度
		const slopeHeight = slope * slopeLength; // 斜坡垂直高度变化
		return bottomHeight + ((absDist - halfBottom) / slopeLength) * slopeHeight;
	} else {
		// 两岸顶部
		return bottomHeight + (halfTop - halfBottom) * slope;
	}
}

/**
 * 在点云中查找距离目标点最近的点并获取其z值
 * @param targetPoint 目标点坐标
 * @param pointCloud 点云数据数组
 * @returns 包含最近点z值的新对象
 */
function findNearestPointWithZ(targetPoint: { x: number; y: number }, pointCloud: Point3D[]): Point3D {
	let nearestPoint: Point3D | null = null;
	let minDistance = Infinity;

	pointCloud.forEach((point) => {
		const dist = distance(targetPoint, point);
		if (dist < minDistance) {
			minDistance = dist;
			nearestPoint = point;
		}
	});

	return nearestPoint ? { ...targetPoint, z: (nearestPoint as Point3D).z } : { ...targetPoint, z: 0 };
}

/**
 * 沿中线生成间隔点及其切线方向
 * @param midLine 中线点数组
 * @param interval 采样间隔距离（米）
 * @param targetInterval 指定的目标间隔数组（可选）
 * @returns 生成的采样点数组
 */
function getMidlinePoints(
	midLine: Point3D[],
	interval: number | undefined,
	targetInterval: number[] = []
): MidlinePoint[] {
	const points: MidlinePoint[] = [];
	if (midLine.length < 2) return points;

	// 如果有指定的目标间隔数组，优先使用它
	const useCustomIntervals = (targetInterval && targetInterval.length > 0) || !interval;
	const intervals = useCustomIntervals
		? [...new Set(targetInterval)].sort((a, b) => a - b) // 去重并排序
		: [];

	let accumulatedDistance = 0;
	let segmentIndex = 0;
	let segmentStart = midLine[0];
	let segmentEnd = midLine[1];
	if (!segmentStart || !segmentEnd) return [];
	let segmentLength = distance(segmentStart!, segmentEnd!);
	let currentPosInSegment = 0;

	// 添加起点（0m位置）
	if (!useCustomIntervals) {
		const firstDirX = (segmentEnd.x - segmentStart.x) / segmentLength;
		const firstDirY = (segmentEnd.y - segmentStart.y) / segmentLength;
		points.push({
			x: segmentStart.x,
			y: segmentStart.y,
			z: segmentStart.z,
			directionX: firstDirX,
			directionY: firstDirY,
			accumulatedDistance: 0,
		});
	}

	// 使用自定义间隔点的情况
	if (useCustomIntervals) {
		let intervalIndex = 0;

		while (intervalIndex < intervals.length && segmentIndex < midLine.length - 1) {
			const targetDist = intervals[intervalIndex];
			if (targetDist == undefined) continue;
			// 跳过小于0的间隔（无效值）
			if (targetDist < 0) {
				intervalIndex++;
				continue;
			}

			// 如果目标距离小于当前累计距离，说明已经处理过（因为数组已排序）
			if (targetDist < accumulatedDistance) {
				intervalIndex++;
				continue;
			}

			// 计算到下一个目标点还需要移动的距离
			const distanceToTarget = targetDist - accumulatedDistance;

			// 如果目标点在当前段内
			if (distanceToTarget <= segmentLength - currentPosInSegment) {
				currentPosInSegment += distanceToTarget;
				accumulatedDistance = targetDist;

				const t = currentPosInSegment / segmentLength;
				const x = segmentStart!.x + t * (segmentEnd!.x - segmentStart!.x);
				const y = segmentStart!.y + t * (segmentEnd!.y - segmentStart!.y);

				points.push({
					x,
					y,
					z: segmentStart!.z + t * (segmentEnd!.z - segmentStart!.z),
					directionX: (segmentEnd!.x - segmentStart!.x) / segmentLength,
					directionY: (segmentEnd!.y - segmentStart!.y) / segmentLength,
					accumulatedDistance: targetDist,
				});

				intervalIndex++;
			} else {
				// 移动到下一段
				accumulatedDistance += segmentLength - currentPosInSegment;
				currentPosInSegment = 0;
				segmentIndex++;

				if (segmentIndex >= midLine.length - 1) break;

				segmentStart = midLine[segmentIndex];
				segmentEnd = midLine[segmentIndex + 1];
				segmentLength = distance(segmentStart!, segmentEnd!);
			}
		}
	}
	// 使用固定间隔的情况
	else {
		while (segmentIndex < midLine.length - 1) {
			if (!segmentStart || !segmentEnd) continue;
			const remainingInSegment = segmentLength - currentPosInSegment;
			const nextSampleDistance = Math.floor(accumulatedDistance / interval + 1) * interval;
			const distanceToNextSample = nextSampleDistance - accumulatedDistance;

			if (distanceToNextSample <= remainingInSegment) {
				currentPosInSegment += distanceToNextSample;
				accumulatedDistance = nextSampleDistance;

				const t = currentPosInSegment / segmentLength;
				const x = segmentStart.x + t * (segmentEnd.x - segmentStart.x);
				const y = segmentStart.y + t * (segmentEnd.y - segmentStart.y);

				points.push({
					x,
					y,
					z: segmentStart.z + t * (segmentEnd.z - segmentStart.z),
					directionX: (segmentEnd.x - segmentStart.x) / segmentLength,
					directionY: (segmentEnd.y - segmentStart.y) / segmentLength,
					accumulatedDistance: nextSampleDistance,
				});
			} else {
				accumulatedDistance += remainingInSegment;
				currentPosInSegment = 0;
				segmentIndex++;

				if (segmentIndex >= midLine.length - 1) break;

				segmentStart = midLine[segmentIndex];
				segmentEnd = midLine[segmentIndex + 1];
				if (!segmentStart || !segmentEnd) return [];
				segmentLength = distance(segmentStart, segmentEnd);
			}
		}
	}

	return points;
}

/**
 * 计算填方和挖方面积，并返回交点信息
 * @param points 断面采样点数组
 * @returns 计算结果
 */
function calculateFillCutAreas(points: SectionPoint[]): FillCutResult {
	// 确保点集按x坐标排序
	points.sort((a, b) => a.x - b.x);

	let fillArea = 0;
	let cutArea = 0;
	const intersectionPoints: IntersectionPoint[] = [];

	for (let i = 0; i < points.length - 1; i++) {
		const p1 = points[i];
		const p2 = points[i + 1];
		if (!p1 || !p2) continue;
		// 计算当前线段的长度
		const dx = p2.x - p1.x;

		// 计算实际高程和标准高程的差值
		const dz1 = p1.z - p1.standardZ;
		const dz2 = p2.z - p2.standardZ;

		// 情况1: 两个点都在标准线之上（填方面积）
		if (dz1 <= 0 && dz2 <= 0) {
			const area = ((dz1 + dz2) * dx) / 2;
			fillArea += area;
		}
		// 情况2: 两个点都在标准线之下（挖方面积）
		else if (dz1 >= 0 && dz2 >= 0) {
			const area = (Math.abs(dz1 + dz2) * dx) / 2;
			cutArea += area;
		}
		// 情况3: 一个点在标准线之上，一个在标准线之下（有交点）
		else {
			// 计算交点位置
			const t = Math.abs(dz1) / (Math.abs(dz1) + Math.abs(dz2));
			const xIntersect = p1.x + t * dx;

			// 计算交点处的z值（应该等于标准值）
			const zIntersect = p1.z + t * (p2.z - p1.z);
			const standardZ = p1.standardZ + t * (p2.standardZ - p1.standardZ);

			// 记录交点信息
			intersectionPoints.push({
				x: xIntersect,
				z: zIntersect,
				standardZ: standardZ,
			});

			// 计算填方部分面积
			if (dz1 < 0) {
				const fillDz1 = dz1;
				const fillDz2 = 0;
				const fillAreaPart = ((fillDz1 + fillDz2) * (xIntersect - p1.x)) / 2;
				fillArea += fillAreaPart;

				const cutDz1 = 0;
				const cutDz2 = dz2;
				const cutAreaPart = (Math.abs(cutDz1 + cutDz2) * (p2.x - xIntersect)) / 2;
				cutArea += cutAreaPart;
			} else {
				const cutDz1 = dz1;
				const cutDz2 = 0;
				const cutAreaPart = (Math.abs(cutDz1 + cutDz2) * (xIntersect - p1.x)) / 2;
				cutArea += cutAreaPart;

				const fillDz1 = 0;
				const fillDz2 = dz2;
				const fillAreaPart = ((fillDz1 + fillDz2) * (p2.x - xIntersect)) / 2;
				fillArea += fillAreaPart;
			}
		}
	}

	return { fillArea: Math.abs(fillArea), cutArea, intersectionPoints };
}

/**
 * 生成采样点 - 横截面按米计算
 * @param params 参数对象
 * @returns 生成的采样点数组
 */
function generateSamplePointsByDistance(params: {
	midLine: Point3D[];
	cloudData: Point3D[];
	midSampleDis?: number;
	crossSampleDis: number;
	sectionParams: SectionParams;
	maintainParams: SectionParams;
	targetInterval?: number[];
	baseTitle?: string;
	waterParams: WaterParams;
}): SectionResult[] {
	const {
		midLine,
		cloudData,
		midSampleDis: interval,
		crossSampleDis: sampleInterval,
		sectionParams,
		maintainParams,
		targetInterval = [],
		baseTitle,
		waterParams,
	} = params;
	const halfTop = Math.max(sectionParams.topWidth, maintainParams.topWidth) / 2;

	// 主流程 - 传入 targetInterval
	const midlinePoints = getMidlinePoints(midLine, interval, targetInterval);
	const result: SectionResult[] = [];

	// 计算中线总长度
	let totalMidlineLength = 0;
	for (let i = 0; i < midLine.length - 1; i++) {
		totalMidlineLength += distance(midLine[i]!, midLine[i + 1]!);
	}

	// 标准断面的关键拐点距离
	const standardCriticalDistances = [
		-sectionParams.topWidth / 2,
		-sectionParams.bottomWidth / 2,
		0,
		sectionParams.bottomWidth / 2,
		sectionParams.topWidth / 2,
	];

	// 维护断面的关键拐点距离
	const maintainCriticalDistances = [
		-maintainParams.topWidth / 2,
		-maintainParams.bottomWidth / 2,
		0,
		maintainParams.bottomWidth / 2,
		maintainParams.topWidth / 2,
	];

	midlinePoints.forEach((mp, index) => {
		const sectionPoints: SectionPoint[] = []; // 当前断面的所有点

		// 计算垂线方向向量（法向量）
		const dirX = -mp.directionY;
		const dirY = mp.directionX;

		// 1. 先生成常规采样点
		const regularSampleCount = Math.ceil((halfTop * 2) / sampleInterval) + 1;
		const regularDistances: number[] = [];
		for (let i = 0; i < regularSampleCount; i++) {
			const dist = -halfTop + i * sampleInterval;
			regularDistances.push(dist);
		}

		// 2. 合并常规采样点和所有关键点距离，并去重排序
		const allDistances = [
			...new Set([...regularDistances, ...standardCriticalDistances, ...maintainCriticalDistances]),
		].sort((a, b) => a - b);

		// 3. 生成所有采样点
		allDistances.forEach((dist) => {
			// 计算采样点坐标
			const x = mp.x + dirX * dist;
			const y = mp.y + dirY * dist;

			// 创建采样点并查找最近的云数据点
			const samplePoint = { x, y };
			const pointWithZ = findNearestPointWithZ(samplePoint, cloudData);

			// 计算标准断面z值
			const standardZ = calculateZValue(dist, sectionParams);
			// 计算维护断面z值
			const maintainZ = calculateZValue(dist, maintainParams);

			// 添加到当前断面
			sectionPoints.push({
				x,
				y,
				z: pointWithZ.z, // 实测高程
				standardZ, // 标准高程
				maintainZ, // 维护高程
				dis: dist, // 距离中线的距离（带符号）
				maxWaterZ: waterParams.maxWaterZ,
				minWaterZ: waterParams.minWaterZ,
			});
		});

		// 计算填方和挖方量，并获取交点
		const { fillArea, cutArea, intersectionPoints } = calculateFillCutAreas(sectionPoints);

		// 将交点添加到采样点中
		intersectionPoints.forEach((intersect) => {
			// 计算交点距离中线的距离
			const dist = (intersect.x - mp.x) / dirX; // 因为 x = mp.x + dirX * dist

			// 计算交点处的维护高程
			const maintainZ = calculateZValue(dist, maintainParams);

			// 查找交点处的实际高程（使用最近的云数据点）
			const intersectPoint = { x: intersect.x, y: mp.y + dirY * dist };

			// 添加到断面点集
			sectionPoints.push({
				x: intersect.x,
				y: intersectPoint.y,
				z: intersect.standardZ,
				standardZ: intersect.standardZ,
				maintainZ: maintainZ,
				dis: dist,
				maxWaterZ: waterParams.maxWaterZ,
				minWaterZ: waterParams.minWaterZ,
			});
		});

		// 重新按x坐标排序
		sectionPoints.sort((a, b) => a.x - b.x);

		// 生成标题
		let title = '';
		if (baseTitle) {
			// 解析基础标题中的桩号名称和起始距离
			const match = baseTitle.split('+');
			if (match && match.length == 2) {
				const km = match[0];
				const m = parseInt(match[1]!, 10);
				// 计算当前点的总距离（米）
				const totalMeters = m + mp.accumulatedDistance;
				title = `${km}+${totalMeters}`;
			} else {
				// 如果无法解析，使用基础标题加上距离
				title = `${baseTitle}+${mp.accumulatedDistance}`;
			}
		} else {
			// 如果没有基础标题，使用距离
			title = `${mp.accumulatedDistance}m`;
		}

		// 计算有效长度（用于体积计算）
		let effectiveLength = 0;
		if (!targetInterval || !targetInterval.length) {
			if (midlinePoints.length === 1) {
				// 如果只有一个断面，则使用中线总长度
				effectiveLength = totalMidlineLength;
			} else if (index === 0) {
				// 第一个断面的有效长度是到下一个断面的一半距离
				const nextDist = midlinePoints[index + 1]!.accumulatedDistance - mp.accumulatedDistance;
				effectiveLength = nextDist / 2;
			} else if (index === midlinePoints.length - 1) {
				// 最后一个断面的有效长度是前一个断面到当前断面的距离的一半
				// 加上当前断面到中线终点的距离
				const prevDist = mp.accumulatedDistance - midlinePoints[index - 1]!.accumulatedDistance;
				const remainingDist = totalMidlineLength - mp.accumulatedDistance;
				effectiveLength = prevDist / 2 + remainingDist;
			} else {
				// 中间断面的有效长度是前后断面距离的一半之和
				const prevDist = mp.accumulatedDistance - midlinePoints[index - 1]!.accumulatedDistance;
				const nextDist = midlinePoints[index + 1]!.accumulatedDistance - mp.accumulatedDistance;
				effectiveLength = (prevDist + nextDist) / 2;
			}
		}

		// 计算填方和挖方体积
		const fillVolume = fillArea * effectiveLength;
		const cutVolume = cutArea * effectiveLength;

		// 将当前断面添加到结果中
		result.push({
			title,
			fillArea,
			cutArea,
			fillVolume,
			cutVolume,
			effectiveLength,
			data: sectionPoints,
		});
	});

	return result;
}

/**
 * 提取采样点主函数
 * @param params 参数对象
 * @param fileList 文件列表
 * @returns 生成的采样点数组
 */
export const extractPoints = async (params: extractInfoParams, fileList: string[]) => {
	const fileName = fileList[0] ? fileList[0] : '2k+200.txt';
	const midLineName = fileList[1] ? fileList[1] : '中线-6个点.txt';

	const cloudData = await readFile(fileName);
	const midLine = await readFile(midLineName);

	if (!cloudData.length) throw new Error(`${fileName}多波束点云文件不存在`);
	if (!midLine.length) throw new Error(`${midLineName}多波束中线文件不存在`);

	const match = fileName.match(/^[^+]+\+[^+]+\.txt$/);
	if (!match) throw new Error('不合法的文件名称，请参考 2k+200,且文件格式需为txt');
	const baseTitle = path.basename(fileName, path.extname(fileName));
	const startDistance = parseInt(baseTitle.split('+')[1]!, 10); // 起始距离200米

	// 计算目标距离（相对于起始点）
	const targetInterval = params.stationDescription?.stationNumber?.map((num) => num - startDistance);

	// 标准断面参数
	const sectionParams: SectionParams = {
		bottomWidth: 45,
		bottomHeight: -2.8,
		topWidth: 60,
		slope: 0.2,
		...Object.fromEntries(
			Object.entries(params.sectionParams || {}).filter(
				([_, value]) => value !== '' && value !== null && value !== undefined
			)
		),
	};

	// 维护断面参数
	const maintainParams: SectionParams = {
		bottomWidth: 43,
		bottomHeight: -2.2,
		topWidth: 60,
		slope: 0.2,
		...Object.fromEntries(
			Object.entries(params.maintainParams || {}).filter(
				([_, value]) => value !== '' && value !== null && value !== undefined
			)
		),
	};

	// 水位参数
	const waterParams: WaterParams = {
		maxWaterZ: 2.654,
		minWaterZ: 0.394,
		...Object.fromEntries(
			Object.entries(params.waterParams || {}).filter(
				([_, value]) => value !== '' && value !== null && value !== undefined
			)
		),
	};

	const points = generateSamplePointsByDistance({
		midLine,
		cloudData,
		midSampleDis: params.midSampleDis,
		crossSampleDis: params.crossSampleDis,
		sectionParams,
		maintainParams,
		targetInterval,
		baseTitle,
		waterParams,
	});

	return points;
};

export default {
	extractPoints,
};
