import crypto from 'crypto';
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
 * SAFETY INVARIANTS:
 * 1. Hard Concurrency Cap: Exactly 1 concurrent active session.
 * 2. Read-Only / Public Access: ONLY 'read.public' action class permitted.
 * 3. Anti-SSRF / Private IP Filter: Blocks localhost, 127.0.0.1, 169.254.169.254, internal CIDRs.
 * 4. Zero Secrets Access: Ephemeral profile, no cookies, no stored credentials.
 */
export class BrowserSandbox {
  private static readonly MAX_CONCURRENT_SESSIONS = 1;
  private activeSessions = 0;

  /**
   * Validates target URL against SSRF and private network boundaries.
   */
  public validateTargetUrl(rawUrl: string): URL {
    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      throw new BrowserPolicyViolationError(`Invalid URL format: ${rawUrl}`);
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new BrowserPolicyViolationError(
        `Disallowed protocol '${parsed.protocol}'. Only http: and https: are allowed in Browser Sandbox.`
      );
    }

    const hostname = parsed.hostname.toLowerCase();

    // Anti-SSRF: block loopback and cloud metadata endpoints
    const blockedHosts = [
      'localhost',
      '127.0.0.1',
      '::1',
      '0.0.0.0',
      '169.254.169.254', // AWS/Cloud Metadata service
      'metadata.google.internal',
    ];

    if (blockedHosts.includes(hostname)) {
      throw new BrowserPolicyViolationError(
        `Access to internal/metadata address '${hostname}' is strictly prohibited by Browser Sandbox anti-SSRF policy.`
      );
    }

    // Block private RFC1918 IPv4 ranges
    if (
      hostname.startsWith('10.') ||
      hostname.startsWith('192.168.') ||
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname)
    ) {
      throw new BrowserPolicyViolationError(
        `Access to private RFC1918 IP address '${hostname}' is prohibited.`
      );
    }

    return parsed;
  }

  /**
   * Acquires browser session lock (enforcing MAX_CONCURRENT_SESSIONS = 1).
   */
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
   */
  async executeResearchScrape(req: BrowserScrapeRequest): Promise<BrowserScrapeResult> {
    // 1. Action class validation: strictly read.public only
    if (req.actionClass !== 'read.public') {
      throw new BrowserPolicyViolationError(
        `Action '${req.actionClass}' is forbidden in Browser Sandbox. Only 'read.public' is permitted.`
      );
    }

    // 2. Validate URL against anti-SSRF rules
    const targetUrl = this.validateTargetUrl(req.url);

    // 3. Acquire atomic session lock
    this.acquireSession();

    try {
      // Ephemeral fetch with strict timeout and no cookie persistence
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);

      const response = await fetch(targetUrl.toString(), {
        method: 'GET',
        headers: {
          'User-Agent': 'AVOS-Research-Agent/1.0 (Autonomous Market Intelligence)',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        signal: controller.signal,
      }).finally(() => clearTimeout(timeout));

      if (!response.ok) {
        throw new Error(`HTTP fetch failed with status ${response.status} ${response.statusText}`);
      }

      const rawHtml = await response.text();
      const maxLen = req.maxContentLengthBytes || 100000;
      const truncated = rawHtml.slice(0, maxLen);

      // Extract basic title & snippet
      const titleMatch = truncated.match(/<title[^>]*>([^<]+)<\/title>/i);
      const title = titleMatch ? titleMatch[1].trim() : targetUrl.hostname;

      // Strip basic HTML tags for text snippet
      const cleanSnippet = truncated
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 1000);

      const contentHash = crypto.createHash('sha256').update(truncated).digest('hex');

      return {
        url: targetUrl.toString(),
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
