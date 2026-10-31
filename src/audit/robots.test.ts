import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AuditContext } from '../types.js';
import { auditRobots } from './robots.js';
import { MAX_HTML_BYTES } from '../constants.js';

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
  it('reads robots.txt up to MAX_HTML_BYTES even when the caller lowered the page cap', async () => {
    mockFetchPage.mockResolvedValue(robotsPage('User-agent: *\nAllow: /\n'));

    await auditRobots(makeCtx({ fetchOptions: { maxBytes: 1000, timeout: 5 } }));

    expect(mockFetchPage.mock.calls[0][1]).toMatchObject({ maxBytes: MAX_HTML_BYTES, timeout: 5 });
  });

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

  it.each([401, 403, 410])('reports ROBOTS_MISSING with no restrictions for %i', async (status) => {
    mockFetchPage.mockResolvedValue({
      body: '',
      status,
      headers: new Headers(),
      finalUrl: 'https://example.com/robots.txt',
    });

    const findings = await auditRobots(makeCtx());
    expect(findings).toHaveLength(1);
    expect(findings[0].code).toBe('ROBOTS_MISSING');
    expect(findings[0].severity).toBe('warning');
    expect(findings[0].message).toContain(String(status));
    expect(findings[0].explanation).toContain('no crawl restrictions');
    expect(findings[0].details).toEqual({ status });
  });

  it.each([500, 503, 429])('reports ROBOTS_SERVER_ERROR for %i', async (status) => {
    mockFetchPage.mockResolvedValue({
      body: 'oops',
      status,
      headers: new Headers(),
      finalUrl: 'https://example.com/robots.txt',
    });

    const ctx = makeCtx();
    const findings = await auditRobots(ctx);
    expect(findings).toHaveLength(1);
    expect(findings[0].code).toBe('ROBOTS_SERVER_ERROR');
    expect(findings[0].severity).toBe('error');
    expect(findings[0].message).toContain('paused');
    expect(findings[0].explanation).toContain('12 hours');
    expect(findings[0].explanation).toContain('30 days');
    expect(findings[0].details).toEqual({ status });
    expect(ctx.robotsTxt).toBeUndefined();
  });

  it('reports ROBOTS_TOO_LARGE past 500 KiB and still checks the rules', async () => {
    const head = 'User-agent: *\nDisallow: /\nSitemap: https://example.com/sitemap.xml\n';
    const body = head + '#'.repeat(512_001 - head.length);
    mockFetchPage.mockResolvedValue(robotsPage(body));

    const findings = await auditRobots(makeCtx());
    const tooLarge = findings.find((f) => f.code === 'ROBOTS_TOO_LARGE');
    expect(tooLarge).toBeDefined();
    expect(tooLarge!.severity).toBe('warning');
    expect(tooLarge!.details).toEqual({ bytes: 512_001, limit: 512_000 });
    expect(findings.find((f) => f.code === 'ROBOTS_BLOCKS_ALL')).toBeDefined();
  });

  it('does not report ROBOTS_TOO_LARGE at exactly 500 KiB', async () => {
    const head = 'User-agent: *\nAllow: /\nSitemap: https://example.com/sitemap.xml\n';
    mockFetchPage.mockResolvedValue(robotsPage(head + '#'.repeat(512_000 - head.length)));

    const findings = await auditRobots(makeCtx());
    expect(findings.map((f) => f.code)).toEqual(['AI_CRAWLER_ACCESS']);
  });

  it('counts ROBOTS_TOO_LARGE in UTF-8 bytes, not characters', async () => {
    const head = 'User-agent: *\nAllow: /\nSitemap: https://example.com/sitemap.xml\n';
    // 'é' is two bytes in UTF-8, so this is under the limit in characters but over it in bytes.
    const body = head + '#'.repeat(256_000);
    const padded = body + 'é'.repeat(Math.ceil((512_001 - body.length) / 2));
    mockFetchPage.mockResolvedValue(robotsPage(padded));

    const findings = await auditRobots(makeCtx());
    expect(padded.length).toBeLessThan(512_000);
    expect(findings.find((f) => f.code === 'ROBOTS_TOO_LARGE')).toBeDefined();
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
    expect(findings.map((f) => f.code)).toEqual(['AI_CRAWLER_ACCESS']);
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
    expect(findings.map((f) => f.code)).toEqual(['AI_CRAWLER_ACCESS']);
  });

  it('handles empty disallow values', async () => {
    mockFetchPage.mockResolvedValue(
      robotsPage('User-agent: *\nDisallow:\nSitemap: https://example.com/sitemap.xml\n'),
    );

    const findings = await auditRobots(makeCtx());
    expect(findings.find((f) => f.code === 'ROBOTS_BLOCKS_ALL')).toBeUndefined();
  });

  it('reports EDGE_CHALLENGE instead of ROBOTS_MISSING when robots.txt is challenged', async () => {
    mockFetchPage.mockResolvedValue({
      body: '<html>challenge</html>',
      status: 403,
      headers: new Headers({ 'x-vercel-mitigated': 'challenge' }),
      finalUrl: 'https://example.com/robots.txt',
    });

    const findings = await auditRobots(makeCtx());
    expect(findings.map((f) => f.code)).toEqual(['EDGE_CHALLENGE']);
    expect(findings[0].category).toBe('robots');
    expect(findings[0].url).toBe('https://example.com/robots.txt');
    expect(findings[0].details).toEqual({ status: 403, provider: 'vercel', header: 'x-vercel-mitigated' });
  });

  it('keeps ROBOTS_MISSING for a 403 without a challenge header', async () => {
    mockFetchPage.mockResolvedValue({
      body: '',
      status: 403,
      headers: new Headers(),
      finalUrl: 'https://example.com/robots.txt',
    });

    const findings = await auditRobots(makeCtx());
    expect(findings.map((f) => f.code)).toEqual(['ROBOTS_MISSING']);
  });
});

