import { describe, it, expect } from 'vitest';
import type { AuditContext } from '../types.js';
import { auditSecurity } from './security.js';

function makeCtx(headers?: Record<string, string>): AuditContext {
  return {
    url: 'https://example.com',
    normalizedUrl: 'https://example.com/',
    fetchOptions: {},
    verbose: false,
    headers,
  };
}

const ALL_HEADERS: Record<string, string> = {
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'strict-origin-when-cross-origin',
};

describe('auditSecurity', () => {
  it('returns no findings when all security headers present', async () => {
    const findings = await auditSecurity(makeCtx(ALL_HEADERS));
    expect(findings).toHaveLength(0);
  });

  it('returns empty findings when headers not available', async () => {
    const findings = await auditSecurity(makeCtx(undefined));
    expect(findings).toHaveLength(0);
  });

  it('detects HSTS_MISSING', async () => {
    const { 'strict-transport-security': _, ...rest } = ALL_HEADERS;
    const findings = await auditSecurity(makeCtx(rest));
    const hsts = findings.find((f) => f.code === 'HSTS_MISSING');
    expect(hsts).toBeDefined();
    expect(hsts!.severity).toBe('info');
  });

  it('detects CONTENT_TYPE_OPTIONS_MISSING when header absent', async () => {
    const { 'x-content-type-options': _, ...rest } = ALL_HEADERS;
    const findings = await auditSecurity(makeCtx(rest));
    const cto = findings.find((f) => f.code === 'CONTENT_TYPE_OPTIONS_MISSING');
    expect(cto).toBeDefined();
    expect(cto!.severity).toBe('info');
  });

  it('detects CONTENT_TYPE_OPTIONS_MISSING when header is wrong value', async () => {
    const headers = { ...ALL_HEADERS, 'x-content-type-options': 'sniff' };
    const findings = await auditSecurity(makeCtx(headers));
    expect(findings.find((f) => f.code === 'CONTENT_TYPE_OPTIONS_MISSING')).toBeDefined();
  });

  it('detects FRAME_PROTECTION_MISSING', async () => {
    const { 'x-frame-options': _, ...rest } = ALL_HEADERS;
    const findings = await auditSecurity(makeCtx(rest));
    const frame = findings.find((f) => f.code === 'FRAME_PROTECTION_MISSING');
    expect(frame).toBeDefined();
    expect(frame!.severity).toBe('info');
  });

  it('accepts CSP frame-ancestors as alternative to X-Frame-Options', async () => {
    const { 'x-frame-options': _, ...rest } = ALL_HEADERS;
    const headers = { ...rest, 'content-security-policy': "frame-ancestors 'self'" };
    const findings = await auditSecurity(makeCtx(headers));
    expect(findings.find((f) => f.code === 'FRAME_PROTECTION_MISSING')).toBeUndefined();
  });

  it('detects REFERRER_POLICY_MISSING', async () => {
    const { 'referrer-policy': _, ...rest } = ALL_HEADERS;
    const findings = await auditSecurity(makeCtx(rest));
    const rp = findings.find((f) => f.code === 'REFERRER_POLICY_MISSING');
    expect(rp).toBeDefined();
    expect(rp!.severity).toBe('info');
  });

  it('reports all four issues when no security headers present', async () => {
    const findings = await auditSecurity(makeCtx({}));
    expect(findings).toHaveLength(4);
    const codes = findings.map((f) => f.code).sort();
    expect(codes).toEqual([
      'CONTENT_TYPE_OPTIONS_MISSING',
      'FRAME_PROTECTION_MISSING',
      'HSTS_MISSING',
      'REFERRER_POLICY_MISSING',
    ]);
  });

  it('all findings have category security', async () => {
    const findings = await auditSecurity(makeCtx({}));
    expect(findings.every((f) => f.category === 'security')).toBe(true);
  });
});
