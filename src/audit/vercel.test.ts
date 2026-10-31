import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AuditContext } from '../types.js';
import { auditVercel } from './vercel.js';

vi.mock('../utils/http.js', () => ({
  fetchPage: vi.fn(),
}));

import { fetchPage } from '../utils/http.js';
const mockFetchPage = vi.mocked(fetchPage);

type Page = Awaited<ReturnType<typeof fetchPage>>;

function page(headers: Record<string, string>, overrides: Partial<Page> = {}): Page {
  return { body: '', status: 200, headers: new Headers(headers), finalUrl: 'https://example.com/', ...overrides };
}

// The re-request on a MISS answers MISS again unless a test says otherwise, so the cases
// below that start from a MISS describe a page that really is not being cached.
function secondRequest(headers: Record<string, string>, overrides: Partial<Page> = {}) {
  mockFetchPage.mockImplementation(async (url) => page(headers, { finalUrl: url, ...overrides }));
}

beforeEach(() => {
  vi.resetAllMocks();
  secondRequest({ server: 'Vercel', 'x-vercel-cache': 'MISS' });
});

function makeCtx(overrides: Partial<AuditContext> = {}): AuditContext {
  return {
    url: 'https://example.com',
    normalizedUrl: 'https://example.com/',
    fetchOptions: {},
    verbose: false,
    ...overrides,
  };
}

// What a cached page on a custom domain looks like from the client side:
// Vercel has consumed s-maxage and sends its default cache-control back.
const VERCEL_HIT: Record<string, string> = {
  server: 'Vercel',
  'x-vercel-id': 'lhr1::abc12-1700000000000-0123456789ab',
  'x-vercel-cache': 'HIT',
  'cache-control': 'public, max-age=0, must-revalidate',
};

const codes = (findings: { code: string }[]) => findings.map((f) => f.code);

