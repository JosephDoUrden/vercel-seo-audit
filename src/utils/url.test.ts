import { describe, it, expect } from 'vitest';
import {
  normalizeUrl,
  hasTrailingSlash,
  addTrailingSlash,
  removeTrailingSlash,
  resolveUrl,
  isHttps,
  isSameOrigin,
  getOrigin,
  toHttpUrl,
} from './url.js';

describe('normalizeUrl', () => {
  it('adds https:// when no protocol is provided', () => {
    expect(normalizeUrl('example.com')).toBe('https://example.com/');
  });

  it('preserves existing https protocol', () => {
    expect(normalizeUrl('https://example.com')).toBe('https://example.com/');
  });

  it('preserves existing http protocol', () => {
    expect(normalizeUrl('http://example.com')).toBe('http://example.com/');
  });

  it('removes default https port 443', () => {
    expect(normalizeUrl('https://example.com:443')).toBe('https://example.com/');
  });

  it('removes default http port 80', () => {
    expect(normalizeUrl('http://example.com:80')).toBe('http://example.com/');
  });

  it('keeps non-default ports', () => {
    expect(normalizeUrl('https://example.com:8080')).toBe('https://example.com:8080/');
  });

  it('trims whitespace', () => {
    expect(normalizeUrl('  example.com  ')).toBe('https://example.com/');
  });

  it('preserves path', () => {
    expect(normalizeUrl('https://example.com/path/to/page')).toBe(
      'https://example.com/path/to/page',
    );
  });

  it('preserves query string', () => {
    expect(normalizeUrl('https://example.com/page?q=1')).toBe(
      'https://example.com/page?q=1',
    );
  });

  it('is case-insensitive for protocol detection', () => {
    expect(normalizeUrl('HTTPS://Example.com')).toBe('https://example.com/');
  });
});

describe('hasTrailingSlash', () => {
  it('returns true for URL with trailing slash', () => {
    expect(hasTrailingSlash('https://example.com/about/')).toBe(true);
  });

  it('returns false for URL without trailing slash', () => {
    expect(hasTrailingSlash('https://example.com/about')).toBe(false);
  });

  it('returns false for root path (single slash)', () => {
    expect(hasTrailingSlash('https://example.com/')).toBe(false);
  });
});

describe('addTrailingSlash', () => {
  it('adds trailing slash when missing', () => {
    expect(addTrailingSlash('https://example.com/about')).toBe(
      'https://example.com/about/',
    );
  });

  it('does not double-add trailing slash', () => {
    expect(addTrailingSlash('https://example.com/about/')).toBe(
      'https://example.com/about/',
    );
  });

  it('works on root URL', () => {
    expect(addTrailingSlash('https://example.com')).toBe('https://example.com/');
  });
});

describe('removeTrailingSlash', () => {
  it('removes trailing slash', () => {
    expect(removeTrailingSlash('https://example.com/about/')).toBe(
      'https://example.com/about',
    );
  });

  it('does not remove root slash', () => {
    expect(removeTrailingSlash('https://example.com/')).toBe('https://example.com/');
  });

  it('no-op when no trailing slash', () => {
    expect(removeTrailingSlash('https://example.com/about')).toBe(
      'https://example.com/about',
    );
  });
});

describe('resolveUrl', () => {
  it('resolves relative path against base', () => {
    expect(resolveUrl('https://example.com/page', '/other')).toBe(
      'https://example.com/other',
    );
  });

  it('resolves absolute URL unchanged', () => {
    expect(resolveUrl('https://example.com', 'https://other.com/page')).toBe(
      'https://other.com/page',
    );
  });

  it('resolves relative path with subdirectory', () => {
    expect(resolveUrl('https://example.com/a/b', '../c')).toBe(
      'https://example.com/c',
    );
  });
});

describe('isHttps', () => {
  it('returns true for https URL', () => {
    expect(isHttps('https://example.com')).toBe(true);
  });

  it('returns false for http URL', () => {
    expect(isHttps('http://example.com')).toBe(false);
  });
});

describe('isSameOrigin', () => {
  it('returns true for same origin', () => {
    expect(isSameOrigin('https://example.com/a', 'https://example.com/b')).toBe(true);
  });

  it('returns false for different domains', () => {
    expect(isSameOrigin('https://example.com', 'https://other.com')).toBe(false);
  });

  it('returns false for different protocols', () => {
    expect(isSameOrigin('https://example.com', 'http://example.com')).toBe(false);
  });

  it('returns false for different ports', () => {
    expect(isSameOrigin('https://example.com', 'https://example.com:8080')).toBe(false);
  });
});

describe('getOrigin', () => {
  it('returns origin without path', () => {
    expect(getOrigin('https://example.com/path')).toBe('https://example.com');
  });

  it('includes port in origin', () => {
    expect(getOrigin('https://example.com:8080/path')).toBe('https://example.com:8080');
  });
});

describe('toHttpUrl', () => {
  it('converts https to http', () => {
    expect(toHttpUrl('https://example.com/page')).toBe('http://example.com/page');
  });

  it('keeps http as http', () => {
    expect(toHttpUrl('http://example.com/page')).toBe('http://example.com/page');
  });
});
