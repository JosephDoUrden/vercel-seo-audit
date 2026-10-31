import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import dns from 'node:dns';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ProxyAgent } from 'undici';
import { fetchHead, fetchPage, guardedLookup, PrivateAddressError } from './http.js';

// Names in `.test` answer from this table; anything else in `.test` does not
// exist. The real resolver is never asked, so nothing here leaves the machine.
// Every private answer is 127.0.0.1, where `internal` stands in for a service
// on the private network and counts what reaches it.
const PUBLIC = '93.184.215.14';
const table: Record<string, string[] | NodeJS.ErrnoException> = {
  'internal.test': ['127.0.0.1'],
  'internal6.test': ['::ffff:127.0.0.1'],
  'public.test': [PUBLIC],
  'mixed.test': [PUBLIC, '127.0.0.1'],
  'mixed-first.test': ['127.0.0.1', PUBLIC],
  'refused.test': Object.assign(new Error('queryA EREFUSED refused.test'), { code: 'EREFUSED' }),
};

type Answer = { address: string; family: number };

function fakeLookup(hostname: string, options: unknown, callback?: unknown): void {
  const cb = (typeof options === 'function' ? options : callback) as (
    err: NodeJS.ErrnoException | null,
    address?: string | Answer[],
    family?: number,
  ) => void;
  const all = typeof options === 'object' && options !== null && (options as { all?: boolean }).all;
  const entry =
    table[hostname] ?? Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), { code: 'ENOTFOUND' });
  process.nextTick(() => {
    if (entry instanceof Error) return cb(entry);
    const answers = entry.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
    if (all) cb(null, answers);
    else cb(null, answers[0].address, answers[0].family);
  });
}

let internal: Server;
let port = 0;
let hits: string[] = [];

beforeAll(async () => {
  internal = createServer((req, res) => {
    hits.push(`${req.method} ${req.headers.host}${req.url}`);
    res.writeHead(200, { 'content-type': 'text/html' }).end('<title>INTERNAL token=s3cr3t</title>');
  });
  await new Promise<void>((resolve) => internal.listen(0, '127.0.0.1', resolve));
  port = (internal.address() as AddressInfo).port;
});

afterAll(() => {
  internal.close();
});

