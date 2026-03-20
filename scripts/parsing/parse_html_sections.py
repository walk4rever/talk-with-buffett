#!/usr/bin/env python3
"""
Parse Berkshire Hathaway shareholder letters (1977-1999) from HTML format.
Output sections.json compatible with the Prisma seed importer.
"""

import json
import os
import re
import sys
from bs4 import BeautifulSoup, NavigableString, Tag

# 配置
START_YEAR = 1977
END_YEAR = 1999

# 短文本阈值：低于此长度的段落可能被识别为标题
TITLE_MAX_LENGTH = 120
# 最短有效段落长度
MIN_PARAGRAPH_LENGTH = 10
# 标题最短长度
MIN_TITLE_LENGTH = 3
# legacy PRE 表格检测阈值
TABLE_DOT_LINE_RATIO = 0.3

SENTENCE_STARTERS = {
    'The', 'In', 'It', 'We', 'Our', 'This', 'That', 'These', 'Those',
    'For', 'With', 'When', 'But', 'And', 'Not', 'All', 'Some', 'Any',
    'During', 'Although', 'However', 'Therefore', 'Because', 'Since',
    'At', 'As', 'By', 'From', 'If', 'Of', 'On', 'Then', 'To'
}


def make_section(content, sec_type, source_tag, year, *, meta=None, table_data=None):
    """构建统一 section，保留旧字段兼容空间"""
    section = {
        "content": content,
        "type": sec_type,
        "source": {
            "format": "html",
            "tag": source_tag,
            "year": year,
        },
    }
    if meta:
        section["meta"] = meta
    if table_data is not None:
        section["table_data"] = table_data
    return section


def normalize_whitespace(text):
    """规范化空白"""
    text = text.replace('\xa0', ' ')
    text = re.sub(r'[ \t]+', ' ', text)
    text = re.sub(r'\n{3,}', '\n\n', text)
    return text.strip()


def collapse_text(text):
    """压平文本为单行"""
    return re.sub(r'\s+', ' ', normalize_whitespace(text)).strip()


def is_visual_separator(text):
    """是否为纯视觉分隔符"""
    compact = collapse_text(text)
    if not compact:
        return True
    return bool(re.fullmatch(r'[\*_\-=·•. ]{3,}', compact))


def is_probable_title(text):
    """判断文本是否像章节标题"""
    text = collapse_text(text)
    if not text or is_visual_separator(text):
        return False
    if len(text) < MIN_TITLE_LENGTH or len(text) > TITLE_MAX_LENGTH:
        return False
    if '\n' in text:
        return False
    if text.endswith(('.', ';', '?', '!')):
        return False
    if re.fullmatch(r'[\d,./() -]+', text):
        return False

    words = text.split()
    if len(words) > 14:
        return False

    first_word = re.sub(r'^[^A-Za-z]+', '', words[0]) if words else ''
    if first_word in SENTENCE_STARTERS and not text.endswith(':'):
        return False

    if ':' in text and not text.endswith(':'):
        return False

    alpha_words = [w for w in words if re.search(r'[A-Za-z]', w)]
    capitalized = sum(1 for w in alpha_words if w[:1].isupper())
    if alpha_words and capitalized / len(alpha_words) < 0.5 and not text.endswith(':'):
        return False

    return True


def classify_line(line):
    """判断单行是否为表格行（点线格式）"""
    if not line.strip():
        return "empty"
    stripped = line.strip()
    
    # 检测点线表格格式：包含连续点号用于对齐（至少 5 个点）
    if '.....' in stripped or '. . . .' in stripped:
        return "table"
    
    # 检测多列数字对齐的表格行（需要同时有多个数字和长点线）
    if re.search(r'\.{10,}', stripped) and re.search(r'\$[\d,]+', stripped):
        return "table"
    
    # 检测典型的表格行格式：多列数字
    parts = stripped.split()
    dollar_amounts = sum(1 for p in parts if re.match(r'^\$[\d,]+\.?\d*$', p))
    if dollar_amounts >= 3 and re.search(r'\.{5,}', stripped):
        return "table"
    
    return "text"


