# Parsing And QA Guide

This directory documents the validation flow for parsed Buffett letter data.

## Current Layout

```text
tests/
├── parsing/
│   └── test_html_sections.py
└── README.md
```

Related validation scripts live outside `tests/`:

```text
scripts/qa/
├── verify_html_sections.py
├── verify_pdf_sections.py
└── check_content_sections.py
```

## Validation Layers

Parsed data is checked in three layers.

### 1. HTML Regression Test

Use this for HTML-derived years `1977-1999`.

```bash
python3 tests/parsing/test_html_sections.py
python3 tests/parsing/test_html_sections.py --year 1977
python3 tests/parsing/test_html_sections.py --verbose
python3 tests/parsing/test_html_sections.py --list
```

What it checks:

- section types are valid
- `order` is continuous
- no empty content
- parsed text covers the source HTML
- titles and table-like blocks are not obviously lost

### 2. Structural Verification

Use these for source-vs-output validation.

HTML:

```bash
python3 scripts/qa/verify_html_sections.py
```

PDF:

```bash
python3 scripts/qa/verify_pdf_sections.py $(seq 2000 2024)
python3 scripts/qa/verify_pdf_sections.py 2024
```

What they check:

- `sections.json` exists
- source metadata is present
- section ordering is sane
- source coverage is acceptable
- obvious structural corruption is absent

### 3. Content QA

Use this for heuristic content-quality checks across parsed years.

```bash
python3 scripts/qa/check_content_sections.py
python3 scripts/qa/check_content_sections.py 2000-2007
python3 scripts/qa/check_content_sections.py 2024
```

What it checks:

- too many short text fragments
- overly long text or table sections
- title-like text not marked as title
- front-matter/table-note anomalies

## Acceptance Baseline

The canonical acceptance standard is documented in:

- [PARSED_DATA_ACCEPTANCE.md](/Users/rafael/R129/talk-with-buffett/PARSED_DATA_ACCEPTANCE.md)

Current baseline:

- English `sections.json` exists for `1977-2024`
- HTML regression tests pass for `1977-1999`
- PDF structural verification passes for `2000-2024`
- content QA only flags the accepted `front_table_note` pattern in `2000-2007`

## Recommended Full Check

Run this after changing parsing heuristics or regenerating parsed data:

```bash
python3 tests/parsing/test_html_sections.py
python3 scripts/qa/verify_pdf_sections.py $(seq 2000 2024)
python3 scripts/qa/check_content_sections.py
```

## Adding New Tests

Rules:

- HTML parser regression tests belong in `tests/parsing/`
- structural or acceptance checks belong in `scripts/qa/`
- keep parser-specific tests separate from heuristic QA

If you add a new parser-facing test, place it next to:

- [test_html_sections.py](/Users/rafael/R129/talk-with-buffett/tests/parsing/test_html_sections.py)
