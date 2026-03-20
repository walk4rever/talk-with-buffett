"use client";

import { useRef, useState, useCallback } from "react";

interface Section {
  id: string;
  order: number;
  contentEn: string;
  contentZh: string | null;
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

  /** Find the paragraph whose vertical center is closest to the EN column center. */
  function findCenterPara(): number {
    const enCol = enColRef.current;
    if (!enCol) return 0;

    const colRect = enCol.getBoundingClientRect();
    const colMid = colRect.height / 2;
    let bestIdx = 0;
    let bestDist = Infinity;

    enParaRefs.current.forEach((el, i) => {
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

  // EN column scroll → sync ZH
  const handleEnScroll = useCallback(() => {
    if (lockRef.current) return;
    if (rafRef.current !== null) return; // already scheduled

    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;

      const enCol = enColRef.current;
      const zhCol = zhColRef.current;
      if (!enCol || !zhCol) return;

      const best = findCenterPara();

      setActivePara((prev) => {
        const enPara = enParaRefs.current[best];
        const zhPara = zhParaRefs.current[best];
        if (enPara && zhPara) {
          lockRef.current = true;
          alignCol(zhCol, zhPara, enCol, enPara);
          requestAnimationFrame(() => { lockRef.current = false; });
        }
        return best;
      });
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
              {s.contentEn}
            </div>
          ))}
        </div>
      </div>

      <div className="reader-divider" />

      {/* ZH column */}
      <div
        className="reader-col reader-col--zh"
        ref={zhColRef}
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
              {s.contentZh || (
                <span className="reader-para-empty">（暂无译文）</span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
