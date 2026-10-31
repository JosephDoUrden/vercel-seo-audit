import { describe, it, expect } from 'vitest';
import { responseTooLarge } from './tooLarge.js';
import { MAX_HTML_BYTES, MAX_SITEMAP_BYTES } from '../constants.js';

describe('responseTooLarge', () => {
  it('cites the 50 MB sitemap limit for a sitemap', () => {
    const f = responseTooLarge('https://example.com/sitemap.xml', 'sitemap', new Headers(), 'sitemap');

    expect(f.details).toEqual({ bytes: null, limit: MAX_SITEMAP_BYTES });
    expect(f.message).toContain('50 MB');
    expect(f.explanation).toMatch(/sitemap/i);
    expect(f.explanation).not.toMatch(/2 ?MB/);
  });

  it("cites Googlebot's 2 MB HTML cut-off for a page, without talking about sitemaps", () => {
    const f = responseTooLarge('https://example.com/', 'performance', new Headers({ 'content-length': '314572800' }), 'html');

    expect(f.details).toEqual({ bytes: 314572800, limit: MAX_HTML_BYTES });
    expect(f.message).toContain('10 MiB');
    expect(f.explanation).toContain('2 MB');
    expect(f.explanation).not.toMatch(/sitemap/i);
  });

  it('defaults to the HTML wording', () => {
    expect(responseTooLarge('https://example.com/', 'crawl', new Headers()).details).toEqual({
      bytes: null,
      limit: MAX_HTML_BYTES,
    });
  });

  it('names the cap a caller set in place of the default', () => {
    const mib = responseTooLarge('https://example.com/', 'performance', new Headers(), 'html', 2 * 1024 * 1024);
    const odd = responseTooLarge('https://example.com/', 'performance', new Headers(), 'html', 500_000);

    expect(mib.details).toEqual({ bytes: null, limit: 2 * 1024 * 1024 });
    expect(mib.message).toContain('larger than 2 MiB');
    expect(odd.message).toContain('larger than 500,000 bytes');
    expect(odd.explanation).toContain('first 500,000 bytes were read');
  });

  it("is info, not a warning, when the cap was the caller's and below the default", () => {
    const lowered = responseTooLarge('https://example.com/', 'performance', new Headers(), 'html', 500_000);
    const defaulted = responseTooLarge('https://example.com/', 'performance', new Headers(), 'html');

    expect(lowered.severity).toBe('info');
    expect(lowered.explanation).toMatch(/cap set by the caller/);
    expect(defaulted.severity).toBe('warning');
    expect(defaulted.explanation).not.toMatch(/caller/);
  });
});