describe('auditRobots render assets', () => {
  const nextHtml = `<!doctype html><html><head>
    <link rel="stylesheet" href="/_next/static/css/app.css">
    <script src="/_next/static/chunks/main.js" async></script>
    <script src="https://cdn.example.net/analytics.js"></script>
  </head><body><img src="/_next/image?url=%2Fhero.png&w=1080&q=75" alt=""></body></html>`;

  function codes(findings: { code: string }[]) {
    return findings.map((f) => f.code).filter((c) => c.startsWith('ROBOTS_BLOCKS'));
  }

  async function run(robots: string, html = nextHtml) {
    mockFetchPage.mockResolvedValue(robotsPage(`${robots}\nSitemap: https://example.com/sitemap.xml\n`));
    return auditRobots(makeCtx({ html, finalUrl: 'https://example.com/' }));
  }

  it('reports ROBOTS_BLOCKS_RENDER_ASSETS when Disallow: /_next/ covers a _next/static script', async () => {
    const findings = await run('User-agent: *\nDisallow: /_next/');
    const f = findings.find((x) => x.code === 'ROBOTS_BLOCKS_RENDER_ASSETS');
    expect(f).toBeDefined();
    expect(f!.severity).toBe('error');
    expect(f!.message).toContain('2');
    expect(f!.details).toEqual({
      blocked: ['https://example.com/_next/static/chunks/main.js', 'https://example.com/_next/static/css/app.css'],
      rule: 'Disallow: /_next/',
      group: '*',
    });
    expect(f!.suggestion).toContain('Allow: /_next/static/');
    expect(findings.filter((x) => x.code === 'ROBOTS_BLOCKS_RENDER_ASSETS')).toHaveLength(1);
  });

  it('reports ROBOTS_BLOCKS_NEXT_IMAGE as info when the page uses /_next/image', async () => {
    const findings = await run('User-agent: *\nDisallow: /_next/');
    const f = findings.find((x) => x.code === 'ROBOTS_BLOCKS_NEXT_IMAGE');
    expect(f).toBeDefined();
    expect(f!.severity).toBe('info');
    expect(f!.details).toMatchObject({ rule: 'Disallow: /_next/', group: '*' });
  });

  it('says nothing when Allow: /_next/static/ follows Disallow: /_next/', async () => {
    const findings = await run('User-agent: *\nDisallow: /_next/\nAllow: /_next/static/\nAllow: /_next/image');
    expect(codes(findings)).toEqual([]);
  });

  it('says nothing for a non-Next page under Disallow: /_next/', async () => {
    const html =
      '<html><head><script src="/js/app.js"></script><link rel="stylesheet" href="/css/site.css"></head><body><img src="/hero.png" alt=""></body></html>';
    const findings = await run('User-agent: *\nDisallow: /_next/', html);
    expect(codes(findings)).toEqual([]);
  });

  it('follows the googlebot group over *', async () => {
    expect(codes(await run('User-agent: *\nDisallow: /_next/\n\nUser-agent: Googlebot\nDisallow: /private/'))).toEqual([]);

    const findings = await run('User-agent: *\nAllow: /\n\nUser-agent: googlebot\nDisallow: /_next/static/');
    const f = findings.find((x) => x.code === 'ROBOTS_BLOCKS_RENDER_ASSETS');
    expect(f!.details).toMatchObject({ rule: 'Disallow: /_next/static/', group: 'googlebot' });
  });

  it('applies rules under consecutive User-agent lines to each of them', async () => {
    const findings = await run('User-agent: googlebot\nUser-agent: bingbot\nDisallow: /_next/');
    expect(codes(findings)).toContain('ROBOTS_BLOCKS_RENDER_ASSETS');
  });

  it('drops a trailing comment from the rule', async () => {
    const findings = await run('User-agent: * # everyone\nDisallow: /_next/ # build output');
    const f = findings.find((x) => x.code === 'ROBOTS_BLOCKS_RENDER_ASSETS');
    expect(f!.details).toMatchObject({ rule: 'Disallow: /_next/', group: '*' });
  });

  it('flags non-Next assets too, with a generic suggestion', async () => {
    const html = '<html><head><script src="js/app.js"></script></head></html>';
    const findings = await run('User-agent: *\nDisallow: /js/', html);
    const f = findings.find((x) => x.code === 'ROBOTS_BLOCKS_RENDER_ASSETS');
    expect(f!.details).toMatchObject({ blocked: ['https://example.com/js/app.js'], rule: 'Disallow: /js/' });
    expect(f!.suggestion).not.toContain('/_next/static/');
  });

  it('ignores cross-origin assets', async () => {
    const html = '<html><head><script src="https://cdn.example.net/_next/static/a.js"></script></head></html>';
    expect(codes(await run('User-agent: *\nDisallow: /_next/', html))).toEqual([]);
  });

  it('leaves it to ROBOTS_BLOCKS_ALL when the page itself is blocked', async () => {
    expect(codes(await run('User-agent: *\nDisallow: /'))).toEqual(['ROBOTS_BLOCKS_ALL']);
  });

  it('caps blocked at 10 URLs and counts them all in the message', async () => {
    const scripts = Array.from({ length: 12 }, (_, i) => `<script src="/_next/static/chunks/${i}.js"></script>`).join('');
    const findings = await run('User-agent: *\nDisallow: /_next/', `<html><head>${scripts}</head></html>`);
    const f = findings.find((x) => x.code === 'ROBOTS_BLOCKS_RENDER_ASSETS');
    expect(f!.message).toContain('12');
    expect((f!.details as { blocked: string[] }).blocked).toHaveLength(10);
  });

  it('skips the check when the page was not fetched', async () => {
    mockFetchPage.mockResolvedValue(robotsPage('User-agent: *\nDisallow: /_next/\n'));
    expect(codes(await auditRobots(makeCtx()))).toEqual([]);
    expect(mockFetchPage).toHaveBeenCalledTimes(1);
  });
});

