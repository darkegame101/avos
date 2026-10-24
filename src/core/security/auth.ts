import crypto from 'crypto';
import { config } from '../../config';

export interface AuthContext {
  isAuthenticated: boolean;
  isOwner: boolean;
  actor: string;
}

/**
 * Constant-time string comparison to prevent timing attacks.
 */
function secureCompare(a: string, b: string): boolean {
  try {
    const bufA = Buffer.from(a, 'utf8');
    const bufB = Buffer.from(b, 'utf8');
    if (bufA.length !== bufB.length) {
      // Execute dummy comparison to keep constant execution time
      crypto.timingSafeEqual(bufA, bufA);
      return false;
    }
    return crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

/**
 * Authenticates an incoming request.
 * CRITICAL SECURITY INVARIANT:
 * 1. NEVER inspect request body for identity/role claims (e.g. { "approver": "owner" } or { "isOwner": true }).
 * 2. Identity is determined solely by the cryptographic Bearer token.
 */
export function authenticateRequest(
  authHeader?: string,
  _untrustedRequestBody?: Record<string, any>
): AuthContext {
  // Explicitly ignore any body-supplied claims
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return {
      isAuthenticated: false,
      isOwner: false,
      actor: 'anonymous',
    };
  }

  const token = authHeader.slice(7).trim();
  const isOwner = secureCompare(token, config.ownerToken);

  if (isOwner) {
    return {
      isAuthenticated: true,
      isOwner: true,
      actor: 'owner',
    };
  }

  return {
    isAuthenticated: false,
    isOwner: false,
    actor: 'unauthorized',
  };
}
