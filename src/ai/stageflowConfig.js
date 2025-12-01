/**
 * StageFlow AI Configuration
 *
 * Centralized AI configuration for consistent styling and behavior
 * across all AI-powered features.
 *
 * @author StageFlow Engineering
 */

/**
 * StageFlow AI System Prompt Rules
 * These rules are enforced across all AI interactions
 */
export const STAGEFLOW_AI_RULES = {
  // Tone and style
  noEmojis: true,
  professionalTone: true,
  concise: true,

  // Output format
  useBullets: true,
  useHeadings: true,
  maxParagraphLength: 4, // sentences

  // Section structure for Plan My Day
  sections: [
    { id: 'summary', label: 'Summary', required: true },
    { id: 'priority_deals', label: 'Priority Deals', required: true },
    { id: 'risks', label: 'Risks', required: false },
    { id: 'suggestions', label: 'Suggestions', required: true }
  ]
};

/**
 * Sanitize AI text output
 * Removes emojis, excessive whitespace, and cleans formatting
 *
 * @param {string} text - Raw AI output text
 * @returns {string} Sanitized text
 */
export function sanitizeAIText(text) {
  if (!text || typeof text !== 'string') {
    return '';
  }

  // Remove emojis and emoji-like characters
  // This regex covers most Unicode emoji ranges
  const emojiRegex = /[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{1F000}-\u{1F02F}]|[\u{1F0A0}-\u{1F0FF}]|[\u{1F100}-\u{1F1FF}]|[\u{1F200}-\u{1F2FF}]|[\u{1F600}-\u{1F64F}]|[\u{1F680}-\u{1F6FF}]|[\u{1F900}-\u{1F9FF}]|[\u{1FA00}-\u{1FA6F}]|[\u{1FA70}-\u{1FAFF}]|[\u{2300}-\u{23FF}]|[\u{2B50}]|[\u{2B55}]|[\u{2934}-\u{2935}]|[\u{25AA}-\u{25AB}]|[\u{25B6}]|[\u{25C0}]|[\u{25FB}-\u{25FE}]|[\u{2600}-\u{2604}]|[\u{260E}]|[\u{2611}]|[\u{2614}-\u{2615}]|[\u{2618}]|[\u{261D}]|[\u{2620}]|[\u{2622}-\u{2623}]|[\u{2626}]|[\u{262A}]|[\u{262E}-\u{262F}]|[\u{2638}-\u{263A}]|[\u{2640}]|[\u{2642}]|[\u{2648}-\u{2653}]|[\u{265F}-\u{2660}]|[\u{2663}]|[\u{2665}-\u{2666}]|[\u{2668}]|[\u{267B}]|[\u{267E}-\u{267F}]|[\u{2692}-\u{2697}]|[\u{2699}]|[\u{269B}-\u{269C}]|[\u{26A0}-\u{26A1}]|[\u{26AA}-\u{26AB}]|[\u{26B0}-\u{26B1}]|[\u{26BD}-\u{26BE}]|[\u{26C4}-\u{26C5}]|[\u{26C8}]|[\u{26CE}]|[\u{26CF}]|[\u{26D1}]|[\u{26D3}-\u{26D4}]|[\u{26E9}-\u{26EA}]|[\u{26F0}-\u{26F5}]|[\u{26F7}-\u{26FA}]|[\u{26FD}]|[\u{2702}]|[\u{2705}]|[\u{2708}-\u{270D}]|[\u{270F}]/gu;

  let sanitized = text.replace(emojiRegex, '');

  // Remove common text emoticons
  const textEmoticonRegex = /[:;][-']?[)D(P|/\\oO3><]/g;
  sanitized = sanitized.replace(textEmoticonRegex, '');

  // Clean up excessive whitespace
  sanitized = sanitized.replace(/\n{3,}/g, '\n\n');
  sanitized = sanitized.replace(/[ \t]{2,}/g, ' ');

  // Trim leading/trailing whitespace from each line
  sanitized = sanitized.split('\n').map(line => line.trim()).join('\n');

  // Trim overall
  sanitized = sanitized.trim();

  return sanitized;
}

/**
 * Parse structured AI response for Mission Control
 * Extracts sections from AI narrative text
 *
 * @param {string} text - AI response text
 * @returns {Object} Parsed sections { summary, priorityDeals, risks, suggestions }
 */
export function parseAIResponseSections(text) {
  if (!text || typeof text !== 'string') {
    return { summary: '', priorityDeals: [], risks: [], suggestions: [] };
  }

  const sanitized = sanitizeAIText(text);

  // Split by common section headers
  const sections = {
    summary: '',
    priorityDeals: [],
    risks: [],
    suggestions: []
  };

  // Look for summary (first paragraph before any headers)
  const summaryMatch = sanitized.match(/^([\s\S]*?)(?=\n(?:#{1,3}|\*\*|Priority|Risk|Suggestion|Deal|Action))/i);
  if (summaryMatch) {
    sections.summary = summaryMatch[1].trim();
  } else {
    // Take first 3 sentences as summary
    const sentences = sanitized.split(/[.!?]+/).slice(0, 3);
    sections.summary = sentences.join('. ').trim() + '.';
  }

  // Extract priority deals (bullet points after "Priority" or "Deal" headers)
  const priorityMatch = sanitized.match(/(?:Priority|Deals?|Closest)[\s\S]*?(?:\n[-*]\s+([^\n]+))+/gi);
  if (priorityMatch) {
    priorityMatch.forEach(block => {
      const bullets = block.match(/[-*]\s+([^\n]+)/g);
      if (bullets) {
        bullets.forEach(bullet => {
          const cleanBullet = bullet.replace(/^[-*]\s+/, '').trim();
          if (cleanBullet && !sections.priorityDeals.includes(cleanBullet)) {
            sections.priorityDeals.push(cleanBullet);
          }
        });
      }
    });
  }

  // Extract risks
  const riskMatch = sanitized.match(/(?:Risk|At[\s-]?Risk|Warning|Concern)[\s\S]*?(?:\n[-*]\s+([^\n]+))+/gi);
  if (riskMatch) {
    riskMatch.forEach(block => {
      const bullets = block.match(/[-*]\s+([^\n]+)/g);
      if (bullets) {
        bullets.forEach(bullet => {
          const cleanBullet = bullet.replace(/^[-*]\s+/, '').trim();
          if (cleanBullet && !sections.risks.includes(cleanBullet)) {
            sections.risks.push(cleanBullet);
          }
        });
      }
    });
  }

  // Extract suggestions
  const suggestionMatch = sanitized.match(/(?:Suggestion|Recommend|Action|Next[\s-]?Step)[\s\S]*?(?:\n[-*]\s+([^\n]+))+/gi);
  if (suggestionMatch) {
    suggestionMatch.forEach(block => {
      const bullets = block.match(/[-*]\s+([^\n]+)/g);
      if (bullets) {
        bullets.forEach(bullet => {
          const cleanBullet = bullet.replace(/^[-*]\s+/, '').trim();
          if (cleanBullet && !sections.suggestions.includes(cleanBullet)) {
            sections.suggestions.push(cleanBullet);
          }
        });
      }
    });
  }

  return sections;
}

/**
 * Format currency value
 * @param {number} value - Numeric value
 * @returns {string} Formatted currency string
 */
export function formatCurrency(value) {
  if (value === null || value === undefined || isNaN(value)) {
    return '--';
  }

  if (value >= 1000000) {
    return `$${(value / 1000000).toFixed(1)}M`;
  }
  if (value >= 1000) {
    return `$${(value / 1000).toFixed(0)}K`;
  }
  return `$${value.toFixed(0)}`;
}

/**
 * Format percentage value
 * @param {number} value - Numeric percentage (0-100)
 * @returns {string} Formatted percentage string
 */
export function formatPercentage(value) {
  if (value === null || value === undefined || isNaN(value)) {
    return '--';
  }
  return `${Math.round(value)}%`;
}

export default {
  STAGEFLOW_AI_RULES,
  sanitizeAIText,
  parseAIResponseSections,
  formatCurrency,
  formatPercentage
};