def split_pre_blocks(pre_text):
    """按空行拆分 PRE 内容"""
    blocks = []
    current = []

    for raw_line in pre_text.splitlines():
        line = raw_line.rstrip()
        if not line.strip():
            if current:
                blocks.append('\n'.join(current).strip())
                current = []
            continue
        current.append(line)

    if current:
        blocks.append('\n'.join(current).strip())

    return [b for b in blocks if b]


def is_pre_table_block(block):
    """判断 PRE 中的块是否为表格"""
    lines = [line for line in block.splitlines() if line.strip()]
    if not lines:
        return False

    table_lines = sum(1 for line in lines if classify_line(line) == "table")
    has_dot_leader = any('.....' in line or re.search(r'\.{8,}', line) for line in lines)
    numeric_rows = sum(1 for line in lines if len(re.findall(r'[\d$(),.%]+', line)) >= 3)

    return (
        (table_lines / len(lines)) > TABLE_DOT_LINE_RATIO
        or (has_dot_leader and len(lines) >= 2)
        or (has_dot_leader and numeric_rows >= 2)
    )


def normalize_pre_block(block):
    """规范化 PRE 块文本，同时保留段内换行"""
    lines = [re.sub(r'[ \t]+', ' ', line).rstrip() for line in block.splitlines()]
    return '\n'.join(line.strip() for line in lines if line.strip()).strip()


def pre_block_table_data(block_text):
    """PRE 表格的轻量结构化表示"""
    rows = []
    for line in block_text.splitlines():
        stripped = line.strip()
        if stripped:
            rows.append([re.sub(r'\s{2,}', ' ', stripped)])
    return {
        "format": "preformatted",
        "rows": rows,
    }


def extract_sections_from_pre_tag(pre, title_texts, year):
    """从单个 PRE 标签提取 sections"""
    sections = []

    for block in split_pre_blocks(pre.get_text()):
        block_text = normalize_pre_block(block)
        if not block_text or is_visual_separator(block_text):
            continue

        collapsed = collapse_text(block_text)
        if collapsed in title_texts or is_probable_title(collapsed):
            sections.append(
                make_section(
                    collapsed,
                    "title",
                    "pre",
                    year,
                    meta={"is_standalone_heading": True},
                )
            )
            continue

        if len(collapsed) < MIN_PARAGRAPH_LENGTH:
            continue

        if is_pre_table_block(block_text):
            sections.append(
                make_section(
                    block_text,
                    "table",
                    "pre",
                    year,
                    table_data=pre_block_table_data(block_text),
                )
            )
            continue

        sections.append(make_section(block_text, "text", "pre", year))

    return sections


def collect_title_texts(soup):
    """收集显式标记出来的标题文本"""
    title_texts = set()
    for tag in soup.find_all(['i', 'b', 'strong']):
        if tag.find_parent('table') is not None:
            continue
        text = collapse_text(tag.get_text())
        if is_probable_title(text):
            title_texts.add(text)
    return title_texts


def add_section(sections, seen, content, sec_type):
    """去重后追加 section"""
    dedupe_value = content["content"] if isinstance(content, dict) else content
    key = (sec_type, dedupe_value)
    if key in seen:
        return
    seen.add(key)
    sections.append(content)


def extract_sections_from_hybrid_html(soup, year):
    """处理 1990-1997 这类 P/PRE 混合结构"""
    sections = []
    seen = set()
    body = soup.body or soup
    title_texts = collect_title_texts(soup)
    data_table_ids = {id(table) for table in body.find_all('table') if is_data_table(table)}

    for tag in body.descendants:
        if not isinstance(tag, Tag):
            continue

        if tag.name == 'pre':
            for section in extract_sections_from_pre_tag(tag, title_texts, year):
                add_section(sections, seen, section, section['type'])
            continue

        if tag.name == 'p':
            if any(id(parent) in data_table_ids for parent in tag.parents if getattr(parent, 'name', None) == 'table'):
                continue

            text = extract_text_excluding_tables(tag)
            if not text or is_visual_separator(text):
                continue
            if text == 'BERKSHIRE HATHAWAY INC.':
                continue

            sec_type = 'title' if text in title_texts or is_probable_title(text) else 'text'
            add_section(
                sections,
                seen,
                make_section(
                    text,
                    sec_type,
                    'p',
                    year,
                    meta={"is_standalone_heading": sec_type == 'title'},
                ),
                sec_type,
            )
            continue

        if tag.name == 'table' and id(tag) in data_table_ids:
            table_section = extract_table_section(tag)
            if table_section is not None:
                table_section["source"]["year"] = year
                add_section(sections, seen, table_section, table_section['type'])

    return sections


