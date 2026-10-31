import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { FetchCache } from '../types.js';
import { MAX_BODY_BYTES } from '../constants.js';
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

  it('reuses the page read through another URL that redirected to it', async () => {
    const cache: FetchCache = new Map();
    mockFetch
      .mockResolvedValueOnce(response(302, '', { location: '/b' }))
      .mockResolvedValueOnce(response(200, '<html>b</html>'));

    await fetchPage('https://example.com/a', { cache });
    const direct = await fetchPage('https://example.com/b', { cache });

    expect(direct.body).toBe('<html>b</html>');
    expect(direct.finalUrl).toBe('https://example.com/b');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('falls back to a follow GET when something else consumed the cached response', async () => {
    const cache: FetchCache = new Map();
    mockFetch
      .mockResolvedValueOnce(response(200, '<html>first</html>'))
      .mockResolvedValueOnce(response(200, '<html>again</html>'));

    const raw = await fetchWithoutRedirect('https://example.com/', { cache });
    await raw.text();
    const page = await fetchPage('https://example.com/', { cache });

    expect(page.body).toBe('<html>again</html>');
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls[1][1]).toMatchObject({ redirect: 'follow' });
  });

  it('gives up on a body that never finishes', async () => {
    const stalled = new Response(new ReadableStream({ start() {} }), { status: 200 });
    mockFetch.mockResolvedValueOnce(stalled);

    await expect(fetchPage('https://example.com/', { timeout: 20 })).rejects.toThrow(/Timed out/);
  });

  it('reads one body for redirect chains that converge on the same page', async () => {
    const cache: FetchCache = new Map();
    mockFetch.mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/tgt')) return response(200, '<html>tgt</html>');
      return response(302, '', { location: '/tgt' });
    });

    const pages = await Promise.all(
      Array.from({ length: 20 }, (_, i) => fetchPage(`https://example.com/s${i}`, { cache })),
    );

    expect(pages.every((p) => p.body === '<html>tgt</html>')).toBe(true);
    expect(pages.every((p) => p.finalUrl === 'https://example.com/tgt')).toBe(true);
    expect(requestedUrls().filter((u) => u.endsWith('/tgt'))).toHaveLength(1);
    expect(mockFetch).toHaveBeenCalledTimes(21);
  });
});

