"use client";

import React, { useState, useEffect } from "react";
import { useSession } from "next-auth/react";

interface SectionCardProps {
  id: string;
  order: number;
  contentEn: string;
  contentZh?: string;
  isPaid?: boolean;
}

interface Highlight {
  id: string;
  text: string;
  color: string;
}

const SectionCard: React.FC<SectionCardProps> = ({ id, contentEn, contentZh, isPaid: isPaidProp }) => {
  const { data: session } = useSession();
  const isPaid = !!session || isPaidProp;

  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [showPopup, setShowPopup] = useState(false);
  const [popupPos, setPopupPos] = useState({ x: 0, y: 0 });
  const [selectedText, setSelectedText] = useState("");

  useEffect(() => {
    // Load highlights from localStorage as fallback
    const storedHighlights = localStorage.getItem(`highlights-${id}`);
    if (storedHighlights) {
      setHighlights(JSON.parse(storedHighlights));
    }
    
    // Then try to load from server if logged in
    if (session) {
      fetch(`/api/highlights?sectionId=${id}`)
        .then(res => res.json())
        .then(data => {
          setHighlights(data);
          // Store in localStorage as well
          localStorage.setItem(`highlights-${id}`, JSON.stringify(data));
        })
        .catch(err => {
          console.error("Error fetching highlights:", err);
          // Use stored highlights if server fails
        });
    }
  }, [id, session]);

  const handleMouseUp = () => {
    if (!isPaid) return;
    
    const selection = window.getSelection();
    const text = selection?.toString().trim();
    
    if (text && text.length > 0) {
      const range = selection?.getRangeAt(0);
      const rect = range?.getBoundingClientRect();
      
      if (rect) {
        setPopupPos({ 
          x: rect.left + window.scrollX + rect.width / 2, 
          y: rect.top + window.scrollY - 40 
        });
        setSelectedText(text);
        setShowPopup(true);
      }
    } else {
      setShowPopup(false);
    }
  };

  const saveHighlight = async (color: string) => {
    try {
      const res = await fetch("/api/highlights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sectionId: id, text: selectedText, color }),
      });
      
      if (res.ok) {
        const newHighlight = await res.json();
        const updatedHighlights = [...highlights, newHighlight];
        setHighlights(updatedHighlights);
        // Persist to localStorage
        localStorage.setItem(`highlights-${id}`, JSON.stringify(updatedHighlights));
        setShowPopup(false);
        window.getSelection()?.removeAllRanges();
      }
    } catch (err) {
      console.error("Error saving highlight:", err);
      // Still update locally even if API fails
      const tempHighlight = {
        id: `temp-${Date.now()}`,
        text: selectedText,
        color
      };
      const updatedHighlights = [...highlights, tempHighlight];
      setHighlights(updatedHighlights);
      localStorage.setItem(`highlights-${id}`, JSON.stringify(updatedHighlights));
      setShowPopup(false);
      window.getSelection()?.removeAllRanges();
    }
  };

  // Simple highlighting implementation by wrapping text in spans
  // In a more robust implementation, we would use a library like 'react-highlight-words'
  const renderHighlightedContent = (text: string) => {
    if (highlights.length === 0) return text;
    
    // Sort highlights by position to avoid overlapping issues
    const sortedHighlights = [...highlights].sort((a, b) => 
      text.indexOf(a.text) - text.indexOf(b.text)
    );
    
    let lastIndex = 0;
    const elements: (React.ReactElement | string)[] = [];
    
    sortedHighlights.forEach(highlight => {
      const startIndex = text.indexOf(highlight.text, lastIndex);
      if (startIndex >= 0) {
        // Add text before highlight
        if (startIndex > lastIndex) {
          elements.push(<span key={`before-${lastIndex}`}>{text.substring(lastIndex, startIndex)}</span>);
        }
        
        // Add highlighted text
        elements.push(
          <mark 
            key={`highlight-${startIndex}`} 
            className="custom-highlight" 
            style={{ backgroundColor: highlight.color }}
          >
            {highlight.text}
          </mark>
        );
        
        lastIndex = startIndex + highlight.text.length;
      }
    });
    
    // Add remaining text after last highlight
    if (lastIndex < text.length) {
      elements.push(<span key={`after-${lastIndex}`}>{text.substring(lastIndex)}</span>);
    }
    
    return elements.length > 0 ? elements : text;
  };

  return (
    <div className="section-card-container">
      <div 
        className="section-card" 
        onMouseUp={handleMouseUp}
        style={{ cursor: isPaid ? "text" : "default" }}
      >
        <div className="content-en">{renderHighlightedContent(contentEn)}</div>
        {contentZh && (
          <div className="content-zh">{contentZh}</div>
        )}
        
      </div>

      {showPopup && (
        <div 
          className="highlight-popup"
          style={{ 
            position: "absolute", 
            left: popupPos.x, 
            top: popupPos.y,
            transform: "translateX(-50%)"
          }}
        >
          <button onClick={() => saveHighlight("#ffeb3b")} className="h-btn yellow"></button>
          <button onClick={() => saveHighlight("#b3e5fc")} className="h-btn blue"></button>
          <button onClick={() => saveHighlight("#c8e6c9")} className="h-btn green"></button>
        </div>
      )}
    </div>
  );
};

export default SectionCard;
