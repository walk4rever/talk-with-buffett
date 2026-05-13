import Link from "next/link";
import { notFound } from "next/navigation";
import prisma from "@/lib/prisma";
import { SiteNav } from "@/components/SiteNav";
import { getTribeMember } from "@/lib/tribe";
import { LetterReadingArea } from "@/components/LetterReadingArea";
import { ArticleReadingArea, type ArticleSource } from "@/components/ArticleReadingArea";

// Cache pages for 5 minutes — letter content changes rarely.
// Use revalidate instead of force-dynamic to avoid hammering the DB on every request.
export const revalidate = 300;


// ── Category config ───────────────────────────────────────────────────────────

const CATEGORIES = [
  { key: "letter",  label: "信件" },
  { key: "article", label: "文章" },
  { key: "book",    label: "书籍" },
  { key: "video",   label: "视频" },
] as const;
type Category = typeof CATEGORIES[number]["key"];
const VALID_CATEGORIES = CATEGORIES.map((c) => c.key) as string[];

// Map source.type → category
const TYPE_TO_CATEGORY: Record<string, Category> = {
  shareholder:    "letter",
  partnership:    "letter",
  annual_meeting: "video",
  article:        "article",
  interview:      "article",
  post:           "article",
  speech:         "article",
};

// Small badge label per type (for letter items)
const TYPE_BADGE: Record<string, string> = {
  shareholder:    "致股东信",
  partnership:    "合伙人信",
  annual_meeting: "股东大会",
  article:        "文章",
  interview:      "采访",
  post:           "言论",
  speech:         "演讲",
};

