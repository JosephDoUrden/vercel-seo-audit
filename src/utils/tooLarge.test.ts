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
});
