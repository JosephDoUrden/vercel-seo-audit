import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AuditContext } from '../types.js';
import { auditHostLeak } from './hostLeak.js';

vi.mock('../utils/http.js', () => ({
  fetchPage: vi.fn(),
  fetchHead: vi.fn(),
}));

import { fetchPage, fetchHead } from '../utils/http.js';

beforeEach(() => {
  vi.resetAllMocks();
});

function makeCtx(head: string, overrides: Partial<AuditContext> = {}): AuditContext {
  return {
    url: 'https://example.com',
    normalizedUrl: 'https://example.com/',
    fetchOptions: {},
    verbose: false,
    html: `<html><head>${head}</head><body></body></html>`,
    ...overrides,
  };
}

function jsonld(data: unknown): string {
  return `<script type="application/ld+json">${JSON.stringify(data)}</script>`;
}

const codes = (findings: { code: string }[]) => findings.map((f) => f.code);

describe('auditHostLeak', () => {
  it('returns nothing and fetches nothing when phase 0 left no HTML', async () => {
    const findings = await auditHostLeak(makeCtx('', { html: undefined }));
    expect(findings).toEqual([]);
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it('reports a localhost canonical as an error', async () => {
    const findings = await auditHostLeak(makeCtx('<link rel="canonical" href="http://localhost:3000/">'));
    expect(codes(findings)).toEqual(['URL_HOST_LOCALHOST']);
    expect(findings[0].severity).toBe('error');
    expect(findings[0].details).toEqual({
      count: 1,
      occurrences: [{ tag: 'canonical', url: 'http://localhost:3000/', host: 'localhost' }],
    });
    expect(fetchPage).not.toHaveBeenCalled();
    expect(fetchHead).not.toHaveBeenCalled();
  });

  it('treats 127.0.0.1, 0.0.0.0 and .local names as local too', async () => {
    const findings = await auditHostLeak(
      makeCtx(
        '<meta property="og:image" content="http://127.0.0.1/og.png">' +
          '<meta name="twitter:image" content="http://0.0.0.0:3000/tw.png">' +
          '<link rel="alternate" hreflang="de" href="http://my-mac.local/de">',
      ),
    );
    expect(codes(findings)).toEqual(['URL_HOST_LOCALHOST']);
    expect(findings[0].details).toMatchObject({ count: 3 });
  });

  it('reports a vercel.app og:image on a custom domain as a warning', async () => {
    const findings = await auditHostLeak(
      makeCtx('<meta property="og:image" content="https://my-app-abc123.vercel.app/og.png">'),
    );
    expect(codes(findings)).toEqual(['URL_HOST_VERCEL_APP']);
    expect(findings[0].severity).toBe('warning');
    expect(findings[0].details).toEqual({
      count: 1,
      occurrences: [
        { tag: 'og:image', url: 'https://my-app-abc123.vercel.app/og.png', host: 'my-app-abc123.vercel.app' },
      ],
    });
  });

  it('says nothing about a vercel.app og:image when the site itself is on vercel.app', async () => {
    const findings = await auditHostLeak(
      makeCtx('<meta property="og:image" content="https://my-app.vercel.app/og.png">', {
        url: 'https://my-app.vercel.app',
        normalizedUrl: 'https://my-app.vercel.app/',
      }),
    );
    expect(findings).toEqual([]);
  });

  it('treats www and apex as the same host, whatever the scheme', async () => {
    const findings = await auditHostLeak(
      makeCtx(
        '<link rel="canonical" href="http://www.example.com/">' +
          '<meta property="og:url" content="https://www.example.com/">' +
          '<meta property="og:image" content="/og.png">',
      ),
    );
    expect(findings).toEqual([]);
  });

  it('does not flag a JSON-LD image or logo on a CDN host', async () => {
    const findings = await auditHostLeak(
      makeCtx(
        jsonld({
          '@context': 'https://schema.org',
          '@type': 'Organization',
          url: 'https://example.com/',
          logo: 'https://cdn.example-assets.net/logo.png',
          image: ['https://images.ctfassets.net/a.png'],
        }),
      ),
    );
    expect(findings).toEqual([]);
  });

  it('finds vercel.app and localhost hosts in nested JSON-LD url, @id, image and logo values', async () => {
    const findings = await auditHostLeak(
      makeCtx(
        jsonld({
          '@context': 'https://schema.org',
          '@graph': [
            { '@type': 'WebSite', '@id': 'https://my-app.vercel.app/#site', url: 'https://my-app.vercel.app/' },
            { '@type': 'Organization', logo: { '@type': 'ImageObject', url: 'http://localhost:3000/logo.png' } },
          ],
        }),
      ),
    );
    expect(codes(findings)).toEqual(['URL_HOST_LOCALHOST', 'URL_HOST_VERCEL_APP']);
    expect(findings[1].details).toMatchObject({ count: 2 });
  });

  it('notes an og:url on another host as info, but not a canonical (CANONICAL_EXTERNAL covers it)', async () => {
    const findings = await auditHostLeak(
      makeCtx(
        '<link rel="canonical" href="https://other.com/">' +
          '<meta property="og:url" content="https://other.com/">' +
          '<meta property="og:image" content="https://other.com/og.png">',
      ),
    );
    expect(codes(findings)).toEqual(['URL_HOST_MISMATCH']);
    expect(findings[0].severity).toBe('info');
    expect(findings[0].details).toEqual({
      count: 1,
      occurrences: [{ tag: 'og:url', url: 'https://other.com/', host: 'other.com' }],
    });
  });

  it('counts the host the page redirected to as the site', async () => {
    const findings = await auditHostLeak(
      makeCtx('<meta property="og:url" content="https://example.co.uk/">', { finalUrl: 'https://example.co.uk/' }),
    );
    expect(findings).toEqual([]);
  });

  it('keeps at most ten occurrences but counts them all', async () => {
    const tags = Array.from(
      { length: 12 },
      (_, i) => `<meta property="og:image" content="http://localhost:3000/${i}.png">`,
    ).join('');
    const findings = await auditHostLeak(makeCtx(tags));
    const details = findings[0].details as { count: number; occurrences: unknown[] };
    expect(details.count).toBe(12);
    expect(details.occurrences).toHaveLength(10);
  });

  it('skips malformed JSON-LD and non-http URLs', async () => {
    const findings = await auditHostLeak(
      makeCtx(
        '<script type="application/ld+json">{ not json }</script>' +
          '<meta property="og:image" content="data:image/png;base64,AAAA">' +
          '<link rel="canonical" href="http://[bad">',
      ),
    );
    expect(findings).toEqual([]);
  });
});
