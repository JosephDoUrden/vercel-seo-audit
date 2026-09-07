import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AuditContext } from '../types.js';
import { auditPerformance } from './performance.js';

vi.mock('../utils/http.js', () => ({
  fetchPage: vi.fn(),
}));

import { fetchPage } from '../utils/http.js';
const mockFetchPage = vi.mocked(fetchPage);

beforeEach(() => {
  vi.resetAllMocks();
});

function makeCtx(html?: string): AuditContext {
  return {
    url: 'https://example.com',
    normalizedUrl: 'https://example.com/',
    fetchOptions: {},
    verbose: false,
    html,
  };
}

const CLEAN_HTML = `<!DOCTYPE html>
<html>
<head>
  <script src="/app.js" defer></script>
  <link rel="preconnect" href="https://cdn.example.com">
  <link href="https://cdn.example.com/style.css" rel="stylesheet">
  <style>body { margin: 0; }</style>
</head>
<body><p>Hello</p></body>
</html>`;

describe('auditPerformance', () => {
  it('returns no findings for clean HTML', async () => {
    const findings = await auditPerformance(makeCtx(CLEAN_HTML));
    expect(findings).toHaveLength(0);
  });

  it('detects HTML > 500 KB as info', async () => {
    const html = '<html><head></head><body>' + 'x'.repeat(501 * 1024) + '</body></html>';
    const findings = await auditPerformance(makeCtx(html));
    const f = findings.find((f) => f.code === 'HTML_SIZE_WARNING');
    expect(f).toBeDefined();
    expect(f!.severity).toBe('info');
  });

  it('detects HTML > 1 MB as warning', async () => {
    const html = '<html><head></head><body>' + 'x'.repeat(1025 * 1024) + '</body></html>';
    const findings = await auditPerformance(makeCtx(html));
    const f = findings.find((f) => f.code === 'HTML_SIZE_WARNING');
    expect(f).toBeDefined();
    expect(f!.severity).toBe('warning');
  });

  it('detects render-blocking script in head', async () => {
    const html = `<html><head><script src="/app.js"></script></head><body></body></html>`;
    const findings = await auditPerformance(makeCtx(html));
    const f = findings.find((f) => f.code === 'RENDER_BLOCKING_SCRIPT');
    expect(f).toBeDefined();
    expect(f!.severity).toBe('warning');
  });

  it('does not flag script with async', async () => {
    const html = `<html><head><script src="/app.js" async></script></head><body></body></html>`;
    const findings = await auditPerformance(makeCtx(html));
    expect(findings.find((f) => f.code === 'RENDER_BLOCKING_SCRIPT')).toBeUndefined();
  });

  it('does not flag script with defer', async () => {
    const html = `<html><head><script src="/app.js" defer></script></head><body></body></html>`;
    const findings = await auditPerformance(makeCtx(html));
    expect(findings.find((f) => f.code === 'RENDER_BLOCKING_SCRIPT')).toBeUndefined();
  });

  it('does not flag script with type="module"', async () => {
    const html = `<html><head><script src="/app.js" type="module"></script></head><body></body></html>`;
    const findings = await auditPerformance(makeCtx(html));
    expect(findings.find((f) => f.code === 'RENDER_BLOCKING_SCRIPT')).toBeUndefined();
  });

  it('does not flag JSON-LD data blocks', async () => {
    const ld = '<script type="application/ld+json">{"@context":"https://schema.org"}</script>';
    const html = `<html><head>${ld}${ld}${ld}</head><body></body></html>`;
    const findings = await auditPerformance(makeCtx(html));
    expect(findings.find((f) => f.code === 'RENDER_BLOCKING_SCRIPT')).toBeUndefined();
  });

  it('does not flag importmap or speculationrules', async () => {
    const html = `<html><head><script type="importmap">{"imports":{}}</script><script type="speculationrules">{"prerender":[]}</script></head><body></body></html>`;
    const findings = await auditPerformance(makeCtx(html));
    expect(findings.find((f) => f.code === 'RENDER_BLOCKING_SCRIPT')).toBeUndefined();
  });

  it('does not flag inline scripts without src', async () => {
    const html = `<html><head><script>window.dataLayer = [];</script></head><body></body></html>`;
    const findings = await auditPerformance(makeCtx(html));
    expect(findings.find((f) => f.code === 'RENDER_BLOCKING_SCRIPT')).toBeUndefined();
  });

  it('flags external scripts with an explicit JavaScript type', async () => {
    const html = `<html><head><script type="text/javascript" src="/legacy.js"></script></head><body></body></html>`;
    const findings = await auditPerformance(makeCtx(html));
    expect(findings.find((f) => f.code === 'RENDER_BLOCKING_SCRIPT')).toBeDefined();
  });

  it('reads attributes, not substrings of attribute values', async () => {
    const html = `<html><head><script src="/vendor/async-defer.js"></script></head><body></body></html>`;
    const findings = await auditPerformance(makeCtx(html));
    expect(findings.find((f) => f.code === 'RENDER_BLOCKING_SCRIPT')).toBeDefined();
  });

  it('treats an empty type as classic and a MIME parameter or blank type as a data block', async () => {
    const empty = `<html><head><script type="" src="/a.js"></script></head><body></body></html>`;
    const param = `<html><head><script type="text/javascript; charset=utf-8" src="/a.js"></script></head><body></body></html>`;
    const blank = `<html><head><script type="   " src="/a.js"></script></head><body></body></html>`;
    expect((await auditPerformance(makeCtx(empty))).find((f) => f.code === 'RENDER_BLOCKING_SCRIPT')).toBeDefined();
    expect((await auditPerformance(makeCtx(param))).find((f) => f.code === 'RENDER_BLOCKING_SCRIPT')).toBeUndefined();
    expect((await auditPerformance(makeCtx(blank))).find((f) => f.code === 'RENDER_BLOCKING_SCRIPT')).toBeUndefined();
  });

  it('does not read script tags out of JSON-LD text or comments', async () => {
    const html = `<html><head><!-- <script src="/old.js"></script> --><script type="application/ld+json">{"d":"<script src=\\"/x.js\\">"}</script></head><body></body></html>`;
    const findings = await auditPerformance(makeCtx(html));
    expect(findings.find((f) => f.code === 'RENDER_BLOCKING_SCRIPT')).toBeUndefined();
  });

  it('uses the singular message for one script', async () => {
    const html = `<html><head><script src="/a.js"></script></head><body></body></html>`;
    const f = (await auditPerformance(makeCtx(html))).find((f) => f.code === 'RENDER_BLOCKING_SCRIPT');
    expect(f!.message).toBe('1 render-blocking <script> tag in <head> without async or defer');
    expect(f!.details).toEqual({ count: 1, srcs: ['/a.js'] });
  });

  it('collapses several blocking scripts into one finding with a count', async () => {
    const html = `<html><head><script src="/a.js"></script><script src=/b.js></script><script src="/c.js" defer></script></head><body></body></html>`;
    const findings = await auditPerformance(makeCtx(html));
    const hits = findings.filter((f) => f.code === 'RENDER_BLOCKING_SCRIPT');
    expect(hits).toHaveLength(1);
    expect(hits[0].details).toEqual({ count: 2, srcs: ['/a.js', '/b.js'] });
    expect(hits[0].message).toContain('2 render-blocking');
  });

  it('detects large inline style', async () => {
    const bigCss = 'a'.repeat(51 * 1024);
    const html = `<html><head><style>${bigCss}</style></head><body></body></html>`;
    const findings = await auditPerformance(makeCtx(html));
    const f = findings.find((f) => f.code === 'LARGE_INLINE_STYLE');
    expect(f).toBeDefined();
    expect(f!.severity).toBe('warning');
  });

  it('does not flag small inline style', async () => {
    const html = `<html><head><style>body { margin: 0; }</style></head><body></body></html>`;
    const findings = await auditPerformance(makeCtx(html));
    expect(findings.find((f) => f.code === 'LARGE_INLINE_STYLE')).toBeUndefined();
  });

  it('detects missing preconnect for third-party origins', async () => {
    const html = `<html><head></head><body>
      <script src="https://cdn.other.com/lib.js"></script>
      <img src="https://images.other.com/pic.png">
    </body></html>`;
    const findings = await auditPerformance(makeCtx(html));
    const f = findings.find((f) => f.code === 'MISSING_PRECONNECT');
    expect(f).toBeDefined();
    expect(f!.severity).toBe('info');
    expect((f!.details as { origins: string[] }).origins).toContain('https://cdn.other.com');
    expect((f!.details as { origins: string[] }).origins).toContain('https://images.other.com');
  });

  it('does not flag when preconnect is present', async () => {
    const html = `<html><head>
      <link rel="preconnect" href="https://cdn.other.com">
    </head><body>
      <script src="https://cdn.other.com/lib.js"></script>
    </body></html>`;
    const findings = await auditPerformance(makeCtx(html));
    expect(findings.find((f) => f.code === 'MISSING_PRECONNECT')).toBeUndefined();
  });

  it('reuses ctx.html when available', async () => {
    await auditPerformance(makeCtx(CLEAN_HTML));
    expect(mockFetchPage).not.toHaveBeenCalled();
  });

  it('falls back to fetchPage when ctx.html is undefined', async () => {
    mockFetchPage.mockResolvedValue({
      body: CLEAN_HTML,
      status: 200,
      headers: new Headers(),
      finalUrl: 'https://example.com/',
    });
    const findings = await auditPerformance(makeCtx(undefined));
    expect(mockFetchPage).toHaveBeenCalledTimes(1);
    expect(findings).toHaveLength(0);
  });

  it('returns empty findings when fetchPage fails', async () => {
    mockFetchPage.mockRejectedValue(new Error('timeout'));
    const findings = await auditPerformance(makeCtx(undefined));
    expect(findings).toHaveLength(0);
  });

  it('all findings have category performance', async () => {
    const html = `<html><head><script src="/app.js"></script></head><body>
      <script src="https://cdn.other.com/lib.js"></script>
    </body></html>`;
    const findings = await auditPerformance(makeCtx(html));
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.every((f) => f.category === 'performance')).toBe(true);
  });
});
