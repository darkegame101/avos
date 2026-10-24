const SENSITIVE_KEYS = new Set([
  'authorization',
  'token',
  'ownertoken',
  'avos_owner_token',
  'password',
  'secret',
  'apikey',
  'api_key',
  'privatekey',
  'private_key',
  'databaseurl',
  'database_url',
]);

/**
 * Recursively redacts sensitive values from objects before logging or returning to clients.
 */
export function redactSecrets<T>(data: T): T {
  if (data === null || data === undefined) {
    return data;
  }

  if (typeof data === 'string') {
    // Redact Bearer tokens in strings
    return data.replace(/(Bearer\s+)[A-Za-z0-9_\-\.]{8,}/gi, '$1[REDACTED]') as unknown as T;
  }

  if (Array.isArray(data)) {
    return data.map((item) => redactSecrets(item)) as unknown as T;
  }

  if (typeof data === 'object') {
    const redacted: Record<string, any> = {};
    for (const [key, val] of Object.entries(data)) {
      const lower = key.toLowerCase();
      if (SENSITIVE_KEYS.has(lower) || lower.includes('token') || lower.includes('secret') || lower.includes('password')) {
        redacted[key] = '[REDACTED]';
      } else {
        redacted[key] = redactSecrets(val);
      }
    }
    return redacted as T;
  }

  return data;
}
