import ExcelJS from 'exceljs';
import path from 'path';
import fs from 'fs';

// 将JSON数据写入Excel文件
export default async function writeJsonToExcel(data: Record<string, string>[], filename: string): Promise<void> {
    // 检查数据是否为空
    if (!data || data.length === 0) {
        throw new Error('数据不能为空');
    }

    // 创建一个新的工作簿
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('工作数据');

    // 获取所有键作为表头
    const headers = Object.keys(data[0]!);
    
    // 添加表头行
    worksheet.addRow(headers);

    // 添加数据行
    data.forEach((item) => {
        const row = headers.map(header => item[header]);
        worksheet.addRow(row);
    });

    // 设置表头样式
    const headerRow = worksheet.getRow(1);
    headerRow.eachCell((cell) => {
        cell.font = { bold: true };
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
        cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFD3D3D3' },
        };
    });

    // 确保目录存在
    const dirPath = path.join(__dirname, '../../upload/data/');
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }

    const filePath = path.join(dirPath, filename);
    
    try {
        // 写入文件
        await workbook.xlsx.writeFile(filePath);
        console.log(`Excel文件已成功写入: ${filePath}`);
    } catch (error) {
        console.error('写入Excel文件时出错:', error);
        throw error;
    }
}