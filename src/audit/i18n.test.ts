import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AuditContext } from '../types.js';
import { auditI18n } from './i18n.js';

vi.mock('../utils/http.js', () => ({
  fetchPage: vi.fn(),
}));

import { fetchPage } from '../utils/http.js';
const mockFetchPage = vi.mocked(fetchPage);

function makeCtx(html?: string): AuditContext {
  return {
    url: 'https://example.com',
    normalizedUrl: 'https://example.com/',
    fetchOptions: {},
    verbose: false,
    html,
  };
}

function hreflangHtml(links: { hreflang: string; href: string }[]): string {
  const tags = links
    .map((l) => `<link rel="alternate" hreflang="${l.hreflang}" href="${l.href}">`)
    .join('\n');
  return `<html><head>${tags}</head><body></body></html>`;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('auditI18n', () => {
  it('reports HREFLANG_MISSING when no hreflang tags exist', async () => {
    const ctx = makeCtx('<html><head></head><body></body></html>');
    const findings = await auditI18n(ctx);

    expect(findings).toHaveLength(1);
    expect(findings[0].code).toBe('HREFLANG_MISSING');
    expect(findings[0].severity).toBe('info');
  });

  it('returns no issues for a valid complete setup', async () => {
    const html = hreflangHtml([
      { hreflang: 'en', href: 'https://example.com/' },
      { hreflang: 'fr', href: 'https://example.com/fr' },
      { hreflang: 'x-default', href: 'https://example.com/' },
    ]);
    const ctx = makeCtx(html);

    // Mock reciprocal fetch for /fr
    mockFetchPage.mockResolvedValueOnce({
      body: hreflangHtml([
        { hreflang: 'en', href: 'https://example.com/' },
        { hreflang: 'fr', href: 'https://example.com/fr' },
        { hreflang: 'x-default', href: 'https://example.com/' },
      ]),
      status: 200,
      headers: new Headers(),
      finalUrl: 'https://example.com/fr',
    });

    const findings = await auditI18n(ctx);
    expect(findings).toHaveLength(0);
  });

  it('reports HREFLANG_INVALID_LANG for invalid language code', async () => {
    const html = hreflangHtml([
      { hreflang: 'en', href: 'https://example.com/' },
      { hreflang: 'invalid-code-here', href: 'https://example.com/xx' },
      { hreflang: 'x-default', href: 'https://example.com/' },
    ]);
    const ctx = makeCtx(html);

    mockFetchPage.mockResolvedValue({
      body: hreflangHtml([
        { hreflang: 'en', href: 'https://example.com/' },
        { hreflang: 'invalid-code-here', href: 'https://example.com/xx' },
      ]),
      status: 200,
      headers: new Headers(),
      finalUrl: 'https://example.com/xx',
    });

    const findings = await auditI18n(ctx);
    const invalid = findings.find((f) => f.code === 'HREFLANG_INVALID_LANG');
    expect(invalid).toBeDefined();
    expect(invalid!.severity).toBe('error');
    expect(invalid!.details?.hreflang).toBe('invalid-code-here');
  });

  it('reports HREFLANG_MISSING_SELF when no self-reference exists', async () => {
    const html = hreflangHtml([
      { hreflang: 'fr', href: 'https://example.com/fr' },
      { hreflang: 'de', href: 'https://example.com/de' },
      { hreflang: 'x-default', href: 'https://example.com/fr' },
    ]);
    const ctx = makeCtx(html);

    mockFetchPage.mockResolvedValue({
      body: hreflangHtml([
        { hreflang: 'en', href: 'https://example.com/' },
        { hreflang: 'fr', href: 'https://example.com/fr' },
        { hreflang: 'de', href: 'https://example.com/de' },
      ]),
      status: 200,
      headers: new Headers(),
      finalUrl: 'https://example.com/fr',
    });

    const findings = await auditI18n(ctx);
    const missing = findings.find((f) => f.code === 'HREFLANG_MISSING_SELF');
    expect(missing).toBeDefined();
    expect(missing!.severity).toBe('warning');
  });

  it('reports HREFLANG_MISSING_XDEFAULT when x-default is absent', async () => {
    const html = hreflangHtml([
      { hreflang: 'en', href: 'https://example.com/' },
      { hreflang: 'fr', href: 'https://example.com/fr' },
    ]);
    const ctx = makeCtx(html);

    mockFetchPage.mockResolvedValueOnce({
      body: hreflangHtml([
        { hreflang: 'en', href: 'https://example.com/' },
        { hreflang: 'fr', href: 'https://example.com/fr' },
      ]),
      status: 200,
      headers: new Headers(),
      finalUrl: 'https://example.com/fr',
    });

    const findings = await auditI18n(ctx);
    const missing = findings.find((f) => f.code === 'HREFLANG_MISSING_XDEFAULT');
    expect(missing).toBeDefined();
    expect(missing!.severity).toBe('warning');
  });

  it('reports HREFLANG_DUPLICATE for repeated hreflang values', async () => {
    const html = hreflangHtml([
      { hreflang: 'en', href: 'https://example.com/' },
      { hreflang: 'en', href: 'https://example.com/en-alt' },
      { hreflang: 'x-default', href: 'https://example.com/' },
    ]);
    const ctx = makeCtx(html);

    // Both en alternates will be checked for reciprocal (one is self, one isn't)
    mockFetchPage.mockResolvedValue({
      body: hreflangHtml([
        { hreflang: 'en', href: 'https://example.com/' },
      ]),
      status: 200,
      headers: new Headers(),
      finalUrl: 'https://example.com/en-alt',
    });

    const findings = await auditI18n(ctx);
    const dup = findings.find((f) => f.code === 'HREFLANG_DUPLICATE');
    expect(dup).toBeDefined();
    expect(dup!.severity).toBe('warning');
    expect(dup!.details?.hreflang).toBe('en');
  });

  it('reports HREFLANG_MISSING_RECIPROCAL when alternate does not link back', async () => {
    const html = hreflangHtml([
      { hreflang: 'en', href: 'https://example.com/' },
      { hreflang: 'fr', href: 'https://example.com/fr' },
      { hreflang: 'x-default', href: 'https://example.com/' },
    ]);
    const ctx = makeCtx(html);

    // /fr does not link back to example.com
    mockFetchPage.mockResolvedValueOnce({
      body: '<html><head></head><body></body></html>',
      status: 200,
      headers: new Headers(),
      finalUrl: 'https://example.com/fr',
    });

    const findings = await auditI18n(ctx);
    const missing = findings.find((f) => f.code === 'HREFLANG_MISSING_RECIPROCAL');
    expect(missing).toBeDefined();
    expect(missing!.severity).toBe('error');
    expect(missing!.details?.href).toBe('https://example.com/fr');
  });

  it('skips reciprocal check gracefully when fetch fails', async () => {
    const html = hreflangHtml([
      { hreflang: 'en', href: 'https://example.com/' },
      { hreflang: 'fr', href: 'https://example.com/fr' },
      { hreflang: 'x-default', href: 'https://example.com/' },
    ]);
    const ctx = makeCtx(html);

    mockFetchPage.mockRejectedValueOnce(new Error('Network error'));

    const findings = await auditI18n(ctx);
    // Should not have a reciprocal error — just skipped
    const reciprocal = findings.find((f) => f.code === 'HREFLANG_MISSING_RECIPROCAL');
    expect(reciprocal).toBeUndefined();
  });

  it('reuses cached ctx.html and does not re-fetch', async () => {
    const html = hreflangHtml([
      { hreflang: 'en', href: 'https://example.com/' },
      { hreflang: 'x-default', href: 'https://example.com/' },
    ]);
    const ctx = makeCtx(html);

    await auditI18n(ctx);

    // fetchPage should not have been called since ctx.html was provided
    expect(mockFetchPage).not.toHaveBeenCalled();
  });

  it('fetches page when ctx.html is not set', async () => {
    const html = '<html><head></head><body></body></html>';
    const ctx = makeCtx();

    mockFetchPage.mockResolvedValueOnce({
      body: html,
      status: 200,
      headers: new Headers(),
      finalUrl: 'https://example.com/',
    });

    const findings = await auditI18n(ctx);
    expect(mockFetchPage).toHaveBeenCalledOnce();
    expect(findings[0].code).toBe('HREFLANG_MISSING');
    expect(ctx.html).toBe(html);
  });

  it('accepts valid region codes like en-us', async () => {
    const html = hreflangHtml([
      { hreflang: 'en-us', href: 'https://example.com/' },
      { hreflang: 'en-gb', href: 'https://example.com/gb' },
      { hreflang: 'x-default', href: 'https://example.com/' },
    ]);
    const ctx = makeCtx(html);

    mockFetchPage.mockResolvedValueOnce({
      body: hreflangHtml([
        { hreflang: 'en-us', href: 'https://example.com/' },
        { hreflang: 'en-gb', href: 'https://example.com/gb' },
      ]),
      status: 200,
      headers: new Headers(),
      finalUrl: 'https://example.com/gb',
    });

    const findings = await auditI18n(ctx);
    const invalid = findings.find((f) => f.code === 'HREFLANG_INVALID_LANG');
    expect(invalid).toBeUndefined();
  });
});
