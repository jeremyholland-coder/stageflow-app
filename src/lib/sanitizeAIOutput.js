/**
 * sanitizeAIOutput.js
 *
 * Production-grade sanitization for AI-generated content.
 * Strips all markdown formatting, prompt leakage, and artifacts
 * to ensure clean, structured output for the UI.
 *
 * @author StageFlow Engineering
 * @since 2025-12-06
 */

/**
 * Core markdown patterns to strip from AI output
 */
const MARKDOWN_PATTERNS = {
  // Headers (# ## ### etc.)
  headers: /^#{1,6}\s+/gm,

  // Bold (**text** or __text__)
  bold: /\*\*([^*]+)\*\*|__([^_]+)__/g,

  // Italic (*text* or _text_)
  italic: /(?<!\*)\*([^*]+)\*(?!\*)|(?<!_)_([^_]+)_(?!_)/g,

  // Strikethrough (~~text~~)
  strikethrough: /~~([^~]+)~~/g,

  // Inline code (`text`)
  inlineCode: /`([^`]+)`/g,

  // Code blocks (```...```)
  codeBlocks: /```[\s\S]*?```/g,

  // Links [text](url)
  links: /\[([^\]]+)\]\([^)]+\)/g,

  // Images ![alt](url)
  images: /!\[([^\]]*)\]\([^)]+\)/g,

  // Blockquotes (> text)
  blockquotes: /^>\s*/gm,

  // Horizontal rules (---, ***, ___)
  horizontalRules: /^(?:[-*_]){3,}\s*$/gm,

  // Unordered list markers (- , * , + )
  unorderedLists: /^[\s]*[-*+]\s+/gm,

  // Ordered list markers (1. 2. etc.)
  orderedLists: /^[\s]*\d+\.\s+/gm,

  // Tables (|---|)
  tableDelimiters: /^\|?[\s-:|]+\|?\s*$/gm,
  tableCells: /\|/g,

  // HTML tags
  htmlTags: /<[^>]+>/g,

  // Escape characters
  escapeChars: /\\([*_`#\[\]()\\])/g
};

/**
 * Prompt leakage patterns to detect and remove
 * These are internal instructions that should never reach the user
 */
