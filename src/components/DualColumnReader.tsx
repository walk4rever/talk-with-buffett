"use client";

import { useRef, useState, useCallback } from "react";

interface Section {
  id: string;
  order: number;
  contentEn: string;
  contentZh: string | null;
  hasTable?: boolean;
  tableData?: string | null;
}

interface ParsedTableData {
  rows?: string[][];
}

interface DualColumnReaderProps {
  sections: Section[];
  fontSize: number;
  lineHeight: number;
}

export function DualColumnReader({ sections, fontSize, lineHeight }: DualColumnReaderProps) {
  const [activePara, setActivePara] = useState(0);

  const enColRef = useRef<HTMLDivElement>(null);
  const zhColRef = useRef<HTMLDivElement>(null);
  const enParaRefs = useRef<(HTMLDivElement | null)[]>([]);
  const zhParaRefs = useRef<(HTMLDivElement | null)[]>([]);

  // Prevent feedback loops when we programmatically scroll a column
  const lockRef = useRef(false);
  // rAF handle for scroll throttle
  const rafRef = useRef<number | null>(null);

  /**
   * Scroll `targetCol` so that `targetPara` sits at the same
   * vertical position (relative to its column top) as `refPara`
   * currently does inside `refCol`.
   */
  function alignCol(
    targetCol: HTMLDivElement,
    targetPara: HTMLDivElement,
    refCol: HTMLDivElement,
    refPara: HTMLDivElement,
  ) {
    const refRelTop =
      refPara.getBoundingClientRect().top - refCol.getBoundingClientRect().top;
    const targetCurrentRelTop =
      targetPara.getBoundingClientRect().top -
      targetCol.getBoundingClientRect().top;

    targetCol.scrollTop += targetCurrentRelTop - refRelTop;
  }

  /** Find the paragraph whose vertical center is closest to a column's center. */
  function findCenterPara(
    colRef: React.RefObject<HTMLDivElement | null>,
    paraRefs: React.RefObject<(HTMLDivElement | null)[]>,
  ): number {
    const col = colRef.current;
    if (!col) return 0;

    const colRect = col.getBoundingClientRect();
    const colMid = colRect.height / 2;
    let bestIdx = 0;
    let bestDist = Infinity;

    paraRefs.current.forEach((el, i) => {
      if (!el) return;
      const r = el.getBoundingClientRect();
      const paraMid = r.top - colRect.top + r.height / 2;
      const dist = Math.abs(paraMid - colMid);
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = i;
      }
    });

    return bestIdx;
  }

  function makeScrollHandler(
    srcColRef: React.RefObject<HTMLDivElement | null>,
    srcParaRefs: React.RefObject<(HTMLDivElement | null)[]>,
    tgtColRef: React.RefObject<HTMLDivElement | null>,
    tgtParaRefs: React.RefObject<(HTMLDivElement | null)[]>,
  ) {
    return function () {
      if (lockRef.current) return;
      if (rafRef.current !== null) return;

      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;

        const srcCol = srcColRef.current;
        const tgtCol = tgtColRef.current;
        if (!srcCol || !tgtCol) return;

        const best = findCenterPara(srcColRef, srcParaRefs);

        setActivePara(() => {
          const srcPara = srcParaRefs.current[best];
          const tgtPara = tgtParaRefs.current[best];
          if (srcPara && tgtPara) {
            lockRef.current = true;
            alignCol(tgtCol, tgtPara, srcCol, srcPara);
            requestAnimationFrame(() => { lockRef.current = false; });
          }
          return best;
        });
      });
    };
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const handleEnScroll = useCallback(
    makeScrollHandler(enColRef, enParaRefs, zhColRef, zhParaRefs), []
  );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const handleZhScroll = useCallback(
    makeScrollHandler(zhColRef, zhParaRefs, enColRef, enParaRefs), []
  );

  // Click EN para → highlight + sync ZH
  function handleEnClick(index: number) {
    const enCol = enColRef.current;
    const zhCol = zhColRef.current;
    const enPara = enParaRefs.current[index];
    const zhPara = zhParaRefs.current[index];
    if (!enCol || !zhCol || !enPara || !zhPara) return;

    setActivePara(index);
    lockRef.current = true;
    alignCol(zhCol, zhPara, enCol, enPara);
    requestAnimationFrame(() => { lockRef.current = false; });
  }

  // Click ZH para → highlight + sync EN
  function handleZhClick(index: number) {
    const enCol = enColRef.current;
    const zhCol = zhColRef.current;
    const enPara = enParaRefs.current[index];
    const zhPara = zhParaRefs.current[index];
    if (!enCol || !zhCol || !enPara || !zhPara) return;

    setActivePara(index);
    lockRef.current = true;
    alignCol(enCol, enPara, zhCol, zhPara);
    requestAnimationFrame(() => { lockRef.current = false; });
  }

  const colStyle: React.CSSProperties = { fontSize, lineHeight };

  return (
    <div className="dual-reader">
      {/* EN column */}
      <div
        className="reader-col reader-col--en"
        ref={enColRef}
        onScroll={handleEnScroll}
        style={colStyle}
      >
        <div className="reader-col-inner">
          {sections.map((s, i) => (
            <div
              key={s.id}
              ref={(el) => { enParaRefs.current[i] = el; }}
              data-index={i}
              className={`reader-para${activePara === i ? " reader-para--active" : ""}`}
              onClick={() => handleEnClick(i)}
            >
              <SectionContent section={s} language="en" />
            </div>
          ))}
        </div>
      </div>

      <div className="reader-divider" />

      {/* ZH column */}
      <div
        className="reader-col reader-col--zh"
        ref={zhColRef}
        onScroll={handleZhScroll}
        style={colStyle}
      >
        <div className="reader-col-inner">
          {sections.map((s, i) => (
            <div
              key={s.id}
              ref={(el) => { zhParaRefs.current[i] = el; }}
              data-index={i}
              className={`reader-para${activePara === i ? " reader-para--active" : ""}`}
              onClick={() => handleZhClick(i)}
            >
              <SectionContent section={s} language="zh" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function SectionContent({
  section,
  language,
}: {
  section: Section;
  language: "en" | "zh";
}) {
  const table = parseTableData(section.tableData);
  const text = language === "en" ? section.contentEn : section.contentZh;

  // Structured table from DB
  if (section.hasTable && table?.rows?.length) {
    if (language === "zh" && text && text !== section.contentEn) {
      return <div className="reader-table-text">{text}</div>;
    }
    return <TableBlock rows={table.rows} />;
  }

  if (language === "zh" && !text) {
    return <span className="reader-para-empty">（暂无译文）</span>;
  }

  // Fallback: detect dot-leader table in plain text
  const enText = section.contentEn;
  const dotTable = parseDotLeaderTable(enText);
  if (dotTable) {
    if (language === "zh" && text && text !== enText) {
      // ZH has a real translation — show it as text beside the EN table
      return <div className="reader-table-text">{text}</div>;
    }
    return <TableBlock rows={dotTable} />;
  }

  return <>{text}</>;
}

/**
 * Detect and parse dot-leader tables that the PDF parser missed.
 * Pattern: "Label . . . . . \n value1 \n value2 \n NextLabel . . . ."
 */
function parseDotLeaderTable(text: string): string[][] | null {
  const DOT = /(?:\.\s){3,}\.?|\.{5,}/;
  if (!DOT.test(text)) return null;

  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const dotCount = lines.filter((l) => DOT.test(l)).length;
  if (dotCount < 2) return null;

  const rows: string[][] = [];
  const headerCandidates: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (DOT.test(line)) {
      const label = line.replace(/\s*(?:\.\s){3,}\.?.*$|\s*\.{5,}.*$/, "").trim();
      const afterDots = line.replace(/^.*?(?:(?:\.\s){3,}\.?|\.{5,})\s*/, "").trim();

      const row: string[] = [label || line.replace(DOT, "").trim()];
      if (afterDots) row.push(...tokenizeValues(afterDots));

      i++;
      while (i < lines.length && !DOT.test(lines[i])) {
        const val = lines[i].trim();
        if (/^[\d$(),.%\-\s]+$/.test(val)) {
          row.push(...tokenizeValues(val));
          i++;
        } else {
          break;
        }
      }

      rows.push(row);
    } else {
      if (rows.length === 0) headerCandidates.push(line);
      i++;
    }
  }

  if (rows.length < 2) return null;

  // Prepend header row if candidates match column count
  const colCount = Math.max(...rows.map((r) => r.length));
  if (headerCandidates.length > 0) {
    const headerParts = headerCandidates.join(" ").split(/\s{2,}/).filter(Boolean);
    if (headerParts.length === colCount - 1) {
      rows.unshift(["", ...headerParts]);
    }
  }

  return rows;
}

/** Split value string, merging currency symbols with their numbers: "$ 9,020" → "$9,020" */
function tokenizeValues(s: string): string[] {
  const tokens = s.split(/\s+/).filter(Boolean);
  const merged: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i] === "$" && i + 1 < tokens.length) {
      merged.push("$" + tokens[i + 1]);
      i++;
    } else {
      merged.push(tokens[i]);
    }
  }
  return merged;
}

function parseTableData(raw: string | null | undefined): ParsedTableData | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ParsedTableData;
  } catch {
    return null;
  }
}

function TableBlock({ rows }: { rows: string[][] }) {
  const [header, ...body] = rows;
  return (
    <div className="reader-table-wrap">
      <table className="reader-table">
        {header && (
          <thead>
            <tr>
              {header.map((cell, i) => (
                <th key={i}>{cell}</th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {body.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) => (
                <td key={cellIndex}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
