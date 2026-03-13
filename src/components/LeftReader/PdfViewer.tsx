import React, { useEffect, useRef, useState, useCallback } from 'react';
import { pdfjsLib } from '../../utils/pdfEngine';
import type { ActiveItemInfo } from '../../types';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import './PdfViewer.css';

interface PdfViewerProps {
  file: File;
  activeItem: ActiveItemInfo | null;
  onItemClick: (item: ActiveItemInfo) => void;
}

// Helper: detect and remove repeated text (PDF duplicate text layers)
function deduplicateRepeatedText(text: string): string {
  const words = text.split(/\s+/).filter(w => w.length > 0);
  const n = words.length;
  if (n < 2) return text;

  // Try all possible split points from 1/3 to 2/3 of the array
  const start = Math.max(1, Math.floor(n / 3));
  const end = Math.min(n - 1, Math.ceil((n * 2) / 3));
  for (let splitAt = start; splitAt <= end; splitAt++) {
    const firstPart = words.slice(0, splitAt).join(' ');
    const secondPart = words.slice(splitAt).join(' ');
    if (firstPart === secondPart) {
      return firstPart;
    }
  }
  return text;
}

/**
 * Extract the sentence on the CURRENT LINE only.
 * Splitting rules:
 *   1. Large horizontal gap between spans → break into segments
 *   2. Chinese characters in span text → break at that boundary
 *   3. Period (.) → sentence delimiter within a segment
 * After splitting, selects the segment closest to the clicked span.
 */
function extractSentenceFromLine(clickedSpan: HTMLElement): string {
  const parent = clickedSpan.parentElement;
  if (!parent) return clickedSpan.textContent || '';

  const allSpans = Array.from(parent.querySelectorAll('span'));
  if (allSpans.length === 0) return clickedSpan.textContent || '';

  // Filter to same visual line (Y tolerance 5px)
  const clickedTop = parseFloat(clickedSpan.style.top) || 0;
  const sameLineRaw = allSpans
    .filter(span => Math.abs((parseFloat(span.style.top) || 0) - clickedTop) < 5)
    .sort((a, b) => (parseFloat(a.style.left) || 0) - (parseFloat(b.style.left) || 0));

  // Deduplicate overlapping spans (PDF often has duplicate text layers)
  const seenKeys = new Set<string>();
  const sameLineSpans = sameLineRaw.filter(span => {
    const left = Math.round((parseFloat(span.style.left) || 0) / 10);
    const key = `${left}_${span.textContent || ''}`;
    if (seenKeys.has(key)) return false;
    seenKeys.add(key);
    return true;
  });

  // --- Step 1: split into segments by horizontal gap and Chinese text ---
  const CHINESE_RE = /[\u4e00-\u9fff\u3400-\u4dbf]/;
  const segments: HTMLElement[][] = [[]];

  for (let i = 0; i < sameLineSpans.length; i++) {
    const span = sameLineSpans[i];
    const text = span.textContent || '';

    // Check for Chinese characters → start new segment
    if (CHINESE_RE.test(text)) {
      if (segments[segments.length - 1].length > 0) {
        segments.push([]); // new segment after this Chinese span
      }
      // Skip Chinese spans entirely (don't include in any segment)
      segments.push([]);
      continue;
    }

    // Check horizontal gap from previous span
    if (i > 0 && segments[segments.length - 1].length > 0) {
      const prevSpan = sameLineSpans[i - 1];
      const prevLeft = parseFloat(prevSpan.style.left) || 0;
      const prevFontSize = parseFloat(prevSpan.style.fontSize) || 12;
      // Use actual width if set, otherwise estimate
      const prevWidth = parseFloat(prevSpan.style.width) || (prevSpan.textContent || '').length * prevFontSize * 0.55;
      const prevEnd = prevLeft + prevWidth;
      const curLeft = parseFloat(span.style.left) || 0;
      const gap = curLeft - prevEnd;

      if (gap > prevFontSize * 0.5) {
        // Big gap → new segment
        segments.push([]);
      }
    }

    segments[segments.length - 1].push(span);
  }

  // --- Step 2: find the segment containing the clicked span ---
  const targetSegment = segments.find(seg => seg.includes(clickedSpan));
  if (!targetSegment || targetSegment.length === 0) {
    return clickedSpan.textContent || '';
  }

  // --- Step 3: build text and apply period-based sentence splitting ---
  let segText = '';
  let clickedIdx = 0;
  let foundClicked = false;

  for (let i = 0; i < targetSegment.length; i++) {
    const span = targetSegment[i];
    const text = span.textContent || '';

    if (i > 0) {
      const prevText = targetSegment[i - 1].textContent || '';
      if (prevText.length > 0 && !/\s$/.test(prevText) && !/^\s/.test(text)) {
        segText += ' ';
        if (!foundClicked) clickedIdx++;
      }
    }

    if (span === clickedSpan) foundClicked = true;
    if (!foundClicked) clickedIdx += text.length;
    segText += text;
  }

  if (!foundClicked) return clickedSpan.textContent || '';

  // Split by period
  const clickedText = clickedSpan.textContent || '';
  let sentenceStart = clickedIdx;
  while (sentenceStart > 0 && segText[sentenceStart - 1] !== '.') {
    sentenceStart--;
  }

  let sentenceEnd = clickedIdx + clickedText.length;
  while (sentenceEnd < segText.length && segText[sentenceEnd] !== '.') {
    sentenceEnd++;
  }
  if (sentenceEnd < segText.length) sentenceEnd++;

  const result = segText.substring(sentenceStart, sentenceEnd).trim();
  return deduplicateRepeatedText(result);
}