def extract_sections_from_pre(soup, year):
    """从 PRE 标签提取 legacy HTML 的正文和表格"""
    sections = []
    title_texts = collect_title_texts(soup)

    for pre in soup.find_all('pre'):
        sections.extend(extract_sections_from_pre_tag(pre, title_texts, year))

    return sections


def extract_text_excluding_tables(tag):
    """提取标签文本，但排除嵌套 table 的内容"""
    parts = []
    for node in tag.descendants:
        if isinstance(node, NavigableString):
            inside_nested_table = False
            for parent in node.parents:
                if parent is tag:
                    break
                if getattr(parent, 'name', None) == 'table':
                    inside_nested_table = True
                    break
            if inside_nested_table:
                continue
            parts.append(str(node))
    return collapse_text(' '.join(parts))


def is_data_table(table):
    """区分真正的数据表和仅用于页面布局的 table"""
    rows = table.find_all('tr', recursive=False)
    if len(rows) < 2:
        return False

    compact_row_count = 0
    numeric_or_dot_rows = 0
    long_text_cells = 0
    nested_table_rows = 0

    for row in rows:
        cells = row.find_all(['th', 'td'], recursive=False)
        if len(cells) >= 2:
            compact_row_count += 1

        if any(cell.find('table') is not None for cell in cells):
            nested_table_rows += 1

        cell_texts = [collapse_text(cell.get_text(' ', strip=True)) for cell in cells]
        if any(len(text) > 300 for text in cell_texts):
            long_text_cells += 1

        dot_like = any('.....' in text or re.search(r'\.{6,}', text) for text in cell_texts)
        numeric_cells = sum(1 for text in cell_texts if re.search(r'[\d$(),.%]', text))
        if len(cells) >= 2 and (dot_like or numeric_cells >= 2):
            numeric_or_dot_rows += 1

    if compact_row_count < 2:
        return False
    if nested_table_rows > 0:
        return False
    if long_text_cells > 0 and numeric_or_dot_rows == 0:
        return False

    return numeric_or_dot_rows >= 2 or numeric_or_dot_rows >= compact_row_count / 2


def extract_table_section(table):
    """从 HTML table 提取表格文本"""
    rows = []
    raw_rows = []

    for tr in table.find_all('tr'):
        cells = []
        for cell in tr.find_all(['th', 'td'], recursive=False):
            text = collapse_text(cell.get_text(' ', strip=True))
            if text:
                cells.append(text)
        if cells:
            raw_rows.append(cells)
            rows.append(' | '.join(cells))

    if len(rows) < 2:
        fallback = collapse_text(table.get_text(' ', strip=True))
        if fallback and len(fallback) >= MIN_PARAGRAPH_LENGTH:
            return make_section(
                fallback,
                "table",
                "table",
                None,
                table_data={"format": "html_table", "rows": [[fallback]]},
            )
        return None

    return make_section(
        '\n'.join(rows),
        "table",
        "table",
        None,
        table_data={"format": "html_table", "rows": raw_rows},
    )


def modern_tag_kind(tag):
    """现代 HTML 中可产出 section 的标签类型"""
    if not isinstance(tag, Tag):
        return None
    if tag.name == 'table':
        return 'table'
    if tag.name == 'p':
        return 'paragraph'
    return None


