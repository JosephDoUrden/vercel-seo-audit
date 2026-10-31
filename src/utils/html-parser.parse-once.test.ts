import { describe, it, expect, vi, beforeEach } from 'vitest';

// The real cheerio, with load counted.
vi.mock('cheerio', async (importOriginal) => {
  const real = await importOriginal<typeof import('cheerio')>();
  return { ...real, load: vi.fn(real.load) };
});

import * as cheerio from 'cheerio';
import { getTitle, getCanonicalUrl, getMetaTag, getNoindexDirective } from './html-parser.js';

const load = vi.mocked(cheerio.load);

beforeEach(() => {
  load.mockClear();
});

describe('html-parser', () => {
  it('parses one page once, however many helpers read it', () => {
    const html = '<html><head><title>T</title><link rel="canonical" href="https://example.com/"><meta name="description" content="D"></head></html>';

    expect(getTitle(html)).toBe('T');
    expect(getCanonicalUrl(html)).toBe('https://example.com/');
    expect(getMetaTag(html, 'description')).toBe('D');
    expect(getNoindexDirective(html)).toBe(false);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('parses a different page afresh', () => {
    expect(getTitle('<title>A</title>')).toBe('A');
    expect(getTitle('<title>B</title>')).toBe('B');
    expect(load).toHaveBeenCalledTimes(2);
  });
});
