import { describe, it, expect } from 'vitest';
import {
  getCanonicalUrl,
  getNoindexDirective,
  getMetaRefresh,
  getMetaTag,
  getCharset,
  getViewport,
  getTitle,
  getFaviconLinks,
  getHreflangLinks,
} from './html-parser.js';

function html(head: string): string {
  return `<html><head>${head}</head><body></body></html>`;
}

describe('getCanonicalUrl', () => {
  it('returns canonical href', () => {
    expect(getCanonicalUrl(html('<link rel="canonical" href="https://example.com/">'))).toBe(
      'https://example.com/',
    );
  });

  it('returns null when no canonical tag', () => {
    expect(getCanonicalUrl(html(''))).toBeNull();
  });

  it('trims whitespace from href', () => {
    expect(getCanonicalUrl(html('<link rel="canonical" href="  https://example.com/  ">'))).toBe(
      'https://example.com/',
    );
  });

  it('returns null for empty href', () => {
    expect(getCanonicalUrl(html('<link rel="canonical" href="">'))).toBeNull();
  });
});

describe('getNoindexDirective', () => {
  it('detects noindex in robots meta', () => {
    expect(getNoindexDirective(html('<meta name="robots" content="noindex">'))).toBe(true);
  });

  it('detects noindex in googlebot meta', () => {
    expect(getNoindexDirective(html('<meta name="googlebot" content="noindex, nofollow">'))).toBe(
      true,
    );
  });

  it('returns false when no noindex', () => {
    expect(getNoindexDirective(html('<meta name="robots" content="index, follow">'))).toBe(false);
  });

  it('returns false when no robots meta', () => {
    expect(getNoindexDirective(html(''))).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(getNoindexDirective(html('<meta name="robots" content="NOINDEX">'))).toBe(true);
  });
});

describe('getMetaRefresh', () => {
  it('extracts refresh URL', () => {
    expect(
      getMetaRefresh(html('<meta http-equiv="refresh" content="0;url=https://example.com/new">')),
    ).toBe('https://example.com/new');
  });

  it('returns null when no refresh tag', () => {
    expect(getMetaRefresh(html(''))).toBeNull();
  });

  it('returns null when refresh has no URL', () => {
    expect(getMetaRefresh(html('<meta http-equiv="refresh" content="5">'))).toBeNull();
  });

  it('handles URL with quotes', () => {
    expect(
      getMetaRefresh(html('<meta http-equiv="refresh" content="0;url=\'https://example.com/\'">')),
    ).toBe('https://example.com/');
  });

  it('handles case-insensitive URL key', () => {
    expect(
      getMetaRefresh(html('<meta http-equiv="refresh" content="0;URL=https://example.com/">')),
    ).toBe('https://example.com/');
  });
});

describe('getMetaTag', () => {
  it('returns content by name attribute', () => {
    expect(getMetaTag(html('<meta name="description" content="Hello">'), 'description')).toBe(
      'Hello',
    );
  });

  it('returns content by property attribute (OG)', () => {
    expect(getMetaTag(html('<meta property="og:title" content="Title">'), 'og:title')).toBe(
      'Title',
    );
  });

  it('returns null when tag is missing', () => {
    expect(getMetaTag(html(''), 'description')).toBeNull();
  });

  it('returns null for empty content', () => {
    expect(getMetaTag(html('<meta name="description" content="">'), 'description')).toBeNull();
  });

  it('trims whitespace', () => {
    expect(getMetaTag(html('<meta name="description" content="  Hello  ">'), 'description')).toBe(
      'Hello',
    );
  });

  it('prefers name over property', () => {
    const h = html(
      '<meta name="description" content="ByName"><meta property="description" content="ByProp">',
    );
    expect(getMetaTag(h, 'description')).toBe('ByName');
  });
});

describe('getCharset', () => {
  it('returns charset from meta charset attribute', () => {
    expect(getCharset(html('<meta charset="utf-8">'))).toBe('utf-8');
  });

  it('returns charset from http-equiv Content-Type', () => {
    expect(
      getCharset(html('<meta http-equiv="Content-Type" content="text/html; charset=iso-8859-1">')),
    ).toBe('iso-8859-1');
  });

  it('returns null when no charset', () => {
    expect(getCharset(html(''))).toBeNull();
  });

  it('prefers meta charset over http-equiv', () => {
    const h = html(
      '<meta charset="utf-8"><meta http-equiv="Content-Type" content="text/html; charset=iso-8859-1">',
    );
    expect(getCharset(h)).toBe('utf-8');
  });
});

