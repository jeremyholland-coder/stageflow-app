/**
 * Format AI Response - Clean and render AI-generated content
 * Filters out tool calls and converts markdown to formatted JSX
 */

import React from 'react';

/**
 * Remove tool calling syntax from AI responses
 * Filters out code blocks containing executeToolAndReturnAsAgent
 */
export const cleanToolCalls = (text) => {
  if (!text) return '';

  // Remove code blocks with tool calls (```js...executeToolAndReturnAsAgent...```)
  let cleaned = text.replace(/```(?:js|javascript)?\s*[\s\S]*?executeToolAndReturnAsAgent[\s\S]*?```/g, '');

  // Remove standalone tool call patterns
  cleaned = cleaned.replace(/executeToolAndReturnAsAgent\([^)]*\)/g, '');

  // Clean up extra whitespace left behind
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim();

  return cleaned;
};

/**
 * Convert markdown to JSX elements
 * Supports: **bold**, *italic*, `code`, numbered lists, bullet lists
 */
export const renderMarkdown = (text) => {
  if (!text) return null;

  // First clean tool calls
  text = cleanToolCalls(text);

  const lines = text.split('\n');
  const elements = [];
  let key = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Empty line - add spacing
    if (!line.trim()) {
      elements.push(<br key={key++} />);
      continue;
    }

    // Numbered list (1. , 2. , etc.)
    const numberedMatch = line.match(/^(\d+)\.\s+(.+)$/);
    if (numberedMatch) {
      const [, num, content] = numberedMatch;
      elements.push(
        <div key={key++} className="flex gap-2 mb-1">
          <span className="text-[#1ABC9C] font-semibold flex-shrink-0">{num}.</span>
          <span>{formatInlineMarkdown(content)}</span>
        </div>
      );
      continue;
    }

    // Bullet list (- , * , •)
    const bulletMatch = line.match(/^[\-\*•]\s+(.+)$/);
    if (bulletMatch) {
      const [, content] = bulletMatch;
      elements.push(
        <div key={key++} className="flex gap-2 mb-1">
          <span className="text-[#1ABC9C] flex-shrink-0">•</span>
          <span>{formatInlineMarkdown(content)}</span>
        </div>
      );
      continue;
    }

    // Regular line
    elements.push(
      <div key={key++} className="mb-1">
        {formatInlineMarkdown(line)}
      </div>
    );
  }

  return <div>{elements}</div>;
};

/**
 * Format inline markdown within a line
 * Supports **bold**, *italic*, `code`
 */
const formatInlineMarkdown = (text) => {
  const parts = [];
  let remaining = text;
  let key = 0;

  // Pattern to match **bold**, *italic*, or `code`
  const pattern = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;
  let lastIndex = 0;
  let match;

  while ((match = pattern.exec(text)) !== null) {
    // Add text before the match
    if (match.index > lastIndex) {
      parts.push(
        <span key={`text-${key++}`}>
          {text.substring(lastIndex, match.index)}
        </span>
      );
    }

    const matched = match[0];

    // **Bold**
    if (matched.startsWith('**') && matched.endsWith('**')) {
      parts.push(
        <strong key={`bold-${key++}`} className="font-bold text-white">
          {matched.slice(2, -2)}
        </strong>
      );
    }
    // *Italic*
    else if (matched.startsWith('*') && matched.endsWith('*')) {
      parts.push(
        <em key={`italic-${key++}`} className="italic">
          {matched.slice(1, -1)}
        </em>
      );
    }
    // `Code`
    else if (matched.startsWith('`') && matched.endsWith('`')) {
      parts.push(
        <code
          key={`code-${key++}`}
          className="px-1.5 py-0.5 bg-[#1ABC9C]/10 text-[#1ABC9C] rounded text-xs font-mono"
        >
          {matched.slice(1, -1)}
        </code>
      );
    }

    lastIndex = pattern.lastIndex;
  }

  // Add remaining text
  if (lastIndex < text.length) {
    parts.push(
      <span key={`text-${key++}`}>
        {text.substring(lastIndex)}
      </span>
    );
  }

  return parts.length > 0 ? parts : text;
};
