import DOMPurify from 'dompurify';

/**
 * Sanitize user input to prevent XSS attacks
 * @param {string} dirty - Unsanitized user input
 * @param {Object} options - DOMPurify configuration options
 * @returns {string} Sanitized safe HTML
 */
export const sanitizeHTML = (dirty, options = {}) => {
  if (!dirty) return '';
  
  const defaultConfig = {
    ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'u', 'p', 'br', 'ul', 'ol', 'li'],
    ALLOWED_ATTR: [],
    KEEP_CONTENT: true,
    ...options
  };
  
  return DOMPurify.sanitize(dirty, defaultConfig);
};

/**
 * Sanitize plain text (strips all HTML)
 * @param {string} dirty - Unsanitized user input
 * @returns {string} Plain text with HTML stripped
 */
export const sanitizeText = (dirty) => {
  if (!dirty) return '';
  return DOMPurify.sanitize(dirty, { ALLOWED_TAGS: [], KEEP_CONTENT: true });
};

/**
 * Sanitize for display in text inputs (escape HTML entities)
 * @param {string} dirty - Unsanitized user input
 * @returns {string} Escaped safe text
 */
export const escapeHTML = (dirty) => {
  if (!dirty) return '';
  const div = document.createElement('div');
  div.textContent = dirty;
  return div.innerHTML;
};

/**
 * React component wrapper for safe HTML rendering
 * @param {string} html - HTML to render
 * @param {Object} options - DOMPurify options
 * @returns {Object} Props for dangerouslySetInnerHTML
 */
export const createSafeHTML = (html, options = {}) => {
  return {
    __html: sanitizeHTML(html, options)
  };
};
