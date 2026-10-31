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
  isPrivateAddress,
  reachesPrivateAddress,
  isSameHost,
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

describe('isPrivateAddress', () => {
  // Hostnames as new URL() hands them over, so the odd IPv4 spellings arrive normalised.
  const host = (url: string) => new URL(url).hostname;

  it.each([
    'http://127.0.0.1/',
    'http://127.8.9.10/',
    'http://10.0.0.1/',
    'http://172.16.0.1/',
    'http://172.31.255.255/',
    'http://192.168.1.1/',
    'http://169.254.169.254/latest/meta-data/',
    'http://100.64.0.1/',
    'http://0.0.0.0/',
    'http://2130706433/',
    'http://0x7f.1/',
    'http://localhost:3000/',
    'http://app.localhost/',
    'http://[::1]/',
    'http://[::]/',
    'http://[fd00:ec2::254]/',
    'http://[fc00::1]/',
    'http://[fe80::1]/',
    'http://[::ffff:127.0.0.1]/',
    'http://[::ffff:a9fe:a9fe]/',
  ])('flags %s', (url) => {
    expect(isPrivateAddress(host(url))).toBe(true);
  });

  it.each([
    'https://example.com/',
    'http://8.8.8.8/',
    'http://172.15.0.1/',
    'http://172.32.0.1/',
    'http://100.128.0.1/',
    'http://169.255.0.1/',
    'http://[2606:4700::1111]/',
    'http://[::ffff:8.8.8.8]/',
    'http://10.example.com/',
  ])('leaves %s alone', (url) => {
    expect(isPrivateAddress(host(url))).toBe(false);
  });
});

describe('reachesPrivateAddress', () => {
  it('refuses a private address reached from a public site', () => {
    expect(reachesPrivateAddress('http://169.254.169.254/', 'https://example.com/')).toBe(true);
  });

  it('allows a private address when the audit itself targets one', () => {
    expect(reachesPrivateAddress('http://127.0.0.1:3000/a', 'http://localhost:3000/')).toBe(false);
  });

  it('allows public addresses', () => {
    expect(reachesPrivateAddress('https://cdn.example.net/x.png', 'https://example.com/')).toBe(false);
  });

  it('does not flag a URL it cannot parse', () => {
    expect(reachesPrivateAddress('not a url', 'https://example.com/')).toBe(false);
  });
});

describe('isSameHost', () => {
  it('ignores the scheme', () => {
    expect(isSameHost('http://example.com/a', 'https://example.com/b')).toBe(true);
  });

  it('ignores case and default ports', () => {
    expect(isSameHost('https://EXAMPLE.com:443/', 'https://example.com/')).toBe(true);
  });

  it('tells subdomains and ports apart', () => {
    expect(isSameHost('https://www.example.com/', 'https://example.com/')).toBe(false);
    expect(isSameHost('https://example.com:8443/', 'https://example.com/')).toBe(false);
  });

  it('is false for a URL it cannot parse', () => {
    expect(isSameHost('nope', 'https://example.com/')).toBe(false);
  });
});
