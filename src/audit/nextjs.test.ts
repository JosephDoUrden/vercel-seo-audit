import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AuditContext } from '../types.js';
import { auditNextjs } from './nextjs.js';

vi.mock('../utils/http.js', () => ({
  fetchPage: vi.fn(),
  fetchWithoutRedirect: vi.fn(),
}));

import { fetchPage, fetchWithoutRedirect } from '../utils/http.js';

const mockFetchPage = vi.mocked(fetchPage);
const mockFetchWithoutRedirect = vi.mocked(fetchWithoutRedirect);

function makeCtx(overrides: Partial<AuditContext> = {}): AuditContext {
  return {
    url: 'https://example.com',
    normalizedUrl: 'https://example.com/',
    fetchOptions: {},
    verbose: false,
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mockFetchWithoutRedirect.mockResolvedValue({
    status: 200,
    headers: new Headers(),
  } as Response);
});

describe('auditNextjs', () => {
  it('detects Vercel deployment via server header', async () => {
    const ctx = makeCtx({
      headers: { server: 'Vercel', 'x-vercel-id': '', 'x-powered-by': '' },
    });

    const findings = await auditNextjs(ctx);
    const vercel = findings.find((f) => f.code === 'VERCEL_DETECTED');
    expect(vercel).toBeDefined();
    expect(vercel!.severity).toBe('info');
  });

  it('detects Vercel deployment via x-vercel-id header', async () => {
    const ctx = makeCtx({
      headers: { server: 'nginx', 'x-vercel-id': 'iad1::12345', 'x-powered-by': '' },
    });

    const findings = await auditNextjs(ctx);
    expect(findings.find((f) => f.code === 'VERCEL_DETECTED')).toBeDefined();
  });

  it('detects Next.js via x-powered-by header', async () => {
    const ctx = makeCtx({
      headers: { server: 'Vercel', 'x-vercel-id': 'id', 'x-powered-by': 'Next.js' },
    });

    const findings = await auditNextjs(ctx);
    const vercel = findings.find((f) => f.code === 'VERCEL_DETECTED');
    expect(vercel).toBeDefined();
    expect(vercel!.message).toContain('Next.js');
  });

  it('does not report VERCEL_DETECTED for non-Vercel sites', async () => {
    const ctx = makeCtx({
      headers: { server: 'nginx', 'x-powered-by': '' },
    });

    const findings = await auditNextjs(ctx);
    expect(findings.find((f) => f.code === 'VERCEL_DETECTED')).toBeUndefined();
  });

  it('detects 308 trailing slash redirect', async () => {
    mockFetchWithoutRedirect.mockResolvedValue({
      status: 308,
      headers: new Headers({ location: 'https://example.com/' }),
    } as unknown as Response);

    const ctx = makeCtx({
      headers: { server: 'nginx', 'x-powered-by': '' },
    });

    const findings = await auditNextjs(ctx);
    const slash = findings.find((f) => f.code === 'NEXTJS_TRAILING_SLASH_308');
    expect(slash).toBeDefined();
    expect(slash!.severity).toBe('info');
  });

  it('does not report 308 when no 308 response', async () => {
    mockFetchWithoutRedirect.mockResolvedValue({
      status: 200,
      headers: new Headers(),
    } as Response);

    const ctx = makeCtx({
      headers: { server: 'nginx', 'x-powered-by': '' },
    });

    const findings = await auditNextjs(ctx);
    expect(findings.find((f) => f.code === 'NEXTJS_TRAILING_SLASH_308')).toBeUndefined();
  });

  it('detects middleware redirect header', async () => {
    const ctx = makeCtx({
      headers: {
        server: 'Vercel',
        'x-vercel-id': 'id',
        'x-powered-by': '',
        'x-middleware-redirect': 'https://example.com/new',
      },
    });

    const findings = await auditNextjs(ctx);
    const middleware = findings.find((f) => f.code === 'MIDDLEWARE_REDIRECT');
    expect(middleware).toBeDefined();
    expect(middleware!.severity).toBe('info');
  });

  it('detects middleware rewrite header', async () => {
    const ctx = makeCtx({
      headers: {
        server: 'Vercel',
        'x-vercel-id': 'id',
        'x-powered-by': '',
        'x-middleware-rewrite': 'https://example.com/rewritten',
      },
    });

    const findings = await auditNextjs(ctx);
    expect(findings.find((f) => f.code === 'MIDDLEWARE_REDIRECT')).toBeDefined();
  });

  it('does not report middleware when no middleware headers', async () => {
    const ctx = makeCtx({
      headers: { server: 'Vercel', 'x-vercel-id': 'id', 'x-powered-by': '' },
    });

    const findings = await auditNextjs(ctx);
    expect(findings.find((f) => f.code === 'MIDDLEWARE_REDIRECT')).toBeUndefined();
  });

  it('detects APP_ROUTER_METADATA when Next.js markers missing', async () => {
    const ctx = makeCtx({
      headers: { server: 'Vercel', 'x-vercel-id': 'id', 'x-powered-by': 'Next.js' },
      html: '<html><head></head><body>No markers</body></html>',
    });

    const findings = await auditNextjs(ctx);
    const appRouter = findings.find((f) => f.code === 'APP_ROUTER_METADATA');
    expect(appRouter).toBeDefined();
    expect(appRouter!.severity).toBe('info');
  });

  it('does not report APP_ROUTER_METADATA when markers present', async () => {
    const ctx = makeCtx({
      headers: { server: 'Vercel', 'x-vercel-id': 'id', 'x-powered-by': 'Next.js' },
      html: '<html><head></head><body><div id="__next">Content</div><script src="/_next/static/chunks/main.js"></script></body></html>',
    });

    const findings = await auditNextjs(ctx);
    expect(findings.find((f) => f.code === 'APP_ROUTER_METADATA')).toBeUndefined();
  });

  it('fetches page when ctx.headers is not set', async () => {
    mockFetchPage.mockResolvedValue({
      body: '<html></html>',
      status: 200,
      headers: new Headers({ server: 'Vercel', 'x-vercel-id': 'id' }),
      finalUrl: 'https://example.com/',
    });

    const ctx = makeCtx();
    const findings = await auditNextjs(ctx);
    expect(mockFetchPage).toHaveBeenCalled();
    expect(findings.find((f) => f.code === 'VERCEL_DETECTED')).toBeDefined();
  });

  it('returns empty when fetch fails and no headers', async () => {
    mockFetchPage.mockRejectedValue(new Error('timeout'));

    const findings = await auditNextjs(makeCtx());
    expect(findings).toHaveLength(0);
  });

  it('handles fetchWithoutRedirect error gracefully', async () => {
    mockFetchWithoutRedirect.mockRejectedValue(new Error('timeout'));

    const ctx = makeCtx({
      headers: { server: 'nginx', 'x-powered-by': '' },
    });

    const findings = await auditNextjs(ctx);
    expect(findings.find((f) => f.code === 'NEXTJS_TRAILING_SLASH_308')).toBeUndefined();
  });
});
