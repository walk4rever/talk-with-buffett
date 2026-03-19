"""
整封信批量翻译脚本

策略：每封信只调用一次 API，把所有需要翻译的段落合并成带编号的大 prompt，
模型返回对应编号的译文，再解析回各段。

优点：
- 4 年只需 4 次 API 调用（原来 178 次）
- 模型能看到全局上下文，翻译更连贯
- 无需逐段限速等待

失败降级：整封信翻译失败时，自动退回逐段翻译。
"""

import json
import os
import re
import sys
import time
from openai import OpenAI
from dotenv import load_dotenv

load_dotenv()

YEARS = [2020, 2021, 2022, 2023, 2024]

client = OpenAI(
    api_key=os.getenv("AI_API_KEY"),
    base_url=os.getenv("AI_API_BASE_URL")
)

MODEL = os.getenv("AI_MODEL", "MiniMax-M2.5")

SYSTEM_PROMPT = """你是一位专业的金融翻译专家，专门翻译沃伦·巴菲特致股东信。

翻译要求：
- 语言优美准确，符合中国读者阅读习惯
- 金融术语翻译准确（如 float=浮存金，retained earnings=留存收益）
- 公司名保留英文并附中文（如 Berkshire Hathaway 伯克希尔·哈撒韦）
- 保持巴菲特幽默、直白的语气

输出格式：严格按照 [编号] 译文 的格式，每段之间空一行，不要添加任何解释或注释。"""


# ─── 核心：整封信一次翻译 ────────────────────────────────────────────────────

def build_batch_prompt(sections):
    """把需翻译的段落拼成带编号的大 prompt，返回 (prompt文本, order→index映射)"""
    lines = []
    translatable_orders = []

    for s in sections:
        order = s["order"]
        content = s.get("content_en", "").strip()
        sec_type = s.get("type", "text")

        # 表格跳过
        if sec_type == "table":
            continue
        if not content or content == "[TABLE DATA]":
            continue

        lines.append(f"[{order}] {content}")
        translatable_orders.append(order)

    prompt = "\n\n".join(lines)
    return prompt, translatable_orders


def parse_batch_response(response_text, translatable_orders):
    """从模型返回的文本中解析出 order→译文 的字典"""
    results = {}

    # 匹配 [数字] 开头的段落，内容到下一个 [数字] 之前
    pattern = re.compile(r'\[(\d+)\]\s*(.*?)(?=\n\n\[\d+\]|\Z)', re.DOTALL)
    matches = pattern.findall(response_text)

    for order_str, content in matches:
        order = int(order_str)
        if order in translatable_orders:
            results[order] = content.strip()

    return results


def translate_letter_batch(year, sections):
    """整封信一次 API 调用完成翻译，返回 order→译文 字典，失败返回 None"""
    prompt, translatable_orders = build_batch_prompt(sections)

    if not translatable_orders:
        return {}

    total_chars = len(prompt)
    print(f"  [批量] 发送 {len(translatable_orders)} 段，约 {total_chars} 字符...")

    max_retries = 3
    for attempt in range(max_retries):
        try:
            response = client.chat.completions.create(
                model=MODEL,
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": f"请翻译以下 {year} 年巴菲特股东信各段落：\n\n{prompt}"}
                ],
                temperature=0.3,
            )
            raw = response.choices[0].message.content.strip()
            results = parse_batch_response(raw, translatable_orders)

            # 解析成功率校验：至少 80% 的段落被解析出来
            success_rate = len(results) / len(translatable_orders)
            if success_rate >= 0.8:
                print(f"  [批量] 解析成功 {len(results)}/{len(translatable_orders)} 段 ({success_rate:.0%})")
                return results
            else:
                print(f"  [批量] 解析率过低 {success_rate:.0%}，重试 (attempt {attempt+1}/{max_retries})...")

        except Exception as e:
            print(f"  [批量] 调用失败 (attempt {attempt+1}/{max_retries}): {e}")
            if attempt < max_retries - 1:
                time.sleep(2 ** attempt)

    return None  # 全部重试失败


