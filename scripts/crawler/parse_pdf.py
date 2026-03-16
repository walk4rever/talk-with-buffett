import pdfplumber
import os
import json
import sys


YEARS = [2024, 2023, 2022, 2021, 2020]

# 短文本阈值：低于此长度的段落标记为 title 类型
TITLE_MAX_LENGTH = 80
# 最短有效段落长度
MIN_PARAGRAPH_LENGTH = 10
# 表格检测：一页中点线行占比超过此值判定为表格页
TABLE_DOT_LINE_RATIO = 0.3


def classify_page(text):
    """判断整页文本是否为表格页（巴菲特信的业绩对比表用点线对齐）"""
    if not text:
        return "empty"
    lines = [l.strip() for l in text.strip().split('\n') if l.strip()]
    if len(lines) < 3:
        return "text"
    dot_lines = sum(1 for line in lines if '.....' in line or '. . . .' in line)
    if dot_lines / len(lines) >= TABLE_DOT_LINE_RATIO:
        return "table"
    return "text"


def split_paragraphs(text):
    """将页面文本拆分为段落列表"""
    paragraphs = []
    lines = text.split('\n')
    current = []

    for line in lines:
        line = line.strip()
        if not line:
            if current:
                paragraphs.append(" ".join(current))
                current = []
            continue

        current.append(line)

        # 启发式段落结束：短行 + 以句号等结尾
        if len(line) < 40 and line.endswith(('.', '!', '?', '"', ')')):
            paragraphs.append(" ".join(current))
            current = []

    if current:
        paragraphs.append(" ".join(current))

    return paragraphs


def parse_letter(year):
    pdf_path = f"data/letters/{year}_shareholder_letter.pdf"
    output_dir = f"data/parsed/{year}"

    if not os.path.exists(pdf_path):
        print(f"[SKIP] PDF not found: {pdf_path}")
        return None

    if not os.path.exists(output_dir):
        os.makedirs(output_dir)

    sections = []
    section_count = 0

    print(f"Parsing {year} shareholder letter...")

    with pdfplumber.open(pdf_path) as pdf:
        for page_num, page in enumerate(pdf.pages):
            text = page.extract_text()
            if not text:
                continue

            page_type = classify_page(text)

            if page_type == "table":
                # 整页是表格（业绩对比表等），作为一个 section
                section_count += 1
                sections.append({
                    "order": section_count,
                    "content_en": text.strip(),
                    "page": page_num + 1,
                    "type": "table"
                })
                continue

            # 正常文本页：拆段落
            paragraphs = split_paragraphs(text)

            for p_text in paragraphs:
                if len(p_text) < MIN_PARAGRAPH_LENGTH:
                    continue

                section_count += 1
                sec_type = "title" if len(p_text) <= TITLE_MAX_LENGTH else "text"
                sections.append({
                    "order": section_count,
                    "content_en": p_text,
                    "page": page_num + 1,
                    "type": sec_type
                })

    output_path = os.path.join(output_dir, "sections.json")
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(sections, f, ensure_ascii=False, indent=2)

    text_count = sum(1 for s in sections if s['type'] == 'text')
    title_count = sum(1 for s in sections if s['type'] == 'title')
    table_count = sum(1 for s in sections if s['type'] == 'table')
    print(f"Finished {year}: {len(sections)} sections "
          f"({text_count} text, {title_count} title, {table_count} table)")
    return sections


if __name__ == "__main__":
    years = YEARS
    if len(sys.argv) > 1:
        years = [int(y) for y in sys.argv[1:]]

    for year in years:
        parse_letter(year)
