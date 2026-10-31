import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The CLI is the only module that loads commander. If the entry point pulled it in,
// importing the package would parse argv and could exit the process.
vi.mock('commander', () => {
  throw new Error('the library entry point must not load commander');
});

import * as api from './index.js';
import { runAudit, formatAgent, getExitCode, VERSION, MODULE_IDS } from './index.js';
import type { AgentReport } from './index.js';
import { isPrivateAddress } from './utils/url.js';

const mockFetch = vi.fn<typeof fetch>();

// Serves the given URLs; everything else is a 404.
function site(routes: Record<string, () => Response>) {
  return async (input: string | URL | Request): Promise<Response> => {
    const href = new URL(input instanceof Request ? input.url : input).href;
    const route = routes[href];
    return route ? route() : new Response('not found', { status: 404, headers: { 'content-type': 'text/plain' } });
  };
}

const html = (body: string) => new Response(body, { status: 200, headers: { 'content-type': 'text/html' } });
const redirect = (location: string, status = 301) => new Response(null, { status, headers: { location } });

// Every host the audit asked for.
const requestedHosts = () =>
  mockFetch.mock.calls.map(([input]) => new URL(input instanceof Request ? input.url : input).hostname);

beforeEach(() => {
  mockFetch.mockReset();
  vi.stubGlobal('fetch', mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('package entry point', () => {
  it('exports the programmatic API and nothing from the CLI or the HTTP layer', () => {
    expect(Object.keys(api).sort()).toEqual([
      'ISSUE_CODES',
      'ISSUE_DESCRIPTIONS',
      'MODULE_IDS',
      'VERSION',
      'buildAgentReport',
      'describeCode',
      'diffReports',
      'formatAgent',
      'getExitCode',
      'runAudit',
    ]);
  });

  it('describes a code the way `explain` does', () => {
    expect(api.describeCode('TITLE_MISSING')).toMatchObject({
      code: 'TITLE_MISSING',
      modules: ['metadata'],
      description: api.ISSUE_DESCRIPTIONS.TITLE_MISSING,
    });
  });
});

describe('runAudit as a library', () => {
  it('audits a site without the CLI and feeds the agent format', async () => {
    mockFetch.mockImplementation(site({
      'https://example.com/': () => html('<html><head><title>Example</title></head><body>Hello</body></html>'),
      'https://example.com/robots.txt': () =>
        new Response('User-agent: *\nAllow: /\n', { status: 200, headers: { 'content-type': 'text/plain' } }),
    }));

    const report = await runAudit('example.com', { only: ['robots', 'metadata'], timeout: 1000 });

    expect(report.url).toBe('https://example.com/');
    expect(report.page).toMatchObject({ status: 200, finalUrl: 'https://example.com/' });
    expect(report.modules.map((m) => m.module)).toEqual(['robots', 'metadata']);
    expect(report.modules.flatMap((m) => m.findings).map((f) => f.code)).toContain('DESCRIPTION_MISSING');

    const exitCode = getExitCode(report.summary, false);
    const agent = JSON.parse(formatAgent(report, { version: VERSION, exitCode })) as AgentReport;
    expect(agent).toMatchObject({ tool: 'vercel-seo-audit', version: VERSION, url: 'https://example.com/', exitCode });
    expect(agent.skipped).toEqual(MODULE_IDS.filter((id) => id !== 'robots' && id !== 'metadata'));
  });

  it('refuses to follow the audited page into a private address, as the CLI does', async () => {
    mockFetch.mockImplementation(site({
      'https://example.com/': () => redirect('http://169.254.169.254/latest/meta-data/'),
    }));

    const report = await runAudit('https://example.com/', { timeout: 1000 });

    expect(requestedHosts()).toEqual(['example.com']);
    const target = report.modules.find((m) => m.module === 'target');
    expect(target?.findings).toHaveLength(1);
    expect(target?.findings[0].code).toBe('TARGET_UNREACHABLE');
    expect(target?.findings[0].message).toContain('Refused to follow a redirect to the private address 169.254.169.254');
  });

  it('refuses every module request that a public site redirects into a private address', async () => {
    mockFetch.mockImplementation(site({
      'https://example.com/': () => html('<html><head><title>Example</title></head><body>Hello</body></html>'),
      'https://example.com/robots.txt': () => redirect('http://127.0.0.1:8080/robots.txt', 302),
      'https://example.com/sitemap.xml': () => redirect('http://10.0.0.5/sitemap.xml'),
      'https://example.com/favicon.ico': () => redirect('http://[::1]/favicon.ico'),
    }));

    const report = await runAudit('https://example.com/', { timeout: 1000 });

    expect(report.modules.length).toBeGreaterThan(1);
    expect(requestedHosts().length).toBeGreaterThan(3);
    expect(requestedHosts().filter(isPrivateAddress)).toEqual([]);
  });
});
