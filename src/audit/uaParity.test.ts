import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as cheerio from 'cheerio';
import type { AuditContext, FetchOptions } from '../types.js';
import { USER_AGENT_PRESETS } from '../constants.js';
import { BOT_PROBE_USER_AGENT } from './streamed-metadata.js';
import { auditUaParity, PARITY_BROWSER_USER_AGENT, PARITY_CRAWLER_USER_AGENT, parityUserAgents } from './uaParity.js';

vi.mock('../utils/http.js', () => ({
  fetchPage: vi.fn(),
}));

import { fetchPage } from '../utils/http.js';
const mockFetchPage = vi.mocked(fetchPage);

type Page = Awaited<ReturnType<typeof fetchPage>>;

const URL_ = 'https://example.com/';
const GOOGLEBOT = USER_AGENT_PRESETS.googlebot;

function html({
  title = '<title>Example</title>',
  canonical = '<link rel="canonical" href="https://example.com/">',
  robots = '',
  body = '<h1>Example</h1><p>Some text on the page.</p>',
} = {}): string {
  return `<html><head>${title}${canonical}${robots}</head><body>${body}</body></html>`;
}

const PAGE = html();

function page(body: string, overrides: Partial<Page> = {}): Page {
  return { body, status: 200, headers: new Headers(), finalUrl: URL_, ...overrides };
}

// Answers each user agent with its own page; any other gets the default page.
function answer(byUa: Record<string, Page> = {}): void {
  mockFetchPage.mockImplementation(async (_url: string, opts?: FetchOptions) => byUa[opts?.userAgent ?? ''] ?? page(PAGE));
}

function makeCtx(overrides: Partial<AuditContext> = {}): AuditContext {
  return {
    url: 'https://example.com',
    normalizedUrl: URL_,
    fetchOptions: { timeout: 5000, cache: new Map(), auditedUrl: URL_ },
    verbose: false,
    html: PAGE,
    headers: { 'cache-control': 'public, max-age=0, must-revalidate' },
    finalUrl: URL_,
    ...overrides,
  };
}

const codes = (findings: { code: string }[]) => findings.map((f) => f.code);

beforeEach(() => {
  vi.resetAllMocks();
  answer();
});

describe('parityUserAgents', () => {
  it('uses Googlebot, the streamed-metadata bot and a browser when the default is the audit user agent', () => {
    expect(parityUserAgents('vercel-seo-audit/2.11.0').map((u) => u.userAgent)).toEqual([
      GOOGLEBOT,
      BOT_PROBE_USER_AGENT,
      PARITY_BROWSER_USER_AGENT,
    ]);
  });

  it('uses the plain crawler user agent when --user-agent replaced the default', () => {
    expect(parityUserAgents('Mozilla/5.0 Custom').map((u) => u.label)).toEqual(['googlebot', 'htmlLimitedBot', 'crawler']);
  });

  it('never asks again as the default user agent, and still makes three requests', () => {
    const agents = parityUserAgents(GOOGLEBOT).map((u) => u.userAgent);
    expect(agents).toEqual([BOT_PROBE_USER_AGENT, PARITY_CRAWLER_USER_AGENT, PARITY_BROWSER_USER_AGENT]);
  });
});

