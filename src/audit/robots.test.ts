import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AuditContext } from '../types.js';
import { auditRobots } from './robots.js';

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

function robotsPage(body: string) {
  return {
    body,
    status: 200,
    headers: new Headers(),
    finalUrl: 'https://example.com/robots.txt',
  };
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe('auditRobots', () => {
  it('reports ROBOTS_MISSING when status is not 200', async () => {
    mockFetchPage.mockResolvedValue({
      body: '',
      status: 404,
      headers: new Headers(),
      finalUrl: 'https://example.com/robots.txt',
    });

    const findings = await auditRobots(makeCtx());
    expect(findings).toHaveLength(1);
    expect(findings[0].code).toBe('ROBOTS_MISSING');
    expect(findings[0].severity).toBe('warning');
  });

  it('reports ROBOTS_MISSING when fetch throws', async () => {
    mockFetchPage.mockRejectedValue(new Error('Network error'));

    const findings = await auditRobots(makeCtx());
    expect(findings).toHaveLength(1);
    expect(findings[0].code).toBe('ROBOTS_MISSING');
  });

  it('detects ROBOTS_BLOCKS_ALL', async () => {
    mockFetchPage.mockResolvedValue(
      robotsPage('User-agent: *\nDisallow: /\n'),
    );

    const findings = await auditRobots(makeCtx());
    const blocksAll = findings.find((f) => f.code === 'ROBOTS_BLOCKS_ALL');
    expect(blocksAll).toBeDefined();
    expect(blocksAll!.severity).toBe('error');
  });

  it('detects ROBOTS_BLOCKS_GOOGLEBOT', async () => {
    mockFetchPage.mockResolvedValue(
      robotsPage('User-agent: Googlebot\nDisallow: /\n'),
    );

    const findings = await auditRobots(makeCtx());
    const blocks = findings.find((f) => f.code === 'ROBOTS_BLOCKS_GOOGLEBOT');
    expect(blocks).toBeDefined();
    expect(blocks!.severity).toBe('error');
  });

  it('detects ROBOTS_BLOCKS_GOOGLEBOT for googlebot-news', async () => {
    mockFetchPage.mockResolvedValue(
      robotsPage('User-agent: Googlebot-News\nDisallow: /\n'),
    );

    const findings = await auditRobots(makeCtx());
    const blocks = findings.find((f) => f.code === 'ROBOTS_BLOCKS_GOOGLEBOT');
    expect(blocks).toBeDefined();
  });

  it('detects ROBOTS_BLOCKS_GOOGLEBOT for googlebot-image', async () => {
    mockFetchPage.mockResolvedValue(
      robotsPage('User-agent: Googlebot-Image\nDisallow: /\n'),
    );

    const findings = await auditRobots(makeCtx());
    const blocks = findings.find((f) => f.code === 'ROBOTS_BLOCKS_GOOGLEBOT');
    expect(blocks).toBeDefined();
  });

  it('reports ROBOTS_NO_SITEMAP when no sitemap directive', async () => {
    mockFetchPage.mockResolvedValue(
      robotsPage('User-agent: *\nAllow: /\n'),
    );

    const findings = await auditRobots(makeCtx());
    const noSitemap = findings.find((f) => f.code === 'ROBOTS_NO_SITEMAP');
    expect(noSitemap).toBeDefined();
    expect(noSitemap!.severity).toBe('info');
  });

  it('does not report ROBOTS_NO_SITEMAP when sitemap exists', async () => {
    mockFetchPage.mockResolvedValue(
      robotsPage('User-agent: *\nAllow: /\nSitemap: https://example.com/sitemap.xml\n'),
    );

    const findings = await auditRobots(makeCtx());
    expect(findings.find((f) => f.code === 'ROBOTS_NO_SITEMAP')).toBeUndefined();
  });

  it('no issues for a well-formed robots.txt', async () => {
    mockFetchPage.mockResolvedValue(
      robotsPage(
        'User-agent: *\nAllow: /\nDisallow: /admin\nSitemap: https://example.com/sitemap.xml\n',
      ),
    );

    const findings = await auditRobots(makeCtx());
    expect(findings).toHaveLength(0);
  });

  it('stores robotsTxt on ctx for cross-module use', async () => {
    const body = 'User-agent: *\nAllow: /\nSitemap: https://example.com/sitemap.xml\n';
    mockFetchPage.mockResolvedValue(robotsPage(body));

    const ctx = makeCtx();
    await auditRobots(ctx);
    expect(ctx.robotsTxt).toBe(body);
  });

  it('does not store robotsTxt on ctx when not found', async () => {
    mockFetchPage.mockResolvedValue({
      body: '',
      status: 404,
      headers: new Headers(),
      finalUrl: 'https://example.com/robots.txt',
    });

    const ctx = makeCtx();
    await auditRobots(ctx);
    expect(ctx.robotsTxt).toBeUndefined();
  });

  it('ignores comment lines', async () => {
    mockFetchPage.mockResolvedValue(
      robotsPage('# This is a comment\nUser-agent: *\nAllow: /\nSitemap: https://example.com/sitemap.xml\n'),
    );

    const findings = await auditRobots(makeCtx());
    expect(findings).toHaveLength(0);
  });

  it('handles empty disallow values', async () => {
    mockFetchPage.mockResolvedValue(
      robotsPage('User-agent: *\nDisallow:\nSitemap: https://example.com/sitemap.xml\n'),
    );

    const findings = await auditRobots(makeCtx());
    expect(findings.find((f) => f.code === 'ROBOTS_BLOCKS_ALL')).toBeUndefined();
  });
});
