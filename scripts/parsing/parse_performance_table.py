"""
解析巴菲特信中的"业绩对比表"（Berkshire's Performance vs. the S&P 500）

表格格式固定：
- 标题：Berkshire's Performance vs. the S&P 500
- 表头：5 行
- 数据行：年份 + 点线 + 伯克希尔收益率 + 标普 500 收益率
- 汇总行：Compounded Annual Gain 和 Overall Gain
- 注释行：Note: ...

输出结构化 JSON：
{
  "type": "performance_table",
  "headers": [...],
  "data": [{"year": 1965, "berkshire": 49.5, "sp500": 10.0}, ...],
  "summary": {"compound_gain": 19.8, "overall_gain": 4384748},
  "note": "..."
}
"""

import re
import json


def parse_performance_table(text):
    """
    从业绩对比表文本中解析结构化数据
    
    Returns:
        dict: 结构化数据，如果解析失败返回 None
    """
    lines = text.strip().split('\n')
    
    # 1. 验证是否是业绩对比表
    if not any('Berkshire' in line and 'Performance' in line and 'S&P' in line for line in lines[:5]):
        return None
    
    result = {
        "type": "performance_table",
        "headers": [],
        "data": [],
        "summary": {},
        "note": None
    }
    
    # 2. 提取表头（标题后的 5 行）
    header_start = None
    for i, line in enumerate(lines):
        if 'Berkshire' in line and 'Performance' in line:
            header_start = i + 1
            break
    
    if header_start:
        result["headers"] = [lines[i].strip() for i in range(header_start, min(header_start + 5, len(lines)))]
    
    # 3. 提取数据行：年份 + 点线 + 两个数字
    # 模式 1: 带括号负数 1966 ... (3.4) (11.7)
    # 模式 2: 正数 1965 ... 49.5 10.0
    # 模式 3: 带百分号 2024 ... 49.5% 10.0%
    data_pattern = re.compile(
        r'^(\d{4})\s*\.+\s*'  # 年份 + 点线
        r'(\(?\d+\.?\d*%?\)?)\s*'  # 伯克希尔收益率（可能有括号/百分号）
        r'(\(?\d+\.?\d*%?\)?)'  # 标普 500 收益率（可能有括号/百分号）
        r'\s*$'
    )
    
    for line in lines:
        line = line.strip()
        # 跳过非数据行
        if not re.match(r'^\d{4}\s*\.', line):
            continue
        
        match = data_pattern.match(line)
        if match:
            year = int(match.group(1))
            
            # 解析伯克希尔收益率（处理括号负数和百分号）
            b_str = match.group(2).replace('%', '').strip()
            if b_str.startswith('(') and b_str.endswith(')'):
                berkshire = -float(b_str[1:-1])
            else:
                berkshire = float(b_str)
            
            # 解析标普 500 收益率（处理括号负数和百分号）
            s_str = match.group(3).replace('%', '').strip()
            if s_str.startswith('(') and s_str.endswith(')'):
                sp500 = -float(s_str[1:-1])
            else:
                sp500 = float(s_str)
            
            result["data"].append({
                "year": year,
                "berkshire": berkshire,
                "sp500": sp500
            })
    
    # 4. 提取汇总行（兼容紧凑格式和空格格式）
    compound_pattern = re.compile(r'Compounded\s*Annual\s*Gain\s*[-–]\s*(\d{4})-(\d{4})\s*\.+\s*(\d+\.?\d*)%')
    overall_pattern = re.compile(r'Overall\s*Gain\s*[-–]\s*(\d{4})-(\d{4})\s*\.+\s*([\d,]+)%')
    
    for line in lines:
        compound_match = compound_pattern.search(line)
        if compound_match:
            result["summary"]["compound_start"] = int(compound_match.group(1))
            result["summary"]["compound_end"] = int(compound_match.group(2))
            result["summary"]["compound_gain"] = float(compound_match.group(3))
        
        overall_match = overall_pattern.search(line)
        if overall_match:
            result["summary"]["overall_start"] = int(overall_match.group(1))
            result["summary"]["overall_end"] = int(overall_match.group(2))
            # 移除逗号
            overall_str = overall_match.group(3).replace(',', '')
            result["summary"]["overall_gain"] = int(overall_str)
    
    # 5. 提取注释
    note_pattern = re.compile(r'^Note:\s*(.+)$')
    for line in lines:
        note_match = note_pattern.match(line.strip())
        if note_match:
            result["note"] = note_match.group(1)
            break
    
    # 验证：至少要有数据行
    if not result["data"]:
        return None
    
    return result


def test_parse():
    """测试解析函数"""
    # 测试数据（2023 年的表格）
    test_text = """Berkshire's Performance vs. the S&P 500
Annual Percentage Change
in Per-Share in S&P 500
Market Value of with Dividends
Year Berkshire Included
1965 ........................................................................ 49.5 10.0
1966 ........................................................................ (3.4) (11.7)
1967 ........................................................................ 13.3 30.9
2021 ........................................................................ 29.6 28.7
2022 ........................................................................ 4.0 (18.1)
2023 ........................................................................ 15.8 26.3
Compounded Annual Gain – 1965-2023 ........................................... 19.8% 10.2%
Overall Gain – 1964-2023 ...................................................... 4,384,748% 31,223%
Note: Data are for calendar years with these exceptions: 1965 and 1966, year ended 9/30."""

    result = parse_performance_table(test_text)
    print(json.dumps(result, indent=2))
    
    # 验证
    assert result["type"] == "performance_table"
    assert len(result["data"]) == 6
    assert result["data"][0]["year"] == 1965
    assert result["data"][0]["berkshire"] == 49.5
    assert result["data"][1]["berkshire"] == -3.4  # 负数
    assert result["data"][2]["sp500"] == 30.9
    assert result["summary"]["compound_gain"] == 19.8
    assert result["summary"]["overall_gain"] == 4384748
    assert "exceptions" in result["note"]
    
    print("\n✅ 所有测试通过！")


if __name__ == "__main__":
    test_parse()
