import pdfplumber
import os
import json
import sys
import re
import fitz

from parse_performance_table import parse_performance_table


YEARS = [2024, 2023, 2022, 2021, 2020]

# 短文本阈值：低于此长度的段落标记为 title 类型
TITLE_MAX_LENGTH = 80
# 最短有效段落长度
MIN_PARAGRAPH_LENGTH = 10
# 超长 block 再次按段落拆分
LONG_NARRATIVE_THRESHOLD = 3500
# 表格检测：一页中点线行占比超过此值判定为表格页
TABLE_DOT_LINE_RATIO = 0.3
BLOCK_TABLE_DOT_LINE_RATIO = 0.25


def make_section(order, content, page, sec_type, *, meta=None, table_data=None):
    """统一 PDF section 输出结构"""
    section = {
        "order": order,
        "content_en": content,
        "page": page,
        "type": sec_type,
        "source": {
            "format": "pdf",
            "page": page,
        },
    }
    if meta:
        section["meta"] = meta
    if table_data is not None:
        section["tableData"] = table_data
    return section


def normalize_text(text):
    """规范化文本"""
    text = text.replace('\xa0', ' ')
    text = text.replace('\uf8e7', ' - ')
    text = re.sub(r'[ \t]+', ' ', text)
    text = re.sub(r'\n{3,}', '\n\n', text)
    return text.strip()


def collapse_text(text):
    return re.sub(r'\s+', ' ', normalize_text(text)).strip()


def is_page_number_block(text):
    compact = collapse_text(text)
    return bool(re.fullmatch(r'\d{1,3}', compact))


def is_visual_separator(text):
    compact = collapse_text(text)
    return bool(compact) and bool(re.fullmatch(r'[\*_\-=·•. ]{5,}', compact))


def is_probable_title(text):
    compact = collapse_text(text)
    if not compact or is_visual_separator(compact):
        return False
    if compact.isupper():
        return True
    if len(compact) > TITLE_MAX_LENGTH:
        return False
    if compact.endswith(('.', ';', '?', '!')):
        return False
    words = compact.split()
    if len(words) > 12:
        return False
    alpha_words = [w for w in words if re.search(r'[A-Za-z]', w)]
    if not alpha_words:
        return False
    capitalized = sum(1 for w in alpha_words if w[:1].isupper())
    return capitalized / len(alpha_words) >= 0.6


def word_count(text):
    return len(collapse_text(text).split())


def has_dot_leader(text):
    return (
        "....." in text
        or ". . . ." in text
        or bool(re.search(r"\.{6,}", text))
        or bool(re.search(r"(?:\.\s){4,}\.", text))
    )


def block_to_table_data(text):
    """将文本块转换为轻量表格结构"""
    rows = []
    for line in normalize_text(text).splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        cells = [cell for cell in re.split(r'\s{2,}', stripped) if cell]
        if not cells:
            cells = [stripped]
        rows.append(cells)
    return {
        "format": "pdf_block",
        "rows": rows,
    }


def is_performance_table_text(text):
    normalized = normalize_text(text)
    lower = normalized.lower()
    return (
        "berkshire" in lower
        and "s&p 500" in lower
        and ("annual percentage change" in lower or "relative results" in lower)
        and ("1965" in normalized and "1966" in normalized)
        and has_dot_leader(normalized)
    )


def is_table_block(text):
    """判断 block 是否为表格"""
    normalized = normalize_text(text)
    lines = [line.strip() for line in normalized.splitlines() if line.strip()]
    if len(lines) == 1:
        line = lines[0]
        dense_numbers = len(re.findall(r'[\d$(),.%]+', line))
        if has_dot_leader(line) and dense_numbers >= 8:
            return True
        return False
    if len(lines) < 2:
        return False

    dot_lines = sum(1 for line in lines if has_dot_leader(line))
    numeric_lines = sum(1 for line in lines if len(re.findall(r'[\d$(),.%]+', line)) >= 3)

    if dot_lines / len(lines) >= BLOCK_TABLE_DOT_LINE_RATIO:
        return True
    if dot_lines >= 1 and numeric_lines >= 2:
        return True
    avg_words = sum(len(line.split()) for line in lines) / len(lines)
    if len(lines) >= 5 and numeric_lines / len(lines) >= 0.8 and avg_words <= 8:
        return True
    return False