/**
 * Extract the single word that was clicked from the span text.
 */
function extractWordAtClick(text: string, offsetX: number, totalWidth: number): string {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= 1) return text.trim();

  // Rough approximation: figure out which word was clicked based on position ratio
  const ratio = offsetX / totalWidth;
  const idx = Math.floor(ratio * words.length);
  return words[Math.min(idx, words.length - 1)];
}

interface TocItem {
  title: string;
  pageNum: number;
}

export const PdfViewer: React.FC<PdfViewerProps> = ({ file, onItemClick }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [totalPages, setTotalPages] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const renderedPages = useRef<Set<number>>(new Set());
  const [tocItems, setTocItems] = useState<TocItem[]>([]);
  const [showToc, setShowToc] = useState(false);

  // Load PDF document
  useEffect(() => {
    let cancelled = false;

    async function loadPdf() {
      setLoading(true);
      setError(null);
      renderedPages.current.clear();

      try {
        const arrayBuffer = await file.arrayBuffer();
        const doc = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
        if (!cancelled) {
          setPdfDoc(doc);
          setTotalPages(doc.numPages);
        }
      } catch (err: any) {
        console.error('PDF Load Error:', err);
        if (!cancelled) {
          const detail = err?.message || String(err);
          setError(`PDF 加载失败：${detail}`);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadPdf();
    return () => { cancelled = true; };
  }, [file]);

  // Load TOC / outline
  useEffect(() => {
    if (!pdfDoc) return;
    async function loadOutline() {
      try {
        const outline = await pdfDoc!.getOutline();
        if (outline && outline.length > 0) {
          // Resolve outline destinations to page numbers
          const items: TocItem[] = [];
          for (const entry of outline) {
            try {
              let pageNum = 1;
              if (entry.dest) {
                const dest = typeof entry.dest === 'string'
                  ? await pdfDoc!.getDestination(entry.dest)
                  : entry.dest;
                if (dest && dest[0]) {
                  const pageIndex = await pdfDoc!.getPageIndex(dest[0]);
                  pageNum = pageIndex + 1;
                }
              }
              items.push({ title: entry.title, pageNum });
            } catch {
              items.push({ title: entry.title, pageNum: 1 });
            }
          }
          setTocItems(items);
        } else {
          // No outline — generate a simple page list
          const pages: TocItem[] = [];
          for (let i = 1; i <= pdfDoc!.numPages; i++) {
            pages.push({ title: `第 ${i} 页`, pageNum: i });
          }
          setTocItems(pages);
        }
      } catch {
        // Fallback to page list
        const pages: TocItem[] = [];
        for (let i = 1; i <= pdfDoc!.numPages; i++) {
          pages.push({ title: `第 ${i} 页`, pageNum: i });
        }
        setTocItems(pages);
      }
    }
    loadOutline();
  }, [pdfDoc]);

  // Scroll to a specific page
  const scrollToPage = useCallback((pageNum: number) => {
    const container = containerRef.current;
    if (!container) return;
    const pageEl = container.querySelector(`[data-page="${pageNum}"]`);
    if (pageEl) {
      pageEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, []);

  // Create page placeholders and lazy-render with IntersectionObserver
  useEffect(() => {
    if (!pdfDoc || !containerRef.current) return;

    const container = containerRef.current;
    container.innerHTML = ''; // Clear previous
    renderedPages.current.clear();

    const scale = 1.5;

    // Render a single page into its placeholder
    async function renderPage(pageNum: number, wrapper: HTMLDivElement) {
      if (renderedPages.current.has(pageNum)) return;
      renderedPages.current.add(pageNum);

      try {
        const page = await pdfDoc!.getPage(pageNum);
        const viewport = page.getViewport({ scale });

        // Remove the loading label
        const label = wrapper.querySelector('.page-loading-label');
        if (label) label.remove();

        // Resize wrapper to actual page dimensions
        wrapper.style.width = `${viewport.width}px`;
        wrapper.style.height = `${viewport.height}px`;

        // Create canvas
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        canvas.style.display = 'block';

        const ctx = canvas.getContext('2d')!;
        await page.render({ canvasContext: ctx, viewport, canvas }).promise;

        wrapper.appendChild(canvas);

        // Create text layer
        const textLayerDiv = document.createElement('div');
        textLayerDiv.classList.add('pdf-text-layer');
        textLayerDiv.style.width = `${viewport.width}px`;
        textLayerDiv.style.height = `${viewport.height}px`;

        const textContent = await page.getTextContent();

        // Deduplicate text items at render time
        const renderedTextKeys = new Set<string>();

        for (const item of textContent.items) {
          if (!('str' in item) || !(item as any).str) continue;
          const textItem = item as any;

          const tx = textItem.transform;
          const fontSize = Math.sqrt(tx[2] * tx[2] + tx[3] * tx[3]) * scale;
          const left = tx[4] * scale - fontSize * 0.5;
          const itemHeight = (textItem.height || fontSize / scale) * scale;
          const top = viewport.height - tx[5] * scale - itemHeight + fontSize * 0.5;

          // Skip duplicate: same text at similar position (grid = fontSize)
          const grid = Math.max(fontSize, 15);
          const dedupKey = `${Math.round(left / grid)}_${Math.round(top / grid)}_${textItem.str}`;
          if (renderedTextKeys.has(dedupKey)) continue;
          renderedTextKeys.add(dedupKey);

          const span = document.createElement('span');
          span.textContent = textItem.str;
          span.style.position = 'absolute';
          span.style.left = `${left}px`;
          span.style.top = `${top}px`;
          span.style.fontSize = `${fontSize}px`;
          span.style.fontFamily = 'sans-serif';
          span.style.lineHeight = '1.2';
          span.style.whiteSpace = 'pre';
          if (textItem.width) {
            span.style.width = `${textItem.width * scale}px`;
            span.style.display = 'inline-block';
          }
          span.dataset.text = textItem.str;

          textLayerDiv.appendChild(span);
        }

        wrapper.appendChild(textLayerDiv);
      } catch (err) {
        console.error(`Error rendering page ${pageNum}:`, err);
      }
    }

    // Step 1: Create lightweight placeholder for each page
    const wrappers: HTMLDivElement[] = [];
    for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
      const wrapper = document.createElement('div');
      wrapper.classList.add('pdf-page-wrapper');
      wrapper.style.width = '600px'; // default width, will be resized
      wrapper.style.height = '800px';
      wrapper.style.position = 'relative';
      wrapper.setAttribute('data-page', String(pageNum));

      // Loading label
      const label = document.createElement('div');
      label.className = 'page-loading-label';
      label.textContent = `第 ${pageNum} 页 - 加载中...`;
      wrapper.appendChild(label);

      container.appendChild(wrapper);
      wrappers.push(wrapper);
    }

    // Step 2: Render first 2 pages immediately
    const immediateRender = Math.min(2, pdfDoc.numPages);
    for (let i = 0; i < immediateRender; i++) {
      renderPage(i + 1, wrappers[i]);
    }

    // Step 3: Use IntersectionObserver to lazy-render remaining pages
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const pageNum = Number((entry.target as HTMLElement).getAttribute('data-page'));
            if (pageNum && !renderedPages.current.has(pageNum)) {
              renderPage(pageNum, entry.target as HTMLDivElement);
            }
            observer.unobserve(entry.target);
          }
        }
      },
      { root: container, rootMargin: '200px' } // Pre-load 200px before visible
    );

    // Observe pages 3+
    for (let i = immediateRender; i < wrappers.length; i++) {
      observer.observe(wrappers[i]);
    }

    return () => observer.disconnect();
  }, [pdfDoc]);

  // Single-click: read the whole sentence
  const handleTextClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.tagName !== 'SPAN' || !target.dataset.text) return;

    const clickedText = target.dataset.text || '';
    if (!clickedText.trim()) return;

    // Extract the full sentence from context
    const sentence = extractSentenceFromLine(target);

    // Highlight the clicked span
    const container = containerRef.current;
    if (container) {
      container.querySelectorAll('.pdf-text-layer span.active-text').forEach(el => 
        el.classList.remove('active-text')
      );
      target.classList.add('active-text');
    }

    if (sentence.trim()) {
      onItemClick({
        type: 'sentence',
        text: sentence,
        id: `sen-${Date.now()}`
      });
    }
  }, [onItemClick]);

  // Double-click: read just the clicked word
  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.tagName !== 'SPAN' || !target.dataset.text) return;

    const clickedText = target.dataset.text || '';
    if (!clickedText.trim()) return;

    const rect = target.getBoundingClientRect();
    const offsetX = e.clientX - rect.left;
    const word = extractWordAtClick(clickedText, offsetX, rect.width);
    const cleanWord = word.replace(/[^a-zA-Z0-9']/g, '');

    if (cleanWord) {
      onItemClick({
        type: 'word',
        text: cleanWord,
        id: `word-${Date.now()}`
      });
    }
  }, [onItemClick]);

  // === Drag-select: box selection to pick text ===
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const [selectionBox, setSelectionBox] = useState<{
    left: number; top: number; width: number; height: number
  } | null>(null);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const container = containerRef.current;
    if (!container) return;

    // Clear previous highlights
    container.querySelectorAll('.pdf-text-layer span.active-text').forEach(el =>
      el.classList.remove('active-text')
    );

    const rect = container.getBoundingClientRect();
    dragStart.current = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top + container.scrollTop
    };
    setIsDragging(false);
    setSelectionBox(null);
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragStart.current) return;
    const container = containerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const curX = e.clientX - rect.left;
    const curY = e.clientY - rect.top + container.scrollTop;
    const dx = curX - dragStart.current.x;
    const dy = curY - dragStart.current.y;

    // Only activate drag if moved more than 5px (avoid triggering on simple clicks)
    if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
      e.preventDefault(); // Prevent browser text selection during drag
      setIsDragging(true);
      setSelectionBox({
        left: Math.min(dragStart.current.x, curX),
        top: Math.min(dragStart.current.y, curY),
        width: Math.abs(dx),
        height: Math.abs(dy)
      });
    }
  }, []);

  const handleMouseUp = useCallback(() => {
    if (isDragging && selectionBox && containerRef.current) {
      const container = containerRef.current;
      const containerRect = container.getBoundingClientRect();

      // Find all spans within the selection box
      const allSpans = container.querySelectorAll('.pdf-text-layer span');
      const selectedTexts: string[] = [];

      // Track positions to deduplicate overlapping spans
      const seen = new Set<string>();

      allSpans.forEach(span => {
        const spanRect = span.getBoundingClientRect();
        // Use span's CENTER point for more precise selection
        const spanCenterX = spanRect.left - containerRect.left + spanRect.width / 2;
        const spanCenterY = spanRect.top - containerRect.top + container.scrollTop + spanRect.height / 2;

        // Check if span's center is inside the selection box
        const boxRight = selectionBox.left + selectionBox.width;
        const boxBottom = selectionBox.top + selectionBox.height;

        if (
          spanCenterX > selectionBox.left &&
          spanCenterX < boxRight &&
          spanCenterY > selectionBox.top &&
          spanCenterY < boxBottom
        ) {
          const text = (span as HTMLElement).dataset.text || span.textContent || '';
          if (text.trim()) {
            // Deduplicate: skip if same text at roughly same position (5px tolerance)
            const key = `${Math.round(spanCenterX / 5)}_${Math.round(spanCenterY / 5)}_${text.trim()}`;
            if (!seen.has(key)) {
              seen.add(key);
              selectedTexts.push(text.trim());
            }
            (span as HTMLElement).classList.add('active-text');
          }
        }
      });

      if (selectedTexts.length > 0) {
        const combined = deduplicateRepeatedText(selectedTexts.join(' '));

        onItemClick({
          type: 'sentence',
          text: combined,
          id: `drag-${Date.now()}`
        });
      }
    }

    dragStart.current = null;
    setIsDragging(false);
    setSelectionBox(null);
  }, [isDragging, selectionBox, onItemClick]);

  if (loading) {
    return (
      <div className="pdf-loading">
        <div className="loading-spinner"></div>
        <p>正在加载课文...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="pdf-error">
        <p>😢 {error}</p>
      </div>
    );
  }

  return (
    <div className="pdf-viewer-container">
      <div className="pdf-toolbar">
        <div className="pdf-hint">
          💡 <strong>单击</strong>朗读句子 | <strong>双击</strong>朗读单词 | <strong>拖动框选</strong>朗读选中内容
        </div>
        <button
          className={`toc-toggle-btn ${showToc ? 'active' : ''}`}
          onClick={() => setShowToc(!showToc)}
        >
          📑 目录
        </button>
      </div>

      {/* TOC Panel */}
      {showToc && (
        <div className="toc-panel">
          <div className="toc-header">📑 目录导航</div>
          <ul className="toc-list">
            {tocItems.map((item, idx) => (
              <li
                key={idx}
                className="toc-item"
                onClick={() => {
                  scrollToPage(item.pageNum);
                  setShowToc(false);
                }}
              >
                <span className="toc-title">{item.title}</span>
                <span className="toc-page">p.{item.pageNum}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div 
        className="pdf-pages-container"
        ref={containerRef}
        onClick={handleTextClick}
        onDoubleClick={handleDoubleClick}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onTouchStart={(e) => {
          const touch = e.touches[0];
          const container = containerRef.current;
          if (!container) return;
          const rect = container.getBoundingClientRect();
          dragStart.current = {
            x: touch.clientX - rect.left,
            y: touch.clientY - rect.top + container.scrollTop
          };
          setIsDragging(false);
          setSelectionBox(null);
        }}
        onTouchMove={(e) => {
          if (!dragStart.current) return;
          const container = containerRef.current;
          if (!container) return;
          const touch = e.touches[0];
          const rect = container.getBoundingClientRect();
          const curX = touch.clientX - rect.left;
          const curY = touch.clientY - rect.top + container.scrollTop;
          const dx = curX - dragStart.current.x;
          const dy = curY - dragStart.current.y;

          if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
            e.preventDefault(); // Prevent scrolling while drag-selecting
            setIsDragging(true);
            setSelectionBox({
              left: Math.min(dragStart.current.x, curX),
              top: Math.min(dragStart.current.y, curY),
              width: Math.abs(dx),
              height: Math.abs(dy)
            });
          }
        }}
        onTouchEnd={() => {
          handleMouseUp(); // Reuse the same logic
        }}
        style={{ position: 'relative' }}
      >
        {/* Selection box overlay */}
        {isDragging && selectionBox && (
          <div
            className="drag-selection-box"
            style={{
              position: 'absolute',
              left: selectionBox.left,
              top: selectionBox.top,
              width: selectionBox.width,
              height: selectionBox.height,
              pointerEvents: 'none',
              zIndex: 999
            }}
          />
        )}
      </div>
      {totalPages > 0 && (
        <div className="pdf-page-count">共 {totalPages} 页</div>
      )}
    </div>
  );
};
