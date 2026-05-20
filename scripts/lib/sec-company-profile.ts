const EDGAR = "https://data.sec.gov";

const HEADERS = {
  "User-Agent": "buffett-tribe research walkklaw@gmail.com",
  Accept: "application/json, text/xml, */*",
};

type SubmissionRecent = {
  form: string[];
  filingDate: string[];
  reportDate: string[];
  accessionNumber: string[];
  primaryDocument: string[];
};

type SubmissionPayload = {
  name?: string;
  tickers?: string[];
  exchanges?: string[];
  sic?: string;
  sicDescription?: string;
  category?: string;
  fiscalYearEnd?: string;
  stateOfIncorporation?: string;
  stateOfIncorporationDescription?: string;
  filings?: {
    recent: SubmissionRecent;
  };
};

export type SecCompanyProfile = {
  name: string | null;
  tickers: string[];
  exchanges: string[];
  sic: string | null;
  sicDescription: string | null;
  category: string | null;
  fiscalYearEnd: string | null;
  stateOfIncorporation: string | null;
  stateOfIncorporationDescription: string | null;
};

export type SecRecentFiling = {
  accession: string;
  filedAt: string;
  reportDate: string;
  primaryDocument: string;
  form: string;
};

const ANNUAL_FORMS = new Set(["10-K", "10-K/A", "20-F", "20-F/A"]);

function normalizeList(values: string[] | undefined) {
  if (!values) return [] as string[];
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function firstNonEmpty(value: string | undefined) {
  const next = value?.trim();
  return next ? next : null;
}

export function mapSectorFromSic(sic: string | null, sicDescription: string | null) {
  const description = (sicDescription ?? "").toLowerCase();
  const code = sic ? Number.parseInt(sic, 10) : Number.NaN;

  const keywordMatches: Array<[RegExp, string]> = [
    [/\b(oil|gas|petroleum|pipeline|drilling|exploration|energy)\b/i, "Energy"],
    [/\b(bank|bancorp|credit|financial|insurance|capital|asset|broker|mortgage|reit|trust)\b/i, "Financials"],
    [/\b(software|computer|internet|semiconductor|telecom|communications|electronic|data processing)\b/i, "Technology"],
    [/\b(pharma|pharmaceutical|biotech|medical|health|hospital|diagnostic|therapeutic)\b/i, "Health Care"],
    [/\b(restaurant|food|beverage|apparel|footwear|retail|consumer|household|cosmetic|automotive retail)\b/i, "Consumer"],
    [/\b(media|broadcast|entertainment|publishing|streaming|advertising)\b/i, "Communication Services"],
    [/\b(railroad|air freight|air transport|airline|aerospace|defense|machinery|industrial|manufactur|logistics|transport)\b/i, "Industrials"],
    [/\b(electric|utility|water supply|natural gas distribution)\b/i, "Utilities"],
    [/\b(mining|chemical|steel|metal|forest|paper|lumber|glass|cement)\b/i, "Materials"],
  ];

  for (const [pattern, sector] of keywordMatches) {
    if (pattern.test(description)) return sector;
  }

  if (Number.isFinite(code)) {
    if (code >= 1000 && code <= 1299) return "Materials";
    if (code >= 1300 && code <= 1399) return "Energy";
    if (code >= 4900 && code <= 4999) return "Utilities";
    if (code >= 6000 && code <= 6799) return "Financials";
    if (code >= 7370 && code <= 7379) return "Technology";
    if (code >= 8000 && code <= 8099) return "Health Care";
  }

  return null;
}

export async function fetchSecSubmissions(cik: string) {
  const padded = cik.padStart(10, "0");
  const res = await fetch(`${EDGAR}/submissions/CIK${padded}.json`, { headers: HEADERS });
  if (!res.ok) throw new Error(`Submissions fetch failed for CIK ${cik}`);
  return res.json() as Promise<SubmissionPayload>;
}

export function pickCompanyProfile(data: SubmissionPayload): SecCompanyProfile {
  return {
    name: firstNonEmpty(data.name),
    tickers: normalizeList(data.tickers),
    exchanges: normalizeList(data.exchanges),
    sic: firstNonEmpty(data.sic),
    sicDescription: firstNonEmpty(data.sicDescription),
    category: firstNonEmpty(data.category),
    fiscalYearEnd: firstNonEmpty(data.fiscalYearEnd),
    stateOfIncorporation: firstNonEmpty(data.stateOfIncorporation),
    stateOfIncorporationDescription: firstNonEmpty(data.stateOfIncorporationDescription),
  };
}

export function pickRecentAnnualFilings(data: SubmissionPayload): SecRecentFiling[] {
  const recent = data.filings?.recent;
  if (!recent) return [];

  const filings: SecRecentFiling[] = [];
  for (let i = 0; i < recent.form.length; i++) {
    const form = recent.form[i];
    if (!ANNUAL_FORMS.has(form)) continue;
    filings.push({
      accession: recent.accessionNumber[i],
      filedAt: recent.filingDate[i],
      reportDate: recent.reportDate[i],
      primaryDocument: recent.primaryDocument[i],
      form,
    });
  }
  return filings;
}