def extract_sections_from_modern_html(soup, year):
    """处理 1998-1999 这种以 p/table 为主的 HTML"""
    sections = []
    seen = set()
    body = soup.body or soup
    data_table_ids = {id(table) for table in body.find_all('table') if is_data_table(table)}

    for tag in body.descendants:
        kind = modern_tag_kind(tag)
        if kind is None:
            continue

        if kind == 'paragraph':
            if any(id(parent) in data_table_ids for parent in tag.parents if getattr(parent, 'name', None) == 'table'):
                continue

            text = extract_text_excluding_tables(tag)
            if not text or is_visual_separator(text):
                continue

            if text == 'BERKSHIRE HATHAWAY INC.':
                continue

            signature_like = text in {'Warren E. Buffett', 'Chairman'} or re.fullmatch(r'[A-Z][a-z]+ \d{1,2}, \d{4}', text)
            if signature_like:
                sec_type = 'title'
            elif is_probable_title(text):
                sec_type = 'title'
            else:
                sec_type = 'text'

            key = (sec_type, text)
            if key in seen:
                continue
            seen.add(key)
            sections.append(
                make_section(
                    text,
                    sec_type,
                    'p',
                    year,
                    meta={"is_standalone_heading": sec_type == 'title'},
                )
            )
            continue

        if id(tag) not in data_table_ids:
            continue
        table_section = extract_table_section(tag)
        if table_section is None:
            continue
        table_section["source"]["year"] = year
        key = (table_section['type'], table_section['content'])
        if key in seen:
            continue
        seen.add(key)
        sections.append(table_section)

    return sections


def parse_letter(year):
    """解析单一年份的 HTML 文件"""
    html_path = f"data/letters/{year}.html"
    output_dir = f"data/parsed/{year}"
    
    if not os.path.exists(html_path):
        print(f"[SKIP] HTML not found: {html_path}")
        return None
    
    if not os.path.exists(output_dir):
        os.makedirs(output_dir)
    
    print(f"Parsing {year} shareholder letter (HTML)...")
    
    # 读取并解析 HTML
    with open(html_path, 'r', encoding='utf-8') as f:
        content = f.read()
    
    soup = BeautifulSoup(content, 'lxml')
    
    # 移除 script 和 style
    for tag in soup.find_all(['script', 'style']):
        tag.decompose()
    
    p_count = len(soup.find_all('p'))
    pre_count = len(soup.find_all('pre'))

    if year >= 1998:
        raw_sections = extract_sections_from_modern_html(soup, year)
    elif p_count >= 20 and pre_count >= 1:
        raw_sections = extract_sections_from_hybrid_html(soup, year)
    else:
        raw_sections = extract_sections_from_pre(soup, year)

    if not raw_sections:
        print("  Warning: No sections extracted, trying fallback...")
        raw_sections = extract_sections_from_pre(soup, year)
    
    # 添加 order 并构建最终 sections
    sections = []
    for i, sec in enumerate(raw_sections):
        section = {
            "order": i + 1,
            "content_en": sec["content"],
            "type": sec["type"]
        }
        if "source" in sec:
            section["source"] = sec["source"]
        if "meta" in sec:
            section["meta"] = sec["meta"]
        if "table_data" in sec:
            section["table_data"] = sec["table_data"]
        sections.append(section)
    
    # 保存结果
    output_path = os.path.join(output_dir, "sections.json")
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(sections, f, ensure_ascii=False, indent=2)
    
    # 统计
    text_count = sum(1 for s in sections if s['type'] == 'text')
    title_count = sum(1 for s in sections if s['type'] == 'title')
    table_count = sum(1 for s in sections if s['type'] == 'table')
    
    print(f"Finished {year}: {len(sections)} sections "
          f"({text_count} text, {title_count} title, {table_count} table)")
    
    return sections


def main():
    """主函数"""
    if len(sys.argv) > 1:
        # 从命令行参数获取年份
        years = []
        for arg in sys.argv[1:]:
            if '-' in arg:
                start, end = map(int, arg.split('-'))
                years.extend(range(start, end + 1))
            else:
                years.append(int(arg))
    else:
        # 默认解析所有年份
        years = list(range(START_YEAR, END_YEAR + 1))
    
    print(f"Parsing HTML letters for years: {years}\n")
    
    for year in years:
        parse_letter(year)
        print()
    
    print("All done!")


if __name__ == "__main__":
    main()
