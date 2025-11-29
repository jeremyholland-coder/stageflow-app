/**
 * Cryptographic utilities for StageFlow
 * Using Web Crypto API for browser-compatible hashing
 */

/**
 * Hash an API key using SHA-256
 * @param {string} apiKey - The raw API key to hash
 * @returns {Promise<string>} - Hex-encoded hash
 */
export async function hashApiKey(apiKey) {
  // Convert string to bytes
  const encoder = new TextEncoder();
  const data = encoder.encode(apiKey);
  
  // Hash using SHA-256
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  
  // Convert to hex string
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  
  return hashHex;
}

/**
 * Generate a cryptographically secure random API key
 * Format: sk_[64 hex characters]
 * @returns {string} - Generated API key
 * 
 * SECURITY: Uses Web Crypto API (crypto.getRandomValues) for cryptographically
 * secure random generation, replacing the previous Math.random() implementation
 * which was predictable and unsuitable for security-sensitive keys.
 */
export function generateApiKey() {
  // Use crypto.getRandomValues for cryptographically secure random bytes
  // 32 bytes = 256 bits of entropy (same as SHA-256)
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  
  // Convert to hex string (64 characters)
  const randomPart = Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
  
  return `sk_${randomPart}`;
}
