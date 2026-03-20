#!/usr/bin/env python3
"""
HTML Parser Test Suite
======================
Tests for verifying the correctness and completeness of HTML parsing.

This test suite:
1. Verifies that all HTML content is captured in parsed sections
2. Checks that no content is lost or corrupted during parsing
3. Validates section types (text, title, table)
4. Ensures proper ordering of sections
5. Reports coverage statistics

Usage:
    python3 tests/parsing/test_html_sections.py [--year YEAR] [--verbose]

Examples:
    python3 tests/parsing/test_html_sections.py              # Test all years
    python3 tests/parsing/test_html_sections.py --year 1977  # Test specific year
    python3 tests/parsing/test_html_sections.py --verbose    # Show detailed output
"""

import json
import os
import re
import sys
from pathlib import Path
from typing import Dict, List, Tuple, Optional
from dataclasses import dataclass, field
from bs4 import BeautifulSoup


# Configuration
START_YEAR = 1977
END_YEAR = 1999
HTML_DIR = Path("data/letters")
PARSED_DIR = Path("data/parsed")

# Minimum content length to be considered valid
MIN_CONTENT_LENGTH = 10

# Coverage thresholds
MIN_COVERAGE_THRESHOLD = 0.85  # 85% minimum coverage (accounts for whitespace/nav content differences)


@dataclass
class TestResult:
    """Result of a single test case"""
    year: int
    passed: bool
    errors: List[str] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)
    stats: Dict = field(default_factory=dict)


@dataclass
class CoverageReport:
    """Coverage report for a single year"""
    year: int
    html_char_count: int = 0
    parsed_char_count: int = 0
    html_word_count: int = 0
    parsed_word_count: int = 0
    coverage_ratio: float = 0.0
    missing_phrases: List[str] = field(default_factory=list)
    extra_phrases: List[str] = field(default_factory=list)


def normalize_text(text: str) -> str:
    """Normalize text for comparison"""
    # Remove extra whitespace
    text = re.sub(r'\s+', ' ', text)
    # Normalize quotes
    text = text.replace('"', '"').replace('"', '"')
    text = text.replace(''', "'").replace(''', "'")
    # Normalize dashes
    text = text.replace('—', '-').replace('–', '-')
    # Normalize non-breaking spaces
    text = text.replace('\xa0', ' ')
    return text.strip()


