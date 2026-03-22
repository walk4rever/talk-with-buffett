"use client";

interface Section {
  id: string;
  order: number;
  contentEn: string;
  contentZh: string | null;
  hasTable?: boolean;
  tableData?: string | null;
}

interface SingleColumnReaderProps {
  sections: Section[];
  language: "en" | "zh";
  fontSize: number;
  lineHeight: number;
}

export function SingleColumnReader({ sections, language, fontSize, lineHeight }: SingleColumnReaderProps) {
  return (
    <div className="single-reader" style={{ fontSize, lineHeight }}>
      <div className="single-reader-inner">
        {sections.map((s) => {
          const text = language === "en" ? s.contentEn : s.contentZh;
          return (
            <div key={s.id} className="reader-para">
              {text ? text : <span className="reader-para-empty">（暂无译文）</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