const PROMPT_LEAKAGE_PATTERNS = [
  // Section instruction patterns
  /\*\*SECTION\s*\d+:\s*/gi,
  /SECTION\s*\d+:\s*/gi,
  /End with:\s*["'].*?["']/gi,
  /Focus on[^.]*\./gi,

  // Instruction patterns
  /TONE:\s*[^.]+\./gi,
  /Never mention\s*[^.]+\./gi,
  /Based on\s*(?:my|the)\s*historical\s*[^.]+\./gi,
  /Look for deals\s*[^.]+\./gi,
  /Use gentle,\s*[^.]+\./gi,

  // AI self-reference patterns
  /Want me to\s*[^?]+\?/gi,
  /Would you like help\s*[^?]+\?/gi,
  /Want help\s*[^?]+\?/gi,

  // Internal markers
  /\(Conditional\)/gi,
  /\[\s*Conditional\s*\]/gi,
  /\(20-30 min focus\)/gi,
  /\(45-60 min focus\)/gi,
  /\(10-20 min focus\)/gi
];

/**
 * Known Plan My Day section headers for structured parsing
 */
const SECTION_PATTERNS = {
  closestToClose: [
    /closest to close/i,
    /section 1/i,
    /near decision/i,
    /priority deals/i,
    /ready to close/i
  ],
  momentumBuilders: [
    /momentum builder/i,
    /section 2/i,
    /needs movement/i,
    /activity potential/i,
    /new leads/i
  ],
  relationshipTouchpoints: [
    /relationship/i,
    /touchpoint/i,
    /section 3/i,
    /nurture/i,
    /check-in/i,
    /partnership/i
  ],
  workflowInsights: [
    /workflow/i,
    /insight/i,
    /section 4/i,
    /work style/i,
    /pattern/i,
    /personal/i
  ]
};

/**
 * Strip all markdown formatting from text
 *
 * @param {string} text - Raw text with markdown
 * @returns {string} Clean text without markdown
 */
export function stripMarkdown(text) {
  if (!text || typeof text !== 'string') return '';

  let result = text;

  // Remove code blocks first (they might contain other patterns)
  result = result.replace(MARKDOWN_PATTERNS.codeBlocks, '');

  // Remove images and links (preserve link text)
  result = result.replace(MARKDOWN_PATTERNS.images, '$1');
  result = result.replace(MARKDOWN_PATTERNS.links, '$1');

  // Remove formatting
  result = result.replace(MARKDOWN_PATTERNS.bold, '$1$2');
  result = result.replace(MARKDOWN_PATTERNS.strikethrough, '$1');
  result = result.replace(MARKDOWN_PATTERNS.inlineCode, '$1');

  // Handle italic carefully (avoid breaking contractions)
  result = result.replace(MARKDOWN_PATTERNS.italic, '$1$2');

  // Remove structural elements
  result = result.replace(MARKDOWN_PATTERNS.headers, '');
  result = result.replace(MARKDOWN_PATTERNS.blockquotes, '');
  result = result.replace(MARKDOWN_PATTERNS.horizontalRules, '');
  result = result.replace(MARKDOWN_PATTERNS.htmlTags, '');

  // Clean up list markers
  result = result.replace(MARKDOWN_PATTERNS.unorderedLists, '');
  result = result.replace(MARKDOWN_PATTERNS.orderedLists, '');

  // Remove table formatting
  result = result.replace(MARKDOWN_PATTERNS.tableDelimiters, '');
  result = result.replace(MARKDOWN_PATTERNS.tableCells, ' ');

  // Remove escape characters
  result = result.replace(MARKDOWN_PATTERNS.escapeChars, '$1');

  return result;
}

/**
 * Remove prompt leakage from AI output
 *
 * @param {string} text - Text that may contain prompt instructions
 * @returns {string} Clean text without prompt leakage
 */
export function removePromptLeakage(text) {
  if (!text || typeof text !== 'string') return '';

  let result = text;

  for (const pattern of PROMPT_LEAKAGE_PATTERNS) {
    result = result.replace(pattern, '');
  }

  return result;
}

/**
 * Normalize whitespace in text
 *
 * @param {string} text - Text with irregular whitespace
 * @returns {string} Text with normalized whitespace
 */
export function normalizeWhitespace(text) {
  if (!text || typeof text !== 'string') return '';

  let result = text;

  // Normalize line endings
  result = result.replace(/\r\n/g, '\n');
  result = result.replace(/\r/g, '\n');

  // Reduce multiple blank lines to max 2
  result = result.replace(/\n{3,}/g, '\n\n');

  // Reduce multiple spaces to single space
  result = result.replace(/[ \t]{2,}/g, ' ');

  // Trim each line
  result = result.split('\n').map(line => line.trim()).join('\n');

  // Trim overall
  result = result.trim();

  return result;
}

/**
 * Detect section type from header text
 *
 * @param {string} headerText - Section header text
 * @returns {string|null} Section type identifier
 */
export function detectSectionType(headerText) {
  if (!headerText || typeof headerText !== 'string') return null;

  const lower = headerText.toLowerCase();

  for (const [sectionType, patterns] of Object.entries(SECTION_PATTERNS)) {
    for (const pattern of patterns) {
      if (pattern.test(lower)) {
        return sectionType;
      }
    }
  }

  return null;
}

/**
 * Parse AI output into structured sections
 *
 * @param {string} text - Raw AI output
 * @returns {Object} Parsed sections { closestToClose, momentumBuilders, relationshipTouchpoints, workflowInsights, general }
 */
export function parseIntoSections(text) {
  if (!text || typeof text !== 'string') {
    return {
      closestToClose: [],
      momentumBuilders: [],
      relationshipTouchpoints: [],
      workflowInsights: [],
      general: []
    };
  }

  const sections = {
    closestToClose: [],
    momentumBuilders: [],
    relationshipTouchpoints: [],
    workflowInsights: [],
    general: []
  };

  // Split into lines for processing
  const lines = text.split('\n').filter(line => line.trim());

  let currentSection = 'general';
  let currentContent = [];

  for (const line of lines) {
    const trimmedLine = line.trim();

    // Check if this line is a section header
    const sectionType = detectSectionType(trimmedLine);

    if (sectionType && sectionType !== currentSection) {
      // Save previous content
      if (currentContent.length > 0) {
        sections[currentSection].push(...currentContent);
        currentContent = [];
      }
      currentSection = sectionType;
    } else if (trimmedLine) {
      // Add to current section content
      currentContent.push(trimmedLine);
    }
  }

  // Save final section content
  if (currentContent.length > 0) {
    sections[currentSection].push(...currentContent);
  }

  return sections;
}

/**
 * Extract action items from text content
 *
 * @param {string} text - Text that may contain action items
 * @returns {Array} Array of { task, priority, dealName } objects
 */
export function extractActionItems(text) {
  if (!text || typeof text !== 'string') return [];

  const actionItems = [];
  const lines = text.split('\n');

  // Action verb patterns
  const actionVerbs = /^(?:follow[- ]?up|contact|call|email|send|schedule|review|prepare|draft|research|reach out|check[- ]?in)/i;

  // Priority patterns
  const highPriority = /(?:urgent|critical|high priority|immediate|today|asap)/i;
  const lowPriority = /(?:low priority|when possible|optional|nice to have)/i;

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip empty lines and headers
    if (!trimmed || trimmed.length < 10) continue;

    // Check for action patterns
    const isAction = actionVerbs.test(trimmed) ||
      /^[•\-*]\s*/.test(trimmed) ||
      /^\d+[.)]\s*/.test(trimmed);

    if (isAction) {
      // Clean the task text
      let task = trimmed
        .replace(/^[•\-*]\s*/, '')
        .replace(/^\d+[.)]\s*/, '')
        .trim();

      // Determine priority
      let priority = 'medium';
      if (highPriority.test(task)) {
        priority = 'high';
      } else if (lowPriority.test(task)) {
        priority = 'low';
      }

      // Extract deal name if present (in parentheses or after dash)
      let dealName = null;
      const dealMatch = task.match(/(?:\(([^)]+)\)|—\s*([^—]+)$)/);
      if (dealMatch) {
        dealName = (dealMatch[1] || dealMatch[2])?.trim();
        task = task.replace(dealMatch[0], '').trim();
      }

      // Extract value if present
      const valueMatch = task.match(/\$[\d,]+(?:\.\d{2})?(?:k|K|m|M)?/);
      const value = valueMatch ? valueMatch[0] : null;

      actionItems.push({
        id: `action-${Date.now()}-${actionItems.length}`,
        task: task,
        priority,
        dealName,
        value,
        completed: false
      });
    }
  }

  return actionItems;
}

