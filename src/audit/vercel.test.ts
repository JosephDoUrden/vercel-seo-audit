import { describe, it, expect } from 'vitest';
import type { AuditContext } from '../types.js';
import { auditVercel } from './vercel.js';

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

    it.each(['HIT', 'PRERENDER', 'REVALIDATED', 'BYPASS'])('says nothing about a %s', async (status) => {
      const findings = await auditVercel(makeCtx({ headers: { ...VERCEL_HIT, 'x-vercel-cache': status } }));
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

    it('does not report a miss when cdn-cache-control opts out', async () => {
      const headers = { ...VERCEL_HIT, 'x-vercel-cache': 'MISS', 'cdn-cache-control': 'no-store' };
      const findings = await auditVercel(makeCtx({ headers }));
      expect(findings).toHaveLength(0);
    });
  });

  describe('cache-control directives', () => {
    it('warns when the page missed the cache and sends no cache-control at all', async () => {
      const { 'cache-control': _, ...rest } = VERCEL_HIT;
      const findings = await auditVercel(makeCtx({ headers: { ...rest, 'x-vercel-cache': 'MISS' } }));
      const f = findings.find((x) => x.code === 'VERCEL_CACHE_CONTROL_MISSING');
      expect(f).toBeDefined();
      expect(f!.severity).toBe('warning');
    });

    it('warns when cdn-cache-control is visible but carries no lifetime', async () => {
      const headers = { ...VERCEL_HIT, 'x-vercel-cache': 'MISS', 'cdn-cache-control': 'public' };
      const findings = await auditVercel(makeCtx({ headers }));
      expect(codes(findings)).toContain('VERCEL_CACHE_CONTROL_MISSING');
    });

    it('does not warn on the ambiguous default cache-control after a miss', async () => {
      // Vercel strips s-maxage before the client sees it, so this could be a cold miss.
      const findings = await auditVercel(makeCtx({ headers: { ...VERCEL_HIT, 'x-vercel-cache': 'MISS' } }));
      expect(codes(findings)).toEqual(['VERCEL_CACHE_MISS']);
    });

    it('does not warn when a lifetime is visible', async () => {
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
      expect(f!.details).toMatchObject({ sMaxage: 1, floor: 60 });
      expect(codes(findings)).not.toContain('VERCEL_SWR_MISSING');
    });

    it('takes max-age from cdn-cache-control when s-maxage is absent', async () => {
      const headers = { ...VERCEL_HIT, 'cdn-cache-control': 'max-age=30' };
      const findings = await auditVercel(makeCtx({ headers }));
      expect(codes(findings)).toContain('VERCEL_S_MAXAGE_SHORT');
      expect(codes(findings)).toContain('VERCEL_SWR_MISSING');
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

    it('ignores a non-numeric s-maxage', async () => {
      const headers = { ...VERCEL_HIT, 'cdn-cache-control': 's-maxage=abc' };
      const findings = await auditVercel(makeCtx({ headers }));
      expect(codes(findings)).not.toContain('VERCEL_S_MAXAGE_SHORT');
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
});
