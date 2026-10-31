import { describe, it, expect } from 'vitest';
import { MODULE_IDS } from '../types.js';
import type { AuditFinding, AuditReport } from '../types.js';
import { buildAgentReport, formatAgent, resolveFormat, MAX_DETAIL_CHARS, MAX_DETAIL_ITEMS } from './agent-format.js';
import { diffReports } from './diff.js';

function finding(overrides: Partial<AuditFinding>): AuditFinding {
  return {
    code: 'TITLE_MISSING',
    severity: 'error',
    category: 'metadata',
    message: 'No <title> tag found',
    explanation: 'Search results show a made-up title.',
    suggestion: 'Return a title from generateMetadata.',
    url: 'https://example.com/',
    ...overrides,
  };
}

function report(modules: AuditReport['modules'], overrides?: Partial<AuditReport>): AuditReport {
  const counted = modules.flatMap((m) => m.findings).filter((f) => !f.ignored);
  return {
    url: 'https://example.com/',
    timestamp: '2026-10-31T00:00:00.000Z',
    duration: 10,
    summary: {
      errors: counted.filter((f) => f.severity === 'error').length,
      warnings: counted.filter((f) => f.severity === 'warning').length,
      info: counted.filter((f) => f.severity === 'info').length,
      passed: counted.filter((f) => f.severity === 'pass').length,
    },
    modules,
    page: { status: 200, finalUrl: 'https://example.com/', nextjs: true },
    ...overrides,
  };
}

const opts = { version: '9.9.9', exitCode: 1 };

