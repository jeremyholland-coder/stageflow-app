/**
 * Authentication Error Classes
 *
 * Centralized error handling for authentication and authorization failures.
 * All errors are sanitized to prevent information disclosure.
 */

export class AuthError extends Error {
  statusCode: number;
  code: string;
  details?: any;

  constructor(message: string, statusCode: number = 500, code: string = 'AUTH_ERROR') {
    super(message);
    this.name = 'AuthError';
    this.statusCode = statusCode;
    this.code = code;
  }

  toJSON() {
    return {
      error: this.message,
      code: this.code,
      // Never expose stack traces or internal details in production
      ...(process.env.NODE_ENV === 'development' && { details: this.details })
    };
  }
}

/**
 * 401 Unauthorized - No valid authentication credentials
 */
export class UnauthorizedError extends AuthError {
  constructor(message: string = 'Authentication required', details?: any) {
    super(message, 401, 'UNAUTHORIZED');
    this.name = 'UnauthorizedError';
    this.details = details;
  }
}

/**
 * 403 Forbidden - Valid auth, but insufficient permissions
 */
export class ForbiddenError extends AuthError {
  constructor(message: string = 'Insufficient permissions', details?: any) {
    super(message, 403, 'FORBIDDEN');
    this.name = 'ForbiddenError';
    this.details = details;
  }
}

/**
 * 401 Token Expired - JWT token has expired
 */
export class TokenExpiredError extends AuthError {
  constructor(message: string = 'Token expired, please refresh', details?: any) {
    super(message, 401, 'TOKEN_EXPIRED');
    this.name = 'TokenExpiredError';
    this.details = details;
  }
}

/**
 * 401 Invalid Token - JWT token is malformed or tampered
 */
export class InvalidTokenError extends AuthError {
  constructor(message: string = 'Invalid authentication token', details?: any) {
    super(message, 401, 'INVALID_TOKEN');
    this.name = 'InvalidTokenError';
    this.details = details;
  }
}

/**
 * 403 Insufficient Role - User role doesn't have required permissions
 */
export class InsufficientRoleError extends AuthError {
  constructor(requiredRoles: string[], userRole: string, details?: any) {
    super(
      `This action requires one of these roles: ${requiredRoles.join(', ')}. Current role: ${userRole}`,
      403,
      'INSUFFICIENT_ROLE'
    );
    this.name = 'InsufficientRoleError';
    this.details = details;
  }
}

/**
 * 404 Organization Not Found - User is not member of specified organization
 */
export class OrganizationAccessError extends AuthError {
  constructor(message: string = 'Organization not found or access denied', details?: any) {
    super(message, 404, 'ORG_ACCESS_DENIED');
    this.name = 'OrganizationAccessError';
    this.details = details;
  }
}

/**
 * Create standardized error response
 */
export function createAuthErrorResponse(error: AuthError | Error): Response {
  // Handle auth errors
  if (error instanceof AuthError) {
    return new Response(JSON.stringify(error.toJSON()), {
      status: error.statusCode,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // Handle unknown errors (sanitize for security)
  console.error('❌ Unexpected auth error:', error);
  return new Response(JSON.stringify({
    error: 'Internal server error',
    code: 'INTERNAL_ERROR'
  }), {
    status: 500,
    headers: { 'Content-Type': 'application/json' }
  });
}
