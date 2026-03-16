import requests
import os

# Placeholder list of recent Berkshire Hathaway letters
# In a real scenario, we would crawl the main page to find all URLs automatically.
LETTERS = [
    {"year": 2024, "url": "https://www.berkshirehathaway.com/letters/2024ltr.pdf"},
    {"year": 2023, "url": "https://www.berkshirehathaway.com/letters/2023ltr.pdf"},
    {"year": 2022, "url": "https://www.berkshirehathaway.com/letters/2022ltr.pdf"},
    {"year": 2021, "url": "https://www.berkshirehathaway.com/letters/2021ltr.pdf"},
    {"year": 2020, "url": "https://www.berkshirehathaway.com/letters/2020ltr.pdf"},
]

DOWNLOAD_DIR = "data/letters"

def download_letter(year, url):
    if not os.path.exists(DOWNLOAD_DIR):
        os.makedirs(DOWNLOAD_DIR)
    
    filename = f"{year}_shareholder_letter.pdf"
    filepath = os.path.join(DOWNLOAD_DIR, filename)
    
    if os.path.exists(filepath):
        print(f"Skipping {year} - already exists.")
        return
    
    print(f"Downloading {year} shareholder letter from {url}...")
    try:
        response = requests.get(url, timeout=30)
        response.raise_for_status()
        with open(filepath, "wb") as f:
            f.write(response.content)
        print(f"Successfully downloaded {year} letter.")
    except Exception as e:
        print(f"Failed to download {year} letter: {e}")

if __name__ == "__main__":
    for letter in LETTERS:
        download_letter(letter["year"], letter["url"])
