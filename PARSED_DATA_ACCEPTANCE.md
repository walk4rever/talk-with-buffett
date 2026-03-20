# Parsed Data Acceptance

This document defines the acceptance standard for parsed Buffett shareholder letters and records the current baseline status.

## Scope

- English source of truth: `data/parsed/<year>/sections.json`
- Covered years:
  - HTML-derived: `1977-1999`
  - PDF-derived: `2000-2024`

This standard currently applies to English parsed data only. Chinese parsed data is not yet full coverage.

## Acceptance Standard

Parsed data is accepted only when it passes all three layers below.

### 1. Structure Layer

Each year must satisfy all of the following:

- `sections.json` exists
- `order` starts at `1` and is continuous
- every section has non-empty `content_en`
- every section has a valid `type`
- allowed section types are `text`, `title`, `table`
- PDF sections include `source.format = "pdf"`
- HTML sections include `source.format = "html"`
- title sections include `meta.is_standalone_heading`
- table sections include `tableData` when structured table extraction is available

### 2. Coverage Layer

The parsed output must cover the source document without obvious omissions:

- no missing pages
- no missing large text regions
- no empty parse outputs
- no severe section-order corruption

Validation commands:

```bash
python3 tests/parsing/test_html_sections.py
python3 scripts/qa/verify_pdf_sections.py $(seq 2000 2024)
```

Notes:

- HTML years are expected to be near 100% source-text coverage.
- PDF coverage may exceed 100% because block-based extraction can duplicate some textual material relative to plain-page text extraction. This is acceptable as long as structural validation passes and content QA does not surface real defects.

### 3. Content Layer

The parsed output must also be reasonable for downstream use:

- titles should not be broadly misclassified as text
- tables should not be broadly misclassified as text
- text should not be excessively fragmented into many trivial sections
- large narrative pages should not be merged into giant blocks
- front matter, table notes, and table bodies should be classified consistently

Validation command:

```bash
python3 scripts/qa/check_content_sections.py
```

## Explicitly Accepted Exceptions

The following pattern is accepted and does not count as a defect:

- `front_table_note` in `2000-2007`
  - Example: `Note: The following table appears in the printed Annual Report ...`
  - Reason: this note exists in the original source and the product decision is to preserve it in `sections.json`

## Current Baseline

As of `2026-03-20`, the English parsed dataset is accepted.

### English Coverage

- `1977-2024` English `sections.json` exists for all 48 years
- HTML-derived years: `1977-1999`
- PDF-derived years: `2000-2024`

### Validation Status

- Structure layer: pass
- Coverage layer: pass
- Content layer: pass, with only the accepted `front_table_note` pattern remaining in `2000-2007`

### Latest Verification Results

HTML:

```bash
python3 tests/parsing/test_html_sections.py
```

- result: `23/23` years pass
- scope: `1977-1999`

PDF:

```bash
python3 scripts/qa/verify_pdf_sections.py $(seq 2000 2024)
```

- result: `25/25` years pass
- scope: `2000-2024`

Content QA:

```bash
python3 scripts/qa/check_content_sections.py
```

- result: `48` total years scanned
- flagged years: `8`
- all `8` flagged years are `2000-2007`
- all `8` flags are the accepted `front_table_note` exception

## Operational Rule

For this project:

- JSON is the source of truth
- Markdown is a derived representation for reading, review, and diffing
- web rendering may use Markdown, but correctness should always be judged against `sections.json`

## When To Re-run Acceptance

Re-run the full acceptance flow whenever any of the following changes:

- `scripts/parsing/parse_html_sections.py`
- `scripts/parsing/parse_pdf_sections.py`
- `scripts/qa/check_content_sections.py`
- `tests/parsing/test_html_sections.py`
- parsing heuristics for title/table detection
- regenerated `data/parsed/<year>/sections.json`

Recommended full check:

```bash
python3 tests/parsing/test_html_sections.py
python3 scripts/qa/verify_pdf_sections.py $(seq 2000 2024)
python3 scripts/qa/check_content_sections.py
```
