"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import styles from "./verify.module.css";

// 年份列表
const YEARS = Array.from({ length: 23 }, (_, i) => 1977 + i);

interface Section {
  order: number;
  content_en: string;
  type: string;
}

interface VerifyData {
  year: number;
  html: string;
  sections: Section[];
}

// 规范化空白：移除所有连续空白用于比较
function normalizeForMatch(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

// 在 HTML 中查找内容并返回匹配位置
function findMatchPosition(html: string, content: string): { start: number; end: number; matched: string } | null {
  const cleanContent = normalizeForMatch(content);
  const htmlLower = html.toLowerCase();
  const contentLower = cleanContent.toLowerCase();
  
  // 尝试多种长度
  for (const length of [300, 200, 150, 100, 80, 60]) {
    if (cleanContent.length < 20) break;
    
    const searchText = cleanContent.slice(0, length);
    const searchLower = searchText.toLowerCase();
    const idx = htmlLower.indexOf(searchLower);
    
    if (idx !== -1) {
      // 找到匹配，返回 HTML 中的原始文本
      const matched = html.slice(idx, idx + searchText.length);
      return { start: idx, end: idx + matched.length, matched };
    }
  }
  
  // 回退：使用更短的片段
  const shortText = cleanContent.slice(0, 40).toLowerCase();
  const shortIdx = htmlLower.indexOf(shortText);
  if (shortIdx !== -1) {
    const matched = html.slice(shortIdx, shortIdx + shortText.length);
    return { start: shortIdx, end: shortIdx + matched.length, matched };
  }
  
  return null;
}

// 在 HTML 中高亮文本
function highlightInHtml(html: string, searchText: string): string {
  if (!searchText) return html;
  
  const result = findMatchPosition(html, searchText);
  if (!result) return html;
  
  const before = html.slice(0, result.start);
  const matched = html.slice(result.start, result.end);
  const after = html.slice(result.end);
  
  return before + 
    `<mark style="background: #ffeb3b; color: #000; padding: 2px 4px; border-radius: 3px;">${matched}</mark>` + 
    after;
}

export default function VerifyPage() {
  const [year, setYear] = useState<number>(1977);
  const [data, setData] = useState<VerifyData | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeSection, setActiveSection] = useState<number | null>(null);
  const [viewMode, setViewMode] = useState<"split" | "html" | "parsed">("split");
  const [filter, setFilter] = useState<string>("all");
  const [highlightedHtml, setHighlightedHtml] = useState<string>("");
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // 加载数据
  useEffect(() => {
    setLoading(true);
    fetch(`/api/verify/${year}`)
      .then((res) => res.json())
      .then((data) => {
        setData(data);
        setHighlightedHtml(data.html);
      })
      .finally(() => setLoading(false));
  }, [year]);

  // 当 HTML 变化时，更新 iframe 内容
  useEffect(() => {
    if (highlightedHtml && iframeRef.current) {
      const iframe = iframeRef.current;
      const doc = iframe.contentDocument;
      if (doc) {
        doc.open();
        doc.write(highlightedHtml);
        doc.close();
        
        // 添加基础样式
        const style = doc.createElement('style');
        style.textContent = `
          body { 
            font-family: Georgia, serif; 
            line-height: 1.6; 
            padding: 20px;
            max-width: 800px;
            margin: 0 auto;
            color: #333;
          }
          table { border-collapse: collapse; margin: 20px 0; }
          td { padding: 8px; border: 1px solid #ddd; }
          pre { background: #f5f5f5; padding: 10px; overflow-x: auto; }
        `;
        doc.head.appendChild(style);
        
        // 滚动到高亮位置
        setTimeout(() => {
          const mark = doc.querySelector('mark');
          if (mark) {
            mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        }, 100);
      }
    }
  }, [highlightedHtml]);

  // 处理段落点击 - 高亮对应 HTML 内容
  const handleSectionClick = useCallback((section: Section) => {
    if (activeSection === section.order) {
      // 取消高亮
      setActiveSection(null);
      if (data) {
        setHighlightedHtml(data.html);
      }
      return;
    }
    
    setActiveSection(section.order);
    
    if (data) {
      const highlighted = highlightInHtml(data.html, section.content_en);
      // 检查是否真的找到了匹配
      if (!highlighted.includes('<mark')) {
        console.log(`未找到匹配: #${section.order}`);
      }
      setHighlightedHtml(highlighted);
    }
  }, [activeSection, data]);

  // 过滤 sections
  const filteredSections = data?.sections.filter((s) => {
    if (filter === "all") return true;
    return s.type === filter;
  }) || [];

  // 统计
  const stats = data?.sections
    ? {
        total: data.sections.length,
        text: data.sections.filter((s) => s.type === "text").length,
        title: data.sections.filter((s) => s.type === "title").length,
        table: data.sections.filter((s) => s.type === "table").length,
      }
    : { total: 0, text: 0, title: 0, table: 0 };

  return (
    <div className={styles.container}>
      {/* 顶部导航 */}
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <Link href="/" className={styles.backLink}>
            ← 返回
          </Link>
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className={styles.yearSelect}
          >
            {YEARS.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
          <span className={styles.yearLabel}>年</span>
        </div>
        <div className={styles.headerRight}>
          {data && (
            <span className={styles.stats}>
              {stats.total} 段落 | {stats.text} 文本 | {stats.title} 标题 | {stats.table} 表格
            </span>
          )}
          <div className={styles.viewToggle}>
            <button
              className={viewMode === "split" ? styles.active : ""}
              onClick={() => setViewMode("split")}
            >
              分屏
            </button>
            <button
              className={viewMode === "html" ? styles.active : ""}
              onClick={() => setViewMode("html")}
            >
              源文件
            </button>
            <button
              className={viewMode === "parsed" ? styles.active : ""}
              onClick={() => setViewMode("parsed")}
            >
              解析结果
            </button>
          </div>
        </div>
      </header>

      {/* 过滤栏 */}
      {data && viewMode === "parsed" && (
        <div className={styles.filterBar}>
          <span>筛选:</span>
          <button
            className={filter === "all" ? styles.filterActive : ""}
            onClick={() => setFilter("all")}
          >
            全部 ({stats.total})
          </button>
          <button
            className={filter === "text" ? styles.filterActive : ""}
            onClick={() => setFilter("text")}
          >
            文本 ({stats.text})
          </button>
          <button
            className={filter === "title" ? styles.filterActive : ""}
            onClick={() => setFilter("title")}
          >
            标题 ({stats.title})
          </button>
          <button
            className={filter === "table" ? styles.filterActive : ""}
            onClick={() => setFilter("table")}
          >
            表格 ({stats.table})
          </button>
        </div>
      )}

      {loading ? (
        <div className={styles.loading}>加载中...</div>
      ) : data ? (
        <div className={`${styles.content} ${viewMode === "split" ? styles.split : ""}`}>
          {/* 左侧：源文件 (渲染后) */}
          {(viewMode === "split" || viewMode === "html") && (
            <div className={styles.sourcePanel}>
              <div className={styles.panelHeader}>
                <h2>源文件渲染</h2>
                {activeSection && (
                  <span className={styles.highlightHint}>已高亮对应内容</span>
                )}
                <span className={styles.charCount}>
                  {data.html.length.toLocaleString()} 字符
                </span>
              </div>
              <div className={styles.iframeContainer}>
                <iframe
                  ref={iframeRef}
                  className={styles.iframe}
                  title="HTML Preview"
                  sandbox="allow-same-origin"
                />
              </div>
            </div>
          )}

          {/* 右侧：解析结果 */}
          {(viewMode === "split" || viewMode === "parsed") && (
            <div className={styles.parsedPanel}>
              <div className={styles.panelHeader}>
                <h2>解析结果</h2>
                <span className={styles.sectionCount}>
                  {filteredSections.length} 段落
                </span>
              </div>
              <div className={styles.sectionsList}>
                {filteredSections.map((section) => (
                  <div
                    key={section.order}
                    className={`${styles.sectionItem} ${
                      section.type === "title"
                        ? styles.title
                        : section.type === "table"
                        ? styles.table
                        : ""
                    } ${activeSection === section.order ? styles.active : ""}`}
                    onClick={() => handleSectionClick(section)}
                  >
                    <div className={styles.sectionHeader}>
                      <span className={styles.sectionOrder}>#{section.order}</span>
                      <span
                        className={`${styles.sectionType} ${
                          section.type === "title"
                            ? styles.typeTitle
                            : section.type === "table"
                            ? styles.typeTable
                            : styles.typeText
                        }`}
                      >
                        {section.type}
                      </span>
                    </div>
                    <div className={styles.sectionContent}>
                      {section.content_en}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className={styles.error}>加载数据失败</div>
      )}
    </div>
  );
}