import json
import os
import sys
import time
from openai import OpenAI
from dotenv import load_dotenv

load_dotenv()

YEARS = [2024, 2023, 2022, 2021, 2020]

# 不需要翻译的内容模式
SKIP_TRANSLATION = {"[TABLE DATA]", "[表格数据]"}

# 短文本（标题、公司名等）用简化 prompt，避免模型"过度发挥"
SHORT_TEXT_THRESHOLD = 100

client = OpenAI(
    api_key=os.getenv("AI_API_KEY"),
    base_url=os.getenv("AI_API_BASE_URL")
)


def translate_text(text, is_short=False):
    """翻译英文段落为中文。短文本用简化 prompt。"""
    if not text or text.strip() in SKIP_TRANSLATION:
        return text

    model_name = os.getenv("AI_MODEL", "MiniMax-M2.5")

    if is_short:
        system_prompt = (
            "将以下英文直接翻译为中文。如果是公司名称、人名等专有名词，"
            "给出通用中文译名即可。只输出翻译结果，不要解释。"
        )
    else:
        system_prompt = (
            "你是一位专业的金融翻译专家。请将沃伦·巴菲特股东信中的以下英文段落"
            "翻译成优美、准确的中文。保持专业的语气，确保金融术语翻译准确，"
            "符合中国读者的阅读习惯。只输出翻译结果。"
        )

    max_retries = 3
    for attempt in range(max_retries):
        try:
            response = client.chat.completions.create(
                model=model_name,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": text}
                ],
                temperature=0.3
            )
            return response.choices[0].message.content.strip()
        except Exception as e:
            print(f"  翻译出错 (attempt {attempt+1}/{max_retries}): {e}")
            if attempt < max_retries - 1:
                time.sleep(2 ** attempt)
    return None


def translate_letter(year):
    input_path = f"data/parsed/{year}/sections.json"
    output_path = f"data/parsed/{year}/sections_zh.json"

    if not os.path.exists(input_path):
        print(f"[SKIP] 未找到 {year} 年的解析数据: {input_path}")
        return

    with open(input_path, "r", encoding="utf-8") as f:
        sections = json.load(f)

    # 断点续传：加载已翻译的部分
    translated_sections = []
    if os.path.exists(output_path):
        with open(output_path, "r", encoding="utf-8") as f:
            translated_sections = json.load(f)
        print(f"[{year}] 从第 {len(translated_sections)+1}/{len(sections)} 段恢复翻译...")
    else:
        print(f"[{year}] 开始翻译 {len(sections)} 段...")

    for i in range(len(translated_sections), len(sections)):
        section = sections[i]
        content = section.get("content_en", "")
        sec_type = section.get("type", "text")

        print(f"  [{year}] 翻译段落 {section['order']}/{len(sections)} ({sec_type})...", end=" ")

        if sec_type == "table" and content == "[TABLE DATA]":
            section["content_zh"] = "[表格数据]"
            print("跳过(表格占位)")
        elif sec_type == "table":
            # 表格文本内容，保留原文不翻译
            section["content_zh"] = content
            print("保留原文(表格)")
        elif sec_type == "title" or len(content) <= SHORT_TEXT_THRESHOLD:
            zh = translate_text(content, is_short=True)
            if zh:
                section["content_zh"] = zh
                print(f"OK (短文本: {zh[:30]}...)")
            else:
                print("失败!")
                break
        else:
            zh = translate_text(content, is_short=False)
            if zh:
                section["content_zh"] = zh
                print(f"OK ({len(zh)} chars)")
            else:
                print("失败! 停止翻译，下次运行可断点续传。")
                break

        translated_sections.append(section)

        # 每 5 段保存一次
        if (i + 1) % 5 == 0:
            with open(output_path, "w", encoding="utf-8") as f:
                json.dump(translated_sections, f, ensure_ascii=False, indent=2)

        # 限速：避免 API rate limit
        time.sleep(0.5)

    # 最终保存
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(translated_sections, f, ensure_ascii=False, indent=2)

    done = len(translated_sections)
    total = len(sections)
    status = "✅ 完成" if done == total else f"⚠️ 部分完成 ({done}/{total})"
    print(f"[{year}] {status}")


if __name__ == "__main__":
    years = YEARS
    if len(sys.argv) > 1:
        years = [int(y) for y in sys.argv[1:]]

    for year in years:
        translate_letter(year)
