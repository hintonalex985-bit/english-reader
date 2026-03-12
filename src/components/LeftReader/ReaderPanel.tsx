import React, { useState, useRef, useEffect } from 'react';
import { Upload, FileText, File, Loader } from 'lucide-react';
import { PdfViewer } from './PdfViewer';
import { parseText } from '../../utils/textEngine';
import { cachePdfFile, loadCachedPdf, clearCachedPdf } from '../../utils/fileCache';
import './ReaderPanel.css';
import type { ActiveItemInfo } from '../../types';

interface ReaderPanelProps {
  activeItem: ActiveItemInfo | null;
  onItemClick: (item: ActiveItemInfo) => void;
}

export const ReaderPanel: React.FC<ReaderPanelProps> = ({
  activeItem,
  onItemClick
}) => {
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [textContent, setTextContent] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isLoadingCache, setIsLoadingCache] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [inputText, setInputText] = useState('');

  // On mount: try to load cached PDF
  useEffect(() => {
    loadCachedPdf().then(file => {
      if (file) {
        setPdfFile(file);
      }
    }).finally(() => {
      setIsLoadingCache(false);
    });
  }, []);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.type === 'application/pdf') {
      setPdfFile(file);
      setTextContent(null);
      // Cache the PDF for next refresh
      cachePdfFile(file);
    } else if (file.type === 'text/plain') {
      setIsProcessing(true);
      try {
        const text = await file.text();
        setTextContent(text);
        setPdfFile(null);
        clearCachedPdf();
      } catch {
        alert('读取文件失败，请重试。');
      } finally {
        setIsProcessing(false);
      }
    } else {
      alert('不支持的文件格式，请上传 .pdf 或 .txt 文件');
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleTextSubmit = () => {
    if (inputText.trim()) {
      setTextContent(inputText);
      setPdfFile(null);
      clearCachedPdf();
    }
  };

  const clearContent = () => {
    setPdfFile(null);
    setTextContent(null);
    setInputText('');
    clearCachedPdf();
  };

  // Show loading while checking cache
  if (isLoadingCache) {
    return (
      <div className="reader-panel glass-panel input-mode">
        <Loader className="spinner" size={32} />
        <p>加载中...</p>
      </div>
    );
  }

  // === PDF View Mode ===
  if (pdfFile) {
    return (
      <div className="reader-panel glass-panel">
        <div className="reader-header">
          <h2>📚 课文阅读</h2>
          <button className="btn-secondary" onClick={clearContent}>更换课文</button>
        </div>
        <PdfViewer file={pdfFile} activeItem={activeItem} onItemClick={onItemClick} />
      </div>
    );
  }

  // === Text View Mode ===
  if (textContent) {
    const parsed = parseText(textContent);
    return (
      <div className="reader-panel glass-panel">
        <div className="reader-header">
          <h2>📚 课文阅读</h2>
          <button className="btn-secondary" onClick={clearContent}>更换课文</button>
        </div>
        <div className="reader-content">
          {parsed.sentences.map((sentence) => (
            <span key={sentence.id} className="sentence-block">
              <span
                className="sentence-click-layer"
                onClick={() => onItemClick({ type: 'sentence', text: sentence.rawText, id: sentence.id })}
              >[整句发音]</span>
              {sentence.tokens.map(token => {
                if (token.type === 'whitespace') {
                  return <span key={token.id} className="whitespace">{token.content}</span>;
                }
                if (token.type === 'punctuation') {
                  return <span key={token.id} className="punctuation">{token.content}</span>;
                }
                return (
                  <span
                    key={token.id}
                    className={`word-block ${activeItem?.id === token.id ? 'active-word' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onItemClick({ type: 'word', text: token.content, id: token.id });
                    }}
                  >{token.content}</span>
                );
              })}
            </span>
          ))}
        </div>
      </div>
    );
  }

  // === Upload Mode ===
  return (
    <div className="reader-panel glass-panel input-mode">
      <h2>✨ 导入英语课文</h2>
      <p className="subtitle">上传 PDF 课文直接展示，点击文字即可发音！也可以粘贴纯文本</p>

      <div className="upload-options">
        <div className="file-upload-box" onClick={() => fileInputRef.current?.click()}>
          {isProcessing ? (
            <div className="loading-state">
              <Loader className="spinner" size={32} />
              <p>课文解析中...</p>
            </div>
          ) : (
            <>
              <div className="icons">
                <Upload size={28} />
                <FileText size={28} />
                <File size={28} />
              </div>
              <p>点击选择文件或拖拽到这里</p>
              <span className="formats">支持 .pdf, .txt</span>
            </>
          )}
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileUpload}
            accept=".txt,.pdf,application/pdf,text/plain"
            style={{ display: 'none' }}
          />
        </div>

        <div className="divider"><span>或者</span></div>

        <textarea
          placeholder="在这里粘贴英语小短文..."
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          rows={5}
        />
        <button
          className="btn-primary"
          onClick={handleTextSubmit}
          disabled={!inputText.trim()}
        >
          导入文本
        </button>
      </div>
    </div>
  );
};