describe('auditRobots AI crawlers', () => {
  async function run(robots: string) {
    mockFetchPage.mockResolvedValue(robotsPage(`${robots}\nSitemap: https://example.com/sitemap.xml\n`));
    const findings = await auditRobots(makeCtx());
    return {
      findings,
      access: findings.find((f) => f.code === 'AI_CRAWLER_ACCESS'),
      blocked: findings.find((f) => f.code === 'AI_SEARCH_BOT_BLOCKED'),
    };
  }

  const allAllowed = {
    training: { GPTBot: 'allow', ClaudeBot: 'allow', 'Google-Extended': 'allow', 'Applebot-Extended': 'allow', CCBot: 'allow' },
    search: { 'OAI-SearchBot': 'allow', 'Claude-SearchBot': 'allow', PerplexityBot: 'allow' },
    user: { 'ChatGPT-User': 'allow', 'Claude-User': 'allow', 'Perplexity-User': 'allow' },
  };

  it('reports every AI crawler as allowed under a permissive * group', async () => {
    const { access, blocked } = await run('User-agent: *\nAllow: /');
    expect(access).toBeDefined();
    expect(access!.severity).toBe('info');
    expect(access!.category).toBe('robots');
    expect(access!.details).toEqual({ ...allAllowed, source: 'robots.txt' });
    expect(access!.message).toBe('AI crawlers: training 5 allowed, search 3 allowed, user fetch 3 allowed');
    expect(access!.explanation).toContain('robots.txt only');
    expect(access!.explanation).toContain('Vercel');
    expect(access!.explanation).toContain('Cloudflare');
    expect(blocked).toBeUndefined();
  });

  it('reports blocked training crawlers without a warning', async () => {
    const { access, blocked } = await run(
      'User-agent: GPTBot\nUser-agent: ClaudeBot\nUser-agent: CCBot\nDisallow: /\n\nUser-agent: *\nAllow: /',
    );
    expect(access!.details).toMatchObject({
      training: { GPTBot: 'block', ClaudeBot: 'block', CCBot: 'block', 'Google-Extended': 'allow' },
      search: allAllowed.search,
    });
    expect(access!.message).toBe(
      'AI crawlers: training 3 blocked and 2 allowed, search 3 allowed, user fetch 3 allowed',
    );
    expect(blocked).toBeUndefined();
  });

  it('warns when a search bot is blocked while Googlebot is allowed', async () => {
    const { access, blocked } = await run(
      'User-agent: OAI-SearchBot\nUser-agent: PerplexityBot\nDisallow: /\n\nUser-agent: *\nAllow: /',
    );
    expect(access!.details).toMatchObject({
      search: { 'OAI-SearchBot': 'block', 'Claude-SearchBot': 'allow', PerplexityBot: 'block' },
    });
    expect(blocked).toBeDefined();
    expect(blocked!.severity).toBe('warning');
    expect(blocked!.category).toBe('robots');
    expect(blocked!.details).toEqual({ blocked: ['OAI-SearchBot', 'PerplexityBot'] });
    expect(blocked!.message).toContain('OAI-SearchBot');
    expect(blocked!.explanation).toContain('legitimate choice');
  });

  it('does not warn about search bots when Googlebot is blocked too', async () => {
    const { blocked } = await run('User-agent: *\nDisallow: /');
    expect(blocked).toBeUndefined();
  });

  it("lets a crawler's own group override the * group", async () => {
    const { access, blocked } = await run(
      'User-agent: *\nDisallow: /\n\nUser-agent: Googlebot\nAllow: /\n\nUser-agent: claude-searchbot\nAllow: /',
    );
    expect(access!.details).toMatchObject({
      search: { 'OAI-SearchBot': 'block', 'Claude-SearchBot': 'allow', PerplexityBot: 'block' },
      training: { ClaudeBot: 'block' },
    });
    expect(blocked!.details).toEqual({ blocked: ['OAI-SearchBot', 'PerplexityBot'] });
  });

  it('parses Content-Signal lines into details without a finding of their own', async () => {
    const { findings, access } = await run('User-Agent: *\nContent-Signal: search=yes, ai-train=no\nAllow: /');
    expect(access!.details).toMatchObject({
      contentSignal: [{ userAgents: ['*'], signals: { search: 'yes', 'ai-train': 'no' } }],
    });
    expect(findings.map((f) => f.code)).toEqual(['AI_CRAWLER_ACCESS']);
  });

  it('leaves contentSignal out when robots.txt has none', async () => {
    const { access } = await run('User-agent: *\nAllow: /');
    expect(access!.details).not.toHaveProperty('contentSignal');
  });

  it('reports the matrix when robots.txt has no groups at all', async () => {
    const { access } = await run('');
    expect(access!.details).toEqual({ ...allAllowed, source: 'robots.txt' });
  });
});