def is_table_header_block(text):
    compact = collapse_text(text)
    if not compact or compact.endswith("."):
        return False
    keywords = (
        "annual percentage change",
        "yearend float",
        "underwriting profit",
        "earnings",
        "balance sheet",
        "assets liabilities",
        "assets",
        "liabilities and equity",
        "operations",
        "market value",
        "book value",
        "relative results",
        "capital gains",
        "in millions",
        "year",
        "yearend float",
        "underwriting profit",
        "earnings applicable",
        "net earnings",
        "operating earnings",
        "operating expenses",
        "revenues",
        "interest",
        "income taxes",
        "cost*",
        "market",
        "shares",
    )
    lower = compact.lower()
    return any(keyword in lower for keyword in keywords) and word_count(compact) <= 20


def is_table_note_block(text):
    compact = collapse_text(text)
    lower = compact.lower()
    return (
        lower.startswith("notes:")
        or lower.startswith("note:")
        or lower.startswith("*")
        or lower.startswith("(1)")
        or lower.startswith("(2)")
        or lower.startswith("includes ")
        or lower.startswith("stated on a pre-tax basis")
    )


def is_narrative_block(text):
    compact = collapse_text(text)
    if not compact:
        return False
    if is_table_block(text) or is_table_header_block(text) or is_table_note_block(text):
        return False
    return word_count(compact) >= 18 and any(mark in compact for mark in (".", "?", "!"))


def is_table_lead_block(text):
    compact = collapse_text(text)
    lower = compact.lower()
    if not compact:
        return False
    if is_table_header_block(text):
        return True
    if compact.startswith("(") and compact.endswith(")"):
        return True
    if "employees" in lower or "written premium" in lower:
        return True
    return is_probable_title(text) and word_count(compact) <= 6


def merge_table_group(blocks, start):
    """合并连续的表头/表体/表注 block"""
    group = []
    seen_table_like = False
    i = start

    while i < len(blocks):
        block = blocks[i]
        if is_table_block(block):
            group.append(block)
            seen_table_like = True
            i += 1
            continue

        if not seen_table_like:
            if is_table_lead_block(block) or word_count(block) <= 6:
                group.append(block)
                i += 1
                continue
            break

        if is_table_note_block(block) or is_table_header_block(block):
            group.append(block)
            i += 1
            continue

        if word_count(block) <= 8 and not is_narrative_block(block):
            group.append(block)
            i += 1
            continue

        break

    return group, i


def should_start_table_group(blocks, index):
    block = blocks[index]
    if is_table_block(block):
        return True
    if not is_table_lead_block(block):
        return False

    for look_ahead in range(index + 1, min(len(blocks), index + 8)):
        candidate = blocks[look_ahead]
        if is_table_block(candidate):
            return True
        if is_narrative_block(candidate):
            return False
    return False


def maybe_promote_text_table(section):
    """将明显是表格的 text section 升级为 table"""
    content = section["content_en"]
    if section.get("type") != "text":
        return section
    if not is_table_block(content) and not is_performance_table_text(content):
        return section
    if len(collapse_text(content)) < 20:
        return section

    promoted = dict(section)
    promoted["type"] = "table"
    promoted["tableData"] = block_to_table_data(content)
    return promoted


def extract_page_blocks(pdf, doc, page_index):
    """优先使用 PyMuPDF blocks，必要时回退到 pdfplumber"""
    page = doc[page_index]
    blocks = []

    for block in page.get_text("blocks"):
        text = normalize_text(block[4])
        if not text or is_page_number_block(text):
            continue
        blocks.append(text)

    if blocks:
        return blocks

    fallback_text = pdf.pages[page_index].extract_text() or ""
    fallback_text = normalize_text(fallback_text)
    if not fallback_text:
        return []
    return [fallback_text]


