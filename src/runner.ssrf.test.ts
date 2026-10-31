import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import dns from 'node:dns';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { runAudit } from './runner.js';

// A public site whose page, robots.txt and redirects point the audit at
// `internal.test`, a name that resolves to 127.0.0.1. The public site is served
// without a socket; every other request goes out through the real fetch, with
// `dns.lookup` answering for `.test` names, so the internal server counts every
// request that reaches it.

let internal: Server;
let port = 0;
let hits: string[] = [];

beforeAll(async () => {
  internal = createServer((req, res) => {
    hits.push(`${req.method} ${req.url}`);
    if (req.url === '/sitemap.xml') {
      res.writeHead(200, { 'content-type': 'application/xml' });
      return res.end(
        `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>http://internal.test:${port}/crawl-me</loc></url></urlset>`,
      );
    }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(
      `<html><head><title>INTERNAL token=s3cr3t</title><link rel="canonical" href="http://internal.test/leak-canonical"></head><body><h1>x</h1></body></html>`,
    );
  });
  await new Promise<void>((resolve) => internal.listen(0, '127.0.0.1', resolve));
  port = (internal.address() as AddressInfo).port;
});

afterAll(() => {
  internal.close();
});

function fakeLookup(hostname: string, options: unknown, callback?: unknown): void {
  const cb = (typeof options === 'function' ? options : callback) as (
    err: NodeJS.ErrnoException | null,
    address?: string | { address: string; family: number }[],
    family?: number,
  ) => void;
  const all = typeof options === 'object' && options !== null && (options as { all?: boolean }).all;
  process.nextTick(() => {
    if (hostname !== 'internal.test') {
      return cb(Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), { code: 'ENOTFOUND' }));
    }
    if (all) cb(null, [{ address: '127.0.0.1', family: 4 }]);
    else cb(null, '127.0.0.1', 4);
  });
}

function serve(mode: 'redirect' | 'page'): void {
  const I = `http://internal.test:${port}`;
  const real = globalThis.fetch;
  vi.stubGlobal('fetch', (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.hostname !== 'public.example') return real(input, init);
    const html = (body: string) => new Response(body, { status: 200, headers: { 'content-type': 'text/html' } });
    if (mode === 'redirect' && url.pathname === '/') {
      return Promise.resolve(new Response('', { status: 302, headers: { location: `${I}/secret` } }));
    }
    if (url.pathname === '/robots.txt') {
      return Promise.resolve(new Response(`User-agent: *\nAllow: /\nSitemap: ${I}/sitemap.xml\n`, { status: 200 }));
    }
    if (url.pathname === '/') {
      return Promise.resolve(
        html(
          `<!doctype html><html lang="en"><head><title>Pub</title><meta name="description" content="d">` +
            `<meta property="og:image" content="${I}/og.png"><link rel="alternate" hreflang="de" href="${I}/de">` +
            `<link rel="alternate" hreflang="en" href="https://public.example/"><link rel="icon" href="${I}/favicon.ico">` +
            `</head><body><h1>h</h1><img src="${I}/img.png" alt="a"></body></html>`,
        ),
      );
    }
    return Promise.resolve(new Response('', { status: 404 }));
  });
}

beforeEach(() => {
  hits = [];
  vi.spyOn(dns, 'lookup').mockImplementation(fakeLookup as unknown as typeof dns.lookup);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('a public site pointing the audit at a name that resolves to a private address', () => {
  it.each(['redirect', 'page'] as const)('never reaches it (%s)', async (mode) => {
    serve(mode);

    const report = await runAudit('https://public.example/', { timeout: 3000, crawl: 5 });

    expect(hits).toEqual([]);
    expect(JSON.stringify(report)).not.toMatch(/INTERNAL|s3cr3t|leak-canonical/);
  });
});

describe('auditing a name that resolves to a private address', () => {
  it('reports TARGET_PRIVATE_ADDRESS, not an unreachable site', async () => {
    const report = await runAudit(`http://internal.test:${port}/`, { timeout: 3000 });

    const findings = report.modules.find((m) => m.module === 'target')?.findings ?? [];
    expect(findings.map((f) => f.code)).toEqual(['TARGET_PRIVATE_ADDRESS']);
    expect(findings[0]).toMatchObject({ severity: 'error', details: { hostname: 'internal.test', address: '127.0.0.1' } });
    expect(findings[0].suggestion).toMatch(/--allow-private/);
    expect(hits).toEqual([]);
  });

  it('audits it with allowPrivate', async () => {
    const report = await runAudit(`http://internal.test:${port}/`, { timeout: 3000, allowPrivate: true, only: ['metadata'] });

    expect(report.page.status).toBe(200);
    expect(hits).toContain('GET /');
  });
});
