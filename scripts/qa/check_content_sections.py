#!/usr/bin/env python3
"""
Content-level QA for parsed sections.json files.

Focuses on likely parsing-quality issues that structural validation will not catch:
- too many short text sections
- overly long text/table sections
- title-like text sections not marked as title
- unusually high bullet fragmentation
- front-matter note blocks
"""

import json
import re
import sys
from collections import Counter
from pathlib import Path


PARSED_DIR = Path("data/parsed")
SHORT_TEXT_THRESHOLD = 35
SHORT_TEXT_COUNT_THRESHOLD = 10
LONG_TEXT_THRESHOLD = 3500
LONG_TABLE_THRESHOLD = 5000
TITLE_RATIO_THRESHOLD = 0.20
BULLET_COUNT_THRESHOLD = 12
SHORT_BULLET_THRESHOLD = 140


def normalize_text(text: str) -> str:
    text = text.replace("\xa0", " ")
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def is_title_like(text: str) -> bool:
    text = normalize_text(text)
    if not text or len(text) < 3 or len(text) > 90:
        return False
    if text.endswith((".", "!", "?", ";")):
        return False
    if re.fullmatch(r"[\d\W_ ]+", text):
        return False

    words = text.split()
    if len(words) > 12:
        return False

    alpha_words = [w for w in words if re.search(r"[A-Za-z]", w)]
    if not alpha_words:
        return False

    capitalized = sum(1 for w in alpha_words if w[:1].isupper())
    return capitalized / len(alpha_words) >= 0.7


def is_expected_front_performance_table(section: dict) -> bool:
    if section.get("type") != "table":
        return False
    if section.get("order", 999) > 4:
        return False
    if section.get("page") != 1:
        return False

    text = normalize_text(section.get("content_en", "")).lower()
    required_markers = (
        "annual percentage change",
        "berkshire",
        "s&p 500",
    )
    return all(marker in text for marker in required_markers)


def expected_performance_table_orders(sections: list[dict]) -> set[int]:
    expected: set[int] = set()
    for idx, section in enumerate(sections):
        if section.get("type") != "table":
            continue
        text = normalize_text(section.get("content_en", ""))
        lower = text.lower()
        if "1965" not in text or "." not in text:
            continue

        window = sections[max(0, idx - 3): min(len(sections), idx + 3)]
        window_text = " ".join(normalize_text(s.get("content_en", "")).lower() for s in window)
        if (
            "annual percentage change" in window_text
            and "berkshire" in window_text
            and "s&p 500" in window_text
        ):
            expected.add(section["order"])
            continue

        if "relative results" in lower and "berkshire" in lower:
            expected.add(section["order"])

    return expected


def analyze_year(year: int) -> dict:
    path = PARSED_DIR / str(year) / "sections.json"
    sections = json.load(open(path, "r", encoding="utf-8"))
    expected_table_orders = expected_performance_table_orders(sections)

    stats = {
        "year": year,
        "count": len(sections),
        "titles": sum(1 for s in sections if s.get("type") == "title"),
        "tables": sum(1 for s in sections if s.get("type") == "table"),
        "texts": sum(1 for s in sections if s.get("type") == "text"),
    }

    issues: list[str] = []
    details: dict[str, list] = {}

    title_ratio = stats["titles"] / stats["count"] if stats["count"] else 0
    if stats["titles"] == 0:
        issues.append("no_titles")
    elif title_ratio > TITLE_RATIO_THRESHOLD:
        issues.append("high_title_ratio")

    short_texts = [
        s for s in sections
        if s.get("type") == "text" and len(normalize_text(s.get("content_en", ""))) < SHORT_TEXT_THRESHOLD
    ]
    if len(short_texts) >= SHORT_TEXT_COUNT_THRESHOLD:
        issues.append("many_short_texts")
        details["many_short_texts"] = [
            (s["order"], normalize_text(s["content_en"])[:100]) for s in short_texts[:10]
        ]

    long_texts = [
        (s["order"], len(s.get("content_en", "")))
        for s in sections
        if s.get("type") == "text" and len(s.get("content_en", "")) > LONG_TEXT_THRESHOLD
    ]
    if long_texts:
        issues.append("long_texts")
        details["long_texts"] = long_texts[:10]

    long_tables = [
        (s["order"], len(s.get("content_en", "")))
        for s in sections
        if (
            s.get("type") == "table"
            and len(s.get("content_en", "")) > LONG_TABLE_THRESHOLD
            and s.get("order") not in expected_table_orders
            and not is_expected_front_performance_table(s)
        )
    ]
    if long_tables:
        issues.append("long_tables")
        details["long_tables"] = long_tables[:10]

    title_like_texts = [
        (s["order"], normalize_text(s.get("content_en", ""))[:100])
        for s in sections
        if s.get("type") == "text" and is_title_like(s.get("content_en", ""))
    ]
    if len(title_like_texts) >= 5:
        issues.append("title_like_text")
        details["title_like_text"] = title_like_texts[:10]

    bullet_sections = [
        (s["order"], normalize_text(s.get("content_en", ""))[:100])
        for s in sections
        if (
            normalize_text(s.get("content_en", "")).startswith(("•", "- ", "‹"))
            and len(normalize_text(s.get("content_en", ""))) < SHORT_BULLET_THRESHOLD
        )
    ]
    if len(bullet_sections) >= BULLET_COUNT_THRESHOLD:
        issues.append("many_short_bullets")
        details["many_short_bullets"] = bullet_sections[:10]

    first = normalize_text(sections[0].get("content_en", "")) if sections else ""
    if "Note: The following table appears" in first:
        issues.append("front_table_note")
        details["front_table_note"] = [(1, first[:120])]

    return {
        "stats": stats,
        "issues": issues,
        "details": details,
    }


def parse_years(args: list[str]) -> list[int]:
    if not args:
        return sorted(
            int(p.name) for p in PARSED_DIR.iterdir()
            if p.is_dir() and (p / "sections.json").exists()
        )

    years: list[int] = []
    for arg in args:
        if "-" in arg:
            start, end = map(int, arg.split("-"))
            years.extend(range(start, end + 1))
        else:
            years.append(int(arg))
    return sorted(set(years))


def main() -> int:
    years = parse_years(sys.argv[1:])
    results = [analyze_year(year) for year in years]

    issue_counter = Counter()
    flagged = 0
    for result in results:
        if result["issues"]:
            flagged += 1
            for issue in result["issues"]:
                issue_counter[issue] += 1

    print(f"TOTAL YEARS: {len(results)}")
    print(f"FLAGGED YEARS: {flagged}")
    if issue_counter:
        print("ISSUE COUNTS:")
        for issue, count in issue_counter.most_common():
            print(f"  {issue}: {count}")

    for result in results:
        if not result["issues"]:
            continue
        stats = result["stats"]
        print(f"\nYEAR {stats['year']} {stats}")
        print(f"  issues: {', '.join(result['issues'])}")
        for issue, samples in result["details"].items():
            print(f"  {issue}: {samples}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
