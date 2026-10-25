import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AuditContext } from '../types.js';
import { HTML_LIMITED_BOT_UA_RE, USER_AGENT, USER_AGENT_PRESETS } from '../constants.js';
import { auditStreamedMetadata, BOT_PROBE_USER_AGENT } from './streamed-metadata.js';

vi.mock('../utils/http.js', () => ({
  fetchPage: vi.fn(),
}));

import { fetchPage } from '../utils/http.js';
const mockFetchPage = vi.mocked(fetchPage);

type Page = Awaited<ReturnType<typeof fetchPage>>;

const URL_ = 'https://example.com/';

const TAGS = `<title>Example</title>
  <meta name="description" content="A description">
  <link rel="canonical" href="https://example.com/">
  <meta property="og:title" content="Example">`;

const HEAD_HTML = `<html><head>${TAGS}</head><body><div id="__next"></div></body></html>`;
// What Next.js 15.2+ sends a user agent it streams to: an empty-ish head, the tags in body.
const STREAMED_HTML = `<html><head><meta charset="utf-8"></head><body><div id="__next"></div>${TAGS}</body></html>`;

function page(body: string, overrides: Partial<Page> = {}): Page {
  return { body, status: 200, headers: new Headers(), finalUrl: URL_, ...overrides };
}

function botAnswers(body: string, overrides: Partial<Page> = {}) {
  mockFetchPage.mockResolvedValue(page(body, overrides));
}

function makeCtx(overrides: Partial<AuditContext> = {}): AuditContext {
  return {
    url: 'https://example.com',
    normalizedUrl: URL_,
    fetchOptions: { timeout: 5000, cache: new Map() },
    verbose: false,
    html: STREAMED_HTML,
    headers: { 'x-powered-by': 'Next.js' },
    finalUrl: URL_,
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  botAnswers(HEAD_HTML);
});