describe('getViewport', () => {
  it('returns viewport content', () => {
    expect(
      getViewport(html('<meta name="viewport" content="width=device-width, initial-scale=1">')),
    ).toBe('width=device-width, initial-scale=1');
  });

  it('returns null when missing', () => {
    expect(getViewport(html(''))).toBeNull();
  });

  it('trims whitespace', () => {
    expect(
      getViewport(html('<meta name="viewport" content="  width=device-width  ">')),
    ).toBe('width=device-width');
  });
});

describe('getTitle', () => {
  it('returns title text', () => {
    expect(getTitle(html('<title>Hello World</title>'))).toBe('Hello World');
  });

  it('returns null when no title tag', () => {
    expect(getTitle(html(''))).toBeNull();
  });

  it('returns null for empty title', () => {
    expect(getTitle(html('<title></title>'))).toBeNull();
  });

  it('trims whitespace', () => {
    expect(getTitle(html('<title>  Hello  </title>'))).toBe('Hello');
  });
});

describe('getFaviconLinks', () => {
  it('returns favicon links', () => {
    const links = getFaviconLinks(
      html('<link rel="icon" href="/favicon.ico" type="image/x-icon">'),
    );
    expect(links).toHaveLength(1);
    expect(links[0]).toEqual({
      rel: 'icon',
      href: '/favicon.ico',
      type: 'image/x-icon',
      sizes: undefined,
    });
  });

  it('finds shortcut icon', () => {
    const links = getFaviconLinks(html('<link rel="shortcut icon" href="/favicon.ico">'));
    expect(links).toHaveLength(1);
    expect(links[0].rel).toBe('shortcut icon');
  });

  it('finds apple-touch-icon', () => {
    const links = getFaviconLinks(
      html('<link rel="apple-touch-icon" href="/apple-icon.png" sizes="180x180">'),
    );
    expect(links).toHaveLength(1);
    expect(links[0].sizes).toBe('180x180');
  });

  it('returns empty array when no icons', () => {
    expect(getFaviconLinks(html(''))).toHaveLength(0);
  });

  it('skips links without href', () => {
    expect(getFaviconLinks(html('<link rel="icon">'))).toHaveLength(0);
  });

  it('finds multiple favicon links', () => {
    const h = html(
      '<link rel="icon" href="/favicon.ico"><link rel="icon" href="/favicon.png" sizes="32x32">',
    );
    expect(getFaviconLinks(h)).toHaveLength(2);
  });
});

describe('getHreflangLinks', () => {
  it('returns hreflang links', () => {
    const links = getHreflangLinks(
      html('<link rel="alternate" hreflang="en" href="https://example.com/en">'),
    );
    expect(links).toHaveLength(1);
    expect(links[0]).toEqual({ hreflang: 'en', href: 'https://example.com/en' });
  });

  it('returns empty array when none found', () => {
    expect(getHreflangLinks(html(''))).toHaveLength(0);
  });

  it('normalizes hreflang to lowercase', () => {
    const links = getHreflangLinks(
      html('<link rel="alternate" hreflang="EN-US" href="https://example.com/en-us">'),
    );
    expect(links[0].hreflang).toBe('en-us');
  });

  it('trims href whitespace', () => {
    const links = getHreflangLinks(
      html('<link rel="alternate" hreflang="en" href="  https://example.com/  ">'),
    );
    expect(links[0].href).toBe('https://example.com/');
  });

  it('skips links without hreflang attribute', () => {
    const links = getHreflangLinks(
      html('<link rel="alternate" href="https://example.com/feed.xml">'),
    );
    expect(links).toHaveLength(0);
  });

  it('skips links without href', () => {
    const links = getHreflangLinks(html('<link rel="alternate" hreflang="en">'));
    expect(links).toHaveLength(0);
  });
});
