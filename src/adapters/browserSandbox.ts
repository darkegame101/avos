import crypto from 'crypto';
import net from 'net';
import dns from 'dns';
import { ActionClass } from '../core/models/action';

export class BrowserPolicyViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BrowserPolicyViolationError';
  }
}

export class BrowserConcurrencyExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BrowserConcurrencyExceededError';
  }
}

export interface BrowserScrapeRequest {
  url: string;
  actionClass: ActionClass;
  maxContentLengthBytes?: number;
}

export interface BrowserScrapeResult {
  url: string;
  title: string;
  textSnippet: string;
  contentHash: string;
  fetchedAt: Date;
}

/**
 * Sandboxed Browser Runner for Market & Syllabus Research.
 *
 * ADVANCED SECURITY & ANTI-SSRF CONTROLS:
 * 1. Hard Concurrency Cap: Exactly 1 concurrent active session.
 * 2. Read-Only / Public Access: ONLY 'read.public' action class permitted.
 * 3. Anti-SSRF / Private IP Filter:
 *    - Rejects loopback (127.0.0.0/8, ::1)
 *    - Rejects cloud metadata (169.254.169.254, [fd00:ec2::254])
 *    - Rejects private subnets (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, fc00::/7, fe80::/10)
 *    - Normalizes and detects encoded IP formats (dword, octal, hex)
 * 4. Safe Redirect Interception: 'redirect: manual' ensures redirect target is re-validated.
 * 5. Zero Secrets Access: Ephemeral profile, no cookies, no credentials stored.
 */
export class BrowserSandbox {
  private static readonly MAX_CONCURRENT_SESSIONS = 1;
  private static readonly MAX_REDIRECTS = 3;
  private activeSessions = 0;

  /**
   * Checks whether a given hostname or IP represents a private, loopback, or metadata address.
   */
  private isPrivateOrRestrictedIp(hostname: string): boolean {
    const cleanHost = hostname.replace(/^\[|\]$/g, '').toLowerCase();

    // Check known loopback & metadata names
    if (
      cleanHost === 'localhost' ||
      cleanHost === '127.0.0.1' ||
      cleanHost === '::1' ||
      cleanHost === '0.0.0.0' ||
      cleanHost === '169.254.169.254' ||
      cleanHost === 'metadata.google.internal' ||
      cleanHost === 'fd00:ec2::254'
    ) {
      return true;
    }

    // Check if hostname is an integer representation (e.g. dword 2130706433 or hex 0x7f000001)
    if (/^\d+$/.test(cleanHost) || /^0x[0-9a-f]+$/i.test(cleanHost)) {
      // Dword or hex IP representation
      return true;
    }

    // Check octal IP formats (e.g. 0177.0.0.1)
    if (/^0\d+(\.0\d+)*$/.test(cleanHost)) {
      return true;
    }

    // IPv6 link-local or unique local
    if (cleanHost.startsWith('fe80:') || cleanHost.startsWith('fc00:') || cleanHost.startsWith('fd00:')) {
      return true;
    }

    // IPv4-mapped IPv6 (e.g. ::ffff:127.0.0.1 or ::ffff:7f00:1)
    if (cleanHost.includes('::ffff:')) {
      return true; // All IPv4-mapped IPv6 addresses are blocked from research scraping
    }

    // Parse standard IPv4
    const ipType = net.isIP(cleanHost);
    if (ipType === 4) {
      const parts = cleanHost.split('.').map((p) => parseInt(p, 10));
      // 127.0.0.0/8 (Loopback)
      if (parts[0] === 127) return true;
      // 10.0.0.0/8 (Private)
      if (parts[0] === 10) return true;
      // 169.254.0.0/16 (Link Local / AWS Metadata)
      if (parts[0] === 169 && parts[1] === 254) return true;
      // 172.16.0.0/12 (Private)
      if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
      // 192.168.0.0/16 (Private)
      if (parts[0] === 192 && parts[1] === 168) return true;
      // 0.0.0.0/8
      if (parts[0] === 0) return true;
    }

    return false;
  }

  /**
   * Validates target URL against SSRF, private networks, and protocol rules.
   */
  public validateTargetUrl(rawUrl: string): URL {
    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      throw new BrowserPolicyViolationError(`Invalid URL format: ${rawUrl}`);
    }