describe('auditStreamedMetadata', () => {
  it('does nothing on a page that does not look like Next.js', async () => {
    const findings = await auditStreamedMetadata(
      makeCtx({
        headers: { server: 'nginx' },
        html: '<html><head></head><body><title>x</title></body></html>',
      }),
    );
    expect(findings).toEqual([]);
    expect(mockFetchPage).not.toHaveBeenCalled();
  });

  it('treats Next.js build markers in the HTML as Next.js without x-powered-by', async () => {
    const findings = await auditStreamedMetadata(makeCtx({ headers: { server: 'Vercel' } }));
    expect(findings).toHaveLength(1);
  });

  it('does nothing without the shared page', async () => {
    const findings = await auditStreamedMetadata(makeCtx({ html: undefined, headers: undefined }));
    expect(findings).toEqual([]);
    expect(mockFetchPage).not.toHaveBeenCalled();
  });

  it('does nothing when the metadata is already in <head>', async () => {
    const findings = await auditStreamedMetadata(makeCtx({ html: HEAD_HTML }));
    expect(findings).toEqual([]);
    expect(mockFetchPage).not.toHaveBeenCalled();
  });

  it('does not count an inline SVG title in body as streamed metadata', async () => {
    const html = `<html><head>${TAGS}</head><body><div id="__next"><svg><title>Close</title></svg></div></body></html>`;
    const findings = await auditStreamedMetadata(makeCtx({ html }));
    expect(findings).toEqual([]);
    expect(mockFetchPage).not.toHaveBeenCalled();
  });

  it('fetches the page once more as an HTML-limited bot, uncached', async () => {
    await auditStreamedMetadata(makeCtx());
    expect(mockFetchPage).toHaveBeenCalledTimes(1);
    expect(mockFetchPage).toHaveBeenCalledWith(URL_, { timeout: 5000, userAgent: BOT_PROBE_USER_AGENT });
    expect(mockFetchPage.mock.calls[0][1]).not.toHaveProperty('cache');
  });

  it('probes the final URL, not the one typed in', async () => {
    const finalUrl = 'https://www.example.com/';
    botAnswers(HEAD_HTML, { finalUrl });
    await auditStreamedMetadata(makeCtx({ finalUrl }));
    expect(mockFetchPage.mock.calls[0][0]).toBe(finalUrl);
  });

  it('probes with a user agent on the HTML-limited list', () => {
    expect(HTML_LIMITED_BOT_UA_RE.test(BOT_PROBE_USER_AGENT)).toBe(true);
  });

  it('reports METADATA_STREAMED_TO_BODY as info when the bot gets <head> metadata', async () => {
    const findings = await auditStreamedMetadata(makeCtx());
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      code: 'METADATA_STREAMED_TO_BODY',
      severity: 'info',
      category: 'nextjs',
      url: URL_,
      details: {
        bodyOnly: ['title', 'description', 'canonical', 'og:title'],
        botHead: ['title', 'description', 'canonical', 'og:title'],
        defaultUserAgent: USER_AGENT,
        botUserAgent: BOT_PROBE_USER_AGENT,
        botRequest: 'ok',
      },
    });
    expect(findings[0].explanation).toMatch(/GPTBot/);
  });

  it('words the info finding without overclaiming', async () => {
    const [finding] = await auditStreamedMetadata(makeCtx());
    expect(finding.explanation).toMatch(/when generateMetadata is dynamic \(static metadata and prerendered pages stay in <head>\)/);
    expect(finding.explanation).toMatch(/Vercel says it has verified Googlebot reads them/);
    expect(finding.explanation).toMatch(/SEO crawlers that fetch without rendering/);
    expect(finding.explanation).not.toMatch(/AhrefsBot|SemrushBot/);
    expect(finding.suggestion).toMatch(/extend the default list \(setting the option replaces it\)/);
  });

  it('records the default response cache state', async () => {
    const findings = await auditStreamedMetadata(
      makeCtx({ headers: { 'x-powered-by': 'Next.js', 'x-vercel-cache': 'MISS' } }),
    );
    expect(findings[0].details).toMatchObject({ defaultCache: 'MISS', botStatus: 200, botFinalUrl: URL_ });
  });

  it('names the configured user agent in the details', async () => {
    const userAgent = USER_AGENT_PRESETS.googlebot;
    const findings = await auditStreamedMetadata(makeCtx({ fetchOptions: { userAgent } }));
    expect(findings[0].details).toMatchObject({ defaultUserAgent: userAgent });
  });

  it('reports METADATA_NOT_IN_HEAD as a warning when the bot gets body-only metadata too', async () => {
    botAnswers(STREAMED_HTML);
    const findings = await auditStreamedMetadata(makeCtx());
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      code: 'METADATA_NOT_IN_HEAD',
      severity: 'warning',
      category: 'nextjs',
      details: { bodyOnly: ['title', 'description', 'canonical', 'og:title'], botHead: [], botRequest: 'ok' },
    });
  });

  it('warns when the bot gets only some of the tags in <head>', async () => {
    botAnswers(
      '<html><head><title>Example</title></head><body><div id="__next"></div><meta name="description" content="A description"></body></html>',
    );
    const findings = await auditStreamedMetadata(makeCtx());
    expect(findings[0]).toMatchObject({
      code: 'METADATA_NOT_IN_HEAD',
      severity: 'warning',
      details: { botHead: ['title'], missing: ['description', 'canonical', 'og:title'] },
    });
    expect(findings[0].explanation).toMatch(/description, canonical and og:title were still not in <head>/);
    expect(findings[0].explanation).not.toMatch(/title, description, canonical and og:title were still/);
  });

  it('warns on a body-only bot view served from the CDN cache, with a caveat', async () => {
    botAnswers(STREAMED_HTML, { headers: new Headers({ 'x-vercel-cache': 'HIT' }) });
    const findings = await auditStreamedMetadata(makeCtx());
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      code: 'METADATA_NOT_IN_HEAD',
      severity: 'warning',
      details: { botRequest: 'cached', botCache: 'HIT' },
    });
    expect(findings[0].explanation).toMatch(
      /served from the CDN cache; the entry may have been filled by a browser request, re-run after it expires to confirm/,
    );
    expect(findings[0].explanation).not.toMatch(/whatever the user agent/);
  });

  it('treats a STALE bot response like a HIT', async () => {
    botAnswers(STREAMED_HTML, { headers: new Headers({ 'x-vercel-cache': 'stale' }) });
    const findings = await auditStreamedMetadata(makeCtx());
    expect(findings[0]).toMatchObject({
      code: 'METADATA_NOT_IN_HEAD',
      severity: 'warning',
      details: { botRequest: 'cached', botCache: 'STALE' },
    });
  });

  it('reports info when a cached bot copy has the tags in <head>', async () => {
    botAnswers(HEAD_HTML, { headers: new Headers({ 'x-vercel-cache': 'HIT' }) });
    const findings = await auditStreamedMetadata(makeCtx());
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      code: 'METADATA_STREAMED_TO_BODY',
      severity: 'info',
      details: { botRequest: 'cached', botCache: 'HIT', missing: [] },
    });
  });

  it('keeps the warning when the cached bot response is a MISS', async () => {
    botAnswers(STREAMED_HTML, { headers: new Headers({ 'x-vercel-cache': 'MISS' }) });
    const findings = await auditStreamedMetadata(makeCtx());
    expect(findings[0]).toMatchObject({ code: 'METADATA_NOT_IN_HEAD', severity: 'warning' });
  });

  // A bot challenge: 200, same URL, its own <title> in <head>, no Next.js in sight.
  const WAF_HTML = '<html><head><title>Just a moment...</title></head><body><p>Checking your browser</p></body></html>';

  it.each([
    ['the request throws', () => mockFetchPage.mockRejectedValue(new Error('timeout')), { reason: 'error' }],
    ['the bot gets a non-2xx', () => botAnswers(HEAD_HTML, { status: 403 }), { reason: 'status', botStatus: 403 }],
    [
      'the bot is redirected',
      () => botAnswers(HEAD_HTML, { finalUrl: 'https://example.com/challenge' }),
      { reason: 'redirected', botStatus: 200, botFinalUrl: 'https://example.com/challenge' },
    ],
    [
      'the bot gets a page that is not Next.js',
      () => botAnswers(WAF_HTML, { headers: new Headers({ server: 'cloudflare' }) }),
      { reason: 'not-nextjs', botStatus: 200, botFinalUrl: URL_ },
    ],
  ])('reports info with botRequest failed when %s', async (_, arrange, expected) => {
    arrange();
    const findings = await auditStreamedMetadata(makeCtx());
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      code: 'METADATA_STREAMED_TO_BODY',
      severity: 'info',
      details: { bodyOnly: ['title', 'description', 'canonical', 'og:title'], botRequest: 'failed', ...expected },
    });
    expect(findings[0].details).not.toHaveProperty('botHead');
    expect(findings[0].message).toMatch(/could not be confirmed/);
  });

  it('skips when the configured user agent is already an HTML-limited bot', async () => {
    const findings = await auditStreamedMetadata(
      makeCtx({ fetchOptions: { userAgent: 'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)' } }),
    );
    expect(findings).toEqual([]);
    expect(mockFetchPage).not.toHaveBeenCalled();
  });

  it('skips with the bingbot preset', async () => {
    const findings = await auditStreamedMetadata(makeCtx({ fetchOptions: { userAgent: USER_AGENT_PRESETS.bingbot } }));
    expect(findings).toEqual([]);
    expect(mockFetchPage).not.toHaveBeenCalled();
  });

  it('still probes with the googlebot preset, which Next.js streams to', async () => {
    const findings = await auditStreamedMetadata(makeCtx({ fetchOptions: { userAgent: USER_AGENT_PRESETS.googlebot } }));
    expect(mockFetchPage).toHaveBeenCalledTimes(1);
    expect(findings).toHaveLength(1);
  });
});
