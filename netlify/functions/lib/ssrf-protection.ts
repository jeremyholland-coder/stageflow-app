/**
 * SSRF (Server-Side Request Forgery) Protection
 * Prevents webhook URLs from targeting internal networks
 * 
 * CRITICAL FIX H3: Blocks malicious webhook URLs
 */

interface ValidationResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Check if an IP address is in a private range
 */
function isPrivateIP(ip: string): boolean {
  // Remove IPv6 prefix if present
  const cleanIP = ip.replace(/^\[|\]$/g, '');
  
  // IPv4 private ranges
  const privateIPv4Ranges = [
    /^127\./,                    // 127.0.0.0/8 (localhost)
    /^10\./,                     // 10.0.0.0/8
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./, // 172.16.0.0/12
    /^192\.168\./,               // 192.168.0.0/16
    /^169\.254\./,               // 169.254.0.0/16 (link-local)
    /^0\.0\.0\.0$/,              // 0.0.0.0
    /^255\.255\.255\.255$/,      // broadcast
  ];

  // IPv6 private ranges
  const privateIPv6Ranges = [
    /^::1$/,                     // localhost
    /^fe80:/,                    // link-local
    /^fc00:/,                    // unique local
    /^fd00:/,                    // unique local
    /^ff00:/,                    // multicast
  ];

  for (const range of privateIPv4Ranges) {
    if (range.test(cleanIP)) return true;
  }

  for (const range of privateIPv6Ranges) {
    if (range.test(cleanIP.toLowerCase())) return true;
  }

  return false;
}

/**
 * Check if hostname is localhost or private
 */
function isPrivateHostname(hostname: string): boolean {
  const lowerHostname = hostname.toLowerCase();
  
  // Localhost variants
  if (lowerHostname === 'localhost') return true;
  if (lowerHostname.endsWith('.localhost')) return true;
  if (lowerHostname === '0.0.0.0') return true;
  
  // Internal domains
  if (lowerHostname.endsWith('.local')) return true;
  if (lowerHostname.endsWith('.internal')) return true;
  
  // Cloud metadata endpoints
  if (lowerHostname === '169.254.169.254') return true; // AWS, GCP, Azure
  if (lowerHostname === 'metadata.google.internal') return true;
  
  return false;
}

/**
 * Validate webhook URL for SSRF vulnerabilities
 * 
 * @param url - The webhook URL to validate
 * @returns ValidationResult with allowed status and optional reason
 */
export async function validateWebhookURL(url: string): Promise<ValidationResult> {
  try {
    // Parse URL
    const parsed = new URL(url);
    
    // Only allow HTTP/HTTPS
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return {
        allowed: false,
        reason: `Protocol not allowed: ${parsed.protocol}. Only http: and https: are permitted.`
      };
    }
    
    // Check hostname for private domains
    if (isPrivateHostname(parsed.hostname)) {
      return {
        allowed: false,
        reason: `Hostname is private or internal: ${parsed.hostname}`
      };
    }
    
    // Check if hostname is an IP address
    const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$|^\[?[0-9a-fA-F:]+\]?$/;
    if (ipRegex.test(parsed.hostname)) {
      if (isPrivateIP(parsed.hostname)) {
        return {
          allowed: false,
          reason: `IP address is in private range: ${parsed.hostname}`
        };
      }
    }
    
    // Additional checks for known problematic patterns
    if (parsed.hostname.includes('..')) {
      return {
        allowed: false,
        reason: 'Hostname contains suspicious pattern (..)'
      };
    }
    
    // Check for URL-encoded attempts to bypass
    if (url.includes('%') && url !== decodeURIComponent(url)) {
      const decodedUrl = decodeURIComponent(url);
      // Re-validate decoded URL
      return validateWebhookURL(decodedUrl);
    }
    
    return { allowed: true };
    
  } catch (error: any) {
    return {
      allowed: false,
      reason: `Invalid URL format: ${error.message}`
    };
  }
}

/**
 * Whitelist-based validation (optional, can be configured per organization)
 */
export function isWhitelisted(url: string, whitelist: string[]): boolean {
  try {
    const parsed = new URL(url);
    return whitelist.some(domain => 
      parsed.hostname === domain || 
      parsed.hostname.endsWith(`.${domain}`)
    );
  } catch {
    return false;
  }
}

export default { validateWebhookURL, isPrivateIP, isPrivateHostname, isWhitelisted };