    // Enforce protocol whitelist (strictly http: and https: only)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new BrowserPolicyViolationError(
        `Disallowed protocol '${parsed.protocol}'. Only http: and https: are permitted in Browser Sandbox.`
      );
    }

    const hostname = parsed.hostname;

    if (this.isPrivateOrRestrictedIp(hostname)) {
      throw new BrowserPolicyViolationError(
        `Access to internal/private/metadata address '${hostname}' is strictly prohibited by anti-SSRF policy.`
      );
    }

    return parsed;
  }

  /**
   * Validates target URL against SSRF, private networks, protocol rules,
   * AND performs asynchronous DNS resolution to defeat DNS rebinding attacks.
   */
  public async validateTargetUrlAsync(rawUrl: string): Promise<URL> {
    const parsed = this.validateTargetUrl(rawUrl);
    const cleanHost = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();

    // If host is not a raw IP address, resolve via DNS to block rebinding attacks
    if (net.isIP(cleanHost) === 0) {
      try {
        const addresses = await dns.promises.lookup(cleanHost, { all: true });
        for (const addr of addresses) {
          if (this.isPrivateOrRestrictedIp(addr.address)) {
            throw new BrowserPolicyViolationError(
              `DNS rebinding violation: domain '${cleanHost}' resolves to private/restricted IP '${addr.address}'.`
            );
          }
        }
      } catch (err: any) {
        if (err instanceof BrowserPolicyViolationError) throw err;
        throw new BrowserPolicyViolationError(`DNS resolution check failed for '${cleanHost}': ${err.message}`);
      }
    }

    return parsed;
  }

  private acquireSession(): void {
    if (this.activeSessions >= BrowserSandbox.MAX_CONCURRENT_SESSIONS) {
      throw new BrowserConcurrencyExceededError(
        `Browser session limit reached (max: ${BrowserSandbox.MAX_CONCURRENT_SESSIONS}). Concurrent browser execution is blocked.`
      );
    }
    this.activeSessions++;
  }

  private releaseSession(): void {
    if (this.activeSessions > 0) {
      this.activeSessions--;
    }
  }

  public getActiveSessionCount(): number {
    return this.activeSessions;
  }

  /**
   * Executes bounded, public research fetch within sandbox constraints.
   * Intercepts HTTP redirects to re-validate destination against anti-SSRF rules.
   */
  async executeResearchScrape(req: BrowserScrapeRequest): Promise<BrowserScrapeResult> {
    if (req.actionClass !== 'read.public') {
      throw new BrowserPolicyViolationError(
        `Action '${req.actionClass}' is forbidden in Browser Sandbox. Only 'read.public' is permitted.`
      );
    }

    let currentUrl = await this.validateTargetUrlAsync(req.url);
    this.acquireSession();

    try {
      let redirectsCount = 0;
      let finalResponse: Response | null = null;

      while (redirectsCount <= BrowserSandbox.MAX_REDIRECTS) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);

        const response = await fetch(currentUrl.toString(), {
          method: 'GET',
          redirect: 'manual', // MANUAL REDIRECT TO PREVENT SSRF REDIRECT EXPLOITS
          headers: {
            'User-Agent': 'AVOS-Research-Agent/1.0 (Autonomous Market Intelligence; +https://github.com/darkegame101/avos)',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          },
          signal: controller.signal,
        }).finally(() => clearTimeout(timeout));

        // Handle HTTP Redirects securely
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          const location = response.headers.get('location');
          if (!location) {
            throw new Error(`Redirect HTTP ${response.status} missing Location header.`);
          }

          // Resolve relative redirect against current URL
          const resolvedRedirect = new URL(location, currentUrl);

          // CRITICAL: Re-validate redirect target against anti-SSRF rules and DNS rebinding
          currentUrl = await this.validateTargetUrlAsync(resolvedRedirect.toString());
          redirectsCount++;
          continue;
        }

        finalResponse = response;
        break;
      }

      if (!finalResponse) {
        throw new Error(`Maximum redirects exceeded (${BrowserSandbox.MAX_REDIRECTS}).`);
      }

      if (!finalResponse.ok) {
        throw new Error(`HTTP fetch failed with status ${finalResponse.status} ${finalResponse.statusText}`);
      }

      const rawHtml = await finalResponse.text();
      const maxLen = req.maxContentLengthBytes || 100000;
      const truncated = rawHtml.slice(0, maxLen);

      const titleMatch = truncated.match(/<title[^>]*>([^<]+)<\/title>/i);
      const title = titleMatch ? titleMatch[1].trim() : currentUrl.hostname;

      const cleanSnippet = truncated
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 1000);

      const contentHash = crypto.createHash('sha256').update(truncated).digest('hex');

      return {
        url: currentUrl.toString(),
        title,
        textSnippet: cleanSnippet,
        contentHash,
        fetchedAt: new Date(),
      };
    } finally {
      this.releaseSession();
    }
  }
}