describe('fetchPage against a real socket', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('closes the connection when the body times out', async () => {
    const server = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html', 'content-length': 1000 });
      res.write('<html>');
      // Never ends.
    });
    const closed = new Promise<void>((resolve) => {
      server.once('connection', (socket) => socket.once('close', () => resolve()));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;

    try {
      await expect(
        fetchPage(`http://127.0.0.1:${port}/stall`, { timeout: 100 }),
      ).rejects.toThrow(/Timed out reading body/);

      await Promise.race([
        closed,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('socket still open 500ms after the timeout')), 500),
        ),
      ]);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe('fetchPage when the first hop is slow to answer', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports a timeout, not a bare abort, and does not retry once the deadline has passed', async () => {
    let requests = 0;
    const server = createServer((_req, res) => {
      requests++;
      // Headers arrive after the 100ms deadline.
      setTimeout(() => res.writeHead(200).end('late'), 400);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;

    try {
      const started = Date.now();
      await expect(
        fetchPage(`http://127.0.0.1:${port}/slow`, { timeout: 100 }),
      ).rejects.toThrow(/Timed out after 100 ms/);
      expect(Date.now() - started).toBeLessThan(350);
      expect(requests).toBe(1);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

// A fetch stand-in that answers after `delay` ms and rejects with the abort
// reason when its signal fires first, as undici does.
function delayed(delay: number, make: (url: string) => Response) {
  return (input: string | URL | Request, init?: RequestInit) =>
    new Promise<Response>((resolve, reject) => {
      const timer = setTimeout(() => resolve(make(String(input))), delay);
      init?.signal?.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(init.signal?.reason);
      });
    });
}

describe('fetchPage deadline', () => {
  it('spends one --timeout on the whole redirect chain, not one per hop', async () => {
    let hop = 0;
    mockFetch.mockImplementation(delayed(60, () => response(302, '', { location: `/hop${++hop}` })));

    const started = Date.now();
    await expect(fetchPage('https://example.com/', { timeout: 150 })).rejects.toThrow(
      /Timed out after 150 ms/,
    );

    expect(Date.now() - started).toBeLessThan(300);
    // 60 ms a hop against 150 ms in all: the third hop is cut off.
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('gives the body only what is left of the deadline', async () => {
    const stalled = new Response(new ReadableStream({ start() {} }), { status: 200 });
    mockFetch.mockImplementation(delayed(80, () => stalled));

    const started = Date.now();
    await expect(fetchPage('https://example.com/', { timeout: 120 })).rejects.toThrow(/Timed out reading body/);
    expect(Date.now() - started).toBeLessThan(200);
  });

  it('does not fall back to a second GET when the first hop fails', async () => {
    mockFetch.mockRejectedValue(new TypeError('fetch failed', { cause: new Error('getaddrinfo ENOTFOUND x.invalid') }));

    await expect(fetchPage('https://x.invalid/')).rejects.toThrow('fetch failed');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('keeps hop failures out of followRedirectChain, which reports what it walked', async () => {
    mockFetch
      .mockResolvedValueOnce(response(301, '', { location: '/next' }))
      .mockRejectedValueOnce(new Error('ECONNRESET'));

    const chain = await followRedirectChain('https://example.com/');

    expect(chain.hops).toHaveLength(1);
    expect(chain.finalUrl).toBe('https://example.com/next');
  });

  it('names the timeout on a HEAD that does not answer', async () => {
    mockFetch.mockImplementation(delayed(200, () => response(200)));

    await expect(fetchHead('https://example.com/a.png', { timeout: 30 })).rejects.toThrow(
      /Timed out after 30 ms/,
    );
  });
});

describe('redirects into a private network', () => {
  it('refuses a public site redirecting to the metadata address, without requesting it', async () => {
    mockFetch.mockResolvedValueOnce(response(302, '', { location: 'http://169.254.169.254/latest/meta-data/' }));

    await expect(fetchPage('https://example.com/')).rejects.toThrow(/private address 169\.254\.169\.254/);
    expect(requestedUrls()).toEqual(['https://example.com/']);
  });

  it('records the refused hop in followRedirectChain', async () => {
    mockFetch.mockResolvedValueOnce(response(301, '', { location: 'http://10.0.0.5/' }));

    const chain = await followRedirectChain('https://example.com/');

    expect(chain.hops).toEqual([{ url: 'https://example.com/', status: 301, location: 'http://10.0.0.5/' }]);
    expect(chain.finalUrl).toBe('http://10.0.0.5/');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('walks HEAD redirects itself and refuses one into a private network', async () => {
    mockFetch.mockResolvedValueOnce(response(302, '', { location: 'http://[::1]/admin' }));

    await expect(fetchHead('https://cdn.example.com/a.png')).rejects.toThrow(/private address \[::1\]/);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][1]).toMatchObject({ method: 'HEAD', redirect: 'manual' });
  });

  it('follows public HEAD redirects to the final status', async () => {
    mockFetch
      .mockResolvedValueOnce(response(301, '', { location: '/b.png' }))
      .mockResolvedValueOnce(response(200, '', { 'content-length': '42' }));

    const head = await fetchHead('https://cdn.example.com/a.png');

    expect(head.status).toBe(200);
    expect(head.headers.get('content-length')).toBe('42');
    expect(requestedUrls()).toEqual(['https://cdn.example.com/a.png', 'https://cdn.example.com/b.png']);
  });

  it('follows a local server redirecting within the private network', async () => {
    mockFetch
      .mockResolvedValueOnce(response(302, '', { location: 'http://127.0.0.1:3000/home' }))
      .mockResolvedValueOnce(response(200, '<html>home</html>'));

    const page = await fetchPage('http://localhost:3000/');

    expect(page.body).toBe('<html>home</html>');
  });
});

describe('fetchPage body cap', () => {
  it('stops reading at MAX_BODY_BYTES, marks the page truncated and closes the stream', async () => {
    const chunk = new Uint8Array(1024 * 1024).fill(0x61);
    let cancelled = false;
    let pulled = 0;
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled++;
        controller.enqueue(chunk);
      },
      cancel() {
        cancelled = true;
      },
    });
    mockFetch.mockResolvedValueOnce(new Response(endless, { status: 200, headers: { 'content-type': 'text/html' } }));

    const page = await fetchPage('https://example.com/');

    expect(page.body.length).toBe(MAX_BODY_BYTES);
    expect(page.truncated).toBe(true);
    expect(cancelled).toBe(true);
    expect(pulled).toBeLessThanOrEqual(MAX_BODY_BYTES / chunk.length + 2);
  });

  it('leaves a body under the cap alone', async () => {
    mockFetch.mockResolvedValueOnce(response(200, 'small'));

    const page = await fetchPage('https://example.com/');

    expect(page.body).toBe('small');
    expect(page.truncated).toBeUndefined();
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
