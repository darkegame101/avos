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

    it('blocks encoded IP bypasses (dword, hex, octal, and IPv4-mapped IPv6)', () => {
      // Dword representation of 127.0.0.1
      expect(() => sandbox.validateTargetUrl('http://2130706433/')).toThrow(/anti-SSRF/);
      // Hex representation of 127.0.0.1
      expect(() => sandbox.validateTargetUrl('http://0x7f000001/')).toThrow(/anti-SSRF/);
      // Octal representation of 127.0.0.1
      expect(() => sandbox.validateTargetUrl('http://0177.0.0.1/')).toThrow(/anti-SSRF/);
      // IPv4-mapped IPv6
      expect(() => sandbox.validateTargetUrl('http://[::ffff:127.0.0.1]/')).toThrow(/anti-SSRF/);
      // AWS EC2 IPv6 metadata
      expect(() => sandbox.validateTargetUrl('http://[fd00:ec2::254]/')).toThrow(/anti-SSRF/);
    });

    it('blocks private RFC1918 internal subnets (10.x, 192.168.x, 172.16-31.x)', () => {
      expect(() => sandbox.validateTargetUrl('http://10.0.0.5/api')).toThrow(/anti-SSRF/);
      expect(() => sandbox.validateTargetUrl('http://192.168.1.1/router')).toThrow(/anti-SSRF/);
      expect(() => sandbox.validateTargetUrl('http://172.20.0.1/')).toThrow(/anti-SSRF/);
    });

    it('blocks unsafe non-HTTP protocols (file://, javascript:, data:, ws://, wss://, ftp://)', () => {
      expect(() => sandbox.validateTargetUrl('file:///etc/passwd')).toThrow(/Disallowed protocol/);
      expect(() => sandbox.validateTargetUrl('javascript:alert(1)')).toThrow(/Disallowed protocol/);
      expect(() => sandbox.validateTargetUrl('data:text/html,<b>pwned</b>')).toThrow(/Disallowed protocol/);
      expect(() => sandbox.validateTargetUrl('ws://echo.websocket.org')).toThrow(/Disallowed protocol/);
      expect(() => sandbox.validateTargetUrl('wss://secure.websocket.org')).toThrow(/Disallowed protocol/);
      expect(() => sandbox.validateTargetUrl('ftp://ftp.example.com/file.zip')).toThrow(/Disallowed protocol/);
    });

    it('detects DNS rebinding to loopback via validateTargetUrlAsync', async () => {
      // localhost resolves to 127.0.0.1 / ::1
      await expect(sandbox.validateTargetUrlAsync('http://localhost:3000/')).rejects.toThrow(/anti-SSRF|DNS rebinding/);
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
