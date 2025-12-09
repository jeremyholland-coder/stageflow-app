/**
 * AES-256-GCM Encryption Module
 * Provides authenticated encryption for sensitive data (C3 Security Fix)
 */
import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // GCM standard
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32; // 256 bits

/**
 * P0 FIX: Validate hex string format before conversion
 * Buffer.from(key, 'hex') doesn't throw on invalid hex - it silently creates wrong buffer
 */
function isValidHex(str: string): boolean {
  return /^[0-9a-fA-F]+$/.test(str);
}

/**
 * Get encryption key from environment
 * P0 FIX: Added strict hex format validation
 */
function getEncryptionKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) {
    throw new Error('ENCRYPTION_KEY environment variable not set');
  }

  // P0 FIX: Validate hex format BEFORE Buffer.from (which silently fails on invalid hex)
  if (!isValidHex(key)) {
    console.error('[Encryption] ENCRYPTION_KEY contains invalid hex characters');
    throw new Error('ENCRYPTION_KEY must be a valid hex string (0-9, a-f only)');
  }

  // P0 FIX: Check length before conversion (must be exactly 64 hex chars for 32 bytes)
  if (key.length !== KEY_LENGTH * 2) {
    console.error('[Encryption] ENCRYPTION_KEY wrong length:', key.length, 'expected:', KEY_LENGTH * 2);
    throw new Error(`ENCRYPTION_KEY must be exactly ${KEY_LENGTH * 2} hex characters (got ${key.length})`);
  }

  const keyBuffer = Buffer.from(key, 'hex');
  if (keyBuffer.length !== KEY_LENGTH) {
    throw new Error(`Encryption key must be ${KEY_LENGTH} bytes (${KEY_LENGTH * 2} hex chars)`);
  }

  return keyBuffer;
}

/**
 * Encrypt text using AES-256-GCM
 * @param text - Plain text to encrypt
 * @returns Encrypted data (format: iv:authTag:ciphertext)
 */
export function encrypt(text: string): string {
  try {
    const key = getEncryptionKey();
    const iv = crypto.randomBytes(IV_LENGTH);
    
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = cipher.getAuthTag();
    
    // Format: iv:authTag:ciphertext
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
  } catch (error: any) {
    console.error('Encryption error:', error);
    throw new Error('Failed to encrypt data');
  }
}

/**
 * Decrypt text using AES-256-GCM
 * @param encryptedData - Encrypted data (format: iv:authTag:ciphertext)
 * @returns Decrypted plain text
 */
export function decrypt(encryptedData: string): string {
  // Parse encrypted data FIRST for diagnostics
  const parts = encryptedData?.split(':') || [];

  try {
    const key = getEncryptionKey();

    if (parts.length !== 3) {
      // DIAGNOSTIC: Log format issue
      console.error("[StageFlow][AI][DECRYPT][ERROR] Invalid GCM format", {
        expectedParts: 3,
        actualParts: parts.length,
        encryptedDataLength: encryptedData?.length ?? 0
      });
      throw new Error('Invalid encrypted data format');
    }

    const [ivHex, authTagHex, ciphertext] = parts;

    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    // ============================================================================
    // [StageFlow][AI][DECRYPT] Success diagnostic (NO actual key logged!)
    // ============================================================================
    console.log("[StageFlow][AI][DECRYPT]", {
      success: true,
      format: 'GCM',
      inputLength: encryptedData?.length ?? 0,
      outputLength: decrypted?.length ?? 0,
      // Only log first 4 chars to confirm key format (sk-..., AIza..., etc)
      outputPrefix: decrypted?.substring(0, 4) + '***'
    });

    return decrypted;
  } catch (error: any) {
    // ============================================================================
    // [StageFlow][AI][DECRYPT] Failure diagnostic
    // ============================================================================
    console.error("[StageFlow][AI][DECRYPT]", {
      success: false,
      format: 'GCM',
      inputLength: encryptedData?.length ?? 0,
      inputParts: parts.length,
      errorName: error?.name,
      errorMessage: error?.message?.substring(0, 100),
      // Check if ENCRYPTION_KEY is present (don't log the key!)
      encryptionKeyPresent: !!process.env.ENCRYPTION_KEY,
      encryptionKeyLength: process.env.ENCRYPTION_KEY?.length ?? 0
    });
    console.error('Decryption error:', error);
    throw new Error('Failed to decrypt data');
  }
}

/**
 * Check if data uses old CBC format
 */
export function isLegacyEncryption(encryptedData: string): boolean {
  // GCM format: iv:authTag:ciphertext (3 parts)
  // CBC format: iv:ciphertext (2 parts)
  const parts = encryptedData.split(':');
  return parts.length === 2;
}

/**
 * Decrypt legacy CBC encrypted data (for migration only)
 */
export function decryptLegacy(encryptedData: string): string {
  // Parse encrypted data FIRST for diagnostics
  const parts = encryptedData?.split(':') || [];

  try {
    const key = getEncryptionKey();

    if (parts.length !== 2) {
      // DIAGNOSTIC: Log format issue
      console.error("[StageFlow][AI][DECRYPT][ERROR] Invalid CBC format", {
        expectedParts: 2,
        actualParts: parts.length,
        encryptedDataLength: encryptedData?.length ?? 0
      });
      throw new Error('Invalid legacy encrypted data format');
    }

    const [ivHex, ciphertext] = parts;
    const iv = Buffer.from(ivHex, 'hex');

    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);

    let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    // ============================================================================
    // [StageFlow][AI][DECRYPT] Success diagnostic (NO actual key logged!)
    // ============================================================================
    console.log("[StageFlow][AI][DECRYPT]", {
      success: true,
      format: 'CBC_LEGACY',
      inputLength: encryptedData?.length ?? 0,
      outputLength: decrypted?.length ?? 0,
      // Only log first 4 chars to confirm key format
      outputPrefix: decrypted?.substring(0, 4) + '***'
    });

    return decrypted;
  } catch (error: any) {
    // ============================================================================
    // [StageFlow][AI][DECRYPT] Failure diagnostic
    // ============================================================================
    console.error("[StageFlow][AI][DECRYPT]", {
      success: false,
      format: 'CBC_LEGACY',
      inputLength: encryptedData?.length ?? 0,
      inputParts: parts.length,
      errorName: error?.name,
      errorMessage: error?.message?.substring(0, 100),
      encryptionKeyPresent: !!process.env.ENCRYPTION_KEY,
      encryptionKeyLength: process.env.ENCRYPTION_KEY?.length ?? 0
    });
    console.error('Legacy decryption error:', error);
    throw new Error('Failed to decrypt legacy data');
  }
}
