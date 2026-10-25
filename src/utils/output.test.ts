import { describe, it, expect } from 'vitest';
import { formatHtml, formatReport, formatMarkdown, formatDiff, formatJson } from './output.js';
import type { AuditFinding, AuditReport } from '../types.js';

const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');

function makeFinding(overrides: Partial<AuditFinding>): AuditFinding {
  return {
    code: 'TITLE_MISSING',
    severity: 'error',
    category: 'metadata',
    message: 'Title tag is missing',
    explanation: 'The page has no title tag.',
    suggestion: 'Add a <title> tag.',
    ...overrides,
  };
}

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

describe('ignored findings', () => {
  const ignoredReport = (): AuditReport => ({
    url: 'https://example.com',
    timestamp: '2026-01-01T00:00:00.000Z',
    duration: 500,
    summary: { errors: 1, warnings: 0, info: 0, passed: 0, ignored: 2 },
    modules: [
      {
        module: 'robots',
        findings: [makeFinding({ code: 'ROBOTS_MISSING', category: 'robots', message: 'robots.txt is missing', ignored: true })],
      },
      {
        module: 'metadata',
        findings: [
          makeFinding({}),
          makeFinding({ code: 'DESCRIPTION_MISSING', severity: 'warning', message: 'Meta description is missing', ignored: true }),
        ],
      },
    ],
  });

  const onlyIgnoredReport = (): AuditReport => ({
    ...ignoredReport(),
    summary: { errors: 0, warnings: 0, info: 0, passed: 0, ignored: 1 },
    modules: [{
      module: 'robots',
      findings: [makeFinding({ code: 'ROBOTS_MISSING', category: 'robots', message: 'robots.txt is missing', ignored: true })],
    }],
  });

  it('hides ignored findings from the text report without --verbose', () => {
    const out = stripAnsi(formatReport(ignoredReport(), false));
    expect(out).toContain('Title tag is missing');
    expect(out).not.toContain('Meta description is missing');
    expect(out).not.toContain('robots.txt is missing');
    expect(out).toContain('2 findings ignored');
  });

  it('prints no header for a category whose findings are all ignored', () => {
    const out = stripAnsi(formatReport(ignoredReport(), false));
    expect(out).toContain('METADATA');
    expect(out).not.toContain('ROBOTS');
  });

  it('shows ignored findings with an (ignored) tag under --verbose', () => {
    const out = stripAnsi(formatReport(ignoredReport(), true));
    expect(out).toContain('robots.txt is missing (ignored)');
    expect(out).toContain('Meta description is missing (ignored)');
    expect(out).not.toContain('Title tag is missing (ignored)');
    expect(out).toContain('ROBOTS');
    expect(out).toContain('2 findings ignored');
  });

  it('says one finding, not one findings', () => {
    const out = stripAnsi(formatReport(onlyIgnoredReport(), false));
    expect(out).toContain('1 finding ignored');
  });

  it('does not claim no issues when only ignored findings exist', () => {
    const out = stripAnsi(formatReport(onlyIgnoredReport(), false));
    expect(out).not.toContain('No issues found!');
    expect(out).toContain('All 1 finding ignored');
  });

  it('still says no issues found when there are no findings at all', () => {
    const out = stripAnsi(formatReport({ ...onlyIgnoredReport(), summary: { errors: 0, warnings: 0, info: 0, passed: 0, ignored: 0 }, modules: [] }, false));
    expect(out).toContain('No issues found!');
    expect(out).not.toContain('ignored');
  });

  it('works with a summary from before ignore existed', () => {
    const out = stripAnsi(formatReport({ ...onlyIgnoredReport(), summary: { errors: 0, warnings: 0, info: 0, passed: 0 }, modules: [] }, false));
    expect(out).toContain('No issues found!');
  });

  it('tags ignored findings in markdown and counts them in the summary', () => {
    const md = formatMarkdown(ignoredReport());
    expect(md).toContain('robots.txt is missing _(ignored)_');
    expect(md).toContain('| Ignored | 2 |');
    expect(md).not.toContain('Title tag is missing _(ignored)_');
  });

  it('tags ignored findings in html and counts them in the summary', () => {
    const html = formatHtml(ignoredReport());
    expect(html).toContain('data-ignored="true"');
    expect(html).toContain('robots.txt is missing <span class="finding-ignored">(ignored)</span>');
    expect(html).toContain('<div class="card-count">2</div><div class="card-label">Ignored</div>');
  });

  it('adds no ignored card to html when nothing is ignored', () => {
    expect(formatHtml(makeReport())).not.toContain('Ignored');
  });

  it('tags ignored findings in the diff but still lists them', () => {
    const out = stripAnsi(formatDiff({
      newIssues: [
        makeFinding({ code: 'ROBOTS_MISSING', message: 'robots.txt is missing', ignored: true }),
        makeFinding({}),
      ],
      resolvedIssues: [],
      unchanged: [],
    }));
    expect(out).toContain('+ 2 new');
    expect(out).toContain('robots.txt is missing (ignored)');
    expect(out).toContain('Title tag is missing');
    expect(out).not.toContain('Title tag is missing (ignored)');
  });
});

