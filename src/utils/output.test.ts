import { describe, it, expect } from 'vitest';
import { formatHtml } from './output.js';
import type { AuditReport } from '../types.js';

function makeReport(overrides?: Partial<AuditReport>): AuditReport {
  return {
    url: 'https://example.com',
    timestamp: '2026-01-01T00:00:00.000Z',
    duration: 500,
    summary: { errors: 1, warnings: 1, info: 0, passed: 1 },
    modules: [
      {
        module: 'metadata',
        findings: [
          {
            code: 'TITLE_MISSING',
            severity: 'error',
            category: 'metadata',
            message: 'Title tag is missing',
            explanation: 'The page has no title tag.',
            suggestion: 'Add a <title> tag.',
          },
          {
            code: 'DESCRIPTION_MISSING',
            severity: 'warning',
            category: 'metadata',
            message: 'Meta description is missing',
            explanation: 'No meta description found.',
            suggestion: 'Add a meta description.',
          },
          {
            code: 'CHARSET_MISSING',
            severity: 'pass',
            category: 'metadata',
            message: 'Charset present',
            explanation: 'Charset is set.',
            suggestion: 'No action needed.',
          },
        ],
      },
    ],
    ...overrides,
  };
}

describe('formatHtml', () => {
  it('returns valid HTML structure', () => {
    const html = formatHtml(makeReport());
    expect(html).toMatch(/^<!DOCTYPE html>/);
    expect(html).toContain('<html');
    expect(html).toContain('</html>');
    expect(html).toContain('<head>');
    expect(html).toContain('</head>');
    expect(html).toContain('<body>');
    expect(html).toContain('</body>');
  });

  it('contains report URL and metadata', () => {
    const html = formatHtml(makeReport());
    expect(html).toContain('https://example.com');
    expect(html).toContain('2026-01-01T00:00:00.000Z');
    expect(html).toContain('500ms');
  });

  it('contains summary counts', () => {
    const html = formatHtml(makeReport());
    expect(html).toContain('Errors');
    expect(html).toContain('Warnings');
    expect(html).toContain('Passed');
  });

  it('contains category sections and finding messages', () => {
    const html = formatHtml(makeReport());
    expect(html).toContain('Metadata');
    expect(html).toContain('Title tag is missing');
    expect(html).toContain('Meta description is missing');
  });

  it('contains filter controls', () => {
    const html = formatHtml(makeReport());
    expect(html).toContain('filter-btn');
    expect(html).toContain('data-filter="error"');
    expect(html).toContain('data-filter="warning"');
  });

  it('contains style and script tags', () => {
    const html = formatHtml(makeReport());
    expect(html).toContain('<style>');
    expect(html).toContain('<script>');
  });

  it('shows no issues message for empty findings', () => {
    const html = formatHtml(makeReport({
      summary: { errors: 0, warnings: 0, info: 0, passed: 0 },
      modules: [],
    }));
    expect(html).toContain('No issues found!');
  });

  it('escapes HTML in URLs and messages', () => {
    const html = formatHtml(makeReport({
      url: 'https://example.com/<script>',
      modules: [{
        module: 'test',
        findings: [{
          code: 'TITLE_MISSING',
          severity: 'error',
          category: 'metadata',
          message: 'Test <b>bold</b>',
          explanation: 'Explanation',
          suggestion: 'Fix it',
        }],
      }],
    }));
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;b&gt;bold&lt;/b&gt;');
    expect(html).not.toContain('<script>alert');
  });

  it('includes finding URL when present', () => {
    const html = formatHtml(makeReport({
      modules: [{
        module: 'test',
        findings: [{
          code: 'TITLE_MISSING',
          severity: 'error',
          category: 'metadata',
          message: 'Issue',
          explanation: 'Explain',
          suggestion: 'Fix',
          url: 'https://example.com/page',
        }],
      }],
    }));
    expect(html).toContain('https://example.com/page');
  });
});
