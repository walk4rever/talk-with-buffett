#!/usr/bin/env python3
"""
Verify parsed PDF sections.json against source PDFs.

Checks:
1. sections.json exists
2. order is contiguous
3. source/page metadata exists
4. parsed text roughly covers extracted PDF text
5. suspiciously long table sections are flagged
"""

import json
import re
import sys
from pathlib import Path

import pdfplumber


DATA_DIR = Path("data")
LETTERS_DIR = DATA_DIR / "letters"
PARSED_DIR = DATA_DIR / "parsed"
MIN_COVERAGE_THRESHOLD = 0.85


def normalize_text(text: str) -> str:
    text = text.replace('\xa0', ' ')
    text = text.replace('\uf8e7', ' - ')
    text = re.sub(r'\s+', ' ', text)
    return text.strip()


def extract_pdf_text(pdf_path: Path) -> str:
    texts = []
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            text = page.extract_text()
            if text:
                texts.append(normalize_text(text))
    return ' '.join(texts)


def extract_parsed_text(parsed_path: Path) -> tuple[list[dict], str]:
    sections = json.load(open(parsed_path, 'r', encoding='utf-8'))
    text = ' '.join(normalize_text(section.get('content_en', '')) for section in sections if section.get('content_en'))
    return sections, text


def verify_year(year: int) -> tuple[bool, list[str], dict]:
    pdf_path = LETTERS_DIR / f"{year}_shareholder_letter.pdf"
    parsed_path = PARSED_DIR / str(year) / "sections.json"

    errors: list[str] = []
    stats: dict = {"year": year}

    if not pdf_path.exists():
        errors.append(f"PDF not found: {pdf_path}")
        return False, errors, stats

    if not parsed_path.exists():
        errors.append(f"Parsed file not found: {parsed_path}")
        return False, errors, stats

    sections, parsed_text = extract_parsed_text(parsed_path)
    pdf_text = extract_pdf_text(pdf_path)

    stats["sections"] = len(sections)
    stats["pdf_chars"] = len(pdf_text)
    stats["parsed_chars"] = len(parsed_text)
    stats["coverage"] = round(len(parsed_text) / len(pdf_text), 4) if pdf_text else 0.0

    for idx, section in enumerate(sections, start=1):
        if section.get("order") != idx:
            errors.append(f"Order mismatch at section {idx}")
            break

        source = section.get("source")
        if not isinstance(source, dict) or source.get("format") != "pdf":
            errors.append(f"Invalid source metadata at section {idx}")
            break

        if not isinstance(source.get("page"), int):
            errors.append(f"Missing source.page at section {idx}")
            break

    suspicious_tables = [
        section["order"]
        for section in sections
        if (
            section.get("type") == "table"
            and len(section.get("content_en", "")) > 4000
            and section.get("order") != 1
            and not section.get("tableData")
        )
    ]
    if suspicious_tables:
        errors.append(f"Suspiciously long table sections: {suspicious_tables[:5]}")

    if stats["coverage"] < MIN_COVERAGE_THRESHOLD:
        errors.append(
            f"Low coverage: {stats['coverage']:.2%} (threshold: {MIN_COVERAGE_THRESHOLD:.0%})"
        )

    return len(errors) == 0, errors, stats


def main() -> int:
    years = [int(arg) for arg in sys.argv[1:]] if len(sys.argv) > 1 else [2000, 2001, 2002, 2003, 2004]
    failed = False

    for year in years:
        ok, errors, stats = verify_year(year)
        coverage = stats.get("coverage", 0.0)
        print(
            f"{year}: {'PASS' if ok else 'FAIL'} "
            f"({stats.get('sections', 0)} sections, coverage: {coverage:.2%})"
        )
        for error in errors:
            print(f"  - {error}")
        failed = failed or not ok

    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
