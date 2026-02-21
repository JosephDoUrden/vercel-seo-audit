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
