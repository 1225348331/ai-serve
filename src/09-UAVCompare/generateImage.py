import cv2
import re
import sys
import os
import json
from datetime import datetime
import numpy as np
import io


sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
# import hashlib

def process_image(image_path, bbox_string):
    # 读取图片
    image = cv2.imdecode(np.fromfile(image_path, dtype=np.uint8), -1)
    if image is None:
        raise ValueError(f"无法加载图片，请检查路径是否正确: {image_path}")

    # 获取原始图片尺寸
    original_height, original_width = image.shape[:2]

    # 使用正则表达式提取所有bbox坐标
    bbox_pattern = re.compile(r'<bbox>(\d+) (\d+) (\d+) (\d+)</bbox>')
    bboxes = []
    for match in bbox_pattern.finditer(bbox_string):
        x1, y1, x2, y2 = map(int, match.groups())
        bboxes.append([x1, y1, x2, y2])

    # 定义不同颜色以便区分不同bbox
    colors = [
        (0, 0, 255),   # 红色
        (0, 255, 0),   # 绿色
        (255, 0, 0),   # 蓝色
        (0, 255, 255)  # 黄色
    ]

    thickness = 2  # 边框粗细

    # 绘制所有边界框
    for i, bbox in enumerate(bboxes):
        # 将归一化坐标(0-1000)转换为原始图片坐标
        x_min = int(bbox[0] * original_width / 1000)
        y_min = int(bbox[1] * original_height / 1000)
        x_max = int(bbox[2] * original_width / 1000)
        y_max = int(bbox[3] * original_height / 1000)
        
        # 绘制矩形框
        cv2.rectangle(image, (x_min, y_min), (x_max, y_max), colors[i % len(colors)], thickness)
        
        # 添加标签文本（可选）
        label = f"Box {i+1}"
        cv2.putText(image, label, (x_min, y_min-10), cv2.FONT_HERSHEY_SIMPLEX, 
                    0.5, colors[i % len(colors)], 1)

    # 生成输出文件名
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    output_filename = f"{timestamp}_{os.path.basename(image_path)}"
    output_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../upload/data"))
    output_path = os.path.join(output_dir, output_filename)
    
    # 保存处理后的图片
    cv2.imencode('.jpg', image)[1].tofile(output_path)
    
    return output_filename

if __name__ == "__main__":
    # 从命令行参数获取输入
    if len(sys.argv) < 3:
        print("Usage: python script.py <image_path> <bbox_string>")
        sys.exit(1)
    
    image_path = sys.argv[1]
    bbox_string = sys.argv[2]
    
    try:
        output_filename = process_image(image_path, bbox_string)
        # 输出结果作为JSON，方便Node.js解析
        print(json.dumps({"success": True, "output_path": output_filename}, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}, ensure_ascii=False))