def should_treat_page_as_single_table(page_text, blocks):
    """只有页面主体几乎全是表格时，才整页作为一个 table"""
    if classify_page(page_text) != "table":
        return False
    if not blocks:
        return True

    substantial_blocks = [block for block in blocks if len(collapse_text(block)) >= MIN_PARAGRAPH_LENGTH]
    if not substantial_blocks:
        return True

    table_like_blocks = sum(1 for block in substantial_blocks if is_table_block(block))
    return table_like_blocks == len(substantial_blocks)


def classify_page(text):
    """判断整页文本是否为表格页（巴菲特信的业绩对比表用点线对齐）"""
    if not text:
        return "empty"
    lines = [l.strip() for l in text.strip().split('\n') if l.strip()]
    if len(lines) < 3:
        return "text"
    dot_lines = sum(1 for line in lines if has_dot_leader(line))
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


def split_large_narrative_block(text):
    normalized = normalize_text(text)
    if len(normalized) <= LONG_NARRATIVE_THRESHOLD:
        return [normalized]
    if is_table_block(normalized) or is_performance_table_text(normalized):
        return [normalized]

    paragraphs = split_paragraphs(normalized)
    long_enough = [paragraph for paragraph in paragraphs if len(collapse_text(paragraph)) >= MIN_PARAGRAPH_LENGTH]
    return long_enough or [normalized]


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

    with pdfplumber.open(pdf_path) as pdf, fitz.open(pdf_path) as doc:
        for page_num, page in enumerate(pdf.pages):
            page_text = page.extract_text() or ""
            blocks = extract_page_blocks(pdf, doc, page_num)
            if not page_text and not blocks:
                continue

            if should_treat_page_as_single_table(page_text, blocks):
                # 尝试解析为业绩对比表
                structured = parse_performance_table(page_text)
                
                section_count += 1
                section = make_section(
                    section_count,
                    normalize_text(page_text),
                    page_num + 1,
                    "table",
                )
                
                if structured:
                    section["tableData"] = structured
                    print(f"  Page {page_num + 1}: 解析业绩对比表 ({len(structured['data'])} 年数据)")
                
                sections.append(section)
                continue

            # 正常文本页：优先用 block 分段
            index = 0
            while index < len(blocks):
                block_text = blocks[index]

                if len(collapse_text(block_text)) < MIN_PARAGRAPH_LENGTH:
                    index += 1
                    continue

                if is_visual_separator(block_text):
                    index += 1
                    continue

                if should_start_table_group(blocks, index):
                    group, next_index = merge_table_group(blocks, index)
                    merged = "\n".join(normalize_text(block) for block in group if normalize_text(block))
                    if len(collapse_text(merged)) >= MIN_PARAGRAPH_LENGTH:
                        section_count += 1
                        sections.append(
                            make_section(
                                section_count,
                                normalize_text(merged),
                                page_num + 1,
                                "table",
                                table_data=block_to_table_data(merged),
                            )
                        )
                    index = next_index
                    continue

                section_count += 1
                if is_table_block(block_text):
                    sections.append(
                        make_section(
                            section_count,
                            normalize_text(block_text),
                            page_num + 1,
                            "table",
                            table_data=block_to_table_data(block_text),
                        )
                    )
                    index += 1
                    continue

                sec_type = "title" if is_probable_title(block_text) else "text"
                if sec_type == "title":
                    sections.append(
                        make_section(
                            section_count,
                            collapse_text(block_text),
                            page_num + 1,
                            sec_type,
                            meta={"is_standalone_heading": True},
                        )
                    )
                    index += 1
                    continue

                paragraphs = split_large_narrative_block(block_text)
                section_count -= 1
                for paragraph in paragraphs:
                    paragraph_type = "title" if is_probable_title(paragraph) else "text"
                    section_count += 1
                    sections.append(
                        make_section(
                            section_count,
                            collapse_text(paragraph) if paragraph_type == "title" else normalize_text(paragraph),
                            page_num + 1,
                            paragraph_type,
                            meta={"is_standalone_heading": paragraph_type == "title"},
                        )
                    )
                index += 1

    output_path = os.path.join(output_dir, "sections.json")
    sections = [maybe_promote_text_table(section) for section in sections]
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