describe('auditUaParity', () => {
  it('reports nothing when every user agent gets the same page', async () => {
    expect(await auditUaParity(makeCtx())).toEqual([]);
  });

  it('makes exactly three requests, with the streamed-metadata bot options and outside the shared cache', async () => {
    await auditUaParity(makeCtx());
    expect(mockFetchPage).toHaveBeenCalledTimes(3);
    for (const [url, opts] of mockFetchPage.mock.calls) {
      expect(url).toBe(URL_);
      // The shared cache keys on the URL alone, so using it would hand back the default page.
      expect(opts?.cache).toBeUndefined();
      expect(opts?.timeout).toBe(5000);
    }
    expect(mockFetchPage.mock.calls.map(([, opts]) => opts?.userAgent)).toContain(BOT_PROBE_USER_AGENT);
  });

  it('skips without a request when phase 0 left no HTML (unreachable, non-2xx, challenged or not HTML)', async () => {
    expect(await auditUaParity(makeCtx({ html: undefined, headers: undefined }))).toEqual([]);
    expect(mockFetchPage).not.toHaveBeenCalled();
  });

  it('reports a 500 for Googlebot as an error', async () => {
    answer({ [GOOGLEBOT]: page('<html><body>Internal Server Error</body></html>', { status: 500 }) });
    const findings = await auditUaParity(makeCtx());
    expect(codes(findings)).toEqual(['UA_STATUS_DIFFERS']);
    const [f] = findings;
    expect(f.severity).toBe('error');
    expect(f.category).toBe('indexing');
    expect(f.message).toContain('Googlebot');
    expect(f.message).toContain('500');
    expect(f.explanation).toContain('verify');
    expect(f.details?.byUserAgent).toMatchObject({ default: { statusClass: '2xx' }, googlebot: { status: 500 } });
  });

  it('names an edge challenge served to a spoofed bot', async () => {
    const headers = new Headers({ 'x-vercel-mitigated': 'challenge' });
    answer({ [GOOGLEBOT]: page('<html></html>', { status: 403, headers }) });
    const [f] = await auditUaParity(makeCtx());
    expect(f.code).toBe('UA_STATUS_DIFFERS');
    expect(f.message).toContain('Vercel challenge');
    expect(f.details?.byUserAgent).toMatchObject({ googlebot: { status: 403, challenge: 'vercel' } });
  });

  it('reports a title missing for the HTML-limited bot as a warning', async () => {
    answer({ [BOT_PROBE_USER_AGENT]: page(html({ title: '' })) });
    const findings = await auditUaParity(makeCtx());
    expect(codes(findings)).toEqual(['UA_METADATA_DIFFERS']);
    const [f] = findings;
    expect(f.severity).toBe('warning');
    expect(f.details?.fields).toEqual(['title']);
    expect(f.details?.byUserAgent).toMatchObject({ default: { title: 'Example' }, htmlLimitedBot: { title: null } });
    expect(f.explanation).toContain('cloaking');
  });

  it('reads each field the way the cheerio selectors pick it', async () => {
    const tricky =
      '<html><head><script>document.write("<title>Fake</title><h1>no</h1>")</script>' +
      '<TITLE>A &amp; B</TITLE><title>Second</title>' +
      '<link rel="canonical"><link rel="canonical" href="https://example.com/other">' +
      '<meta name="Robots" content="noindex"><meta name="robots" content=" index ">' +
      '</head><body><p>no heading</p></body></html>';
    const $ = cheerio.load(tricky);
    answer({ [GOOGLEBOT]: page(tricky) });

    const findings = await auditUaParity(makeCtx());
    const googlebot = findings.find((f) => f.code === 'UA_METADATA_DIFFERS')?.details?.byUserAgent as Record<string, Record<string, unknown>>;

    expect(googlebot.googlebot).toMatchObject({
      title: $('title').first().text(),
      canonical: $('link[rel="canonical"]').first().attr('href') ?? null,
      robots: $('meta[name="robots"]').first().attr('content')?.trim(),
    });
    expect(googlebot.googlebot).toMatchObject({ title: 'A & B', canonical: null, robots: 'index' });
  });

  it('matches rel case-insensitively and skips what sits inside <noscript>, as cheerio does', async () => {
    const tricky =
      '<html><head><noscript><title>Hidden</title><link rel="canonical" href="https://example.com/hidden">' +
      '<meta name="robots" content="noindex"></noscript>' +
      '<title>Example</title><link rel="Canonical" href="https://example.com/"></head>' +
      '<body><noscript><h1>Hidden</h1></noscript><p>x</p></body></html>';
    const $ = cheerio.load(tricky);
    answer({ [GOOGLEBOT]: page(tricky) });

    const findings = await auditUaParity(makeCtx());
    const metadata = findings.find((f) => f.code === 'UA_METADATA_DIFFERS');

    expect($('title').first().text()).toBe('Example');
    expect($('link[rel="canonical"]').first().attr('href')).toBe('https://example.com/');
    expect($('meta[name="robots"]').length).toBe(0);
    expect($('h1').length).toBe(0);
    // Title, canonical and robots all agree with the default page, which has an <h1>.
    expect(metadata).toBeUndefined();
  });

  it('ignores case, whitespace and a trailing slash on the canonical', async () => {
    answer({
      [GOOGLEBOT]: page(html({ title: '<title>  EXAMPLE\n</title>', canonical: '<link rel="canonical" href="https://example.com">' })),
    });
    expect(await auditUaParity(makeCtx())).toEqual([]);
  });

  it('reports a noindex sent to one user agent only, in the meta tag or the header', async () => {
    answer({
      [GOOGLEBOT]: page(html({ robots: '<meta name="robots" content="noindex">' })),
      [BOT_PROBE_USER_AGENT]: page(PAGE, { headers: new Headers({ 'x-robots-tag': 'noindex' }) }),
    });
    const [f] = await auditUaParity(makeCtx());
    expect(f.code).toBe('UA_METADATA_DIFFERS');
    expect(f.details?.fields).toEqual(['robots', 'xRobotsTag']);
  });

  it('reports cache-control private for one user agent only as info, citing Next.js 16.3', async () => {
    answer({
      [BOT_PROBE_USER_AGENT]: page(PAGE, {
        headers: new Headers({ 'cache-control': 'private, no-cache, no-store, max-age=0, must-revalidate' }),
      }),
    });
    const findings = await auditUaParity(makeCtx());
    expect(codes(findings)).toEqual(['UA_CACHE_DIFFERS']);
    const [f] = findings;
    expect(f.severity).toBe('info');
    expect(f.explanation).toContain('96594');
    expect(f.details?.byUserAgent).toMatchObject({ htmlLimitedBot: { privateOrNoStore: true }, default: { privateOrNoStore: false } });
  });

  it('does not report a cache-control that differs only in max-age', async () => {
    answer({ [GOOGLEBOT]: page(PAGE, { headers: new Headers({ 'cache-control': 'public, max-age=60' }) }) });
    expect(await auditUaParity(makeCtx())).toEqual([]);
  });

  it('reports a page more than 30% smaller for one user agent as info', async () => {
    const big = html({ body: `<h1>Example</h1>${'<p>Some text on the page.</p>'.repeat(40)}` });
    mockFetchPage.mockImplementation(async (_url: string, opts?: FetchOptions) =>
      opts?.userAgent === GOOGLEBOT ? page(html({ body: '<p>Short</p>' })) : page(big),
    );
    const findings = await auditUaParity(makeCtx({ html: big }));
    expect(codes(findings)).toEqual(['UA_SIZE_DIFFERS']);
    const [f] = findings;
    expect(f.severity).toBe('info');
    expect(f.details?.byUserAgent).toMatchObject({ default: { sizeRatio: 1, h1: true }, googlebot: { h1: false } });
    expect((f.details?.byUserAgent as Record<string, { sizeRatio: number }>).googlebot.sizeRatio).toBeLessThan(0.7);
  });

  it('leaves a request that failed out of the comparison', async () => {
    mockFetchPage.mockImplementation(async (_url: string, opts?: FetchOptions) => {
      if (opts?.userAgent === GOOGLEBOT) throw new Error('fetch failed');
      return page(PAGE);
    });
    expect(await auditUaParity(makeCtx())).toEqual([]);
  });
});
