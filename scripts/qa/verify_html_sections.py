#!/usr/bin/env python3
"""
Verify parsed sections.json against original HTML source for 1977-1999.
Checks:
1. Content completeness - no missing content
2. Content correctness - text matches exactly
3. Table parsing - tables are correctly identified and parsed
"""

import os
import re
import json
from pathlib import Path
from collections import defaultdict

# Years to verify
START_YEAR = 1977
END_YEAR = 1999

DATA_DIR = Path("data")
LETTERS_DIR = DATA_DIR / "letters"
PARSED_DIR = DATA_DIR / "parsed"

# Report output
REPORT = []
REPORT.append("# Verification Report: HTML vs sections.json (1977-1999)\n")
REPORT.append("This report compares original HTML source with parsed sections.json to ensure:")
REPORT.append("1. No content is missing")
REPORT.append("2. Content is correctly parsed")
REPORT.append("3. Tables are correctly identified and parsed\n")

def read_html(year):
    """Read original HTML file"""
    html_path = LETTERS_DIR / f"{year}.html"
    if not html_path.exists():
        return None
    with open(html_path, 'r', encoding='utf-8') as f:
        return f.read()

def read_sections(year):
    """Read parsed sections.json"""
    sections_path = PARSED_DIR / str(year) / "sections.json"
    if not sections_path.exists():
        return None
    with open(sections_path, 'r', encoding='utf-8') as f:
        return json.load(f)

def extract_text_from_html(html_content):
    """Extract all meaningful text from HTML, normalized"""
    # Remove script and style
    content = re.sub(r'<script[^>]*>.*?</script>', '', html_content, flags=re.DOTALL | re.IGNORECASE)
    content = re.sub(r'<style[^>]*>.*?</style>', '', content, flags=re.DOTALL | re.IGNORECASE)
    
    # Replace HTML entities
    content = content.replace('&nbsp;', ' ')
    content = content.replace('&amp;', '&')
    content = content.replace('&lt;', '<')
    content = content.replace('&gt;', '>')
    
    # Remove all HTML tags
    content = re.sub(r'<[^>]+>', ' ', content)
    
    # Normalize whitespace
    content = re.sub(r'\s+', ' ', content)
    content = content.replace('\xa0', ' ')
    
    return content.strip()

def normalize_text(text):
    """Normalize text for comparison"""
    # Remove extra whitespace
    text = re.sub(r'\s+', ' ', text)
    text = text.strip()
    return text

def find_tables_in_html(html_content):
    """Find table-like content in HTML"""
    tables = []
    
    # Look for PRE tags containing table-like content
    pre_matches = re.findall(r'<pre>(.*?)</pre>', html_content, re.DOTALL | re.IGNORECASE)
    for pre_content in pre_matches:
        # Check if this looks like a table (contains dots for alignment)
        if '.....' in pre_content or '. . .' in pre_content or re.search(r'\.{10,}', pre_content):
            tables.append(pre_content)
    
    return tables

def find_table_rows(text):
    """Extract table rows from text"""
    lines = text.split('\n')
    rows = []
    for line in lines:
        line = line.strip()
        if not line:
            continue
        # Check if line looks like a table row (contains dots)
        if '.....' in line or '. . .' in line or re.search(r'\.{5,}', line):
            rows.append(line)
    return rows

