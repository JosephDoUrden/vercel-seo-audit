import { describe, it, expect } from 'vitest';
import { generateFixes } from './index.js';
import type { AuditFinding } from '../types.js';

function makeFinding(overrides: Partial<AuditFinding>): AuditFinding {
  return {
    code: 'ROBOTS_MISSING',
    severity: 'error',
    category: 'robots',
    message: 'Test message',
    explanation: 'Test explanation',
    suggestion: 'Test suggestion',
    ...overrides,
  };
}

describe('generateFixes', () => {
  it('returns fix for ROBOTS_MISSING', () => {
    const findings = [makeFinding({ code: 'ROBOTS_MISSING' })];
    const fixes = generateFixes(findings, 'https://example.com');

    expect(fixes).toHaveLength(1);
    expect(fixes[0].code).toBe('ROBOTS_MISSING');
    expect(fixes[0].filePath).toBe('public/robots.txt');
    expect(fixes[0].content).toContain('User-agent: *');
    expect(fixes[0].content).toContain('Allow: /');
    expect(fixes[0].content).toContain('Sitemap: https://example.com/sitemap.xml');
  });

  it('returns fix for SITEMAP_MISSING', () => {
    const findings = [makeFinding({ code: 'SITEMAP_MISSING', category: 'sitemap' })];
    const fixes = generateFixes(findings, 'https://example.com');

    expect(fixes).toHaveLength(1);
    expect(fixes[0].code).toBe('SITEMAP_MISSING');
    expect(fixes[0].filePath).toBe('public/sitemap.xml');
    expect(fixes[0].content).toContain('<loc>https://example.com/</loc>');
    expect(fixes[0].content).toContain('<?xml version="1.0"');
  });

  it('returns fix for NEXTJS_TRAILING_SLASH_308', () => {
    const findings = [makeFinding({ code: 'NEXTJS_TRAILING_SLASH_308', category: 'nextjs' })];
    const fixes = generateFixes(findings, 'https://example.com');

    expect(fixes).toHaveLength(1);
    expect(fixes[0].code).toBe('NEXTJS_TRAILING_SLASH_308');
    expect(fixes[0].filePath).toBe('next.config.js');
    expect(fixes[0].content).toContain('trailingSlash: true');
  });

  it('returns empty array for non-fixable codes', () => {
    const findings = [
      makeFinding({ code: 'CANONICAL_MISSING', category: 'metadata' }),
      makeFinding({ code: 'FAVICON_MISSING', category: 'favicon' }),
    ];
    const fixes = generateFixes(findings, 'https://example.com');

    expect(fixes).toHaveLength(0);
  });

  it('handles mixed fixable and non-fixable findings', () => {
    const findings = [
      makeFinding({ code: 'ROBOTS_MISSING' }),
      makeFinding({ code: 'CANONICAL_MISSING', category: 'metadata' }),
      makeFinding({ code: 'SITEMAP_MISSING', category: 'sitemap' }),
      makeFinding({ code: 'TITLE_MISSING', category: 'metadata' }),
    ];
    const fixes = generateFixes(findings, 'https://example.com');

    expect(fixes).toHaveLength(2);
    expect(fixes.map((f) => f.code)).toEqual(['ROBOTS_MISSING', 'SITEMAP_MISSING']);
  });

  it('returns empty array for empty findings', () => {
    const fixes = generateFixes([], 'https://example.com');
    expect(fixes).toHaveLength(0);
  });
});