beforeEach(() => {
  hits = [];
  // net.connect reads dns.lookup at call time, so this reaches the default
  // connector as well as the guard.
  vi.spyOn(dns, 'lookup').mockImplementation(fakeLookup as unknown as typeof dns.lookup);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const at = (host: string, path = '/') => `http://${host}:${port}${path}`;
const audit = { auditedUrl: 'https://public.example/', timeout: 3000 };

// The audited site itself is served without a socket; every other URL goes out
// through the real fetch with whatever dispatcher http.ts hands it.
function serveAuditedSite(routes: Record<string, () => Response>): void {
  const real = globalThis.fetch;
  vi.stubGlobal('fetch', (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.hostname !== 'public.example') return real(input, init);
    const route = routes[url.pathname];
    return Promise.resolve(route ? route() : new Response('', { status: 404 }));
  });
}

describe('names that resolve to a private address', () => {
  it('refuses a redirect from a public site to a name that resolves to loopback', async () => {
    serveAuditedSite({ '/': () => new Response('', { status: 302, headers: { location: at('internal.test', '/secret') } }) });

    const err = await fetchPage('https://public.example/', audit).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(PrivateAddressError);
    expect(String(err)).toMatch(/internal\.test resolves to the private address 127\.0\.0\.1/);
    expect(hits).toEqual([]);
  });

  it('refuses a sitemap URL on such a name', async () => {
    await expect(fetchPage(at('internal.test', '/sitemap.xml'), audit)).rejects.toBeInstanceOf(PrivateAddressError);
    expect(hits).toEqual([]);
  });

  it('refuses an og:image probe on such a name, IPv4-mapped IPv6 included', async () => {
    await expect(fetchHead(at('internal.test', '/og.png'), audit)).rejects.toBeInstanceOf(PrivateAddressError);
    await expect(fetchHead(at('internal6.test', '/og.png'), audit)).rejects.toBeInstanceOf(PrivateAddressError);
    expect(hits).toEqual([]);
  });

  it('refuses a name with any private answer, whatever the order', async () => {
    await expect(fetchHead(at('mixed.test'), audit)).rejects.toBeInstanceOf(PrivateAddressError);
    await expect(fetchHead(at('mixed-first.test'), audit)).rejects.toBeInstanceOf(PrivateAddressError);
    expect(hits).toEqual([]);
  });

  it('fails closed when the lookup itself fails', async () => {
    const err = await fetchHead(at('refused.test'), audit).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(Error);
    expect(String((err as Error).cause ?? err)).toMatch(/EREFUSED/);
    expect(hits).toEqual([]);
  });

  it('refuses a private literal on the fast path, before any request', async () => {
    const spy = vi.fn(globalThis.fetch);
    vi.stubGlobal('fetch', spy);

    await expect(fetchHead(`http://127.0.0.1:${port}/`, audit)).rejects.toBeInstanceOf(PrivateAddressError);
    expect(spy).not.toHaveBeenCalled();
    expect(hits).toEqual([]);
  });

  it('lets an audit of a private host reach names that resolve to private addresses', async () => {
    const page = await fetchPage(at('internal.test', '/home'), { auditedUrl: `http://localhost:${port}/`, timeout: 3000 });

    expect(page.body).toContain('INTERNAL');
    expect(hits).toEqual([`GET internal.test:${port}/home`]);
  });
});

describe('allowPrivate', () => {
  it('lets a public audit reach private names and literals when the caller allows it', async () => {
    const opts = { ...audit, allowPrivate: true };

    await expect(fetchPage(at('internal.test', '/a'), opts)).resolves.toMatchObject({ status: 200 });
    await expect(fetchHead(`http://127.0.0.1:${port}/b`, opts)).resolves.toMatchObject({ status: 200 });
    expect(hits).toEqual([`GET internal.test:${port}/a`, `HEAD 127.0.0.1:${port}/b`]);
  });
});

describe('a proxy set as the global dispatcher', () => {
  const key = Symbol.for('undici.globalDispatcher.1');
  const g = globalThis as unknown as Record<symbol, unknown>;
  let saved: unknown;

  beforeEach(() => {
    saved = g[key];
    g[key] = new ProxyAgent('http://proxy.test:3128');
  });

  afterEach(() => {
    g[key] = saved;
  });

  it('is refused with a clear error rather than bypassed', async () => {
    const spy = vi.fn(globalThis.fetch);
    vi.stubGlobal('fetch', spy);

    await expect(fetchPage('https://public.example/', audit)).rejects.toThrow(/proxy.*allowPrivate/i);
    expect(spy).not.toHaveBeenCalled();
  });

  it('is used as it is when the guard is off', async () => {
    const spy = vi.fn(async () => new Response('ok'));
    vi.stubGlobal('fetch', spy);

    await fetchPage('https://public.example/', { ...audit, allowPrivate: true });

    expect(spy.mock.calls[0][1]).not.toHaveProperty('dispatcher');
  });
});

describe('guardedLookup', () => {
  function lookup(host: string, all: boolean): Promise<{ err: NodeJS.ErrnoException | null; address?: unknown; family?: number }> {
    return new Promise((resolve) => {
      guardedLookup(host, { all }, (err, address, family) => resolve({ err, address, family }));
    });
  }

  it('hands back every public answer, in the shape asked for', async () => {
    await expect(lookup('public.test', true)).resolves.toEqual({ err: null, address: [{ address: PUBLIC, family: 4 }], family: undefined });
    await expect(lookup('public.test', false)).resolves.toEqual({ err: null, address: PUBLIC, family: 4 });
  });

  it('asks the resolver for every answer, unsorted', async () => {
    await lookup('public.test', false);

    expect(dns.lookup).toHaveBeenCalledWith('public.test', expect.objectContaining({ all: true, verbatim: true }), expect.any(Function));
  });

  it.each(['internal.test', 'internal6.test', 'mixed.test', 'mixed-first.test'])('rejects %s', async (host) => {
    const { err, address } = await lookup(host, true);

    expect(err).toBeInstanceOf(PrivateAddressError);
    expect((err as PrivateAddressError).hostname).toBe(host);
    expect(address).toBeUndefined();
  });

  it('passes a resolver failure on as an error, never an address', async () => {
    const { err, address } = await lookup('refused.test', true);

    expect(err?.code).toBe('EREFUSED');
    expect(address).toBeUndefined();
  });

  it('turns a resolver that throws into an error', async () => {
    vi.mocked(dns.lookup).mockImplementation(() => {
      throw new TypeError('bad hints');
    });

    const { err, address } = await lookup('public.test', true);

    expect(err).toBeInstanceOf(TypeError);
    expect(address).toBeUndefined();
  });
});
