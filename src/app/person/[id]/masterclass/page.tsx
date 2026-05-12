import Link from "next/link";
import { notFound } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import prisma from "@/lib/prisma";
import { BtLogoMark } from "@/components/BtLogoMark";
import { getTribeMember } from "@/lib/tribe";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ type?: string; year?: string }>;
}

const TYPE_META: Record<string, { label: string }> = {
  shareholder: { label: "致股东信" },
  partnership: { label: "合伙人信" },
  annual_meeting: { label: "股东大会" },
};

const VALID_TYPES = Object.keys(TYPE_META);

function stripHeader(md: string): string {
  const lines = md.split("\n");
  let lastMetaLine = 0;
  for (let i = 0; i < Math.min(lines.length, 30); i++) {
    const t = lines[i].trim();
    if (
      t.startsWith("原文信息") ||
      t.startsWith("- 标题") ||
      t.startsWith("- 作者") ||
      t.startsWith("- 发表") ||
      t.startsWith("- 链接") ||
      t.startsWith("- 中文") ||
      t.startsWith("- 整理") ||
      t.startsWith("- 修订") ||
      t.startsWith("- 校译") ||
      t.startsWith("- 校对") ||
      t.startsWith("[^") ||
      (t === "---" && i < 20) ||
      t === ""
    ) {
      lastMetaLine = i;
    }
  }
  return lines.slice(lastMetaLine + 1).join("\n").trim();
}

export default async function PersonMasterclassPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { type: rawType, year: rawYear } = await searchParams;

  const member = getTribeMember(id);
  if (!member) notFound();

  if (id !== "buffett") {
    return (
      <div className="person-page">
        <nav className="home-nav">
          <div className="home-nav-in">
            <Link href="/" className="home-nav-logo"><BtLogoMark />Buffett Tribe</Link>
            <div className="home-nav-right"><Link href={`/person/${id}`} className="home-nav-link">返回人物页</Link></div>
          </div>
        </nav>
        <div className="person-wrap">
          <section className="person-section"><p className="person-empty">该人物的大师课堂内容建设中。</p></section>
        </div>
      </div>
    );
  }

  const rows = await prisma.source.findMany({
    where: { type: { in: VALID_TYPES } },
    select: { id: true, type: true, year: true, date: true, title: true, contentMd: true },
    orderBy: [{ year: "desc" }, { date: "asc" }],
  });

  if (!rows.length) notFound();

  const byType = new Map<string, Array<typeof rows[number]>>();
  for (const row of rows) {
    if (!byType.has(row.type)) byType.set(row.type, []);
    byType.get(row.type)!.push(row);
  }

  const defaultType = VALID_TYPES.find((t) => (byType.get(t)?.length ?? 0) > 0) ?? VALID_TYPES[0];
  const activeType = rawType && VALID_TYPES.includes(rawType) ? rawType : defaultType;
  const typeRows = byType.get(activeType) ?? [];

  const years = Array.from(new Set(typeRows.map((r) => r.year))).sort((a, b) => b - a);
  const selectedYear = rawYear ? Number(rawYear) : years[0];
  const activeYear = Number.isFinite(selectedYear) && years.includes(selectedYear) ? selectedYear : years[0];

  const yearRows = typeRows.filter((r) => r.year === activeYear);
  if (!yearRows.length) notFound();

  const contentMd = activeType === "partnership"
    ? yearRows.map((r) => r.contentMd ?? "").filter(Boolean).join("\n\n---\n\n")
    : (yearRows.find((r) => !!r.contentMd)?.contentMd ?? "");

  const body = stripHeader(contentMd);

  return (
    <div className="person-page">
      <nav className="home-nav">
        <div className="home-nav-in">
          <Link href="/" className="home-nav-logo"><BtLogoMark />Buffett Tribe</Link>
          <div className="home-nav-right">
            <Link href={`/person/${id}`} className="home-nav-link">返回人物页</Link>
            <Link href={`/text/room?person=${id}`} className="home-nav-login">对话</Link>
          </div>
        </div>
      </nav>

      <div className="masterclass-layout">
        <aside className="masterclass-sidebar">
          <div className="masterclass-sidebar-head">{member.nameZh} · 大师课堂</div>
          {VALID_TYPES.map((type) => {
            const list = byType.get(type) ?? [];
            if (!list.length) return null;
            const typeYears = Array.from(new Set(list.map((r) => r.year))).sort((a, b) => b - a);
            const isActiveType = type === activeType;
            return (
              <section key={type} className="masterclass-group">
                <h3 className={`masterclass-type${isActiveType ? " masterclass-type--active" : ""}`}>{TYPE_META[type].label}</h3>
                <ul className="masterclass-year-list">
                  {typeYears.map((year) => {
                    const active = isActiveType && year === activeYear;
                    return (
                      <li key={`${type}-${year}`}>
                        <Link
                          href={`/person/${id}/masterclass?type=${type}&year=${year}`}
                          className={`masterclass-year-link${active ? " masterclass-year-link--active" : ""}`}
                        >
                          {year}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </aside>

        <main className="masterclass-main">
          <header className="masterclass-main-head">
            <h1>{TYPE_META[activeType]?.label ?? activeType} · {activeYear}</h1>
          </header>
          <article className="md-reader masterclass-reader">
            <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
              {body}
            </ReactMarkdown>
          </article>
        </main>
      </div>
    </div>
  );
}