// ── Page props ────────────────────────────────────────────────────────────────

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    category?: string;
    type?: string;
    year?: string;
    id?: string;
  }>;
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function LibraryPage({ params, searchParams }: Props) {
  const { id } = await params;
  const sp = await searchParams;

  const member = getTribeMember(id);
  if (!member) notFound();

  if (id !== "buffett") {
    return (
      <div className="person-page">
        <SiteNav />
        <div className="person-wrap">
          <section className="person-section">
            <p className="person-empty">该人物的资料库内容建设中。</p>
          </section>
        </div>
      </div>
    );
  }

  // ── Query 1: nav metadata only (no contentMd) ─────────────────────────────
  // Lightweight query for building the sidebar — never fetches full letter text.

  const navRows = await prisma.source.findMany({
    select: {
      id: true,
      type: true,
      year: true,
      date: true,
      title: true,
    },
    orderBy: [{ year: "desc" }, { date: "asc" }],
  });

  // ── Classify nav rows ──────────────────────────────────────────────────────

  // letter map: key = "type:year" → list of row ids
  const letterKeySet = new Set<string>();
  const letterKeyToIds = new Map<string, string[]>();
  const articleNavItems: { id: string; title: string; date?: string | null; year: number; type: string }[] = [];
  const videoNavItems:   { id: string; title: string; date?: string | null; year: number; type: string }[] = [];

  for (const row of navRows) {
    const cat = TYPE_TO_CATEGORY[row.type] ?? "article";
    if (cat === "letter") {
      const key = `${row.type}:${row.year}`;
      letterKeySet.add(key);
      if (!letterKeyToIds.has(key)) letterKeyToIds.set(key, []);
      letterKeyToIds.get(key)!.push(row.id);
    } else if (cat === "article") {
      articleNavItems.push(row);
    } else if (cat === "video") {
      videoNavItems.push(row);
    }
  }

  const letterNavItems = Array.from(letterKeySet)
    .map((key) => {
      const [type, yearStr] = key.split(":");
      return { type, year: Number(yearStr) };
    })
    .sort((a, b) => b.year - a.year);

  // ── Resolve active category ────────────────────────────────────────────────

  const activeCategory: Category = (
    sp.category && VALID_CATEGORIES.includes(sp.category)
      ? sp.category
      : "letter"
  ) as Category;

  // ── Resolve active selection ───────────────────────────────────────────────

  let activeLetterType = "";
  let activeLetterYear = 0;
  let activeArticleNav: typeof articleNavItems[number] | null = null;
  let activeVideoNav:   typeof videoNavItems[number]   | null = null;

  if (activeCategory === "letter") {
    const firstLetter = letterNavItems[0];
    activeLetterType =
      sp.type && letterNavItems.some((i) => i.type === sp.type)
        ? sp.type
        : firstLetter?.type ?? "shareholder";
    const parsedYear = sp.year ? Number(sp.year) : NaN;
    activeLetterYear = letterNavItems.find(
      (i) => i.type === activeLetterType && i.year === parsedYear,
    )
      ? parsedYear
      : letterNavItems.find((i) => i.type === activeLetterType)?.year ?? 0;
  }

  if (activeCategory === "article") {
    activeArticleNav = sp.id
      ? (articleNavItems.find((a) => a.id === sp.id) ?? articleNavItems[0] ?? null)
      : (articleNavItems[0] ?? null);
  }

  if (activeCategory === "video") {
    activeVideoNav = sp.id
      ? (videoNavItems.find((v) => v.id === sp.id) ?? videoNavItems[0] ?? null)
      : (videoNavItems[0] ?? null);
  }

  // ── Query 2: fetch contentMd ONLY for the active item ─────────────────────
  // Targeted query — avoids loading the full text of every letter on each request.

  let letterContentMd = "";
  let activeArticle: ArticleSource | null = null;
  let activeVideo:   ArticleSource | null = null;

  if (activeCategory === "letter" && activeLetterYear > 0) {
    const activeIds = letterKeyToIds.get(`${activeLetterType}:${activeLetterYear}`) ?? [];
    const contentRows = await prisma.source.findMany({
      where: { id: { in: activeIds } },
      select: { contentMd: true },
      orderBy: { date: "asc" },
    });
    letterContentMd = activeLetterType === "partnership"
      ? contentRows.map((r) => r.contentMd ?? "").filter(Boolean).join("\n\n---\n\n")
      : contentRows.find((r) => !!r.contentMd)?.contentMd ?? "";
  }

  if (activeCategory === "article" && activeArticleNav) {
    const row = await prisma.source.findUnique({
      where: { id: activeArticleNav.id },
      select: { id: true, title: true, date: true, year: true, type: true, contentMd: true },
    });
    if (row?.contentMd) {
      activeArticle = { ...activeArticleNav, contentMd: row.contentMd };
    }
  }

  if (activeCategory === "video" && activeVideoNav) {
    const row = await prisma.source.findUnique({
      where: { id: activeVideoNav.id },
      select: { id: true, title: true, date: true, year: true, type: true, contentMd: true },
    });
    activeVideo = { ...activeVideoNav, contentMd: row?.contentMd ?? "" };
  }

  // Article + video sidebar items (nav only, no contentMd)
  const articleItems: ArticleSource[] = articleNavItems.map((r) => ({ ...r, contentMd: "" }));
  const videoItems:   ArticleSource[] = videoNavItems.map((r)   => ({ ...r, contentMd: "" }));

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="person-page library-page">
      <SiteNav />

      <div className="masterclass-layout">
        {/* ── Sidebar ── */}
        <aside className="masterclass-sidebar">
          <div className="masterclass-sidebar-head">{member.nameZh} · 资料库</div>

          {/* Category tabs */}
          <nav className="library-cats" aria-label="资料分类">
            {CATEGORIES.map((cat) => (
              <Link
                key={cat.key}
                href={`/master/${id}/library?category=${cat.key}`}
                className={`library-cat-tab${activeCategory === cat.key ? " library-cat-tab--active" : ""}`}
              >
                {cat.label}
              </Link>
            ))}
          </nav>

          {/* ── Letter nav ── */}
          {activeCategory === "letter" && (
            <div className="library-year-list">
              {letterNavItems.length === 0 && (
                <p className="library-empty-hint">暂无信件资料</p>
              )}
              {letterNavItems.map(({ type, year }) => {
                const active = type === activeLetterType && year === activeLetterYear;
                return (
                  <Link
                    key={`${type}:${year}`}
                    href={`/master/${id}/library?category=letter&type=${type}&year=${year}`}
                    className={`library-year-item${active ? " library-year-item--active" : ""}`}
                  >
                    <span className="library-year-num">{year}</span>
                    <span className="library-type-badge">{TYPE_BADGE[type] ?? type}</span>
                  </Link>
                );
              })}
            </div>
          )}

          {/* ── Article nav ── */}
          {activeCategory === "article" && (
            <div className="library-article-list">
              {articleItems.length === 0 && (
                <p className="library-empty-hint">暂无文章资料</p>
              )}
              {articleItems.map((item) => {
                const active = item.id === activeArticle?.id;
                return (
                  <Link
                    key={item.id}
                    href={`/master/${id}/library?category=article&id=${item.id}`}
                    className={`library-article-item${active ? " library-article-item--active" : ""}`}
                  >
                    <div className="library-article-title">{item.title}</div>
                    <div className="library-article-meta">
                      <span className="library-type-badge">{TYPE_BADGE[item.type] ?? item.type}</span>
                      <span className="library-article-date">{item.date?.slice(0, 10) ?? item.year}</span>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}

          {/* ── Book nav ── */}
          {activeCategory === "book" && (
            <p className="library-empty-hint">书籍资料建设中</p>
          )}

          {/* ── Video nav ── */}
          {activeCategory === "video" && (
            <div className="library-article-list">
              {videoItems.length === 0 && (
                <p className="library-empty-hint">暂无视频资料</p>
              )}
              {videoItems.map((item) => {
                const active = item.id === activeVideo?.id;
                return (
                  <Link
                    key={item.id}
                    href={`/master/${id}/library?category=video&id=${item.id}`}
                    className={`library-article-item${active ? " library-article-item--active" : ""}`}
                  >
                    <div className="library-article-title">{item.title}</div>
                    <div className="library-article-meta">
                      <span className="library-type-badge">视频</span>
                      <span className="library-article-date">{item.date?.slice(0, 10) ?? item.year}</span>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </aside>

        {/* ── Main reading area ── */}
        <main className="masterclass-main masterclass-main--reader">
          {activeCategory === "letter" && (
            letterContentMd ? (
              <LetterReadingArea
                year={activeLetterYear}
                contentMd={letterContentMd}
                sourceType={activeLetterType}
                backHref={`/master/${id}`}
              />
            ) : (
              <div className="library-placeholder">暂无内容</div>
            )
          )}

          {activeCategory === "article" && (
            activeArticle ? (
              <ArticleReadingArea
                source={activeArticle}
                backHref={`/master/${id}/library?category=article`}
              />
            ) : (
              <div className="library-placeholder">
                <div>
                  <p>文章资料建设中</p>
                  <p style={{ fontSize: "0.8rem", marginTop: "0.5rem", opacity: 0.6 }}>
                    段永平·雪球言论、采访稿等内容即将上线
                  </p>
                </div>
              </div>
            )
          )}

          {activeCategory === "book" && (
            <div className="library-placeholder">
              <div>
                <p>书籍资料建设中</p>
                <p style={{ fontSize: "0.8rem", marginTop: "0.5rem", opacity: 0.6 }}>
                  李录《文明、现代化、价值投资与中国》等即将上线
                </p>
              </div>
            </div>
          )}

          {activeCategory === "video" && (
            activeVideo ? (
              <ArticleReadingArea
                source={activeVideo}
                backHref={`/master/${id}/library?category=video`}
              />
            ) : (
              <div className="library-placeholder">
                <div>
                  <p>视频资料建设中</p>
                  <p style={{ fontSize: "0.8rem", marginTop: "0.5rem", opacity: 0.6 }}>
                    股东大会、演讲等视频及文字整理即将上线
                  </p>
                </div>
              </div>
            )
          )}
        </main>
      </div>
    </div>
  );
}
