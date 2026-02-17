import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AuditContext } from '../types.js';
import { auditFavicon } from './favicon.js';

vi.mock('../utils/http.js', () => ({
  fetchHead: vi.fn(),
  fetchPage: vi.fn(),
}));

import { fetchHead, fetchPage } from '../utils/http.js';

const mockFetchHead = vi.mocked(fetchHead);
const mockFetchPage = vi.mocked(fetchPage);

function makeCtx(overrides: Partial<AuditContext> = {}): AuditContext {
  return {
    url: 'https://example.com',
    normalizedUrl: 'https://example.com/',
    fetchOptions: {},
    verbose: false,
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mockFetchPage.mockResolvedValue({
    body: '<html><head></head><body></body></html>',
    status: 200,
    headers: new Headers(),
    finalUrl: 'https://example.com/',
  });
});

describe('auditFavicon', () => {
  it('reports FAVICON_MISSING when no favicon.ico and no HTML links', async () => {
    mockFetchHead.mockResolvedValue({ status: 404, headers: new Headers() });

    const findings = await auditFavicon(makeCtx());
    expect(findings).toHaveLength(1);
    expect(findings[0].code).toBe('FAVICON_MISSING');
    expect(findings[0].severity).toBe('warning');
  });

  it('reports FAVICON_HTML_MISSING when only favicon.ico exists', async () => {
    mockFetchHead.mockResolvedValue({ status: 200, headers: new Headers() });

    const findings = await auditFavicon(makeCtx());
    expect(findings).toHaveLength(1);
    expect(findings[0].code).toBe('FAVICON_HTML_MISSING');
    expect(findings[0].severity).toBe('info');
  });

  it('no findings when HTML link exists but no favicon.ico', async () => {
    mockFetchHead.mockResolvedValue({ status: 404, headers: new Headers() });
    mockFetchPage.mockResolvedValue({
      body: '<html><head><link rel="icon" href="/favicon.png"></head><body></body></html>',
      status: 200,
      headers: new Headers(),
      finalUrl: 'https://example.com/',
    });

    const findings = await auditFavicon(makeCtx());
    expect(findings).toHaveLength(0);
  });

  it('reports FAVICON_CONFLICT when both ico and non-ico links exist alongside favicon.ico', async () => {
    mockFetchHead.mockResolvedValue({ status: 200, headers: new Headers() });
    mockFetchPage.mockResolvedValue({
      body: '<html><head><link rel="icon" href="/favicon.ico"><link rel="icon" href="/favicon.png" sizes="32x32"></head><body></body></html>',
      status: 200,
      headers: new Headers(),
      finalUrl: 'https://example.com/',
    });

    const findings = await auditFavicon(makeCtx());
    const conflict = findings.find((f) => f.code === 'FAVICON_CONFLICT');
    expect(conflict).toBeDefined();
    expect(conflict!.severity).toBe('info');
  });

  it('uses ctx.html when available instead of fetching', async () => {
    mockFetchHead.mockResolvedValue({ status: 404, headers: new Headers() });
    const ctx = makeCtx({
      html: '<html><head><link rel="icon" href="/favicon.png"></head><body></body></html>',
    });

    const findings = await auditFavicon(ctx);
    expect(mockFetchPage).not.toHaveBeenCalled();
    expect(findings).toHaveLength(0);
  });

  it('returns empty findings when fetchPage fails and no ctx.html', async () => {
    mockFetchHead.mockResolvedValue({ status: 404, headers: new Headers() });
    mockFetchPage.mockRejectedValue(new Error('Network error'));

    const findings = await auditFavicon(makeCtx());
    expect(findings).toHaveLength(0);
  });

  it('handles fetchHead error gracefully', async () => {
    mockFetchHead.mockRejectedValue(new Error('timeout'));
    mockFetchPage.mockResolvedValue({
      body: '<html><head><link rel="icon" href="/favicon.png"></head><body></body></html>',
      status: 200,
      headers: new Headers(),
      finalUrl: 'https://example.com/',
    });

    const findings = await auditFavicon(makeCtx());
    // favicon.ico check fails silently, HTML favicon found
    expect(findings).toHaveLength(0);
  });

  it('does not report conflict when only ico links in HTML', async () => {
    mockFetchHead.mockResolvedValue({ status: 200, headers: new Headers() });
    mockFetchPage.mockResolvedValue({
      body: '<html><head><link rel="icon" href="/favicon.ico"></head><body></body></html>',
      status: 200,
      headers: new Headers(),
      finalUrl: 'https://example.com/',
    });

    const findings = await auditFavicon(makeCtx());
    expect(findings.find((f) => f.code === 'FAVICON_CONFLICT')).toBeUndefined();
  });

  it('does not report conflict when only non-ico links in HTML', async () => {
    mockFetchHead.mockResolvedValue({ status: 200, headers: new Headers() });
    mockFetchPage.mockResolvedValue({
      body: '<html><head><link rel="icon" href="/favicon.svg" type="image/svg+xml"></head><body></body></html>',
      status: 200,
      headers: new Headers(),
      finalUrl: 'https://example.com/',
    });

    const findings = await auditFavicon(makeCtx());
    expect(findings.find((f) => f.code === 'FAVICON_CONFLICT')).toBeUndefined();
  });
});
