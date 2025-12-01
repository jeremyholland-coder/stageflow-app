/**
 * Number sanitization utilities for safe numeric input handling.
 *
 * Cleans user-friendly input (with $, commas, spaces, etc.) to plain numeric strings
 * suitable for backend submission. Prevents NaN and invalid payloads.
 */

/**
 * Sanitize a raw input value to a clean numeric string.
 * Removes all non-numeric characters except decimal points.
 * Ensures at most one decimal point.
 *
 * @param {string|number|null|undefined} raw - The raw input value
 * @returns {string} Clean numeric string (digits and optional single decimal)
 */
export function sanitizeNumberInput(raw) {
  if (raw === null || raw === undefined) return '';

  const value = String(raw);

  // Remove everything except digits and decimal point
  const cleaned = value.replace(/[^0-9.]/g, '');

  // Ensure at most one decimal point
  const parts = cleaned.split('.');
  if (parts.length <= 1) return cleaned;

  // Keep first part and join remaining (removing extra decimal points)
  const normalized = parts[0] + '.' + parts.slice(1).join('');
  return normalized;
}

/**
 * Convert a raw input value to a number or null.
 * Returns null for empty/invalid values instead of NaN.
 *
 * @param {string|number|null|undefined} raw - The raw input value
 * @returns {number|null} Numeric value or null if invalid/empty
 */
export function toNumberOrNull(raw) {
  const cleaned = sanitizeNumberInput(raw);
  if (!cleaned) return null;

  const num = Number(cleaned);
  return Number.isFinite(num) ? num : null;
}

/**
 * Validate that a value can be converted to a valid number.
 *
 * @param {string|number|null|undefined} raw - The raw input value
 * @returns {boolean} True if value is valid for numeric conversion
 */
export function isValidNumber(raw) {
  if (raw === null || raw === undefined || raw === '') return false;
  const num = toNumberOrNull(raw);
  return num !== null;
}
