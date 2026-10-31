import { describe, it, expect } from 'vitest';
import { diffReports } from './diff.js';
import type { AuditFinding, AuditReport } from '../types.js';

function finding(code: AuditFinding['code'], url?: string): AuditFinding {
  return { code, severity: 'warning', category: 'metadata', message: '', explanation: '', suggestion: '', ...(url && { url }) };
}

function report(modules: AuditReport['modules'], only?: AuditReport['only']): AuditReport {
  return {
    url: 'https://example.com/',
    timestamp: '2026-10-25T00:00:00.000Z',
    duration: 1,
    summary: { errors: 0, warnings: 0, info: 0, passed: 0 },
    modules,
    ...(only && { only }),
  };
}

describe('diffReports', () => {
  it('splits findings into new, resolved and unchanged by code and url', () => {
    const previous = report([{ module: 'metadata', findings: [finding('TITLE_MISSING'), finding('DESCRIPTION_MISSING', 'https://example.com/a')] }]);
    const current = report([{ module: 'metadata', findings: [finding('TITLE_MISSING'), finding('DESCRIPTION_MISSING', 'https://example.com/b')] }]);

    const diff = diffReports(current, previous);

    expect(diff.newIssues.map((f) => f.url)).toEqual(['https://example.com/b']);
    expect(diff.resolvedIssues.map((f) => f.url)).toEqual(['https://example.com/a']);
    expect(diff.unchanged.map((f) => f.code)).toEqual(['TITLE_MISSING']);
  });

  it('compares only the selected modules when the current run used only', () => {
    const previous = report([
      { module: 'metadata', findings: [finding('TITLE_MISSING')] },
      { module: 'favicon', findings: [finding('FAVICON_MISSING')] },
      { module: 'vercel', findings: [finding('VERCEL_CACHE_MISS')] },
    ]);
    const current = report([{ module: 'vercel', findings: [] }], ['vercel']);

    const diff = diffReports(current, previous);

    expect(diff.resolvedIssues.map((f) => f.code)).toEqual(['VERCEL_CACHE_MISS']);
    expect(diff.newIssues).toEqual([]);
    expect(diff.unchanged).toEqual([]);
  });

  it('compares only the previous run\'s modules when a limited run is followed by a full one', () => {
    const previous = report([{ module: 'favicon', findings: [finding('FAVICON_MISSING')] }], ['favicon']);
    const current = report([
      { module: 'metadata', findings: [finding('TITLE_MISSING')] },
      { module: 'favicon', findings: [] },
    ]);

    const diff = diffReports(current, previous);

    expect(diff.newIssues).toEqual([]);
    expect(diff.resolvedIssues.map((f) => f.code)).toEqual(['FAVICON_MISSING']);
  });

  it('compares only the modules two different limited runs share', () => {
    const previous = report([
      { module: 'metadata', findings: [finding('TITLE_MISSING')] },
      { module: 'vercel', findings: [finding('VERCEL_CACHE_MISS')] },
    ], ['metadata', 'vercel']);
    const current = report([
      { module: 'vercel', findings: [] },
      { module: 'favicon', findings: [finding('FAVICON_MISSING')] },
    ], ['vercel', 'favicon']);

    const diff = diffReports(current, previous);

    expect(diff.resolvedIssues.map((f) => f.code)).toEqual(['VERCEL_CACHE_MISS']);
    expect(diff.newIssues).toEqual([]);
    expect(diff.unchanged).toEqual([]);
  });

  it('compares every module when both runs are full', () => {
    const previous = report([{ module: 'favicon', findings: [finding('FAVICON_MISSING')] }]);
    const current = report([{ module: 'metadata', findings: [finding('TITLE_MISSING')] }]);

    const diff = diffReports(current, previous);

    expect(diff.resolvedIssues.map((f) => f.code)).toEqual(['FAVICON_MISSING']);
    expect(diff.newIssues.map((f) => f.code)).toEqual(['TITLE_MISSING']);
  });

  it('keeps the target findings in the diff whatever only says', () => {
    const previous = report([
      { module: 'target', findings: [finding('TARGET_HTTP_ERROR')] },
      { module: 'vercel', findings: [] },
    ], ['vercel']);
    const current = report([
      { module: 'target', findings: [finding('TARGET_NOT_HTML')] },
      { module: 'vercel', findings: [] },
    ], ['vercel']);

    const diff = diffReports(current, previous);

    expect(diff.newIssues.map((f) => f.code)).toEqual(['TARGET_NOT_HTML']);
    expect(diff.resolvedIssues.map((f) => f.code)).toEqual(['TARGET_HTTP_ERROR']);
  });

  it('reads a pass finding under a failure code from an older report as its pass code', () => {
    const found = (code: AuditFinding['code']): AuditFinding => ({ ...finding(code), severity: 'pass' });
    const previous = report([{ module: 'sitemap', findings: [found('SITEMAP_MISSING'), found('JSONLD_MISSING')] }]);
    const current = report([{ module: 'sitemap', findings: [finding('SITEMAP_MISSING'), found('JSONLD_FOUND')] }]);

    const diff = diffReports(current, previous);

    expect(diff.newIssues.map((f) => f.code)).toEqual(['SITEMAP_MISSING']);
    expect(diff.resolvedIssues.map((f) => [f.code, f.severity])).toEqual([['SITEMAP_MISSING', 'pass']]);
    expect(diff.unchanged.map((f) => f.code)).toEqual(['JSONLD_FOUND']);
  });
});
