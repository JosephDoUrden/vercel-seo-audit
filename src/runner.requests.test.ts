import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { runAudit } from './runner.js';

// A small Next.js-like site served from 127.0.0.1. Every request is counted by
// method and path so the test can assert how many round trips one audit costs.
// Before the shared fetch a single-URL audit made 34 requests, 19 of them for
// the page itself.

let server: Server;
let origin = '';
const counts = new Map<string, number>();
let flakyHits = 0;

function page(withMarkers: boolean): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Harness</title>
  <meta name="description" content="Request count harness">
  <link rel="canonical" href="${origin}/">
  <link rel="icon" href="/favicon.ico">
  <meta property="og:title" content="Harness">
  <meta property="og:description" content="Request count harness">
  <meta property="og:image" content="${origin}/og.png">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:image" content="${origin}/og.png">
  <script type="application/ld+json">{"@context":"https://schema.org","@type":"WebSite","name":"Harness","url":"${origin}/"}</script>
</head>
<body>
  <div${withMarkers ? ' id="__next"' : ''}><img src="${origin}/hero.png" alt="Hero" width="800" height="600"></div>
  ${withMarkers ? '<script src="/_next/static/chunks/main.js" defer></script>' : ''}
</body>
</html>`;
}

function snapshot(): { total: number; byPath: Record<string, number> } {
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  const byPath = Object.fromEntries([...counts.entries()].sort());
  return { total, byPath };
}

beforeAll(async () => {
  server = createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
    const key = `${req.method} ${path}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);

    const send = (status: number, type: string, body: string) => {
      res.writeHead(status, {
        'content-type': type,
        'content-length': Buffer.byteLength(body),
        'x-powered-by': 'Next.js',
      });
      res.end(req.method === 'HEAD' ? undefined : body);
    };

    switch (path) {
      case '/':
        return send(200, 'text/html; charset=utf-8', page(true));
      case '/plain':
        return send(200, 'text/html; charset=utf-8', page(false));
      case '/flaky':
        // First GET fails, every later one serves the page.
        if (req.method === 'GET' && flakyHits++ === 0) {
          return send(500, 'text/plain', 'boom');
        }
        return send(200, 'text/html; charset=utf-8', page(true));
      case '/robots.txt':
        return send(200, 'text/plain', `User-agent: *\nAllow: /\nSitemap: ${origin}/sitemap.xml\n`);
      case '/sitemap.xml':
        return send(
          200,
          'application/xml',
          `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${origin}/</loc></url></urlset>`,
        );
      case '/favicon.ico':
        return send(200, 'image/x-icon', 'icon');
      case '/hero.png':
      case '/og.png':
        return send(200, 'image/png', 'x'.repeat(1000));
      default:
        return send(404, 'text/plain', 'not found');
    }
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  origin = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
});

beforeEach(() => {
  counts.clear();
  flakyHits = 0;
});

describe('request count for a single-URL audit', () => {
  it('fetches the page once and shares it across modules', async () => {
    const report = await runAudit(`${origin}/`, { timeout: 5000 });
    const { total, byPath } = snapshot();

    expect(report.modules.map((m) => m.module)).toContain('metadata');

    // The page itself: one GET, reused by every module and by the redirect
    // chain and trailing-slash probes that hit the same URL.
    expect(byPath['GET /']).toBe(1);
    // robots.txt and sitemap.xml are read once each.
    expect(byPath['GET /robots.txt']).toBe(1);
    expect(byPath['GET /sitemap.xml']).toBe(1);
    // og:image and twitter:image point at the same file: one HEAD.
    expect(byPath['HEAD /og.png']).toBe(1);
    // Four common-page probes are separate URLs and stay.
    expect(byPath['GET /about']).toBe(1);

    // 11 on a clean run; a little headroom for platform differences.
    expect(total).toBeLessThanOrEqual(12);
  });

  it('reports APP_ROUTER_METADATA from the shared HTML when Next.js markers are absent', async () => {
    const report = await runAudit(`${origin}/plain`, { timeout: 5000 });
    const nextjs = report.modules.find((m) => m.module === 'nextjs');
    const finding = nextjs?.findings.find((f) => f.code === 'APP_ROUTER_METADATA');

    expect(finding).toBeDefined();
    expect(finding).toMatchObject({ severity: 'info', category: 'nextjs', url: `${origin}/plain` });
  });

  it('does not share a non-2xx first response with the modules', async () => {
    const report = await runAudit(`${origin}/flaky`, { timeout: 5000 });
    const metadata = report.modules.find((m) => m.module === 'metadata');
    const codes = metadata?.findings.map((f) => f.code) ?? [];

    // The 500 is retried, not analysed: the modules see the real page.
    expect(counts.get('GET /flaky')).toBe(2);
    expect(codes).not.toContain('TITLE_MISSING');
    expect(codes).not.toContain('DESCRIPTION_MISSING');
    expect(codes).not.toContain('CANONICAL_MISSING');
  });

  it('does not report APP_ROUTER_METADATA when the markers are present', async () => {
    const report = await runAudit(`${origin}/`, { timeout: 5000 });
    const nextjs = report.modules.find((m) => m.module === 'nextjs');

    expect(nextjs?.findings.find((f) => f.code === 'APP_ROUTER_METADATA')).toBeUndefined();
  });
});
