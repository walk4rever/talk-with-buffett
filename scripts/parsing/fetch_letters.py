import requests
import os
import re
import brotli
from bs4 import BeautifulSoup

BASE_URL = "https://www.berkshirehathaway.com/letters/"
LETTERS_PAGE = "https://www.berkshirehathaway.com/letters/letters.html"
DOWNLOAD_DIR = "data/letters"

# 年份范围：1977-2024
START_YEAR = 1977
END_YEAR = 2024

# 模拟浏览器 User-Agent - 明确支持 Brotli
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept-Encoding": "gzip, deflate, br",  # 支持 Brotli
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
}


def fetch_letter_links():
    """从伯克希尔官网抓取所有信件链接"""
    print(f"Fetching letter links from {LETTERS_PAGE}...")
    try:
        response = requests.get(LETTERS_PAGE, headers=HEADERS, timeout=30)
        response.raise_for_status()
        soup = BeautifulSoup(response.text, 'html.parser')
        
        letters = []
        for link in soup.find_all('a', href=True):
            href = link['href']
            # 匹配 PDF 格式 (2004-2024): 2024ltr.pdf
            pdf_match = re.match(r'(\d{4})ltr\.pdf$', href)
            # 匹配 HTML 格式 (1977-2003): 1977.html
            html_match = re.match(r'(\d{4})\.html$', href)
            # 匹配 1998-2003 PDF: 1998pdf.pdf
            pdf_alt_match = re.match(r'(\d{4})pdf\.pdf$', href)
            # 匹配 1998-1999 HTML: 1998htm.html
            htm_alt_match = re.match(r'(\d{4})htm\.html$', href)
            
            if pdf_match:
                year = int(pdf_match.group(1))
                if START_YEAR <= year <= END_YEAR:
                    letters.append({
                        "year": year,
                        "url": BASE_URL + href,
                        "format": "pdf"
                    })
            elif pdf_alt_match:
                year = int(pdf_alt_match.group(1))
                if START_YEAR <= year <= END_YEAR:
                    letters.append({
                        "year": year,
                        "url": BASE_URL + href,
                        "format": "pdf"
                    })
            elif html_match:
                year = int(html_match.group(1))
                if START_YEAR <= year <= END_YEAR:
                    # 检查是否是提示页面（指向 PDF）
                    letters.append({
                        "year": year,
                        "url": BASE_URL + href,
                        "format": "html_redirect"  # 标记为跳转页
                    })
            elif htm_alt_match:
                year = int(htm_alt_match.group(1))
                if START_YEAR <= year <= END_YEAR:
                    letters.append({
                        "year": year,
                        "url": BASE_URL + href,
                        "format": "html"  # 实际内容页
                    })
        
        # 按年份排序，并去重（优先实际内容）
        letters.sort(key=lambda x: x["year"])
        
        # 去重：同一年份优先保留实际内容而非跳转页
        seen = {}
        for letter in letters:
            year = letter["year"]
            if year not in seen or letter["format"] != "html_redirect":
                seen[year] = letter
        
        letters = list(seen.values())
        letters.sort(key=lambda x: x["year"])
        
        print(f"Found {len(letters)} letters from {START_YEAR} to {END_YEAR}")
        return letters
    except Exception as e:
        print(f"Failed to fetch letter links: {e}")
        return []


def get_download_url(year, fmt):
    """获取特定年份和格式的正确下载 URL"""
    # 1998-2002 年使用不同的 URL 格式
    if 1998 <= year <= 2002:
        if fmt == "pdf":
            return f"{BASE_URL}{year}pdf.pdf"
        elif fmt == "html":
            return f"{BASE_URL}{year}htm.html"
    # 2003 年使用 ltr.pdf 格式
    elif year == 2003:
        if fmt == "pdf":
            return f"{BASE_URL}{year}ltr.pdf"
    # 2004+ 使用标准格式
    elif year >= 2004:
        if fmt == "pdf":
            return f"{BASE_URL}{year}ltr.pdf"
    # 1977-1997 使用 HTML 格式
    elif year <= 1997:
        if fmt == "html":
            return f"{BASE_URL}{year}.html"
    return None