describe('auditVercel', () => {
  describe('detection', () => {
    it('returns no findings when phase 0 did not produce headers', async () => {
      const findings = await auditVercel(makeCtx({ headers: undefined }));
      expect(findings).toHaveLength(0);
    });

    it('reports NOT_ON_VERCEL once and nothing else when no Vercel signal is present', async () => {
      const findings = await auditVercel(
        makeCtx({ headers: { server: 'nginx', 'x-vercel-cache': 'MISS', 'cache-control': 'public' } }),
      );
      expect(codes(findings)).toEqual(['NOT_ON_VERCEL']);
      expect(findings[0].severity).toBe('info');
      expect(findings[0].category).toBe('vercel');
    });

    it('treats x-vercel-id alone as a Vercel signal', async () => {
      const findings = await auditVercel(
        makeCtx({ headers: { 'x-vercel-id': 'fra1::x', 'x-vercel-cache': 'MISS', 'cache-control': 'public, max-age=0' } }),
      );
      expect(codes(findings)).not.toContain('NOT_ON_VERCEL');
      expect(codes(findings)).toContain('VERCEL_CACHE_MISS');
    });

    it('matches the server header case-insensitively', async () => {
      const findings = await auditVercel(makeCtx({ headers: { server: 'vercel', 'x-vercel-cache': 'STALE' } }));
      expect(codes(findings)).toEqual(['VERCEL_CACHE_STALE']);
    });

    it('is quiet on a cached page served from a custom domain', async () => {
      const findings = await auditVercel(makeCtx({ headers: VERCEL_HIT }));
      expect(findings).toHaveLength(0);
    });

    it('tags every finding with the vercel category and the audited url', async () => {
      const findings = await auditVercel(
        makeCtx({
          headers: { ...VERCEL_HIT, 'x-vercel-cache': 'MISS', 'cdn-cache-control': 's-maxage=10' },
          finalUrl: 'https://app-git-feature-team.vercel.app/',
        }),
      );
      expect(findings.length).toBeGreaterThan(2);
      for (const f of findings) {
        expect(f.category).toBe('vercel');
        expect(f.url).toBe('https://app-git-feature-team.vercel.app/');
      }
    });
  });

  describe('x-vercel-cache', () => {
    it('reports VERCEL_CACHE_MISS as info with the header values in details', async () => {
      const headers = { ...VERCEL_HIT, 'x-vercel-cache': 'MISS' };
      const findings = await auditVercel(makeCtx({ headers }));
      const miss = findings.find((f) => f.code === 'VERCEL_CACHE_MISS');
      expect(miss).toBeDefined();
      expect(miss!.severity).toBe('info');
      expect(miss!.details).toMatchObject({
        xVercelCache: 'MISS',
        cacheControl: 'public, max-age=0, must-revalidate',
      });
    });

    it('reads the cache status case-insensitively', async () => {
      const findings = await auditVercel(makeCtx({ headers: { ...VERCEL_HIT, 'x-vercel-cache': 'miss' } }));
      expect(codes(findings)).toContain('VERCEL_CACHE_MISS');
    });

    it('reports VERCEL_CACHE_STALE as info', async () => {
      const findings = await auditVercel(makeCtx({ headers: { ...VERCEL_HIT, 'x-vercel-cache': 'STALE' } }));
      const stale = findings.find((f) => f.code === 'VERCEL_CACHE_STALE');
      expect(stale).toBeDefined();
      expect(stale!.severity).toBe('info');
      expect(stale!.details).toMatchObject({ xVercelCache: 'STALE' });
    });

    it.each(['HIT', 'PRERENDER', 'REVALIDATED'])('says nothing about a %s', async (status) => {
      const findings = await auditVercel(makeCtx({ headers: { ...VERCEL_HIT, 'x-vercel-cache': status } }));
      expect(findings).toHaveLength(0);
    });

    it('reports a BYPASS as info only', async () => {
      const findings = await auditVercel(makeCtx({ headers: { ...VERCEL_HIT, 'x-vercel-cache': 'BYPASS' } }));
      expect(codes(findings)).toEqual(['VERCEL_CACHE_BYPASS']);
      expect(findings[0].severity).toBe('info');
      expect(findings[0].details).toMatchObject({ xVercelCache: 'BYPASS' });
    });

    it('says nothing about a BYPASS on a response that sets a cookie', async () => {
      const headers = { ...VERCEL_HIT, 'x-vercel-cache': 'BYPASS', 'set-cookie': 'session=abc; Path=/' };
      expect(await auditVercel(makeCtx({ headers }))).toHaveLength(0);
    });

    it('reports no miss on a BYPASS', async () => {
      const findings = await auditVercel(makeCtx({ headers: { ...VERCEL_HIT, 'x-vercel-cache': 'BYPASS' } }));
      expect(codes(findings)).not.toContain('VERCEL_CACHE_MISS');
      expect(codes(findings)).not.toContain('VERCEL_CACHE_STALE');
      expect(codes(findings)).not.toContain('VERCEL_CACHE_CONTROL_MISSING');
    });

    it('does not report a miss when the response sets a cookie', async () => {
      const headers = { ...VERCEL_HIT, 'x-vercel-cache': 'MISS', 'set-cookie': 'session=abc; Path=/' };
      const findings = await auditVercel(makeCtx({ headers }));
      expect(findings).toHaveLength(0);
    });

    it.each(['private, max-age=0', 'no-store', 'no-cache, max-age=0', 'Private, No-Store'])(
      'does not report a miss when cache-control is "%s"',
      async (cc) => {
        const headers = { ...VERCEL_HIT, 'x-vercel-cache': 'MISS', 'cache-control': cc };
        const findings = await auditVercel(makeCtx({ headers }));
        expect(findings).toHaveLength(0);
      },
    );

    it('does not report a miss when Vary is *', async () => {
      const headers = { ...VERCEL_HIT, 'x-vercel-cache': 'MISS', vary: '*' };
      const findings = await auditVercel(makeCtx({ headers }));
      expect(findings).toHaveLength(0);
    });

    it('judges storability from cdn-cache-control alone when it is present', async () => {
      // Browser told not to store, CDN told to cache: a documented Vercel pattern.
      const headers = { ...VERCEL_HIT, 'x-vercel-cache': 'MISS', 'cache-control': 'no-store', 'cdn-cache-control': 's-maxage=30' };
      const findings = await auditVercel(makeCtx({ headers }));
      expect(codes(findings)).toContain('VERCEL_CACHE_MISS');
      expect(codes(findings)).toContain('VERCEL_S_MAXAGE_SHORT');
      expect(codes(findings)).not.toContain('VERCEL_CACHE_CONTROL_MISSING');
    });

    it('still honours set-cookie and Vary: * when cdn-cache-control is present', async () => {
      const base = { ...VERCEL_HIT, 'x-vercel-cache': 'MISS', 'cdn-cache-control': 's-maxage=30' };
      expect(await auditVercel(makeCtx({ headers: { ...base, 'set-cookie': 'a=b' } }))).toHaveLength(0);
      expect(await auditVercel(makeCtx({ headers: { ...base, vary: '*' } }))).toHaveLength(0);
    });

    it('does not report a miss when cdn-cache-control opts out', async () => {
      const headers = { ...VERCEL_HIT, 'x-vercel-cache': 'MISS', 'cdn-cache-control': 'no-store' };
      const findings = await auditVercel(makeCtx({ headers }));
      expect(findings).toHaveLength(0);
    });
  });

  describe('cache-control directives', () => {
    it('reports a page that missed the cache twice and sends no cache-control at all', async () => {
      const { 'cache-control': _, ...rest } = VERCEL_HIT;
      const findings = await auditVercel(makeCtx({ headers: { ...rest, 'x-vercel-cache': 'MISS' } }));
      const f = findings.find((x) => x.code === 'VERCEL_CACHE_CONTROL_MISSING');
      expect(f).toBeDefined();
      expect(f!.severity).toBe('info');
    });

    it('warns when cdn-cache-control is visible but carries no lifetime', async () => {
      const headers = { ...VERCEL_HIT, 'x-vercel-cache': 'MISS', 'cdn-cache-control': 'public' };
      const findings = await auditVercel(makeCtx({ headers }));
      expect(codes(findings)).toContain('VERCEL_CACHE_CONTROL_MISSING');
    });

    it('warns on the default cache-control after a miss, naming the lifetime not the header', async () => {
      const findings = await auditVercel(makeCtx({ headers: { ...VERCEL_HIT, 'x-vercel-cache': 'MISS' } }));
      const f = findings.find((x) => x.code === 'VERCEL_CACHE_CONTROL_MISSING');
      expect(f).toBeDefined();
      expect(f!.message).toMatch(/no CDN lifetime/i);
      expect(f!.message).not.toMatch(/no cache-control header/i);
    });

    it('names the header that is present when only cdn-cache-control lacks a lifetime', async () => {
      const { 'cache-control': _, ...rest } = VERCEL_HIT;
      const findings = await auditVercel(makeCtx({ headers: { ...rest, 'x-vercel-cache': 'MISS', 'cdn-cache-control': 'no-transform' } }));
      const f = findings.find((x) => x.code === 'VERCEL_CACHE_CONTROL_MISSING');
      expect(f!.message).toMatch(/no CDN lifetime in cdn-cache-control/i);
      expect(f!.message).not.toMatch(/in cache-control/i);
    });

    it('warns on an empty cache-control after a miss', async () => {
      const findings = await auditVercel(makeCtx({ headers: { ...VERCEL_HIT, 'x-vercel-cache': 'MISS', 'cache-control': '' } }));
      expect(codes(findings)).toContain('VERCEL_CACHE_CONTROL_MISSING');
    });

    it('does not warn about a missing header when cdn-cache-control carries the lifetime', async () => {
      const { 'cache-control': _, ...rest } = VERCEL_HIT;
      const findings = await auditVercel(
        makeCtx({ headers: { ...rest, 'x-vercel-cache': 'MISS', 'cdn-cache-control': 'max-age=600, stale-while-revalidate=60' } }),
      );
      expect(codes(findings)).toEqual(['VERCEL_CACHE_MISS']);
    });

    it('does not warn when a lifetime is visible in cdn-cache-control', async () => {
      const headers = { ...VERCEL_HIT, 'x-vercel-cache': 'MISS', 'cdn-cache-control': 'max-age=86400, stale-while-revalidate=60' };
      const findings = await auditVercel(makeCtx({ headers }));
      expect(codes(findings)).toEqual(['VERCEL_CACHE_MISS']);
    });

    it('does not warn about missing cache-control on a HIT', async () => {
      const { 'cache-control': _, ...rest } = VERCEL_HIT;
      const findings = await auditVercel(makeCtx({ headers: rest }));
      expect(findings).toHaveLength(0);
    });

    it('reports a short s-maxage from cdn-cache-control', async () => {
      const headers = { ...VERCEL_HIT, 'cdn-cache-control': 's-maxage=1, stale-while-revalidate=59' };
      const findings = await auditVercel(makeCtx({ headers }));
      const f = findings.find((x) => x.code === 'VERCEL_S_MAXAGE_SHORT');
      expect(f).toBeDefined();
      expect(f!.severity).toBe('info');
      expect(f!.details).toMatchObject({ lifetime: 1, directive: 's-maxage', source: 'cdn-cache-control', floor: 60 });
      expect(codes(findings)).not.toContain('VERCEL_SWR_MISSING');
    });

    it('takes max-age from cdn-cache-control when s-maxage is absent and says so in details', async () => {
      const headers = { ...VERCEL_HIT, 'cdn-cache-control': 'max-age=30' };
      const findings = await auditVercel(makeCtx({ headers }));
      const short = findings.find((x) => x.code === 'VERCEL_S_MAXAGE_SHORT');
      expect(short!.details).toMatchObject({ lifetime: 30, directive: 'max-age', source: 'cdn-cache-control' });
      const swr = findings.find((x) => x.code === 'VERCEL_SWR_MISSING');
      expect(swr!.details).toMatchObject({ lifetime: 30, directive: 'max-age', source: 'cdn-cache-control' });
    });

    it('names cache-control as the source when the lifetime came from it', async () => {
      const headers = { ...VERCEL_HIT, 'cache-control': 'public, s-maxage=30' };
      const findings = await auditVercel(makeCtx({ headers }));
      const short = findings.find((x) => x.code === 'VERCEL_S_MAXAGE_SHORT');
      expect(short!.details).toMatchObject({ lifetime: 30, directive: 's-maxage', source: 'cache-control' });
    });

    it('reports a short s-maxage when cache-control reaches the client with it', async () => {
      const headers = { ...VERCEL_HIT, 'cache-control': 'public, s-maxage=10' };
      const findings = await auditVercel(makeCtx({ headers }));
      expect(codes(findings)).toContain('VERCEL_S_MAXAGE_SHORT');
    });

    it('ignores s-maxage in cache-control when cdn-cache-control overrides it', async () => {
      const headers = { ...VERCEL_HIT, 'cache-control': 'public, s-maxage=10', 'cdn-cache-control': 'public' };
      const findings = await auditVercel(makeCtx({ headers }));
      expect(codes(findings)).not.toContain('VERCEL_S_MAXAGE_SHORT');
    });

    it('prefers cdn-cache-control over cache-control for the lifetime', async () => {
      const headers = { ...VERCEL_HIT, 'cache-control': 's-maxage=10', 'cdn-cache-control': 's-maxage=3600, stale-while-revalidate=60' };
      const findings = await auditVercel(makeCtx({ headers }));
      expect(findings).toHaveLength(0);
    });

    it('accepts an s-maxage at the floor', async () => {
      const headers = { ...VERCEL_HIT, 'cdn-cache-control': 's-maxage=60, stale-while-revalidate=600' };
      const findings = await auditVercel(makeCtx({ headers }));
      expect(findings).toHaveLength(0);
    });

    it('reports a missing stale-while-revalidate when a lifetime is visible', async () => {
      const headers = { ...VERCEL_HIT, 'cdn-cache-control': 's-maxage=86400' };
      const findings = await auditVercel(makeCtx({ headers }));
      const f = findings.find((x) => x.code === 'VERCEL_SWR_MISSING');
      expect(f).toBeDefined();
      expect(f!.severity).toBe('info');
      expect(codes(findings)).not.toContain('VERCEL_S_MAXAGE_SHORT');
    });

    it('says nothing about lifetimes when no directive is visible', async () => {
      const findings = await auditVercel(makeCtx({ headers: VERCEL_HIT }));
      expect(findings).toHaveLength(0);
    });

    it('ignores stale-while-revalidate in cache-control when cdn-cache-control is present', async () => {
      const headers = { ...VERCEL_HIT, 'cdn-cache-control': 's-maxage=30', 'cache-control': 'public, stale-while-revalidate=600' };
      const findings = await auditVercel(makeCtx({ headers }));
      expect(codes(findings)).toContain('VERCEL_SWR_MISSING');
    });

    it('treats s-maxage=0 as deliberately uncached', async () => {
      const headers = { ...VERCEL_HIT, 'x-vercel-cache': 'MISS', 'cdn-cache-control': 's-maxage=0' };
      const findings = await auditVercel(makeCtx({ headers }));
      expect(codes(findings)).toEqual(['VERCEL_CACHE_MISS']);
    });

    it('counts a bare stale-while-revalidate as present', async () => {
      const headers = { ...VERCEL_HIT, 'cdn-cache-control': 's-maxage=3600, stale-while-revalidate' };
      const findings = await auditVercel(makeCtx({ headers }));
      expect(codes(findings)).not.toContain('VERCEL_SWR_MISSING');
    });

    it('parses whitespace around the equals sign', async () => {
      const headers = { ...VERCEL_HIT, 'cdn-cache-control': 's-maxage = 10 , stale-while-revalidate = 59' };
      const findings = await auditVercel(makeCtx({ headers }));
      const short = findings.find((x) => x.code === 'VERCEL_S_MAXAGE_SHORT');
      expect(short!.details).toMatchObject({ lifetime: 10 });
      expect(codes(findings)).not.toContain('VERCEL_SWR_MISSING');
    });

    it('ignores a non-numeric s-maxage', async () => {
      const headers = { ...VERCEL_HIT, 'cdn-cache-control': 's-maxage=abc' };
      const findings = await auditVercel(makeCtx({ headers }));
      expect(codes(findings)).not.toContain('VERCEL_S_MAXAGE_SHORT');
    });
  });

  describe('second request on a MISS', () => {
    const MISS = { ...VERCEL_HIT, 'x-vercel-cache': 'MISS' };

    it.each(['HIT', 'STALE', 'PRERENDER', 'REVALIDATED', 'BYPASS', ''])(
      'makes no second request when the first answer is %s',
      async (status) => {
        await auditVercel(makeCtx({ headers: { ...VERCEL_HIT, 'x-vercel-cache': status } }));
        expect(mockFetchPage).not.toHaveBeenCalled();
      },
    );

    it('a lower-case miss still triggers the recheck', async () => {
      await auditVercel(makeCtx({ headers: { ...VERCEL_HIT, 'x-vercel-cache': 'miss' } }));
      expect(mockFetchPage).toHaveBeenCalledTimes(1);
    });

    it('says nothing when the second response turns out to be personalised', async () => {
      secondRequest({ ...VERCEL_HIT, 'cdn-cache-control': 's-maxage=10', 'set-cookie': 'session=abc; Path=/' });
      const findings = await auditVercel(makeCtx({ headers: MISS }));
      expect(findings).toHaveLength(0);
    });

    it('makes no second request on a personalised page', async () => {
      await auditVercel(makeCtx({ headers: { ...MISS, 'set-cookie': 'a=b' } }));
      await auditVercel(makeCtx({ headers: { ...MISS, 'cache-control': 'private' } }));
      await auditVercel(makeCtx({ headers: { ...MISS, vary: '*' } }));
      expect(mockFetchPage).not.toHaveBeenCalled();
    });

    it('makes no second request off Vercel', async () => {
      await auditVercel(makeCtx({ headers: { server: 'nginx', 'x-vercel-cache': 'MISS' } }));
      expect(mockFetchPage).not.toHaveBeenCalled();
    });

    it('asks once more for the final url with the audit options and without the shared cache', async () => {
      secondRequest({ ...VERCEL_HIT });
      const ctx = makeCtx({
        headers: MISS,
        finalUrl: 'https://www.example.com/en',
        fetchOptions: { timeout: 5000, userAgent: 'Googlebot', cache: new Map() },
      });
      await auditVercel(ctx);
      expect(mockFetchPage).toHaveBeenCalledTimes(1);
      expect(mockFetchPage).toHaveBeenCalledWith('https://www.example.com/en', { timeout: 5000, userAgent: 'Googlebot' });
      expect(mockFetchPage.mock.calls[0][1]).not.toHaveProperty('cache');
    });

    it.each(['HIT', 'PRERENDER', 'REVALIDATED'])('treats MISS then %s as a cold miss and says nothing', async (status) => {
      const { 'cache-control': _, ...rest } = VERCEL_HIT;
      secondRequest({ ...VERCEL_HIT, 'x-vercel-cache': status });
      const findings = await auditVercel(makeCtx({ headers: { ...rest, 'x-vercel-cache': 'MISS' } }));
      expect(findings).toHaveLength(0);
    });

    it('reads the lifetime from the second response after a cold miss', async () => {
      secondRequest({ ...VERCEL_HIT, 'cdn-cache-control': 's-maxage=10' });
      const findings = await auditVercel(makeCtx({ headers: MISS }));
      expect(codes(findings)).toEqual(['VERCEL_S_MAXAGE_SHORT', 'VERCEL_SWR_MISSING']);
      expect(findings[0].details).toMatchObject({ xVercelCache: 'HIT', firstRequest: 'MISS', secondRequest: 'HIT', lifetime: 10 });
    });

    it('reports VERCEL_CACHE_STALE from the second response', async () => {
      secondRequest({ ...VERCEL_HIT, 'x-vercel-cache': 'STALE' });
      const findings = await auditVercel(makeCtx({ headers: MISS }));
      expect(codes(findings)).toEqual(['VERCEL_CACHE_STALE']);
      expect(findings[0].details).toMatchObject({ xVercelCache: 'STALE', firstRequest: 'MISS', secondRequest: 'STALE' });
    });

    it('reports VERCEL_CACHE_BYPASS when the second request bypasses the cache', async () => {
      secondRequest({ ...VERCEL_HIT, 'x-vercel-cache': 'BYPASS' });
      const findings = await auditVercel(makeCtx({ headers: MISS }));
      expect(codes(findings)).toEqual(['VERCEL_CACHE_BYPASS']);
      expect(findings[0].severity).toBe('info');
      expect(findings[0].details).toMatchObject({ firstRequest: 'MISS', secondRequest: 'BYPASS' });
    });

    it('reports two misses as info and says so in the text', async () => {
      const findings = await auditVercel(makeCtx({ headers: MISS }));
      expect(codes(findings)).toEqual(['VERCEL_CACHE_MISS', 'VERCEL_CACHE_CONTROL_MISSING']);
      for (const f of findings) {
        expect(f.severity).toBe('info');
        expect(f.details).toMatchObject({ xVercelCache: 'MISS', firstRequest: 'MISS', secondRequest: 'MISS' });
        expect(`${f.message} ${f.explanation} ${f.suggestion}`).not.toMatch(/run the audit again|second run/i);
      }
      expect(findings[0].message).toMatch(/two requests/i);
      expect(findings[1].message).toMatch(/twice/i);
    });

    const failures: [string, () => void][] = [
      ['throws', () => mockFetchPage.mockRejectedValue(new Error('timeout'))],
      ['answers 503', () => secondRequest(MISS, { status: 503 })],
      ['is redirected elsewhere', () => secondRequest(MISS, { finalUrl: 'https://example.com/login' })],
      ['returns headers that cannot be read', () => mockFetchPage.mockResolvedValue({ status: 200, finalUrl: 'https://example.com/' } as unknown as Page)],
      ['answers without x-vercel-cache', () => secondRequest({ server: 'Vercel' })],
    ];

    it.each(failures)('keeps the first-response findings when the second request %s', async (_, arrange) => {
      arrange();
      const { 'cache-control': _cc, ...rest } = VERCEL_HIT;
      const findings = await auditVercel(
        makeCtx({ headers: { ...rest, 'x-vercel-cache': 'MISS' }, finalUrl: 'https://app-git-feature-team.vercel.app/' }),
      );
      expect(codes(findings)).toEqual(['VERCEL_PREVIEW_INDEXABLE', 'VERCEL_CACHE_MISS', 'VERCEL_CACHE_CONTROL_MISSING']);
      const control = findings.find((f) => f.code === 'VERCEL_CACHE_CONTROL_MISSING')!;
      expect(control.severity).toBe('info');
      expect(findings.find((f) => f.code === 'VERCEL_CACHE_MISS')!.suggestion).toMatch(/run the audit again/i);
      for (const f of findings.slice(1)) {
        expect(f.details).toMatchObject({ xVercelCache: 'MISS', firstRequest: 'MISS', secondRequest: 'failed' });
      }
    });
  });

  describe('preview deployments', () => {
    const noindexHtml = '<html><head><meta name="robots" content="noindex, nofollow"></head></html>';

    it('errors on an indexable branch preview url', async () => {
      const findings = await auditVercel(
        makeCtx({ headers: VERCEL_HIT, finalUrl: 'https://my-app-git-feature-x-acme.vercel.app/' }),
      );
      const f = findings.find((x) => x.code === 'VERCEL_PREVIEW_INDEXABLE');
      expect(f).toBeDefined();
      expect(f!.severity).toBe('error');
      expect(f!.details).toMatchObject({ host: 'my-app-git-feature-x-acme.vercel.app' });
    });

    it('warns on any other indexable vercel.app host', async () => {
      const findings = await auditVercel(
        makeCtx({ headers: VERCEL_HIT, finalUrl: 'https://my-app-abc123def-acme.vercel.app/' }),
      );
      const f = findings.find((x) => x.code === 'VERCEL_PREVIEW_INDEXABLE');
      expect(f).toBeDefined();
      expect(f!.severity).toBe('warning');
    });

    it('is satisfied by the x-robots-tag noindex header', async () => {
      const findings = await auditVercel(
        makeCtx({
          headers: { ...VERCEL_HIT, 'x-robots-tag': 'noindex' },
          finalUrl: 'https://my-app-git-feature-acme.vercel.app/',
        }),
      );
      expect(codes(findings)).not.toContain('VERCEL_PREVIEW_INDEXABLE');
    });

    it('treats x-robots-tag: none as noindex', async () => {
      const findings = await auditVercel(
        makeCtx({ headers: { ...VERCEL_HIT, 'x-robots-tag': 'none' }, finalUrl: 'https://my-app-git-feature-acme.vercel.app/' }),
      );
      expect(codes(findings)).not.toContain('VERCEL_PREVIEW_INDEXABLE');
    });

    it('does not treat nonexistent directive text as noindex', async () => {
      const findings = await auditVercel(
        makeCtx({ headers: { ...VERCEL_HIT, 'x-robots-tag': 'nonexistent' }, finalUrl: 'https://my-app-git-feature-acme.vercel.app/' }),
      );
      expect(codes(findings)).toContain('VERCEL_PREVIEW_INDEXABLE');
    });

    it('is satisfied by an upper-case robots meta noindex', async () => {
      const findings = await auditVercel(
        makeCtx({
          headers: VERCEL_HIT,
          html: '<html><head><meta name="ROBOTS" content="NOINDEX"></head></html>',
          finalUrl: 'https://my-app-git-feature-acme.vercel.app/',
        }),
      );
      expect(codes(findings)).not.toContain('VERCEL_PREVIEW_INDEXABLE');
    });

    it('does not read a commit url of a project named with git as a branch preview', async () => {
      const findings = await auditVercel(
        makeCtx({ headers: VERCEL_HIT, finalUrl: 'https://my-git-tools-a1b2c3d4e-acme.vercel.app/' }),
      );
      const f = findings.find((x) => x.code === 'VERCEL_PREVIEW_INDEXABLE');
      expect(f).toBeDefined();
      expect(f!.severity).toBe('warning');
    });

    it('still reads a branch named with nine plain letters as a preview', async () => {
      const findings = await auditVercel(
        makeCtx({ headers: VERCEL_HIT, finalUrl: 'https://app-git-mybranchx-acme.vercel.app/' }),
      );
      expect(findings.find((x) => x.code === 'VERCEL_PREVIEW_INDEXABLE')!.severity).toBe('error');
    });

    it.each(['git-feature-acme.vercel.app', 'app-git-acme.vercel.app', 'app-git-.vercel.app'])(
      'does not read %s as a branch preview',
      async (host) => {
        const findings = await auditVercel(makeCtx({ headers: VERCEL_HIT, finalUrl: `https://${host}/` }));
        const f = findings.find((x) => x.code === 'VERCEL_PREVIEW_INDEXABLE');
        expect(f!.severity).toBe('warning');
      },
    );

    it('is satisfied by a robots meta noindex in the html', async () => {
      const findings = await auditVercel(
        makeCtx({ headers: VERCEL_HIT, html: noindexHtml, finalUrl: 'https://my-app-git-feature-acme.vercel.app/' }),
      );
      expect(codes(findings)).not.toContain('VERCEL_PREVIEW_INDEXABLE');
    });

    it('ignores custom domains', async () => {
      const findings = await auditVercel(makeCtx({ headers: VERCEL_HIT, finalUrl: 'https://www.example.com/' }));
      expect(codes(findings)).not.toContain('VERCEL_PREVIEW_INDEXABLE');
    });

    it('does not match a look-alike domain', async () => {
      const findings = await auditVercel(makeCtx({ headers: VERCEL_HIT, finalUrl: 'https://notvercel.app/' }));
      expect(codes(findings)).not.toContain('VERCEL_PREVIEW_INDEXABLE');
    });

    it('falls back to the normalised url when there is no final url', async () => {
      const findings = await auditVercel(
        makeCtx({ headers: VERCEL_HIT, normalizedUrl: 'https://my-app-git-main-acme.vercel.app/', finalUrl: undefined }),
      );
      expect(codes(findings)).toContain('VERCEL_PREVIEW_INDEXABLE');
    });
  });

  // Phase 0 shares only a 2xx page, so a challenged entry page reaches the module as no headers.
  describe('edge challenge', () => {
    const challenged = (headers: Record<string, string>, status = 403) =>
      mockFetchPage.mockResolvedValue(page(headers, { status, body: '<html>challenge</html>' }));

    it('reports a Vercel challenge on the entry page', async () => {
      challenged({ server: 'Vercel', 'x-vercel-id': 'fra1::x', 'x-vercel-mitigated': 'challenge' });
      const findings = await auditVercel(makeCtx({ headers: undefined }));
      expect(codes(findings)).toEqual(['EDGE_CHALLENGE']);
      expect(findings[0].severity).toBe('error');
      expect(findings[0].category).toBe('vercel');
      expect(findings[0].message).toContain('as an unverified client');
      expect(findings[0].details).toEqual({ status: 403, provider: 'vercel', header: 'x-vercel-mitigated' });
      expect(findings[0].url).toBe('https://example.com/');
    });

    it('reports a Cloudflare challenge on the entry page', async () => {
      challenged({ server: 'cloudflare', 'cf-mitigated': 'challenge' }, 503);
      const findings = await auditVercel(makeCtx({ headers: undefined }));
      expect(codes(findings)).toEqual(['EDGE_CHALLENGE']);
      expect(findings[0].details).toEqual({ status: 503, provider: 'cloudflare', header: 'cf-mitigated' });
    });

    it('says nothing about a 403 without a challenge header', async () => {
      challenged({ server: 'Vercel', 'x-vercel-id': 'fra1::x' });
      const findings = await auditVercel(makeCtx({ headers: undefined }));
      expect(findings).toHaveLength(0);
    });

    it('says nothing when the second request fails', async () => {
      mockFetchPage.mockRejectedValue(new Error('Network error'));
      const findings = await auditVercel(makeCtx({ headers: undefined }));
      expect(findings).toHaveLength(0);
    });
  });
});