// report.md is posted as a bot comment on pull requests, and a preview page
// controls parts of it (robots.txt rules, URLs, the audited url itself).
describe('formatMarkdown escaping', () => {
  const hostile = '<!-- vercel-seo-audit --></details><img src=x onerror=alert(1)> `code`';
  const escaped = '&lt;!-- vercel-seo-audit --&gt;&lt;/details&gt;&lt;img src=x onerror=alert(1)&gt; &#96;code&#96;';

  it('escapes HTML and backticks in finding messages', () => {
    const md = formatMarkdown(makeReport({
      modules: [{ module: 'robots', findings: [makeFinding({ message: `robots.txt blocks ${hostile}` })] }],
    }));
    expect(md).not.toContain('<!--');
    expect(md).not.toContain('</details>');
    expect(md).not.toContain('<img');
    expect(md).not.toContain('`code`');
    expect(md).toContain(`robots.txt blocks ${escaped}`);
  });

  it('keeps a message on one line', () => {
    const md = formatMarkdown(makeReport({
      modules: [{ module: 'robots', findings: [makeFinding({ message: 'blocks a\n\n## Injected\r\nb' })] }],
    }));
    expect(md).toContain('blocks a ## Injected b');
    expect(md).not.toMatch(/^## Injected/m);
  });

  it('escapes ampersands so existing entities are shown, not decoded', () => {
    const md = formatMarkdown(makeReport({
      modules: [{ module: 'robots', findings: [makeFinding({ message: 'a &lt;b&gt;' })] }],
    }));
    expect(md).toContain('a &amp;lt;b&amp;gt;');
  });

  it('cannot break out of the code span around a finding url', () => {
    const md = formatMarkdown(makeReport({
      modules: [{ module: 'redirects', findings: [makeFinding({ url: 'https://x.test/a`<img src=x>`b' })] }],
    }));
    expect(md).toContain('  - URL: `` https://x.test/a`<img src=x>`b ``');
  });

  it('collapses line breaks inside a finding url', () => {
    const md = formatMarkdown(makeReport({
      modules: [{ module: 'redirects', findings: [makeFinding({ url: 'https://x.test/a\n\n## b' })] }],
    }));
    expect(md).toContain('  - URL: `https://x.test/a ## b`');
  });

  it('leaves an ordinary url in a plain code span', () => {
    const md = formatMarkdown(makeReport({
      modules: [{ module: 'redirects', findings: [makeFinding({ url: 'https://example.com/docs' })] }],
    }));
    expect(md).toContain('  - URL: `https://example.com/docs`');
  });

  it('escapes the audited url in the heading', () => {
    const md = formatMarkdown(makeReport({ url: `https://x.test/${hostile}` }));
    expect(md.split('\n')[0]).toBe(`# SEO Audit Report for https://x.test/${escaped}`);
  });

  const inFinding = (overrides: Partial<AuditFinding>) => formatMarkdown(makeReport({
    modules: [{ module: 'hreflang', findings: [makeFinding(overrides)] }],
  }));

  it('escapes explanation and suggestion too', () => {
    const md = inFinding({ explanation: `x ${hostile}`, suggestion: `y ${hostile}` });
    expect(md).toContain(`  - x ${escaped}`);
    expect(md).toContain(`  - **Fix:** y ${escaped}`);
    expect(md).not.toContain('<img');
  });

  it('keeps an encoded line break from a hreflang value on one line', () => {
    const md = inFinding({
      message: 'hreflang en&#10;&#10;## Injected',
      explanation: 'value en&#x0A;## Injected',
      suggestion: 'use en&#13;## Injected',
    });
    expect(md).toContain('hreflang en&amp;#10;&amp;#10;## Injected');
    expect(md).toContain('value en&amp;#x0A;## Injected');
    expect(md).toContain('use en&amp;#13;## Injected');
    expect(md).not.toMatch(/&#(10|13|x0A);/i);
  });

  it('does not mention anyone', () => {
    const md = inFinding({ message: 'by @octocat', explanation: 'cc @acme/team', suggestion: 'ask @octocat' });
    expect(md).not.toContain('@');
    expect(md).toContain('by &#64;octocat');
    expect(md).toContain('cc &#64;acme/team');
  });

  it('does not link or embed images', () => {
    const md = inFinding({ message: 'see [x](https://evil.test)', suggestion: '![p](https://evil.test/p.png)' });
    expect(md).not.toMatch(/\[[^\]]*\]\(https/);
    expect(md).toContain('see &#91;x](https://evil.test)');
    expect(md).toContain('!&#91;p](https://evil.test/p.png)');
  });
});

describe('only', () => {
  const partial = () => makeReport({ only: ['robots', 'sitemap'] });

  it('prints a Modules line in the text report when the run was limited', () => {
    expect(stripAnsi(formatReport(partial(), false))).toContain('Modules: robots, sitemap');
  });

  it('prints a Modules line in markdown when the run was limited', () => {
    expect(formatMarkdown(partial())).toContain('> Modules: robots, sitemap');
  });

  it('prints a Modules line in html when the run was limited', () => {
    expect(formatHtml(partial())).toContain('Modules: robots, sitemap');
  });

  it('prints no Modules line on a full run', () => {
    expect(stripAnsi(formatReport(makeReport(), false))).not.toContain('Modules:');
    expect(formatMarkdown(makeReport())).not.toContain('Modules:');
    expect(formatHtml(makeReport())).not.toContain('Modules:');
  });

  it('keeps the JSON of a full run free of an only key', () => {
    expect(formatJson(makeReport())).not.toContain('"only"');
    expect(JSON.parse(formatJson(partial())).only).toEqual(['robots', 'sitemap']);
  });
});