def extract_text_from_html(html_path: Path) -> str:
    """Extract main text content from HTML file"""
    with open(html_path, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # 1998-1999 的源 HTML 存在明显坏嵌套；使用 lxml 保持与生产解析器一致
    soup = BeautifulSoup(content, 'lxml')
    
    # Remove script and style tags
    for tag in soup.find_all(['script', 'style']):
        tag.decompose()
    
    body = soup.body or soup
    return normalize_text(body.get_text(' ', strip=True))


def get_significant_phrases(text: str, min_length: int = 5) -> List[str]:
    """Extract significant phrases from text for comparison"""
    phrases = []
    
    # Split into sentences
    sentences = re.split(r'[.!?]+', text)
    
    for sentence in sentences:
        sentence = sentence.strip()
        if len(sentence) >= min_length:
            # Extract key phrases (sequences of meaningful words)
            words = sentence.split()
            if len(words) >= 2:
                phrases.append(' '.join(words[:10]))  # First 10 words
    
    return phrases


def parse_sections_json(parsed_path: Path) -> str:
    """Parse sections.json and combine all content"""
    with open(parsed_path, 'r', encoding='utf-8') as f:
        sections = json.load(f)
    
    # Combine all section content
    texts = []
    for section in sections:
        content = section.get('content_en', '')
        if content:
            texts.append(normalize_text(content))
    
    return ' '.join(texts)


def test_section_types(parsed_path: Path) -> Tuple[bool, List[str]]:
    """Test that all sections have valid types and expected schema"""
    errors = []
    
    with open(parsed_path, 'r', encoding='utf-8') as f:
        sections = json.load(f)
    
    valid_types = {'text', 'title', 'table'}
    
    for i, section in enumerate(sections):
        sec_type = section.get('type')
        if sec_type not in valid_types:
            errors.append(f"Section {i+1}: Invalid type '{sec_type}'")
        
        content = section.get('content_en', '')
        if not content:
            errors.append(f"Section {i+1}: Empty content")
        
        order = section.get('order')
        if order != i + 1:
            errors.append(f"Section {i+1}: Order mismatch (expected {i+1}, got {order})")

        source = section.get('source')
        if not isinstance(source, dict):
            errors.append(f"Section {i+1}: Missing source metadata")
        else:
            if source.get('format') != 'html':
                errors.append(f"Section {i+1}: Invalid source.format '{source.get('format')}'")
            if source.get('tag') not in {'p', 'pre', 'table'}:
                errors.append(f"Section {i+1}: Invalid source.tag '{source.get('tag')}'")
            if not isinstance(source.get('year'), int):
                errors.append(f"Section {i+1}: Missing source.year")

        if sec_type == 'title':
            meta = section.get('meta')
            if meta is not None and not isinstance(meta.get('is_standalone_heading'), bool):
                errors.append(f"Section {i+1}: Invalid title meta.is_standalone_heading")

        if sec_type == 'table' and 'table_data' in section:
            table_data = section.get('table_data')
            if not isinstance(table_data, dict):
                errors.append(f"Section {i+1}: table_data must be an object")
            elif not isinstance(table_data.get('rows'), list):
                errors.append(f"Section {i+1}: table_data.rows must be a list")
    
    return len(errors) == 0, errors


def test_content_coverage(html_path: Path, parsed_path: Path, year: int) -> CoverageReport:
    """Test that parsed content covers the original HTML content"""
    report = CoverageReport(year=year)
    
    # Extract text from HTML
    html_text = extract_text_from_html(html_path)
    report.html_char_count = len(html_text)
    report.html_word_count = len(html_text.split())
    
    # Extract text from parsed sections
    parsed_text = parse_sections_json(parsed_path)
    report.parsed_char_count = len(parsed_text)
    report.parsed_word_count = len(parsed_text.split())
    
    # Calculate coverage ratio
    if report.html_char_count > 0:
        report.coverage_ratio = min(1.0, report.parsed_char_count / report.html_char_count)
    
    # Extract significant phrases for detailed comparison
    html_phrases = set(get_significant_phrases(html_text))
    parsed_phrases = set(get_significant_phrases(parsed_text))
    
    # Find missing phrases (in HTML but not in parsed)
    for phrase in html_phrases:
        if phrase not in parsed_phrases:
            # Check if it's a partial match
            found = any(phrase in pp for pp in parsed_phrases)
            if not found:
                report.missing_phrases.append(phrase)
    
    # Limit missing phrases to first 20
    report.missing_phrases = report.missing_phrases[:20]
    
    return report


def test_section_content(html_path: Path, parsed_path: Path, year: int) -> Tuple[bool, List[str], List[str]]:
    """Test that each section's content exists in the original HTML"""
    errors = []
    warnings = []
    
    # Use extract_text_from_html to get clean text (same as coverage test)
    html_text = extract_text_from_html(html_path)
    
    with open(parsed_path, 'r', encoding='utf-8') as f:
        sections = json.load(f)
    
    # Skip very short sections (likely table fragments)
    min_content_length = 30
    
    for i, section in enumerate(sections):
        content = section.get('content_en', '')
        sec_type = section.get('type', '')
        
        if not content or len(content) < min_content_length:
            continue
        
        normalized_content = normalize_text(content)
        
        # Check if content exists in HTML (with some flexibility for whitespace)
        if normalized_content not in html_text:
            # Try fuzzy matching - check if most words exist
            content_words = set(normalized_content.split())
            html_words = set(html_text.split())
            matching_words = content_words & html_words
            
            match_ratio = len(matching_words) / len(content_words) if content_words else 0
            
            if match_ratio < 0.7:
                errors.append(
                    f"Section {i+1} ({sec_type}): Content not found in HTML "
                    f"(match ratio: {match_ratio:.2f})"
                )
            else:
                warnings.append(
                    f"Section {i+1} ({sec_type}): Partial match "
                    f"(ratio: {match_ratio:.2f})"
                )
    
    return len(errors) == 0, errors, warnings


def test_title_detection(html_path: Path, parsed_path: Path, year: int) -> Tuple[bool, List[str], List[str]]:
    """Test that titles are properly detected"""
    errors = []
    warnings = []
    
    with open(html_path, 'r', encoding='utf-8') as f:
        html_content = f.read()
    
    soup = BeautifulSoup(html_content, 'html.parser')
    
    # Find potential titles in HTML (I, B, STRONG tags)
    html_titles = set()
    for tag in soup.find_all(['i', 'b', 'strong', 'h1', 'h2', 'h3']):
        text = tag.get_text().strip()
        if text and len(text) < 150:
            html_titles.add(normalize_text(text))
    
    # Get all parsed content
    with open(parsed_path, 'r', encoding='utf-8') as f:
        sections = json.load(f)
    
    # Combined text from all sections
    all_parsed_text = ' '.join(s.get('content_en', '') for s in sections)
    all_parsed_normalized = normalize_text(all_parsed_text)
    
    # Check if major titles are captured in any section
    major_titles = [t for t in html_titles if len(t) > 15]
    missing_titles = []
    
    for title in major_titles:
        # Check if title exists anywhere in parsed content
        if title not in all_parsed_normalized:
            # Check fuzzy match
            title_words = set(title.split())
            parsed_words = set(all_parsed_normalized.split())
            match_ratio = len(title_words & parsed_words) / len(title_words) if title_words else 0
            if match_ratio < 0.7:
                missing_titles.append(title)
    
    if len(missing_titles) > 5:
        errors.append(f"Missing {len(missing_titles)} titles")
    elif missing_titles:
        warnings.append(f"Missing titles: {missing_titles[:3]}")
    
    return len(errors) == 0, errors, warnings


def test_table_detection(html_path: Path, parsed_path: Path, year: int) -> Tuple[bool, List[str]]:
    """Test that tables are properly detected"""
    errors = []
    
    with open(parsed_path, 'r', encoding='utf-8') as f:
        sections = json.load(f)
    
    # Count tables in parsed sections
    table_sections = [s for s in sections if s.get('type') == 'table']
    
    # Check table content for table-like patterns
    for i, table in enumerate(table_sections):
        content = table.get('content_en', '')
        
        # Tables should have specific patterns
        has_numbers = bool(re.search(r'\$[\d,]+', content))
        has_dots = '.....' in content or '. . . .' in content
        has_multiple_lines = '\n' in content
        
        if not (has_numbers or has_dots or has_multiple_lines):
            errors.append(f"Table {i+1}: May not be a valid table")
    
    return len(errors) == 0, errors


def run_year_test(year: int, verbose: bool = False) -> TestResult:
    """Run all tests for a single year"""
    result = TestResult(year=year, passed=True)
    
    html_path = HTML_DIR / f"{year}.html"
    parsed_path = PARSED_DIR / str(year) / "sections.json"
    
    # Check files exist
    if not html_path.exists():
        result.passed = False
        result.errors.append(f"HTML file not found: {html_path}")
        return result
    
    if not parsed_path.exists():
        result.passed = False
        result.errors.append(f"Parsed file not found: {parsed_path}")
        return result
    
    # Test 1: Section types
    passed, errors = test_section_types(parsed_path)
    if not passed:
        result.passed = False
        result.errors.extend(errors)
    
    # Test 2: Content coverage
    coverage = test_content_coverage(html_path, parsed_path, year)
    result.stats['coverage_ratio'] = coverage.coverage_ratio
    result.stats['html_chars'] = coverage.html_char_count
    result.stats['parsed_chars'] = coverage.parsed_char_count
    
    if coverage.coverage_ratio < MIN_COVERAGE_THRESHOLD:
        result.passed = False
        result.errors.append(
            f"Low coverage: {coverage.coverage_ratio:.2%} "
            f"(threshold: {MIN_COVERAGE_THRESHOLD:.2%})"
        )
    
    if coverage.missing_phrases:
        result.warnings.append(f"Missing {len(coverage.missing_phrases)} phrases")
    
    # Test 3: Section content
    passed, errors, warnings = test_section_content(html_path, parsed_path, year)
    if not passed:
        result.passed = False
        result.errors.extend(errors)
    result.warnings.extend(warnings)
    
    # Test 4: Title detection
    passed, errors, warnings = test_title_detection(html_path, parsed_path, year)
    if not passed:
        result.passed = False
        result.errors.extend(errors)
    result.warnings.extend(warnings)
    
    # Test 5: Table detection
    passed, errors = test_table_detection(html_path, parsed_path, year)
    if not passed:
        result.passed = False
        result.errors.extend(errors)
    
    # Count sections by type
    with open(parsed_path, 'r', encoding='utf-8') as f:
        sections = json.load(f)
    
    result.stats['total_sections'] = len(sections)
    result.stats['text_sections'] = sum(1 for s in sections if s.get('type') == 'text')
    result.stats['title_sections'] = sum(1 for s in sections if s.get('type') == 'title')
    result.stats['table_sections'] = sum(1 for s in sections if s.get('type') == 'table')
    
    return result


def run_all_tests(years: Optional[List[int]] = None, verbose: bool = False) -> List[TestResult]:
    """Run tests for all years or specified years"""
    if years is None:
        years = list(range(START_YEAR, END_YEAR + 1))
    
    results = []
    for year in years:
        result = run_year_test(year, verbose)
        results.append(result)
        
        if verbose:
            print_result(result)
        else:
            status = "✅ PASS" if result.passed else "❌ FAIL"
            print(f"{year}: {status} ({result.stats.get('total_sections', 0)} sections, "
                  f"coverage: {result.stats.get('coverage_ratio', 0):.2%})")
    
    return results


def print_result(result: TestResult):
    """Print detailed test result"""
    status = "✅ PASS" if result.passed else "❌ FAIL"
    print(f"\n{'='*60}")
    print(f"Year {result.year}: {status}")
    print(f"{'='*60}")
    
    print(f"\nStatistics:")
    for key, value in result.stats.items():
        if isinstance(value, float):
            print(f"  {key}: {value:.2%}" if 'ratio' in key else f"  {key}: {value}")
        else:
            print(f"  {key}: {value}")
    
    if result.errors:
        print(f"\nErrors ({len(result.errors)}):")
        for error in result.errors:
            print(f"  ❌ {error}")
    
    if result.warnings:
        print(f"\nWarnings ({len(result.warnings)}):")
        for warning in result.warnings:
            print(f"  ⚠️  {warning}")


def print_summary(results: List[TestResult]):
    """Print test summary"""
    total = len(results)
    passed = sum(1 for r in results if r.passed)
    failed = total - passed
    
    print(f"\n{'='*60}")
    print("TEST SUMMARY")
    print(f"{'='*60}")
    print(f"Total years tested: {total}")
    print(f"Passed: {passed} ({passed/total*100:.1f}%)")
    print(f"Failed: {failed} ({failed/total*100:.1f}%)")
    
    if failed > 0:
        print(f"\nFailed years:")
        for r in results:
            if not r.passed:
                print(f"  - {r.year}: {r.errors[0] if r.errors else 'Unknown error'}")
    
    # Overall coverage
    total_html = sum(r.stats.get('html_chars', 0) for r in results)
    total_parsed = sum(r.stats.get('parsed_chars', 0) for r in results)
    overall_coverage = total_parsed / total_html if total_html > 0 else 0
    
    print(f"\nOverall coverage: {overall_coverage:.2%}")
    print(f"Total sections: {sum(r.stats.get('total_sections', 0) for r in results)}")
    
    return failed == 0


def main():
    """Main entry point"""
    import argparse
    
    parser = argparse.ArgumentParser(description='Test HTML Parser')
    parser.add_argument('--year', type=int, action='append',
                        help='Test specific year(s)')
    parser.add_argument('--verbose', '-v', action='store_true',
                        help='Show detailed output')
    parser.add_argument('--list', action='store_true',
                        help='List available years')
    
    args = parser.parse_args()
    
    if args.list:
        print("Available years:")
        for year in range(START_YEAR, END_YEAR + 1):
            html_exists = (HTML_DIR / f"{year}.html").exists()
            parsed_exists = (PARSED_DIR / str(year) / "sections.json").exists()
            status = "✅" if html_exists and parsed_exists else "❌"
            print(f"  {status} {year}")
        return 0
    
    years = args.year if args.year else None
    results = run_all_tests(years, args.verbose)
    success = print_summary(results)
    
    return 0 if success else 1


if __name__ == "__main__":
    sys.exit(main())
