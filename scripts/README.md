# Scripts Layout

This directory is organized by responsibility.

## Parsing

Path: `scripts/parsing/`

Used for source acquisition, parsing, and transformation.

- `fetch_letters.py`: download source letters into `data/letters/`
- `parse_html_sections.py`: parse HTML letters into `sections.json`
- `parse_pdf_sections.py`: parse PDF letters into `sections.json`
- `parse_performance_table.py`: helpers for Berkshire performance table parsing
- `translate_sections.py`: generate `sections_zh.json` from `sections.json`
- `requirements.txt`: Python dependencies for parsing scripts

Naming rule:

- parser entrypoints use `parse_*_sections.py`
- helper modules use noun-style names such as `parse_performance_table.py`

## QA

Path: `scripts/qa/`

Used for validation and acceptance checks.

- `verify_html_sections.py`: structural and coverage validation for HTML years
- `verify_pdf_sections.py`: structural and coverage validation for PDF years
- `check_content_sections.py`: content-level QA across parsed years

Naming rule:

- `verify_*` is used for source-vs-output validation
- `check_*` is used for heuristic content QA

## DB

Path: `scripts/db/`

Used for loading parsed artifacts into the application database.

- `import_sections.ts`: import parsed sections into Prisma

Naming rule:

- database refresh should normally use `npx prisma db seed`
- database write entrypoints use action-style names such as `import_sections.ts`

## Placement Rule

When adding new scripts:

- source fetching, parsing, normalization, translation: put under `scripts/parsing/`
- validation, audit, acceptance, quality checks: put under `scripts/qa/`
- avoid adding new top-level files directly under `scripts/` unless they explain the structure, like this README