# ─── 降级：逐段翻译 ─────────────────────────────────────────────────────────

def translate_single(text, is_short=False):
    """单段翻译，仅在批量失败时使用"""
    if is_short:
        system = "将以下英文直接翻译为中文。专有名词给出通用中文译名。只输出翻译结果。"
    else:
        system = SYSTEM_PROMPT

    max_retries = 3
    for attempt in range(max_retries):
        try:
            response = client.chat.completions.create(
                model=MODEL,
                messages=[
                    {"role": "system", "content": system},
                    {"role": "user", "content": text}
                ],
                temperature=0.3,
            )
            return response.choices[0].message.content.strip()
        except Exception as e:
            print(f"    逐段翻译失败 (attempt {attempt+1}/{max_retries}): {e}")
            if attempt < max_retries - 1:
                time.sleep(2 ** attempt)
    return None


def translate_letter_fallback(sections):
    """逐段降级翻译，返回 order→译文 字典"""
    results = {}
    for s in sections:
        order = s["order"]
        content = s.get("content_en", "").strip()
        sec_type = s.get("type", "text")

        if sec_type == "table":
            continue
        if not content or content == "[TABLE DATA]":
            continue

        is_short = (sec_type == "title" or len(content) <= 100)
        print(f"    逐段翻译段落 {order}...", end=" ")
        zh = translate_single(content, is_short=is_short)
        if zh:
            results[order] = zh
            print(f"OK ({len(zh)} chars)")
        else:
            print("失败，跳过")

        time.sleep(0.5)

    return results


# ─── 主流程 ──────────────────────────────────────────────────────────────────

def translate_letter(year):
    input_path = f"data/parsed/{year}/sections.json"
    output_path = f"data/parsed/{year}/sections_zh.json"

    if not os.path.exists(input_path):
        print(f"[SKIP] 未找到 {year} 年解析数据: {input_path}")
        return

    with open(input_path, "r", encoding="utf-8") as f:
        sections = json.load(f)

    # 已翻译则跳过（全量完成才算）
    if os.path.exists(output_path):
        with open(output_path, "r", encoding="utf-8") as f:
            existing = json.load(f)
        translated_count = sum(1 for s in existing if "content_zh" in s)
        if translated_count == len(sections):
            print(f"[{year}] ✅ 已全部翻译，跳过")
            return
        else:
            print(f"[{year}] ⚠️ 已有 {translated_count}/{len(sections)} 段，重新全量翻译...")

    print(f"\n[{year}] 开始整封信批量翻译（共 {len(sections)} 段）...")

    # 第一步：批量翻译
    translations = translate_letter_batch(year, sections)

    # 第二步：批量失败则降级逐段
    if translations is None:
        print(f"  [降级] 批量翻译失败，改为逐段翻译...")
        translations = translate_letter_fallback(sections)

    # 第三步：把译文写回 sections
    result_sections = []
    for s in sections:
        order = s["order"]
        content = s.get("content_en", "").strip()
        sec_type = s.get("type", "text")

        s = dict(s)  # 浅拷贝，不修改原始数据

        if sec_type == "table" and content == "[TABLE DATA]":
            s["content_zh"] = "[表格数据]"
        elif sec_type == "table":
            s["content_zh"] = content  # 表格保留原文
        elif order in translations:
            s["content_zh"] = translations[order]
        else:
            s["content_zh"] = content  # 翻译缺失则保留原文
            print(f"  ⚠️ 段落 {order} 无译文，保留原文")

        result_sections.append(s)

    # 保存
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(result_sections, f, ensure_ascii=False, indent=2)

    success_count = sum(1 for s in result_sections if s.get("content_zh") and s["content_zh"] != s.get("content_en"))
    print(f"[{year}] ✅ 完成，{success_count}/{len(sections)} 段已翻译 → {output_path}")


if __name__ == "__main__":
    years = YEARS
    if len(sys.argv) > 1:
        years = [int(y) for y in sys.argv[1:]]

    print(f"翻译年份：{years}，模型：{MODEL}")
    for year in years:
        translate_letter(year)

    print("\n全部完成！")
