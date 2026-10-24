import { describe, it, expect } from 'vitest';
import {
  BrowserSandbox,
  BrowserPolicyViolationError,
  BrowserConcurrencyExceededError,
} from '../src/adapters/browserSandbox';

describe('Browser Research Sandbox Safety & Concurrency Guardrail Tests', () => {
  const sandbox = new BrowserSandbox();

  describe('Anti-SSRF and URL Whitelist Validation', () => {
    it('blocks loopback addresses (localhost, 127.0.0.1, ::1)', () => {
      expect(() => sandbox.validateTargetUrl('http://localhost:8080')).toThrow(BrowserPolicyViolationError);
      expect(() => sandbox.validateTargetUrl('http://127.0.0.1/admin')).toThrow(BrowserPolicyViolationError);
      expect(() => sandbox.validateTargetUrl('http://::1/')).toThrow(BrowserPolicyViolationError);
    });

    it('blocks AWS/Cloud metadata endpoint (169.254.169.254)', () => {
      expect(() =>
        sandbox.validateTargetUrl('http://169.254.169.254/latest/meta-data/')
      ).toThrow(/anti-SSRF policy/);
    });

    it('blocks private RFC1918 internal subnets (10.x, 192.168.x, 172.16-31.x)', () => {
      expect(() => sandbox.validateTargetUrl('http://10.0.0.5/api')).toThrow(/RFC1918/);
      expect(() => sandbox.validateTargetUrl('http://192.168.1.1/router')).toThrow(/RFC1918/);
      expect(() => sandbox.validateTargetUrl('http://172.20.0.1/')).toThrow(/RFC1918/);
    });

    it('blocks unsafe non-HTTP protocols (file://, javascript:, data:)', () => {
      expect(() => sandbox.validateTargetUrl('file:///etc/passwd')).toThrow(/Disallowed protocol/);
      expect(() => sandbox.validateTargetUrl('javascript:alert(1)')).toThrow(/Disallowed protocol/);
    });

    it('allows valid public HTTPS domains', () => {
      const url = sandbox.validateTargetUrl('https://aws.amazon.com/certification/');
      expect(url.hostname).toBe('aws.amazon.com');
    });
  });

  describe('Action Class & Capability Guardrail', () => {
    it('REJECTS publishing or messaging actions via browser sandbox', async () => {
      await expect(
        sandbox.executeResearchScrape({
          url: 'https://twitter.com',
          actionClass: 'social.publish' as any,
        })
      ).rejects.toThrow(BrowserPolicyViolationError);

      await expect(
        sandbox.executeResearchScrape({
          url: 'https://facebook.com',
          actionClass: 'social.message' as any,
        })
      ).rejects.toThrow(BrowserPolicyViolationError);
    });
  });

  describe('Concurrency Cap Enforcement (Max 1 Session)', () => {
    it('enforces maximum 1 active session at a time', async () => {
      expect(sandbox.getActiveSessionCount()).toBe(0);

      // Artificially occupy the 1 allowable session slot
      (sandbox as any).activeSessions = 1;

      // Attempting to run another session concurrently MUST throw ConcurrencyExceededError
      await expect(
        sandbox.executeResearchScrape({
          url: 'https://example.com',
          actionClass: 'read.public',
        })
      ).rejects.toThrow(BrowserConcurrencyExceededError);

      // Release session
      (sandbox as any).activeSessions = 0;
      expect(sandbox.getActiveSessionCount()).toBe(0);
    });
  });
});
