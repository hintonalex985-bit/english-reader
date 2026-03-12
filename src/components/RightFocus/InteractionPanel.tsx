import React, { useEffect, useState, useRef, useCallback } from 'react';
import { Play, Pause, RotateCcw, Volume2, Turtle, Pencil } from 'lucide-react';
import type { ActiveItemInfo } from '../../types';
import './InteractionPanel.css';

interface InteractionPanelProps {
  activeItem: ActiveItemInfo | null;
}

/**
 * Speak a given text using Web Speech API.
 */
function speakText(
  synth: SpeechSynthesis,
  text: string,
  slow: boolean,
  onStart: () => void,
  onEnd: () => void
) {
  synth.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  const voices = synth.getVoices();
  const engVoice = voices.find(v => v.lang.startsWith('en-US') || v.lang.startsWith('en-GB'));
  if (engVoice) utterance.voice = engVoice;
  utterance.rate = slow ? 0.6 : 1.0;
  utterance.pitch = 1.1;
  utterance.onstart = onStart;
  utterance.onend = onEnd;
  utterance.onerror = () => onEnd();
  synth.speak(utterance);
}

export const InteractionPanel: React.FC<InteractionPanelProps> = ({ activeItem }) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isSlowMode, setIsSlowMode] = useState(false);
  const [editableText, setEditableText] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const synthRef = useRef(window.speechSynthesis);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Sync editableText when activeItem changes
  useEffect(() => {
    if (activeItem) {
      setEditableText(activeItem.text);
      setIsEditing(false);
      // Auto-play the new text
      speakText(
        synthRef.current,
        activeItem.text,
        isSlowMode,
        () => setIsPlaying(true),
        () => setIsPlaying(false)
      );
    } else {
      synthRef.current.cancel();
      setIsPlaying(false);
      setEditableText('');
    }
    return () => { synthRef.current.cancel(); };
  }, [activeItem]);

  const handlePlayCurrent = useCallback(() => {
    const textToPlay = editableText.trim();
    if (!textToPlay) return;
    speakText(
      synthRef.current,
      textToPlay,
      isSlowMode,
      () => setIsPlaying(true),
      () => setIsPlaying(false)
    );
  }, [editableText, isSlowMode]);

  const togglePlayback = () => {
    if (isPlaying) {
      synthRef.current.cancel();
      setIsPlaying(false);
    } else {
      handlePlayCurrent();
    }
  };

  // Double-click on a word in the rendered text to speak just that word
  const handleWordDoubleClick = useCallback(() => {
    const selection = window.getSelection();
    if (!selection || selection.toString().trim() === '') {
      // Try to detect word from click position using the browser's selection
      // The browser auto-selects a word on double-click
      return;
    }
    const word = selection.toString().trim();
    if (word && /[a-zA-Z]/.test(word)) {
      speakText(
        synthRef.current,
        word,
        isSlowMode,
        () => setIsPlaying(true),
        () => setIsPlaying(false)
      );
    }
  }, [isSlowMode]);

  const startEditing = () => {
    setIsEditing(true);
    setTimeout(() => textareaRef.current?.focus(), 50);
  };

  const finishEditing = () => {
    setIsEditing(false);
  };

  if (!activeItem) {
    return (
      <div className="interaction-panel glass-panel empty-state">
        <div className="illustration-placeholder">
          <Volume2 size={64} className="pulse-icon" />
        </div>
        <h3>点击左侧课文内容</h3>
        <p>我会大声朗读给你听哦！</p>
        <div className="hint-list">
          <span>📖 单击 → 朗读句子</span>
          <span>🔤 双击 → 朗读单词</span>
        </div>
      </div>
    );
  }

  return (
    <div className="interaction-panel glass-panel">

      {/* Visual Focus Area */}
      <div className={`focus-area ${isPlaying ? 'playing' : ''}`}>
        {isPlaying && <div className="sound-waves">
          <span className="wave w1"></span>
          <span className="wave w2"></span>
          <span className="wave w3"></span>
        </div>}

        <div className="text-display-container">
          <div className="type-badge">
            {activeItem.type === 'word' ? '单词 (Word)' : '句子 (Sentence)'}
          </div>

          {isEditing ? (
            <textarea
              ref={textareaRef}
              className="edit-textarea"
              value={editableText}
              onChange={(e) => setEditableText(e.target.value)}
              onBlur={finishEditing}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  finishEditing();
                  handlePlayCurrent();
                }
              }}
            />
          ) : (
            <div
              className={`focus-text ${activeItem.type === 'word' ? 'large' : 'medium'}`}
              onDoubleClick={handleWordDoubleClick}
            >
              {editableText || activeItem.text}
            </div>
          )}
        </div>
      </div>

      {/* Interaction hint */}
      <div className="interaction-hint">
        ✏️ 点击编辑按钮可修改文本 | 双击单词可单独发音
      </div>

      {/* Control Dashboard */}
      <div className="controls-dashboard">

        <button
          className={`control-btn main-play ${isPlaying ? 'active' : ''}`}
          onClick={togglePlayback}
        >
          {isPlaying ? <Pause size={32} /> : <Play size={32} />}
        </button>

        <div className="secondary-controls">
          <button
            className="control-btn toggle"
            onClick={handlePlayCurrent}
            title="重新播放"
          >
            <RotateCcw size={24} />
            <span>重播</span>
          </button>

          <button
            className={`control-btn toggle ${isSlowMode ? 'active-toggle' : ''}`}
            onClick={() => setIsSlowMode(!isSlowMode)}
            title="慢速跟读"
          >
            <Turtle size={24} />
            <span>慢速 {isSlowMode ? '开' : '关'}</span>
          </button>

          <button
            className={`control-btn toggle ${isEditing ? 'active-toggle' : ''}`}
            onClick={isEditing ? finishEditing : startEditing}
            title="编辑文本"
          >
            <Pencil size={24} />
            <span>编辑</span>
          </button>
        </div>

      </div>
    </div>
  );
};
