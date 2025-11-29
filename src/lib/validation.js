/**
 * Validation utilities for StageFlow
 * Provides secure validation for webhooks, URLs, and data integrity
 */

/**
 * Validates a webhook URL
 * @param {string} url - The URL to validate
 * @returns {{valid: boolean, error?: string}} Validation result
 */
export const validateWebhookUrl = (url) => {
  if (!url || typeof url !== 'string') {
    return { valid: false, error: 'URL is required' };
  }

  // Remove whitespace
  url = url.trim();

  // Basic format check
  try {
    const urlObj = new URL(url);
    
    // Must be HTTP or HTTPS
    if (!['http:', 'https:'].includes(urlObj.protocol)) {
      return { valid: false, error: 'URL must use HTTP or HTTPS protocol' };
    }

    // Must have a valid hostname
    if (!urlObj.hostname || urlObj.hostname.length === 0) {
      return { valid: false, error: 'URL must have a valid hostname' };
    }

    // Prevent localhost/private IPs in production (security)
    const privateIpPatterns = [
      /^localhost$/i,
      /^127\./,
      /^10\./,
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
      /^192\.168\./,
      /^0\.0\.0\.0$/
    ];

    if (privateIpPatterns.some(pattern => pattern.test(urlObj.hostname))) {
      return { valid: false, error: 'Private/localhost URLs are not allowed for webhooks' };
    }

    return { valid: true };
  } catch (error) {
    return { valid: false, error: 'Invalid URL format' };
  }
};

/**
 * Validates CSV row data for deal import
 * @param {Object} row - CSV row data
 * @param {Object} mapping - Field mapping configuration
 * @returns {{valid: boolean, errors: string[]}} Validation result
 */
export const validateDealRow = (row, mapping) => {
  const errors = [];

  // Client name is required
  if (!mapping.client || !row[mapping.client]?.trim()) {
    errors.push('Client name is required');
  }

  // Email validation (if provided)
  if (mapping.email && row[mapping.email]) {
    const email = row[mapping.email].trim();
    // FIX C8: Better email validation - require 2+ char TLD
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
    if (!emailRegex.test(email)) {
      errors.push('Invalid email format');
    }
  }

  // Phone validation (if provided)
  if (mapping.phone && row[mapping.phone]) {
    const phone = row[mapping.phone].trim();
    // Basic phone validation (allows various formats)
    const phoneRegex = /^[\d\s\-\+\(\)]+$/;
    if (!phoneRegex.test(phone) || phone.length < 7) {
      errors.push('Invalid phone format');
    }
  }

  // Value validation (if provided)
  if (mapping.value && row[mapping.value]) {
    const value = parseFloat(row[mapping.value]);
    if (isNaN(value) || value < 0) {
      errors.push('Deal value must be a positive number');
    }
  }

  // Stage validation (if provided)
  if (mapping.stage && row[mapping.stage]) {
    const validStages = ['lead', 'quote', 'approval', 'invoice', 'onboarding', 'delivery', 'retention'];
    const stage = row[mapping.stage].toLowerCase().trim();
    if (!validStages.includes(stage)) {
      errors.push(`Invalid stage. Must be one of: ${validStages.join(', ')}`);
    }
  }

  // Status validation (if provided)
  if (mapping.status && row[mapping.status]) {
    const validStatuses = ['active', 'won', 'lost'];
    const status = row[mapping.status].toLowerCase().trim();
    if (!validStatuses.includes(status)) {
      errors.push(`Invalid status. Must be one of: ${validStatuses.join(', ')}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
};

/**
 * Sanitizes a deal value from CSV import
 * @param {Object} row - CSV row
 * @param {Object} mapping - Field mapping
 * @param {string} userId - User ID
 * @param {string} orgId - Organization ID
 * @returns {Object} Sanitized deal object
 */
export const sanitizeDealFromCSV = (row, mapping, userId, orgId) => {
  return {
    organization_id: orgId,
    user_id: userId,
    client: row[mapping.client]?.trim() || 'Unknown',
    email: mapping.email && row[mapping.email]?.trim() || null,
    phone: mapping.phone && row[mapping.phone]?.trim() || null,
    value: mapping.value ? (parseFloat(row[mapping.value]) || 0) : 0,
    stage: mapping.stage ? row[mapping.stage]?.toLowerCase().trim() : 'lead',
    status: mapping.status ? row[mapping.status]?.toLowerCase().trim() : 'active',
    notes: mapping.notes ? row[mapping.notes]?.trim() || '' : '',
    created: new Date().toISOString(),
    last_activity: new Date().toISOString()
  };
};
