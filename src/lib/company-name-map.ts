export function normalizeEnglishName(name: string): string {
  return name
    .replace(/\b(INC|CORP|CORPORATION|CO|COMPANY|HOLDINGS|HLDGS|GROUP|PLC|LTD|LLC|CL A|CL B|COM|SER [A-Z])\b\.?/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

const ZH_BY_TICKER: Record<string, string> = {
  // ── Berkshire core ──────────────────────────────────────
  AAPL: "苹果",
  BAC: "美国银行",
  AXP: "美国运通",
  KO: "可口可乐",
  OXY: "西方石油",
  CVX: "雪佛龙",
  MCO: "穆迪",
  DVA: "达维塔",
  KHC: "卡夫亨氏",
  KR: "克罗格",
  CB: "安达保险",
  VRSN: "VeriSign",
  SIRI: "SiriusXM",
  LLIVE: "自由直播控股",
  BATRK: "亚特兰大勇士控股",
  // ── Tech / global ────────────────────────────────────────
  AMZN: "亚马逊",
  GOOGL: "谷歌",
  GOOG: "谷歌",
  MSFT: "微软",
  NVDA: "英伟达",
  CRWV: "CoreWeave",
  CRDO: "Credo Technology",
  TEM: "Tempus AI",
  ZM: "Zoom",
  // ── China / HK ADRs ──────────────────────────────────────
  BABA: "阿里巴巴",
  PDD: "拼多多",
  NU: "Nu控股",
  GOTU: "高途教育",
  YY: "欢聚集团",
  // ── Finance ──────────────────────────────────────────────
  COF: "第一资本",
  CHTR: "特许通信",
  ALLY: "Ally金融",
  EWBC: "华美银行",
  WFC: "富国银行",
  JEF: "杰富瑞",
  // ── Healthcare ───────────────────────────────────────────
  UNH: "联合健康",
  MRNA: "莫德纳",
  // ── Consumer / Retail ────────────────────────────────────
  DIS: "迪士尼",
  DPZ: "达美乐",
  CROX: "卡骆驰",
  MA: "万事达卡",
  V: "维萨",
  NYT: "纽约时报",
  // ── Industrials / Materials ──────────────────────────────
  DHI: "D.R.霍顿",
  LEN: "莱纳房屋",
  NVR: "NVR",
  ALLE: "安力电子",
  HEI: "海科航空",
  NUE: "纽柯钢铁",
  LPX: "路易斯安那太平洋",
  LAMR: "雷马广告",
  POOL: "Pool",
  // ── Energy ───────────────────────────────────────────────
  XOM: "埃克森美孚",
  SOC: "Sable Offshore",
  // ── International ────────────────────────────────────────
  TSM: "台积电",
  TM: "丰田",
  ASML: "阿斯麦",
  DEO: "帝亚吉欧",
  AON: "怡安集团",
  // ── Telecom ──────────────────────────────────────────────
  TMUS: "T-Mobile",
  // ── Other ────────────────────────────────────────────────
  "BRK.B": "伯克希尔",
  "BRK.A": "伯克希尔",
  STZ: "星座品牌",
  FWONK: "自由媒体",
  LILAK: "自由拉美",
  LILA: "自由拉美",
};

const ZH_BY_ISSUER_KEY: Record<string, string> = {
  // ── Berkshire core ──────────────────────────────────────
  APPLE: "苹果",
  "BANK AMERICA": "美国银行",
  "AMERICAN EXPRESS": "美国运通",
  "COCA COLA": "可口可乐",
  "OCCIDENTAL PETROLEUM": "西方石油",
  "OCCIDENTAL PETE": "西方石油",
  CHEVRON: "雪佛龙",
  "CHEVRON NEW": "雪佛龙",
  MOODYS: "穆迪",
  DAVITA: "达维塔",
  "KRAFT HEINZ": "卡夫亨氏",
  KROGER: "克罗格",
  "CHUBB LIMITED": "安达保险",
  CHUBB: "安达保险",
  VERISIGN: "VeriSign",
  "SIRIUS XM": "SiriusXM",
  "LIBERTY LIVE": "自由直播控股",
  "ATLANTA BRAVES": "亚特兰大勇士控股",
  // ── Tech ─────────────────────────────────────────────────
  AMAZON: "亚马逊",
  ALPHABET: "谷歌",
  MICROSOFT: "微软",
  NVIDIA: "英伟达",
  COREWEAVE: "CoreWeave",
  "CREDO TECHNOLOGY HOLDI": "Credo Technology",
  "TEMPUS AI": "Tempus AI",
  "ZOOM VIDEO COMMUNICATIONS IN": "Zoom",
  // ── China / HK ADRs ──────────────────────────────────────
  "ALIBABA HLDG": "阿里巴巴",
  PDD: "拼多多",
  "NU HOLDINGS": "Nu控股",
  "GAOTU TECHEDU": "高途教育",
  JOYY: "欢聚集团",
  // ── Finance ──────────────────────────────────────────────
  "CHARTER COMMUNICATIONS": "特许通信",
  "CHARTER COMMUNICATIONS N": "特许通信",
  "CAPITAL ONE FINL": "第一资本",
  "ALLY FINL": "Ally金融",
  ALLY: "Ally金融",
  "EAST WEST BANCORP": "华美银行",
  "WELLS FARGO NEW": "富国银行",
  "JEFFERIES FINL": "杰富瑞",
  // ── Healthcare ───────────────────────────────────────────
  UNITEDHEALTH: "联合健康",
  MODERNA: "莫德纳",
  // ── Consumer / Retail ────────────────────────────────────
  "DISNEY WALT": "迪士尼",
  "DOMINOS PIZZA": "达美乐",
  CROCS: "卡骆驰",
  "MASTERCARD INCORPORATED": "万事达卡",
  VISA: "维萨",
  "NEW YORK TIMES": "纽约时报",
  // ── Industrials / Materials ──────────────────────────────
  "D R HORTON": "D.R.霍顿",
  LENNAR: "莱纳房屋",
  NVR: "NVR",
  ALLEGION: "安力电子",
  "HEICO NEW": "海科航空",
  NUCOR: "纽柯钢铁",
  "LOUISIANA PAC": "路易斯安那太平洋",
  "LAMAR ADVERTISING NEW": "雷马广告",
  POOL: "Pool",
  // ── Energy ───────────────────────────────────────────────
  "EXXON MOBIL": "埃克森美孚",
  "SABLE OFFSHORE": "Sable Offshore",
  // ── International ────────────────────────────────────────
  "TAIWAN SEMICONDUCTOR MFG": "台积电",
  "TOYOTA MOTOR": "丰田",
  "ASML HOLDING N V": "阿斯麦",
  DIAGEO: "帝亚吉欧",
  AON: "怡安集团",
  // ── Telecom ──────────────────────────────────────────────
  "TMOBILE US": "T-Mobile",
  // ── Other ────────────────────────────────────────────────
  "BERKSHIRE HATHAWAY DEL": "伯克希尔",
  "CONSTELLATION BRANDS": "星座品牌",
  "LIBERTY MEDIA DEL": "自由媒体",
  "LIBERTY LATIN AMERICA": "自由拉美",
};

const TICKER_BY_ISSUER_KEY: Record<string, string> = {
  // ── Berkshire core ──────────────────────────────────────
  APPLE: "AAPL",
  "AMERICAN EXPRESS": "AXP",
  "BANK AMERICA": "BAC",
  "COCA COLA": "KO",
  CHEVRON: "CVX",
  "CHEVRON NEW": "CVX",
  MOODYS: "MCO",
  "OCCIDENTAL PETE": "OXY",
  "OCCIDENTAL PETROLEUM": "OXY",
  "CHUBB LIMITED": "CB",
  CHUBB: "CB",
  "KRAFT HEINZ": "KHC",
  KROGER: "KR",
  VERISIGN: "VRSN",
  "SIRIUS XM": "SIRI",
  "LIBERTY LIVE": "LLIVE",
  "ATLANTA BRAVES": "BATRK",
  // ── Tech ─────────────────────────────────────────────────
  ALPHABET: "GOOGL",
  DAVITA: "DVA",
  AMAZON: "AMZN",
  MICROSOFT: "MSFT",
  NVIDIA: "NVDA",
  COREWEAVE: "CRWV",
  "CREDO TECHNOLOGY HOLDI": "CRDO",
  "TEMPUS AI": "TEM",
  "ZOOM VIDEO COMMUNICATIONS IN": "ZM",
  // ── China / HK ADRs ──────────────────────────────────────
  "ALIBABA HLDG": "BABA",
  PDD: "PDD",
  "NU HOLDINGS": "NU",
  "GAOTU TECHEDU": "GOTU",
  JOYY: "YY",
  // ── Finance ──────────────────────────────────────────────
  "CHARTER COMMUNICATIONS": "CHTR",
  "CHARTER COMMUNICATIONS N": "CHTR",
  "CAPITAL ONE FINL": "COF",
  "ALLY FINL": "ALLY",
  ALLY: "ALLY",
  "EAST WEST BANCORP": "EWBC",
  "WELLS FARGO NEW": "WFC",
  "JEFFERIES FINL": "JEF",
  // ── Healthcare ───────────────────────────────────────────
  UNITEDHEALTH: "UNH",
  MODERNA: "MRNA",
  // ── Consumer / Retail ────────────────────────────────────
  "DISNEY WALT": "DIS",
  "DOMINOS PIZZA": "DPZ",
  CROCS: "CROX",
  "MASTERCARD INCORPORATED": "MA",
  VISA: "V",
  "NEW YORK TIMES": "NYT",
  // ── Industrials / Materials ──────────────────────────────
  "D R HORTON": "DHI",
  LENNAR: "LEN",
  NVR: "NVR",
  ALLEGION: "ALLE",
  "HEICO NEW": "HEI",
  NUCOR: "NUE",
  "LOUISIANA PAC": "LPX",
  "LAMAR ADVERTISING NEW": "LAMR",
  POOL: "POOL",
  // ── Energy ───────────────────────────────────────────────
  "EXXON MOBIL": "XOM",
  "SABLE OFFSHORE": "SOC",
  // ── International ────────────────────────────────────────
  "TAIWAN SEMICONDUCTOR MFG": "TSM",
  "TOYOTA MOTOR": "TM",
  "ASML HOLDING N V": "ASML",
  DIAGEO: "DEO",
  AON: "AON",
  // ── Telecom ──────────────────────────────────────────────
  "TMOBILE US": "TMUS",
  // ── Other ────────────────────────────────────────────────
  "BERKSHIRE HATHAWAY DEL": "BRK.B",
  "CONSTELLATION BRANDS": "STZ",
  "LIBERTY MEDIA DEL": "FWONK",
  "LIBERTY LATIN AMERICA": "LILAK",
};

function issuerKey(name: string) {
  return normalizeEnglishName(name).toUpperCase().replace(/[^A-Z0-9 ]/g, "");
}

export function resolveTickerFromName(canonicalName: string): string | null {
  const key = issuerKey(canonicalName);
  return TICKER_BY_ISSUER_KEY[key] ?? null;
}

export function resolveZhFromName(canonicalName: string): string | null {
  const ticker = resolveTickerFromName(canonicalName);
  const key = issuerKey(canonicalName);
  return (ticker ? ZH_BY_TICKER[ticker] : undefined) ?? ZH_BY_ISSUER_KEY[key] ?? null;
}

export function resolveCompanyNames(input: {
  ticker?: string | null;
  canonicalName: string;
  existingNameZh?: string | null;
}) {
  const ticker = input.ticker?.toUpperCase() ?? null;
  const enShort = normalizeEnglishName(input.canonicalName);
  // Mapping always wins over stale stored data so re-imports fix bad names.
  const zh =
    (ticker ? ZH_BY_TICKER[ticker] : undefined) ??
    ZH_BY_ISSUER_KEY[issuerKey(input.canonicalName)] ??
    input.existingNameZh ??
    enShort;

  return {
    nameZh: zh,
    nameEnShort: enShort,
  };
}