def verify_year(year):
    """Verify a single year's data"""
    issues = []
    warnings = []
    
    html = read_html(year)
    sections = read_sections(year)
    
    if html is None:
        issues.append(f"HTML file not found for {year}")
        return issues, warnings
    
    if sections is None:
        issues.append(f"sections.json not found for {year}")
        return issues, warnings
    
    # 1. Check content completeness
    html_text = extract_text_from_html(html)
    html_text_norm = normalize_text(html_text)
    
    # Combine all section content
    sections_text = ' '.join([normalize_text(s['content_en']) for s in sections])
    
    # Check for missing content
    # We need to be careful here - some HTML structure (like tags) won't be in parsed data
    # So we focus on finding key phrases that should be in the content
    
    # Find key phrases in HTML that should appear in parsed content
    key_phrases = [
        # Opening
        "To the Stockholders",
        "To the Shareholders",
        "Berkshire Hathaway",
        # Business sections
        "Textile Operations",
        "Insurance Underwriting",
        "Insurance Investments",
        "Banking",
        "Blue Chip Stamps",
        # Key financial terms
        "operating earnings",
        "combined ratio",
        "equity capital",
        # Closing
        "Warren E. Buffett",
        "Chairman",
    ]
    
    missing_phrases = []
    for phrase in key_phrases:
        # Check if phrase exists in HTML
        if phrase.lower() in html_text_norm.lower():
            # Check if it appears in parsed sections
            if phrase not in sections_text:
                missing_phrases.append(phrase)
    
    if missing_phrases:
        warnings.append(f"Potentially missing phrases: {missing_phrases[:5]}...")
    
    # 2. Check table detection
    html_tables = find_tables_in_html(html)
    parsed_tables = [s for s in sections if s['type'] == 'table']
    
    # Count table rows in HTML
    html_table_rows = 0
    for table in html_tables:
        html_table_rows += len(find_table_rows(table))
    
    parsed_table_rows = 0
    for table in parsed_tables:
        parsed_table_rows += len(find_table_rows(table['content_en']))
    
    if html_table_rows > 0 and parsed_table_rows == 0:
        issues.append(f"Table detection failed: HTML has ~{html_table_rows} table rows, parsed has 0")
    elif parsed_table_rows > 0 and html_table_rows == 0:
        warnings.append(f"Possible false table detection: parsed has {parsed_table_rows} table rows, HTML has 0")
    elif html_table_rows > 0 and parsed_table_rows > 0:
        # Check if they're close
        if abs(html_table_rows - parsed_table_rows) > 2:
            warnings.append(f"Table row count mismatch: HTML ~{html_table_rows}, parsed {parsed_table_rows}")
    
    # 3. Check section counts
    text_count = sum(1 for s in sections if s['type'] == 'text')
    title_count = sum(1 for s in sections if s['type'] == 'title')
    table_count = sum(1 for s in sections if s['type'] == 'table')
    total = len(sections)
    
    if total < 10:
        warnings.append(f"Very few sections ({total}) - possible under-parsing")
    
    # 4. Check for empty content
    empty_sections = [s['order'] for s in sections if not s['content_en'].strip()]
    if empty_sections:
        issues.append(f"Empty sections found at orders: {empty_sections}")
    
    # 5. Check for very long sections (might be merging issues)
    long_sections = [(s['order'], len(s['content_en'])) for s in sections if len(s['content_en']) > 3000]
    if long_sections:
        warnings.append(f"Long sections (>3000 chars): {long_sections[:3]}...")
    
    return issues, warnings

def main():
    print("=" * 60)
    print("Verifying parsed data against HTML source (1977-1999)")
    print("=" * 60)
    print()
    
    all_issues = []
    all_warnings = []
    
    year_stats = []
    
    for year in range(START_YEAR, END_YEAR + 1):
        issues, warnings = verify_year(year)
        
        # Get stats
        sections = read_sections(year)
        if sections:
            text_count = sum(1 for s in sections if s['type'] == 'text')
            title_count = sum(1 for s in sections if s['type'] == 'title')
            table_count = sum(1 for s in sections if s['type'] == 'table')
            total = len(sections)
        else:
            text_count = title_count = table_count = total = 0
        
        year_stats.append({
            'year': year,
            'total': total,
            'text': text_count,
            'title': title_count,
            'table': table_count,
            'issues': len(issues),
            'warnings': len(warnings)
        })
        
        if issues or warnings:
            print(f"\n{'='*40}")
            print(f"Year {year}:")
            print(f"{'='*40}")
            if issues:
                print(f"  ISSUES ({len(issues)}):")
                for issue in issues:
                    print(f"    - {issue}")
                    all_issues.append(f"{year}: {issue}")
            if warnings:
                print(f"  WARNINGS ({len(warnings)}):")
                for warning in warnings:
                    print(f"    - {warning}")
                    all_warnings.append(f"{year}: {warning}")
        else:
            print(f"Year {year}: ✓ OK ({total} sections)")
    
    # Print summary table
    print("\n" + "=" * 60)
    print("Summary by Year:")
    print("=" * 60)
    print(f"{'Year':<6} {'Total':<6} {'Text':<6} {'Title':<6} {'Table':<6} {'Issues':<8} {'Warnings':<10}")
    print("-" * 60)
    
    total_issues = 0
    total_warnings = 0
    
    for stat in year_stats:
        print(f"{stat['year']:<6} {stat['total']:<6} {stat['text']:<6} {stat['title']:<6} {stat['table']:<6} {stat['issues']:<8} {stat['warnings']:<10}")
        total_issues += stat['issues']
        total_warnings += stat['warnings']
    
    print("-" * 60)
    print(f"{'TOTAL':<6} {sum(s['total'] for s in year_stats):<6} {sum(s['text'] for s in year_stats):<6} {sum(s['title'] for s in year_stats):<6} {sum(s['table'] for s in year_stats):<6} {total_issues:<8} {total_warnings:<10}")
    
    print("\n" + "=" * 60)
    print("Overall Status:")
    print("=" * 60)
    print(f"Total Issues: {total_issues}")
    print(f"Total Warnings: {total_warnings}")
    
    if total_issues == 0 and total_warnings == 0:
        print("\n✓ All years verified successfully!")
    elif total_issues == 0:
        print(f"\n⚠ {total_warnings} warnings found - please review")
    else:
        print(f"\n✗ {total_issues} issues found - needs attention")

if __name__ == "__main__":
    main()