import type { Sentence, Token, ParseResult } from '../types';

/**
 * Generates a simple text-based unique ID.
 */
function uuid() {
  return Math.random().toString(36).substring(2, 9);
}

/**
 * Splits raw text into an array of sentences.
 * Matches common English sentence endings (. ? !) followed by space or newline.
 */
function splitIntoSentences(text: string): string[] {
  // Regex to split by sentence boundaries while keeping the delimiter attached to the sentence
  // E.g., "Hello world. How are you?" -> ["Hello world.", " How are you?"]
  // Note: a more robust NLP parser could be used, but this works well for simple English texts.
  const regex = /([^.!?]+[.!?]+(?:[\s\n]*|$))/g;
  const matches = text.match(regex);
  
  if (!matches) {
    // Fallback if no punctuation exists
    return [text];
  }
  
  return matches;
}

/**
 * Tokenizes a single sentence string into words, whitespaces, and punctuation.
 */
function tokenizeSentence(sentenceStr: string): Token[] {
  const tokens: Token[] = [];
  
  // Regex matches: words with optional apostrophes, OR whitespaces/newlines, OR any punctuation
  const tokenRegex = /([a-zA-Z0-9'-]+)|(\s+)|([^a-zA-Z0-9\s'-]+)/g;
  let match;
  
  while ((match = tokenRegex.exec(sentenceStr)) !== null) {
    let type: 'word' | 'whitespace' | 'punctuation';
    let content = match[0];
    
    if (match[1]) {
      type = 'word';
    } else if (match[2]) {
      type = 'whitespace';
    } else {
      type = 'punctuation';
    }
    
    tokens.push({
      id: `tok-${uuid()}`,
      type,
      content,
    });
  }
  
  return tokens;
}

/**
 * Main parser entry point. Takes raw text and returns structured Sentences and Tokens.
 */
export function parseText(rawText: string): ParseResult {
  const cleanText = rawText.trim();
  if (!cleanText) {
    return { sentences: [], rawText: '' };
  }
  
  const sentenceStrings = splitIntoSentences(cleanText);
  
  const sentences: Sentence[] = sentenceStrings.map(str => {
    return {
      id: `sen-${uuid()}`,
      rawText: str,
      tokens: tokenizeSentence(str)
    };
  });
  
  return {
    sentences,
    rawText: cleanText
  };
}