def download_letter(year, url, fmt, force=False):
    if not os.path.exists(DOWNLOAD_DIR):
        os.makedirs(DOWNLOAD_DIR)
    
    # 对于 html_redirect 类型，尝试获取实际内容
    if fmt == "html_redirect":
        # 先尝试 HTML 内容页
        actual_url = get_download_url(year, "html")
        target_fmt = "html"
        target_url = actual_url
        filename = f"{year}.html"
        
        if not actual_url:
            # 没有 HTML，尝试 PDF
            actual_url = get_download_url(year, "pdf")
            target_fmt = "pdf"
            target_url = actual_url
            filename = f"{year}_shareholder_letter.pdf"
        
        filepath = os.path.join(DOWNLOAD_DIR, filename)
        if os.path.exists(filepath) and not force:
            print(f"Skipping {year} - already exists.")
            return True
        
        if not target_url:
            print(f"  No valid URL found for {year}")
            return False
        
        fmt = target_fmt
        url = target_url
    else:
        if fmt == "pdf":
            filename = f"{year}_shareholder_letter.pdf"
        else:
            filename = f"{year}.html"
        filepath = os.path.join(DOWNLOAD_DIR, filename)
        
        if os.path.exists(filepath) and not force:
            print(f"Skipping {year} - already exists.")
            return True
    
    print(f"Downloading {year} shareholder letter ({fmt}) from {url}...")
    try:
        response = requests.get(url, headers=HEADERS, timeout=30)
        response.raise_for_status()
        content = response.content
        
        # 处理压缩
        if fmt == "html":
            try:
                content = brotli.decompress(content)
                print(f"  Decompressed Brotli encoding")
            except:
                if content.startswith(b'\x1f\x8b'):
                    import gzip
                    content = gzip.decompress(content)
                    print(f"  Decompressed gzip encoding")
                else:
                    print(f"  Raw content (no compression)")
        
        # 写入文件
        with open(filepath, "wb") as f:
            f.write(content)
        
        # 验证下载内容并转换为 UTF-8
        if fmt == "html":
            text = None
            for enc in ['utf-8', 'windows-1252', 'iso-8859-1']:
                try:
                    text = content.decode(enc)
                    if enc != 'utf-8':
                        with open(filepath, "w", encoding="utf-8") as f:
                            f.write(text)
                        print(f"  Converted from {enc} to UTF-8")
                    break
                except UnicodeDecodeError:
                    continue
            
            if text is None:
                print(f"  ⚠️ Could not decode content with any known encoding")
                text = content.decode('utf-8', errors='replace')
            
            if "Chairman's Letter" in text or "BERKSHIRE HATHAWAY" in text:
                print(f"  ✅ Valid HTML content detected")
            elif "IMPORTANT NOTE" in text:
                print(f"  ⚠️ PDF redirect page")
            else:
                print(f"  ? Content preview: {text[:100]}...")
        else:
            print(f"  PDF downloaded ({len(content)} bytes)")
        
        print(f"  Successfully downloaded {year} letter.")
        return True
    except Exception as e:
        # HTML 失败时尝试回退到 PDF
        if fmt == "html" and 1998 <= year <= 2003:
            print(f"  HTML download failed, trying PDF fallback...")
            pdf_url = get_download_url(year, "pdf")
            if pdf_url:
                return download_letter(year, pdf_url, "pdf", force=force)
        print(f"  Failed to download {year} letter: {e}")
        return False


if __name__ == "__main__":
    import sys
    
    # 支持命令行参数：--force 重新下载，--years 指定年份范围
    force = "--force" in sys.argv
    target_years = None
    
    for i, arg in enumerate(sys.argv):
        if arg == "--years" and i + 1 < len(sys.argv):
            try:
                target_years = sys.argv[i + 1]
            except:
                pass
    
    letters = fetch_letter_links()
    if not letters:
        print("No letters found. Check the URL or network connection.")
        exit(1)
    
    # 过滤目标年份
    if target_years:
        if "-" in target_years:
            start, end = map(int, target_years.split("-"))
            letters = [l for l in letters if start <= l["year"] <= end]
        else:
            years = list(map(int, target_years.split(",")))
            letters = [l for l in letters if l["year"] in years]
    
    if not letters:
        print(f"No letters found for target years: {target_years}")
        exit(1)
    
    print(f"\nWill download {len(letters)} letters (force={force})")
    
    success_count = 0
    for letter in letters:
        if download_letter(letter["year"], letter["url"], letter["format"], force=force):
            success_count += 1
    
    print(f"\nDownloaded {success_count}/{len(letters)} letters successfully.")
