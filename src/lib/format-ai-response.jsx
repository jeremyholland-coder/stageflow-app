/**
 * Format AI Response - Clean and render AI-generated content
 * PHASE 19B: Enhanced with visual section cards and StageFlow styling
 * PLAN MY DAY REFACTOR: Added prompt leakage prevention and sanitization
 * Filters out tool calls and converts markdown to formatted JSX
 */

import React from 'react';
import { removePromptLeakage } from './sanitizeAIOutput';

/**
 * Remove tool calling syntax from AI responses
 * Filters out code blocks containing executeToolAndReturnAsAgent
 * PLAN MY DAY REFACTOR: Enhanced with prompt leakage prevention
 */
export const cleanToolCalls = (text) => {
  if (!text) return '';

  // Remove code blocks with tool calls (```js...executeToolAndReturnAsAgent...```)
  let cleaned = text.replace(/```(?:js|javascript)?\s*[\s\S]*?executeToolAndReturnAsAgent[\s\S]*?```/g, '');

  // Remove standalone tool call patterns
  cleaned = cleaned.replace(/executeToolAndReturnAsAgent\([^)]*\)/g, '');

  // PLAN MY DAY REFACTOR: Remove prompt leakage patterns
  cleaned = removePromptLeakage(cleaned);

  // Remove any remaining raw prompt instructions
  // These patterns catch common prompt leak formats
  cleaned = cleaned.replace(/\*\*SECTION\s*\d+:\s*/gi, '');
  cleaned = cleaned.replace(/TONE:\s*[^.]+\./gi, '');
  cleaned = cleaned.replace(/Never mention\s*[^.]+\./gi, '');
  cleaned = cleaned.replace(/\(20-30 min focus\)/gi, '');
  cleaned = cleaned.replace(/\(45-60 min focus\)/gi, '');
  cleaned = cleaned.replace(/\(10-20 min focus\)/gi, '');
  cleaned = cleaned.replace(/\(Conditional\)/gi, '');

  // Clean up extra whitespace left behind
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim();

  return cleaned;
};

/**
 * PHASE 19B: Detect section headers in Plan My Day responses
 * Returns section type for visual card styling
 */
const detectSectionType = (headerText) => {
  const lower = headerText.toLowerCase();
  if (lower.includes('closest to close') || lower.includes('section 1')) {
    return { type: 'closest', icon: '🎯', accent: 'from-emerald-500/20 to-emerald-600/10', border: 'border-emerald-500/30' };
  }
  if (lower.includes('momentum') || lower.includes('section 2')) {
    return { type: 'momentum', icon: '⚡', accent: 'from-blue-500/20 to-blue-600/10', border: 'border-blue-500/30' };
  }
  if (lower.includes('relationship') || lower.includes('touchpoint') || lower.includes('section 3')) {
    return { type: 'relationships', icon: '🤝', accent: 'from-purple-500/20 to-purple-600/10', border: 'border-purple-500/30' };
  }
  if (lower.includes('workflow') || lower.includes('insight') || lower.includes('section 4')) {
    return { type: 'insights', icon: '💡', accent: 'from-amber-500/20 to-amber-600/10', border: 'border-amber-500/30' };
  }
  return null;
};

/**
 * PHASE 19B: Parse content into sections for card-based rendering
 */
