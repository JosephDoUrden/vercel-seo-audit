import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AuditContext } from '../types.js';
import { auditMetadata } from './metadata.js';

vi.mock('../utils/http.js', () => ({
  fetchPage: vi.fn(),
}));

import { fetchPage } from '../utils/http.js';

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

function makePage(html: string, opts: { headers?: Headers; finalUrl?: string } = {}) {
  return {
    body: html,
    status: 200,
    headers: opts.headers ?? new Headers(),
    finalUrl: opts.finalUrl ?? 'https://example.com/',
  };
}

const FULL_HTML = `<html><head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Example</title>
  <meta name="description" content="A description">
  <meta name="robots" content="index, follow">
  <link rel="canonical" href="https://example.com/">
  <meta property="og:title" content="Example">
  <meta property="og:description" content="A description">
  <meta property="og:image" content="https://example.com/image.png">
</head><body></body></html>`;

beforeEach(() => {
  vi.resetAllMocks();
  mockFetchPage.mockResolvedValue(makePage(FULL_HTML));
});

describe('auditMetadata', () => {
  it('returns no errors/warnings for fully complete page', async () => {
    const findings = await auditMetadata(makeCtx());
    const issues = findings.filter((f) => f.severity === 'error' || f.severity === 'warning');
    expect(issues).toHaveLength(0);
  });

  it('returns empty findings when fetch fails', async () => {
    mockFetchPage.mockRejectedValue(new Error('timeout'));
    const findings = await auditMetadata(makeCtx());
    expect(findings).toHaveLength(0);
  });

  it('detects NOINDEX_DETECTED', async () => {
    mockFetchPage.mockResolvedValue(
      makePage('<html><head><meta name="robots" content="noindex"></head><body></body></html>'),
    );
    const findings = await auditMetadata(makeCtx());
    const noindex = findings.find((f) => f.code === 'NOINDEX_DETECTED');
    expect(noindex).toBeDefined();
    expect(noindex!.severity).toBe('error');
  });

  it('detects X_ROBOTS_NOINDEX header', async () => {
    const headers = new Headers({ 'x-robots-tag': 'noindex' });
    mockFetchPage.mockResolvedValue(makePage(FULL_HTML, { headers }));
    const findings = await auditMetadata(makeCtx());
    const xRobots = findings.find((f) => f.code === 'X_ROBOTS_NOINDEX');
    expect(xRobots).toBeDefined();
    expect(xRobots!.severity).toBe('error');
  });

  it('detects CANONICAL_MISSING', async () => {
    mockFetchPage.mockResolvedValue(
      makePage(
        '<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>T</title></head><body></body></html>',
      ),
    );
    const findings = await auditMetadata(makeCtx());
    expect(findings.find((f) => f.code === 'CANONICAL_MISSING')).toBeDefined();
  });

  it('detects CANONICAL_MISMATCH', async () => {
    mockFetchPage.mockResolvedValue(
      makePage(
        '<html><head><link rel="canonical" href="https://example.com/other"><meta charset="utf-8"><meta name="viewport" content="w"><title>T</title></head><body></body></html>',
      ),
    );
    const findings = await auditMetadata(makeCtx());
    const mismatch = findings.find((f) => f.code === 'CANONICAL_MISMATCH');
    expect(mismatch).toBeDefined();
    expect(mismatch!.severity).toBe('warning');
  });

  it('detects CANONICAL_EXTERNAL', async () => {
    mockFetchPage.mockResolvedValue(
      makePage(
        '<html><head><link rel="canonical" href="https://other-domain.com/"><meta charset="utf-8"><meta name="viewport" content="w"><title>T</title></head><body></body></html>',
      ),
    );
    const findings = await auditMetadata(makeCtx());
    const external = findings.find((f) => f.code === 'CANONICAL_EXTERNAL');
    expect(external).toBeDefined();
    expect(external!.severity).toBe('info');
  });

  it('detects CHARSET_MISSING', async () => {
    mockFetchPage.mockResolvedValue(
      makePage(
        '<html><head><meta name="viewport" content="w"><title>T</title><link rel="canonical" href="https://example.com/"></head><body></body></html>',
      ),
    );
    const findings = await auditMetadata(makeCtx());
    expect(findings.find((f) => f.code === 'CHARSET_MISSING')).toBeDefined();
  });

  it('detects VIEWPORT_MISSING', async () => {
    mockFetchPage.mockResolvedValue(
      makePage(
        '<html><head><meta charset="utf-8"><title>T</title><link rel="canonical" href="https://example.com/"></head><body></body></html>',
      ),
    );
    const findings = await auditMetadata(makeCtx());
    expect(findings.find((f) => f.code === 'VIEWPORT_MISSING')).toBeDefined();
  });

  it('detects TITLE_MISSING', async () => {
    mockFetchPage.mockResolvedValue(
      makePage(
        '<html><head><meta charset="utf-8"><meta name="viewport" content="w"><link rel="canonical" href="https://example.com/"></head><body></body></html>',
      ),
    );
    const findings = await auditMetadata(makeCtx());
    expect(findings.find((f) => f.code === 'TITLE_MISSING')).toBeDefined();
  });

  it('detects DESCRIPTION_MISSING', async () => {
    mockFetchPage.mockResolvedValue(
      makePage(FULL_HTML.replace('<meta name="description" content="A description">', '')),
    );
    const findings = await auditMetadata(makeCtx());
    expect(findings.find((f) => f.code === 'DESCRIPTION_MISSING')).toBeDefined();
  });

  it('detects OG_TITLE_MISSING', async () => {
    mockFetchPage.mockResolvedValue(
      makePage(FULL_HTML.replace('<meta property="og:title" content="Example">', '')),
    );
    const findings = await auditMetadata(makeCtx());
    expect(findings.find((f) => f.code === 'OG_TITLE_MISSING')).toBeDefined();
  });

  it('detects OG_DESCRIPTION_MISSING', async () => {
    mockFetchPage.mockResolvedValue(
      makePage(FULL_HTML.replace('<meta property="og:description" content="A description">', '')),
    );
    const findings = await auditMetadata(makeCtx());
    expect(findings.find((f) => f.code === 'OG_DESCRIPTION_MISSING')).toBeDefined();
  });

  it('detects OG_IMAGE_MISSING', async () => {
    mockFetchPage.mockResolvedValue(
      makePage(
        FULL_HTML.replace(
          '<meta property="og:image" content="https://example.com/image.png">',
          '',
        ),
      ),
    );
    const findings = await auditMetadata(makeCtx());
    expect(findings.find((f) => f.code === 'OG_IMAGE_MISSING')).toBeDefined();
  });

  it('stores html and headers on ctx', async () => {
    const ctx = makeCtx();
    await auditMetadata(ctx);
    expect(ctx.html).toBeDefined();
    expect(ctx.headers).toBeDefined();
  });

  it('does not report canonical mismatch when canonical matches page URL', async () => {
    mockFetchPage.mockResolvedValue(makePage(FULL_HTML));
    const findings = await auditMetadata(makeCtx());
    expect(findings.find((f) => f.code === 'CANONICAL_MISMATCH')).toBeUndefined();
  });
});
