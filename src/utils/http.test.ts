import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { FetchCache } from '../types.js';
import { fetchPage, fetchHead, fetchWithoutRedirect, followRedirectChain } from './http.js';

const mockFetch = vi.fn<typeof fetch>();

function response(status: number, body = '', headers: Record<string, string> = {}): Response {
  return new Response(body, { status, headers });
}

function requestedUrls(): string[] {
  return mockFetch.mock.calls.map(([input]) => String(input));
}

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
  mockFetch.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchPage', () => {
  it('returns the body of a direct 200 with a single request', async () => {
    mockFetch.mockResolvedValueOnce(response(200, '<html>ok</html>', { 'x-test': '1' }));

    const page = await fetchPage('https://example.com/');

    expect(page).toMatchObject({ body: '<html>ok</html>', status: 200, finalUrl: 'https://example.com/' });
    expect(page.headers.get('x-test')).toBe('1');
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][1]).toMatchObject({ redirect: 'manual' });
  });

  it('walks a redirect chain and reads the last hop without a second GET', async () => {
    mockFetch
      .mockResolvedValueOnce(response(301, '', { location: '/landing' }))
      .mockResolvedValueOnce(response(200, '<html>landing</html>'));

    const page = await fetchPage('https://example.com/');

    expect(page.body).toBe('<html>landing</html>');
    expect(page.finalUrl).toBe('https://example.com/landing');
    expect(requestedUrls()).toEqual(['https://example.com/', 'https://example.com/landing']);
  });

  it('falls back to a follow GET when the last hop body was already consumed', async () => {
    const cache: FetchCache = new Map();
    mockFetch
      .mockResolvedValueOnce(response(302, '', { location: '/b' }))
      .mockResolvedValueOnce(response(200, '<html>b</html>'))
      .mockResolvedValueOnce(response(200, '<html>b again</html>'));

    await fetchPage('https://example.com/a', { cache });
    const again = await fetchPage('https://example.com/b', { cache });

    expect(again.body).toBe('<html>b again</html>');
    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(mockFetch.mock.calls[2][1]).toMatchObject({ redirect: 'follow' });
  });

  it('gives up on a body that never finishes', async () => {
    const stalled = new Response(new ReadableStream({ start() {} }), { status: 200 });
    mockFetch.mockResolvedValueOnce(stalled);

    await expect(fetchPage('https://example.com/', { timeout: 20 })).rejects.toThrow(/Timed out/);
  });
});

describe('per-audit cache', () => {
  it('serves repeated fetchPage calls from one request', async () => {
    const cache: FetchCache = new Map();
    mockFetch.mockResolvedValue(response(200, '<html>ok</html>'));

    const first = await fetchPage('https://example.com/', { cache });
    const second = await fetchPage('https://example.com/', { cache });

    expect(second).toBe(first);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('shares one manual request between followRedirectChain and fetchPage', async () => {
    const cache: FetchCache = new Map();
    mockFetch.mockResolvedValue(response(200, '<xml/>'));

    const chain = await followRedirectChain('https://example.com/sitemap.xml', { cache });
    const page = await fetchPage('https://example.com/sitemap.xml', { cache });

    expect(chain.hops).toEqual([]);
    expect(page.body).toBe('<xml/>');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('dedupes fetchHead and fetchWithoutRedirect but keeps methods apart', async () => {
    const cache: FetchCache = new Map();
    mockFetch.mockImplementation(async () => response(200));

    await fetchHead('https://example.com/a.png', { cache });
    await fetchHead('https://example.com/a.png', { cache });
    await fetchWithoutRedirect('https://example.com/a.png', { cache });
    await fetchWithoutRedirect('https://example.com/a.png', { cache });

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls[0][1]).toMatchObject({ method: 'HEAD' });
    expect(mockFetch.mock.calls[1][1]).toMatchObject({ redirect: 'manual' });
  });

  it('joins concurrent callers onto the same in-flight request', async () => {
    const cache: FetchCache = new Map();
    mockFetch.mockImplementation(async () => response(200));

    await Promise.all([
      fetchHead('https://example.com/', { cache }),
      fetchHead('https://example.com/', { cache }),
      fetchHead('https://example.com/', { cache }),
    ]);

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('forgets a failed request so the next caller retries', async () => {
    const cache: FetchCache = new Map();
    mockFetch
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValueOnce(response(200));

    await expect(fetchHead('https://example.com/', { cache })).rejects.toThrow('ECONNRESET');
    const second = await fetchHead('https://example.com/', { cache });

    expect(second.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(cache.size).toBe(1);
  });

  it('does nothing without a cache', async () => {
    mockFetch.mockImplementation(async () => response(200));

    await fetchHead('https://example.com/');
    await fetchHead('https://example.com/');

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