const parseSections = (lines) => {
  const sections = [];
  let currentSection = null;
  let generalContent = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check for section header (## or **SECTION)
    const headerMatch = line.match(/^(?:##\s*)?(?:\*\*)?(?:SECTION\s*\d+:?\s*)?(.+?)(?:\*\*)?$/i);
    const isBoldHeader = line.startsWith('**') && line.endsWith('**');
    const isH2Header = line.startsWith('## ');

    if ((isBoldHeader || isH2Header) && headerMatch) {
      const headerText = headerMatch[1].replace(/\*\*/g, '').trim();
      const sectionInfo = detectSectionType(headerText);

      if (sectionInfo) {
        // Save previous section
        if (currentSection) {
          sections.push(currentSection);
        } else if (generalContent.length > 0) {
          sections.push({ type: 'general', content: [...generalContent] });
          generalContent = [];
        }

        // Start new section
        currentSection = {
          ...sectionInfo,
          title: headerText.replace(/^\*\*|\*\*$/g, '').replace(/^##\s*/, ''),
          content: []
        };
        continue;
      }
    }

    // Add line to current section or general content
    if (currentSection) {
      currentSection.content.push(line);
    } else {
      generalContent.push(line);
    }
  }

  // Save final section
  if (currentSection) {
    sections.push(currentSection);
  }
  if (generalContent.length > 0) {
    sections.push({ type: 'general', content: generalContent });
  }

  return sections;
};

/**
 * PHASE 19B: Render a section card with StageFlow styling
 */
const renderSectionCard = (section, key) => {
  if (section.type === 'general') {
    // Render general content without card wrapper
    return (
      <div key={key} className="space-y-1.5">
        {section.content.map((line, idx) => renderLine(line, `${key}-${idx}`))}
      </div>
    );
  }

  return (
    <div
      key={key}
      className={`bg-gradient-to-br ${section.accent} border ${section.border} rounded-xl p-4 mb-4 backdrop-blur-sm`}
    >
      {/* Section Header */}
      <div className="flex items-center gap-2 mb-3 pb-2 border-b border-white/10">
        <span className="text-lg">{section.icon}</span>
        <h4 className="text-sm font-bold text-white tracking-wide">{section.title}</h4>
      </div>

      {/* Section Content */}
      <div className="space-y-1.5 text-white/90">
        {section.content.map((line, idx) => renderLine(line, `${key}-content-${idx}`))}
      </div>
    </div>
  );
};

/**
 * PHASE 20: Priority chip component
 */
const PriorityChip = ({ priority }) => {
  const colors = {
    high: 'bg-red-500/20 text-red-300 border-red-500/30',
    medium: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
    low: 'bg-green-500/20 text-green-300 border-green-500/30'
  };

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${colors[priority] || colors.medium}`}>
      {priority}
    </span>
  );
};

/**
 * PHASE 20: Deal badge component
 */
const DealBadge = ({ value, type }) => {
  const badges = {
    hot: { icon: '🔥', bg: 'bg-orange-500/20', border: 'border-orange-500/30' },
    money: { icon: '$', bg: 'bg-emerald-500/20', border: 'border-emerald-500/30' },
    urgent: { icon: '⚡', bg: 'bg-yellow-500/20', border: 'border-yellow-500/30' }
  };

  const badge = badges[type] || badges.money;

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium ${badge.bg} border ${badge.border}`}>
      <span>{badge.icon}</span>
      {value && <span>{value}</span>}
    </span>
  );
};

/**
 * PHASE 19B/20: Render a single line with proper formatting
 * PHASE 20: Enhanced with priority chips and deal badges
 */
const renderLine = (line, key) => {
  if (!line.trim()) {
    return <div key={key} className="h-2" />;
  }

  // PHASE 20: Detect priority indicators and add chips
  const priorityMatch = line.match(/\b(high|medium|low)\s*priority\b/i);
  const hasPriorityChip = priorityMatch !== null;
  const priority = priorityMatch?.[1]?.toLowerCase();

  // PHASE 20: Detect deal value indicators
  const valueMatch = line.match(/\$[\d,]+(?:\.\d{2})?(?:k|K|m|M)?/);
  const hasValueBadge = valueMatch !== null;
  const dealValue = valueMatch?.[0];

  // Numbered list (1. , 2. , etc.)
  const numberedMatch = line.match(/^(\d+)\.\s+(.+)$/);
  if (numberedMatch) {
    const [, num, content] = numberedMatch;
    return (
      <div key={key} className="flex gap-2 mb-1.5 pl-1 items-start">
        <span className="text-[#1ABC9C] font-semibold flex-shrink-0 w-5">{num}.</span>
        <span className="leading-relaxed flex-1">
          {formatInlineMarkdown(content)}
          {/* PHASE 20: Add badges inline */}
          {hasPriorityChip && <span className="ml-2"><PriorityChip priority={priority} /></span>}
          {hasValueBadge && <span className="ml-2"><DealBadge value={dealValue} type="money" /></span>}
        </span>
      </div>
    );
  }

  // Bullet list (- , * , •)
  const bulletMatch = line.match(/^[\-\*•]\s+(.+)$/);
  if (bulletMatch) {
    const [, content] = bulletMatch;
    // PHASE 20: Detect if this is a "hot" deal (🔥 indicator or "hot" word)
    const isHot = line.toLowerCase().includes('hot') || line.includes('🔥');
    const isUrgent = line.toLowerCase().includes('urgent') || line.includes('⚡');

    return (
      <div key={key} className="flex gap-2 mb-1.5 pl-1 items-start">
        <span className="text-[#1ABC9C] flex-shrink-0 mt-1.5">•</span>
        <span className="leading-relaxed flex-1">
          {formatInlineMarkdown(content)}
          {/* PHASE 20: Add contextual badges */}
          {hasPriorityChip && <span className="ml-2"><PriorityChip priority={priority} /></span>}
          {hasValueBadge && <span className="ml-2"><DealBadge value={dealValue} type={isHot ? 'hot' : isUrgent ? 'urgent' : 'money'} /></span>}
        </span>
      </div>
    );
  }

  // Sub-header detection (ends with colon or starts with emoji)
  const isSubHeader = line.match(/^[^\n]{3,40}:$/) || line.match(/^[🎯⚡🤝💡📊✅❌⚠️🔥]/);
  if (isSubHeader) {
    return (
      <div key={key} className="font-semibold text-white mt-3 mb-1.5">
        {formatInlineMarkdown(line)}
      </div>
    );
  }

  // Regular line with improved spacing
  return (
    <div key={key} className="mb-1.5 leading-relaxed">
      {formatInlineMarkdown(line)}
    </div>
  );
};

/**
 * Convert markdown to JSX elements
 * PHASE 19B: Enhanced with section cards for Plan My Day and better visual structure
 * Supports: **bold**, *italic*, `code`, numbered lists, bullet lists, section headers
 */
export const renderMarkdown = (text) => {
  if (!text) return null;

  // First clean tool calls
  text = cleanToolCalls(text);

  const lines = text.split('\n');

  // PHASE 19B: Detect if this looks like a Plan My Day response (has section headers)
  const hasSectionHeaders = lines.some(line => {
    const lower = line.toLowerCase();
    return (lower.includes('section 1') || lower.includes('closest to close') ||
            lower.includes('section 2') || lower.includes('momentum builder') ||
            lower.includes('section 3') || lower.includes('relationship')) &&
           (line.startsWith('**') || line.startsWith('##'));
  });

  // Use section-based rendering for structured responses
  if (hasSectionHeaders) {
    const sections = parseSections(lines);
    return (
      <div className="space-y-2">
        {sections.map((section, idx) => renderSectionCard(section, `section-${idx}`))}
      </div>
    );
  }

  // Standard rendering for general responses with improved styling
  const elements = [];
  let key = 0;

  for (let i = 0; i < lines.length; i++) {
    elements.push(renderLine(lines[i], key++));
  }

  return <div className="space-y-0.5">{elements}</div>;
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
