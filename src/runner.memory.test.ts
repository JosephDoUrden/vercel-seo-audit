import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

// The real cheerio, with load counted.
vi.mock('cheerio', async (importOriginal) => {
  const real = await importOriginal<typeof import('cheerio')>();
  return { ...real, load: vi.fn(real.load) };
});

import * as cheerio from 'cheerio';
import { runAudit } from './runner.js';

const load = vi.mocked(cheerio.load);

// A dynamic page: every response carries a fresh nonce, the way a server-rendered
// Next.js page does, so no two requests for it get the same body.
const MARKER = '<!-- audited page -->';
let served = 0;
let server: Server;
let origin = '';

function page(): string {
  served++;
  return `<!doctype html><html lang="en"><head><title>Dynamic</title><meta name="description" content="d">${MARKER}<meta name="nonce" content="${served}-${Math.random()}"></head><body><h1>Dynamic</h1>${'<p>filler text</p>'.repeat(200)}</body></html>`;
}

beforeAll(async () => {
  server = createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
    if (path === '/robots.txt') return res.writeHead(200, { 'content-type': 'text/plain' }).end('User-agent: *\nAllow: /\n');
    if (path !== '/') return res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(page());
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.close();
});

beforeEach(() => {
  load.mockClear();
  served = 0;
});

const parsesOfThePage = () => load.mock.calls.filter(([html]) => String(html).includes(MARKER)).length;

describe('parsing the audited page', () => {
  it('builds one document for it, however many modules and user-agent probes read it', async () => {
    await runAudit(`${origin}/`, { timeout: 5000 });

    // The page itself, the Vercel recheck, the streamed-metadata probe and three parity probes.
    expect(served).toBeGreaterThanOrEqual(4);
    expect(parsesOfThePage()).toBe(1);
  });
});

describe('maxHtmlBytes', () => {
  it('cuts the page at the cap the caller sets and says where', async () => {
    const report = await runAudit(`${origin}/`, { timeout: 5000, maxHtmlBytes: 1000, only: ['metadata'] });

    const target = report.modules.find((m) => m.module === 'target');
    const tooLarge = target?.findings.find((f) => f.code === 'RESPONSE_TOO_LARGE');
    expect(tooLarge?.details).toMatchObject({ limit: 1000 });
    expect(tooLarge?.message).toMatch(/larger than 1,000 bytes/);
    expect(load.mock.calls.every(([html]) => String(html).length <= 1000)).toBe(true);
  });

  it('leaves a page under the default 10 MiB cap whole', async () => {
    const report = await runAudit(`${origin}/`, { timeout: 5000, only: ['metadata'] });

    expect(report.modules.find((m) => m.module === 'target')).toBeUndefined();
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('rejects %s', async (maxHtmlBytes) => {
    await expect(runAudit(`${origin}/`, { maxHtmlBytes })).rejects.toThrow(RangeError);
    expect(served).toBe(0);
  });
});