/**
 * Full sanitization pipeline for AI output
 *
 * @param {string} text - Raw AI output
 * @param {Object} options - Sanitization options
 * @param {boolean} options.stripMarkdown - Whether to strip markdown (default: true)
 * @param {boolean} options.removePrompts - Whether to remove prompt leakage (default: true)
 * @param {boolean} options.normalizeWhitespace - Whether to normalize whitespace (default: true)
 * @returns {string} Fully sanitized text
 */
export function sanitizeAIOutput(text, options = {}) {
  const {
    stripMarkdown: shouldStripMarkdown = true,
    removePrompts = true,
    normalizeWhitespace: shouldNormalizeWhitespace = true
  } = options;

  if (!text || typeof text !== 'string') return '';

  let result = text;

  // Step 1: Remove prompt leakage
  if (removePrompts) {
    result = removePromptLeakage(result);
  }

  // Step 2: Strip markdown
  if (shouldStripMarkdown) {
    result = stripMarkdown(result);
  }

  // Step 3: Normalize whitespace
  if (shouldNormalizeWhitespace) {
    result = normalizeWhitespace(result);
  }

  return result;
}

/**
 * Sanitize and structure AI output for Plan My Day
 *
 * @param {string} text - Raw AI output
 * @returns {Object} Structured output { sanitized, sections, actionItems }
 */
export function sanitizeAndStructure(text) {
  const sanitized = sanitizeAIOutput(text);
  const sections = parseIntoSections(sanitized);
  const actionItems = extractActionItems(sanitized);

  return {
    sanitized,
    sections,
    actionItems,
    hasSections: Object.values(sections).some(arr => arr.length > 0),
    hasActionItems: actionItems.length > 0
  };
}

// Default export for convenience
export default {
  sanitizeAIOutput,
  sanitizeAndStructure,
  stripMarkdown,
  removePromptLeakage,
  normalizeWhitespace,
  parseIntoSections,
  extractActionItems,
  detectSectionType
};
