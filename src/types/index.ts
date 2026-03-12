// Type definitions for the English Reader

export type TokenType = 'word' | 'punctuation' | 'whitespace';

export interface Token {
  id: string;
  type: TokenType;
  content: string;
}

export interface Sentence {
  id: string;
  tokens: Token[];
  rawText: string;
}

export interface ParseResult {
  sentences: Sentence[];
  rawText: string;
}

export interface ActiveItemInfo {
  type: 'word' | 'sentence';
  text: string;
  id: string;
}

export type InputMode = 'upload' | 'text' | 'pdf-view';
