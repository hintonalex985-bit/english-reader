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

/**
 * Given a clicked text span, extract the sentence it belongs to.
 * 1. Groups ALL spans into visual lines by Y position.
 * 2. Merges consecutive lines into paragraphs when vertical gap is small.
 * 3. Within a paragraph, splits by large horizontal gaps (table columns).
 * 4. Finds sentence boundaries via sentence-ending punctuation.
 */
function extractSentenceFromContext(clickedSpan: HTMLElement): string {
  const parent = clickedSpan.parentElement;
  if (!parent) return clickedSpan.textContent || '';

  const allSpans = Array.from(parent.querySelectorAll('span'));
  if (allSpans.length === 0) return clickedSpan.textContent || '';

  // --- Step 1: group all spans into visual lines by Y position ---
  const LINE_TOLERANCE = 5;
  const lineMap = new Map<number, HTMLElement[]>(); // roundedY -> spans

  for (const span of allSpans) {
    const top = parseFloat(span.style.top) || 0;
    // Find existing line key within tolerance
    let matched = false;
    for (const [key] of lineMap) {
      if (Math.abs(top - key) < LINE_TOLERANCE) {
        lineMap.get(key)!.push(span);
        matched = true;
        break;
      }
    }
    if (!matched) {
      lineMap.set(top, [span]);
    }
  }

  // Sort each line's spans by X, and sort lines by Y
  const sortedLines = Array.from(lineMap.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([y, spans]) => ({
      y,
      spans: spans.sort((a, b) => (parseFloat(a.style.left) || 0) - (parseFloat(b.style.left) || 0))
    }));

  // --- Step 2: merge consecutive lines into paragraphs ---
  // Lines with small vertical gap (< 1.5× line height) belong to the same paragraph.
  const paragraphs: { y: number; spans: HTMLElement[] }[][] = [];
  let currentPara: { y: number; spans: HTMLElement[] }[] = [];

  for (let i = 0; i < sortedLines.length; i++) {
    const line = sortedLines[i];
    if (i === 0) {
      currentPara.push(line);
      continue;
    }
    const prevLine = sortedLines[i - 1];
    const lineGap = line.y - prevLine.y;
    const fontSize = parseFloat(prevLine.spans[0]?.style.fontSize || '12');
    const LINE_HEIGHT_THRESHOLD = fontSize * 1.8;

    if (lineGap > LINE_HEIGHT_THRESHOLD) {
      // Big gap → new paragraph
      paragraphs.push(currentPara);
      currentPara = [line];
    } else {
      currentPara.push(line);
    }
  }
  if (currentPara.length > 0) paragraphs.push(currentPara);

  // --- Step 3: find the paragraph containing the clicked span ---
  let targetPara = paragraphs.find(para =>
    para.some(line => line.spans.includes(clickedSpan))
  );
  if (!targetPara) return clickedSpan.textContent || '';

  // Flatten paragraph lines into a single span list, applying horizontal gap splitting
  // within each line to avoid merging table columns
  const flatSpans: HTMLElement[] = [];
  let clickedInFlat = false;

  for (const line of targetPara) {
    for (let i = 0; i < line.spans.length; i++) {
      const span = line.spans[i];

      // Check horizontal gap to split table-like columns
      if (i > 0) {
        const prevSpan = line.spans[i - 1];
        const prevLeft = parseFloat(prevSpan.style.left) || 0;
        const prevFontSize = parseFloat(prevSpan.style.fontSize) || 12;
        const prevEstWidth = (prevSpan.textContent || '').length * prevFontSize * 0.6;
        const prevEnd = prevLeft + prevEstWidth;
        const curLeft = parseFloat(span.style.left) || 0;
        const gap = curLeft - prevEnd;

        if (gap > prevFontSize * 3) {
          // Big horizontal gap: if clicked span is already found, stop.
          // If not found yet, reset and start fresh.
          if (clickedInFlat) break;
          flatSpans.length = 0; // clear
        }
      }

      flatSpans.push(span);
      if (span === clickedSpan) clickedInFlat = true;
    }

    // If we already found and passed the clicked span's column block, we can
    // continue to next lines (they may still be part of the same sentence)
  }

  // If somehow clicked span wasn't found, fallback
  if (!clickedInFlat) return clickedSpan.textContent || '';

  // --- Step 4: build text and find sentence boundaries ---
  let blockText = '';
  let clickedIdx = 0;
  let foundClicked = false;

  for (let i = 0; i < flatSpans.length; i++) {
    const span = flatSpans[i];
    const text = span.textContent || '';

    if (i > 0) {
      const prevText = flatSpans[i - 1].textContent || '';
      if (prevText.length > 0 && !/\s$/.test(prevText) && !/^\s/.test(text)) {
        blockText += ' ';
        if (!foundClicked) clickedIdx++;
      }
    }

    if (span === clickedSpan) foundClicked = true;
    if (!foundClicked) clickedIdx += text.length;
    blockText += text;
  }

  // Only split on true sentence-ending punctuation
  const SENTENCE_END = /[.!?。！？]/;
  const clickedText = clickedSpan.textContent || '';

  let sentenceStart = clickedIdx;
  while (sentenceStart > 0 && !SENTENCE_END.test(blockText[sentenceStart - 1])) {
    sentenceStart--;
  }

  let sentenceEnd = clickedIdx + clickedText.length;
  while (sentenceEnd < blockText.length && !SENTENCE_END.test(blockText[sentenceEnd])) {
    sentenceEnd++;
  }
  if (sentenceEnd < blockText.length) sentenceEnd++;

  return blockText.substring(sentenceStart, sentenceEnd).trim();
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

export const PdfViewer: React.FC<PdfViewerProps> = ({ file, onItemClick }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [totalPages, setTotalPages] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const renderedPages = useRef<Set<number>>(new Set());

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
      } catch (err) {
        console.error('PDF Load Error:', err);
        if (!cancelled) {
          setError('PDF 加载失败，请检查文件是否损坏。');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadPdf();
    return () => { cancelled = true; };
  }, [file]);

  // Render all pages
  useEffect(() => {
    if (!pdfDoc || !containerRef.current) return;

    const container = containerRef.current;

    async function renderPages() {
      for (let pageNum = 1; pageNum <= pdfDoc!.numPages; pageNum++) {
        if (renderedPages.current.has(pageNum)) continue;
        renderedPages.current.add(pageNum);

        try {
          const page = await pdfDoc!.getPage(pageNum);
          const scale = 1.5;
          const viewport = page.getViewport({ scale });

          // Create wrapper for this page
          const pageWrapper = document.createElement('div');
          pageWrapper.classList.add('pdf-page-wrapper');
          pageWrapper.style.width = `${viewport.width}px`;
          pageWrapper.style.height = `${viewport.height}px`;
          pageWrapper.style.position = 'relative';

          // Create canvas
          const canvas = document.createElement('canvas');
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          canvas.style.display = 'block';

          const ctx = canvas.getContext('2d')!;
          await page.render({ canvasContext: ctx, viewport, canvas }).promise;

          pageWrapper.appendChild(canvas);

          // Create text layer
          const textLayerDiv = document.createElement('div');
          textLayerDiv.classList.add('pdf-text-layer');
          textLayerDiv.style.width = `${viewport.width}px`;
          textLayerDiv.style.height = `${viewport.height}px`;

          const textContent = await page.getTextContent();

          // Render text items as absolutely positioned spans
          for (const item of textContent.items) {
            if (!('str' in item) || !(item as any).str) continue;
            const textItem = item as any;

            const tx = textItem.transform;
            // PDF coordinate system is bottom-up. transform = [scaleX, skewX, skewY, scaleY, translateX, translateY]
            const fontSize = Math.sqrt(tx[2] * tx[2] + tx[3] * tx[3]) * scale;
            const left = tx[4] * scale;
            const top = viewport.height - tx[5] * scale;

            const span = document.createElement('span');
            span.textContent = textItem.str;
            span.style.position = 'absolute';
            span.style.left = `${left}px`;
            span.style.top = `${top - fontSize}px`;
            span.style.fontSize = `${fontSize}px`;
            span.style.fontFamily = 'sans-serif';
            span.style.lineHeight = '1';
            span.style.whiteSpace = 'pre';
            span.dataset.text = textItem.str;

            textLayerDiv.appendChild(span);
          }

          pageWrapper.appendChild(textLayerDiv);
          container.appendChild(pageWrapper);
        } catch (err) {
          console.error(`Error rendering page ${pageNum}:`, err);
        }
      }
    }

    renderPages();
  }, [pdfDoc]);

  // Single-click: read the whole sentence
  const handleTextClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.tagName !== 'SPAN' || !target.dataset.text) return;

    const clickedText = target.dataset.text || '';
    if (!clickedText.trim()) return;

    // Extract the full sentence from context
    const sentence = extractSentenceFromContext(target);

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
      <div className="pdf-hint">
        💡 <strong>单击</strong>朗读整个句子 | <strong>双击</strong>朗读单个单词
      </div>
      <div 
        className="pdf-pages-container"
        ref={containerRef}
        onClick={handleTextClick}
        onDoubleClick={handleDoubleClick}
      />
      {totalPages > 0 && (
        <div className="pdf-page-count">共 {totalPages} 页</div>
      )}
    </div>
  );
};