describe('buildAgentReport', () => {
  it('sorts error, warning, info, then by module run order', () => {
    const r = report([
      { module: 'vercel', findings: [finding({ code: 'VERCEL_CACHE_MISS', severity: 'info', category: 'vercel' })] },
      { module: 'robots', findings: [finding({ code: 'ROBOTS_NO_SITEMAP', severity: 'warning', category: 'robots' })] },
      { module: 'metadata', findings: [
        finding({ code: 'DESCRIPTION_MISSING', severity: 'warning' }),
        finding({ code: 'TITLE_MISSING' }),
      ] },
      { module: 'redirects', findings: [finding({ code: 'REDIRECT_LOOP', category: 'redirect' })] },
      { module: 'target', findings: [finding({ code: 'TARGET_NOT_HTML', severity: 'warning', category: 'indexing' })] },
    ]);
    expect(buildAgentReport(r, opts).findings.map((f) => `${f.severity} ${f.module} ${f.code}`)).toEqual([
      'error redirects REDIRECT_LOOP',
      'error metadata TITLE_MISSING',
      'warning target TARGET_NOT_HTML',
      'warning robots ROBOTS_NO_SITEMAP',
      'warning metadata DESCRIPTION_MISSING',
      'info vercel VERCEL_CACHE_MISS',
    ]);
  });

  it('keeps a module\'s own order between findings of the same severity', () => {
    const r = report([{ module: 'metadata', findings: [
      finding({ code: 'OG_TITLE_MISSING' }),
      finding({ code: 'CANONICAL_MISSING' }),
    ] }]);
    expect(buildAgentReport(r, opts).findings.map((f) => f.code)).toEqual(['OG_TITLE_MISSING', 'CANONICAL_MISSING']);
  });

  it('drops pass and ignored findings, and keeps the counts from the summary', () => {
    const r = report([{ module: 'metadata', findings: [
      finding({ code: 'TITLE_MISSING' }),
      finding({ code: 'CANONICAL_MISSING', ignored: true }),
      finding({ code: 'CHARSET_MISSING', severity: 'pass' }),
    ] }]);
    const out = buildAgentReport(r, opts);
    expect(out.findings.map((f) => f.code)).toEqual(['TITLE_MISSING']);
    expect(out.summary).toEqual({ errors: 1, warnings: 0, info: 0 });
  });

  it('maps a finding to the contract fields, with no explanation', () => {
    const r = report([{ module: 'metadata', findings: [finding({ details: { title: null } })] }]);
    expect(buildAgentReport(r, opts).findings[0]).toEqual({
      code: 'TITLE_MISSING',
      severity: 'error',
      category: 'metadata',
      module: 'metadata',
      message: 'No <title> tag found',
      url: 'https://example.com/',
      fix: 'Return a title from generateMetadata.',
      details: { title: null },
    });
  });

  it('sets fix and url to null when the finding has neither, and leaves out empty details', () => {
    const r = report([{ module: 'metadata', findings: [finding({ suggestion: '', url: undefined, details: {} })] }]);
    const [f] = buildAgentReport(r, opts).findings;
    expect(f.fix).toBeNull();
    expect(f.url).toBeNull();
    expect('details' in f).toBe(false);
  });

  it('caps arrays and strings in details, at any depth, and says so', () => {
    const long = 'x'.repeat(MAX_DETAIL_CHARS + 50);
    const many = Array.from({ length: MAX_DETAIL_ITEMS + 5 }, (_, i) => `/page-${i}`);
    const r = report([{ module: 'sitemap', findings: [
      finding({ code: 'SITEMAP_CROSS_HOST_URLS', severity: 'warning', category: 'sitemap', details: { examples: many, nested: { note: long }, count: 15 } }),
    ] }]);
    const out = buildAgentReport(r, opts);
    const details = out.findings[0].details as { examples: string[]; nested: { note: string }; count: number };
    expect(details.examples).toEqual(many.slice(0, MAX_DETAIL_ITEMS));
    expect(details.nested.note).toHaveLength(MAX_DETAIL_CHARS);
    expect(details.count).toBe(15);
    expect(out.truncated).toBe(true);
  });

  it('leaves truncated false when nothing was cut', () => {
    const r = report([{ module: 'sitemap', findings: [
      finding({ code: 'SITEMAP_CROSS_HOST_URLS', severity: 'warning', category: 'sitemap', details: { examples: ['/a'] } }),
    ] }]);
    expect(buildAgentReport(r, opts).truncated).toBe(false);
  });

  it('lists the modules that did not run as skipped', () => {
    const r = report([
      { module: 'robots', findings: [] },
      { module: 'sitemap', findings: [] },
    ], { only: ['robots', 'sitemap'] });
    expect(buildAgentReport(r, opts).skipped).toEqual(MODULE_IDS.filter((id) => id !== 'robots' && id !== 'sitemap'));
  });

  it('gives a full, valid shape on an unreachable target (exit 2)', () => {
    const r = report(
      [{ module: 'target', findings: [finding({ code: 'TARGET_UNREACHABLE', category: 'indexing', details: { error: 'fetch failed' } })] }],
      { page: { status: null, finalUrl: null, nextjs: false } },
    );
    const parsed = JSON.parse(formatAgent(r, { version: '9.9.9', exitCode: 2 }));
    expect(parsed).toEqual({
      tool: 'vercel-seo-audit',
      version: '9.9.9',
      url: 'https://example.com/',
      finalUrl: null,
      exitCode: 2,
      summary: { errors: 1, warnings: 0, info: 0 },
      findings: [expect.objectContaining({ code: 'TARGET_UNREACHABLE', module: 'target', details: { error: 'fetch failed' } })],
      skipped: [...MODULE_IDS],
      truncated: false,
    });
  });

  it('reads finalUrl as null from a report saved without page facts', () => {
    const r = report([], { page: undefined });
    expect(buildAgentReport(r, opts).finalUrl).toBeNull();
  });

  it('nests the diff under one key, with the module each finding came from', () => {
    const previous = report([
      { module: 'robots', findings: [finding({ code: 'ROBOTS_MISSING', severity: 'warning', category: 'robots' })] },
      { module: 'metadata', findings: [finding({ code: 'TITLE_MISSING' })] },
    ]);
    const current = report([
      { module: 'metadata', findings: [finding({ code: 'TITLE_MISSING' }), finding({ code: 'CANONICAL_MISSING', severity: 'warning' })] },
    ]);
    previous.modules[1].findings.push(finding({ code: 'CHARSET_MISSING', severity: 'pass' }));
    current.modules[0].findings.push(finding({ code: 'CHARSET_MISSING', severity: 'pass' }));
    const diff = diffReports(current, previous);
    const text = formatAgent(current, { ...opts, diff: { result: diff, previous } });
    expect(text.split('\n')).toHaveLength(1);
    const parsed = JSON.parse(text);
    expect(parsed.diff).toEqual({
      new: [expect.objectContaining({ code: 'CANONICAL_MISSING', module: 'metadata' })],
      resolved: [expect.objectContaining({ code: 'ROBOTS_MISSING', module: 'robots' })],
      unchanged: 1,
    });
    expect(parsed.findings.map((f: { code: string }) => f.code)).toEqual(['TITLE_MISSING', 'CANONICAL_MISSING']);
  });

  it('has no diff key without --diff', () => {
    expect('diff' in buildAgentReport(report([]), opts)).toBe(false);
  });
});

describe('resolveFormat', () => {
  it('defaults to text', () => {
    expect(resolveFormat({})).toBe('text');
  });

  it('takes the config when the CLI sets nothing', () => {
    expect(resolveFormat({ config: { format: 'agent' } })).toBe('agent');
  });

  it('lets the CLI win over the config', () => {
    expect(resolveFormat({ cliValue: 'text', config: { format: 'agent' } })).toBe('text');
    expect(resolveFormat({ cliValue: 'agent', config: { format: 'text' } })).toBe('agent');
  });

  it('rejects an unknown CLI value and names the flag', () => {
    expect(() => resolveFormat({ cliValue: 'json' })).toThrow('Error in --format: unknown format "json" (valid: text, agent)');
  });
});
