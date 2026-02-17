import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AuditContext } from '../types.js';
import { auditImages } from './images.js';

vi.mock('../utils/http.js', () => ({
  fetchPage: vi.fn(),
  fetchHead: vi.fn(),
}));

import { fetchHead, fetchPage } from '../utils/http.js';

const mockFetchHead = vi.mocked(fetchHead);
const mockFetchPage = vi.mocked(fetchPage);

function makeCtx(html?: string, headers?: Record<string, string>): AuditContext {
  return {
    url: 'https://example.com',
    normalizedUrl: 'https://example.com/',
    fetchOptions: {},
    verbose: false,
    html,
    headers,
  };
}

function page(body: string): string {
  return `<html><head></head><body>${body}</body></html>`;
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe('auditImages', () => {
  it('returns empty findings when no images exist', async () => {
    const ctx = makeCtx(page(''));
    const findings = await auditImages(ctx);
    expect(findings).toHaveLength(0);
  });

  it('reports IMG_MISSING_ALT for images without alt attribute', async () => {
    const ctx = makeCtx(page('<img src="/photo.jpg">'));
    const findings = await auditImages(ctx);

    const finding = findings.find((f) => f.code === 'IMG_MISSING_ALT');
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe('warning');
    expect(finding!.details?.count).toBe(1);
  });

  it('reports IMG_EMPTY_ALT for images with empty alt', async () => {
    const ctx = makeCtx(page('<img src="/decorative.png" alt="">'));
    const findings = await auditImages(ctx);

    const finding = findings.find((f) => f.code === 'IMG_EMPTY_ALT');
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe('info');
    expect(finding!.details?.count).toBe(1);
  });

  it('does not report IMG_MISSING_ALT when alt is present', async () => {
    const ctx = makeCtx(page('<img src="/photo.jpg" alt="A photo">'));
    const findings = await auditImages(ctx);

    const missing = findings.find((f) => f.code === 'IMG_MISSING_ALT');
    expect(missing).toBeUndefined();
  });

  it('reports IMG_NO_NEXT_IMAGE on Next.js sites', async () => {
    const ctx = makeCtx(
      page('<img src="/photo.jpg" alt="test">'),
      { 'x-powered-by': 'Next.js' },
    );
    const findings = await auditImages(ctx);

    const finding = findings.find((f) => f.code === 'IMG_NO_NEXT_IMAGE');
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe('info');
  });

  it('does not report IMG_NO_NEXT_IMAGE on non-Next.js sites', async () => {
    const ctx = makeCtx(page('<img src="/photo.jpg" alt="test">'));
    const findings = await auditImages(ctx);

    const finding = findings.find((f) => f.code === 'IMG_NO_NEXT_IMAGE');
    expect(finding).toBeUndefined();
  });

  it('does not report IMG_NO_NEXT_IMAGE for images with data-nimg', async () => {
    const ctx = makeCtx(
      page('<img src="/photo.jpg" alt="test" data-nimg="1">'),
      { 'x-powered-by': 'Next.js' },
    );
    const findings = await auditImages(ctx);

    const finding = findings.find((f) => f.code === 'IMG_NO_NEXT_IMAGE');
    expect(finding).toBeUndefined();
  });

  it('reports IMG_NO_LAZY_LOADING for non-first images without loading=lazy', async () => {
    const ctx = makeCtx(
      page('<img src="/hero.jpg" alt="hero"><img src="/below.jpg" alt="below">'),
    );
    const findings = await auditImages(ctx);

    const finding = findings.find((f) => f.code === 'IMG_NO_LAZY_LOADING');
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe('info');
    expect(finding!.details?.count).toBe(1);
  });

  it('does not report IMG_NO_LAZY_LOADING when loading=lazy is set', async () => {
    const ctx = makeCtx(
      page('<img src="/hero.jpg" alt="hero"><img src="/below.jpg" alt="below" loading="lazy">'),
    );
    const findings = await auditImages(ctx);

    const finding = findings.find((f) => f.code === 'IMG_NO_LAZY_LOADING');
    expect(finding).toBeUndefined();
  });

  it('does not report IMG_NO_LAZY_LOADING for single image', async () => {
    const ctx = makeCtx(page('<img src="/hero.jpg" alt="hero">'));
    const findings = await auditImages(ctx);

    const finding = findings.find((f) => f.code === 'IMG_NO_LAZY_LOADING');
    expect(finding).toBeUndefined();
  });

  it('reports IMG_LARGE_FILE for images exceeding 200KB', async () => {
    const ctx = makeCtx(page('<img src="https://cdn.example.com/big.jpg" alt="big">'));
    mockFetchHead.mockResolvedValue({
      status: 200,
      headers: new Headers({ 'content-length': '300000' }),
    });

    const findings = await auditImages(ctx);

    const finding = findings.find((f) => f.code === 'IMG_LARGE_FILE');
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe('warning');
  });

  it('does not report IMG_LARGE_FILE for small images', async () => {
    const ctx = makeCtx(page('<img src="https://cdn.example.com/small.jpg" alt="small">'));
    mockFetchHead.mockResolvedValue({
      status: 200,
      headers: new Headers({ 'content-length': '50000' }),
    });

    const findings = await auditImages(ctx);

    const finding = findings.find((f) => f.code === 'IMG_LARGE_FILE');
    expect(finding).toBeUndefined();
  });

  it('skips HEAD requests for relative image URLs', async () => {
    const ctx = makeCtx(page('<img src="/local.jpg" alt="local">'));
    const findings = await auditImages(ctx);

    expect(mockFetchHead).not.toHaveBeenCalled();
    const finding = findings.find((f) => f.code === 'IMG_LARGE_FILE');
    expect(finding).toBeUndefined();
  });

  it('reports IMG_MISSING_DIMENSIONS for images without width/height', async () => {
    const ctx = makeCtx(page('<img src="/photo.jpg" alt="test">'));
    const findings = await auditImages(ctx);

    const finding = findings.find((f) => f.code === 'IMG_MISSING_DIMENSIONS');
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe('warning');
  });

  it('does not report IMG_MISSING_DIMENSIONS when both width and height are set', async () => {
    const ctx = makeCtx(page('<img src="/photo.jpg" alt="test" width="100" height="100">'));
    const findings = await auditImages(ctx);

    const finding = findings.find((f) => f.code === 'IMG_MISSING_DIMENSIONS');
    expect(finding).toBeUndefined();
  });

  it('returns no issues for a fully optimized page', async () => {
    const ctx = makeCtx(
      page('<img src="/hero.jpg" alt="Hero image" width="800" height="600" loading="eager">'),
    );
    const findings = await auditImages(ctx);

    const issues = findings.filter((f) => f.severity === 'warning' || f.severity === 'error');
    expect(issues).toHaveLength(0);
  });

  it('fetches page when ctx.html is not available', async () => {
    const html = page('<img src="/photo.jpg" alt="test" width="100" height="100">');
    mockFetchPage.mockResolvedValue({
      body: html,
      status: 200,
      headers: new Headers(),
      finalUrl: 'https://example.com/',
    });

    const ctx = makeCtx(undefined);
    await auditImages(ctx);

    expect(mockFetchPage).toHaveBeenCalledTimes(1);
    expect(ctx.html).toBe(html);
  });

  it('handles fetchHead failures gracefully', async () => {
    const ctx = makeCtx(page('<img src="https://cdn.example.com/fail.jpg" alt="fail">'));
    mockFetchHead.mockRejectedValue(new Error('Network error'));

    const findings = await auditImages(ctx);

    const finding = findings.find((f) => f.code === 'IMG_LARGE_FILE');
    expect(finding).toBeUndefined();
  });
});
