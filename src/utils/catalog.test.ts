import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ISSUE_CODES, ISSUE_DESCRIPTIONS, MODULE_IDS } from '../types.js';
import { closestCodes, describeCode, explain, sourceRows } from './catalog.js';

const src = (path: string) => fileURLToPath(new URL(`../${path}`, import.meta.url));

// Codes in ISSUE_CODES that no module reports yet.
const UNREPORTED = new Set(['SITEMAP_INVALID_URL']);

// [path, source] for the module sources and the runner.
function sourceFiles(): [string, string][] {
  const files = readdirSync(src('audit'))
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && f !== 'index.ts')
    .map((f): [string, string] => [`audit/${f}`, f === 'streamed-metadata.ts' ? 'streamedMetadata' : f.replace(/\.ts$/, '')]);
  files.push(['runner.ts', 'target']);
  return files;
}

// (source, category, code) for every finding literal in the module sources and
// the runner, plus the calls to the shared builders that take a category.
function emittedRows(): Set<string> {
  const rows = new Set<string>();
  for (const [path, source] of sourceFiles()) {
    const lines = readFileSync(src(path), 'utf-8').split('\n');
    lines.forEach((line, i) => {
      const code = /code: '([A-Z0-9_]+)'/.exec(line)?.[1];
      if (code && code !== 'MODULE_FAILED') {
        const near = lines.slice(Math.max(0, i - 6), i + 7).join('\n');
        const category = /category: '([a-z0-9-]+)'/.exec(near)?.[1];
        rows.add(`${source} ${category} ${code}`);
      }
      const tooLarge = /responseTooLarge\([^,]+, '([a-z0-9-]+)'/.exec(line)?.[1];
      if (tooLarge) rows.add(`${source} ${tooLarge} RESPONSE_TOO_LARGE`);
      const challenge = /edgeChallengeFinding\([^,]+, '([a-z0-9-]+)'/.exec(line)?.[1];
      if (challenge) rows.add(`${source} ${challenge} EDGE_CHALLENGE`);
      // A module-local builder called as report(urls, 'CODE', 'severity', ...), filed under
      // the category literal the builder sets above it.
      const local = /\(\w+, '([A-Z0-9_]+)', '(?:error|warning|info|pass)'/.exec(line)?.[1];
      if (local) {
        const category = [...lines.slice(0, i).join('\n').matchAll(/category: '([a-z0-9-]+)'/g)].at(-1)?.[1];
        rows.add(`${source} ${category} ${local}`);
      }
    });
  }
  return rows;
}

// Every severity each code is built with: the literals on the severity line of a
// finding literal, or the severity argument of a module-local builder. A severity
// the source computes is recorded as 'unknown'.
function severitiesByCode(): Map<string, Set<string>> {
  const severities = new Map<string, Set<string>>();
  const add = (code: string, found: string[]) => {
    const set = severities.get(code) ?? new Set<string>();
    for (const s of found.length > 0 ? found : ['unknown']) set.add(s);
    severities.set(code, set);
  };
  for (const [path] of sourceFiles()) {
    const lines = readFileSync(src(path), 'utf-8').split('\n');
    lines.forEach((line, i) => {
      const code = /code: '([A-Z0-9_]+)'/.exec(line)?.[1];
      if (code && code !== 'MODULE_FAILED') {
        const severityLine = lines.slice(i, i + 4).find((l) => /\bseverity\b/.test(l)) ?? '';
        add(code, [...severityLine.matchAll(/'(error|warning|info|pass)'/g)].map((m) => m[1]));
      }
      const local = /\(\w+, '([A-Z0-9_]+)', '(error|warning|info|pass)'/.exec(line);
      if (local) add(local[1], [local[2]]);
    });
  }
  return severities;
}

describe('pass codes', () => {
  it('are never also built at another severity, so a code names one outcome', () => {
    const shared = [...severitiesByCode()]
      .filter(([, set]) => set.has('pass') && set.size > 1)
      .map(([code, set]) => `${code}: ${[...set].sort().join(', ')}`);
    expect(shared).toEqual([]);
  });

  it('are found by the scan', () => {
    const pass = [...severitiesByCode()].filter(([, set]) => set.has('pass')).map(([code]) => code).sort();
    expect(pass).toEqual(['HTTP_TO_HTTPS_REDIRECT', 'JSONLD_FOUND', 'METADATA_IN_HEAD', 'SITEMAP_FOUND', 'SOFT_404_NONE']);
  });
});

describe('ISSUE_DESCRIPTIONS', () => {
  it('has one sentence for every code and nothing else', () => {
    expect(Object.keys(ISSUE_DESCRIPTIONS).sort()).toEqual([...ISSUE_CODES].sort());
    for (const code of ISSUE_CODES) {
      expect(ISSUE_DESCRIPTIONS[code], code).toMatch(/^[A-Za-z<*/].*[.]$/);
    }
  });
});

describe('the source table', () => {
  it('matches the module, category and code of every finding the sources build', () => {
    const table = sourceRows()
      .filter(([, , code]) => !UNREPORTED.has(code))
      .map((row) => row.join(' '));
    expect(new Set(table)).toEqual(emittedRows());
  });

  it('places every code but MODULE_FAILED', () => {
    const placed = new Set(sourceRows().map(([, , code]) => code));
    expect(ISSUE_CODES.filter((c) => !placed.has(c))).toEqual(['MODULE_FAILED']);
  });
});

describe('describeCode', () => {
  it('lists every place a shared code comes from, in run order', () => {
    expect(describeCode('RESPONSE_TOO_LARGE')).toMatchObject({
      modules: ['target', 'sitemap', 'crawl'],
      categories: ['performance', 'sitemap', 'crawl'],
    });
  });

  it('gives MODULE_FAILED every module and no fixed category', () => {
    expect(describeCode('MODULE_FAILED')).toMatchObject({ modules: [...MODULE_IDS], categories: [] });
  });
});

describe('explain', () => {
  it('prints the module, category and description of a known code', () => {
    const result = explain('NOINDEX_DETECTED');
    expect(result).toEqual({
      ok: true,
      text: [
        'NOINDEX_DETECTED',
        'module:   metadata',
        'category: indexing',
        '',
        ISSUE_DESCRIPTIONS.NOINDEX_DETECTED,
      ].join('\n'),
    });
  });

  it('matches case-insensitively and reads - as _', () => {
    expect(explain('robots-missing')).toMatchObject({ ok: true, text: expect.stringMatching(/^ROBOTS_MISSING\n/) });
  });

  it('says whose category MODULE_FAILED takes', () => {
    expect(explain('MODULE_FAILED')).toMatchObject({ text: expect.stringContaining("category: the failing module's") });
  });

  it('rejects an unknown code on one line with the three closest codes', () => {
    const result = explain('ROBOTS_MISING');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).not.toContain('\n');
    expect(result.error).toBe(`Error: unknown code "ROBOTS_MISING" (closest: ${closestCodes('ROBOTS_MISING').join(', ')})`);
    expect(closestCodes('ROBOTS_MISING')[0]).toBe('ROBOTS_MISSING');
  });
});

describe('closestCodes', () => {
  it('ranks by edit distance and returns three by default', () => {
    expect(closestCodes('TITLE_MISSIN')).toHaveLength(3);
    expect(closestCodes('TITLE_MISSIN')[0]).toBe('TITLE_MISSING');
    expect(closestCodes('hsts_missing', 1)).toEqual(['HSTS_MISSING']);
  });
});
