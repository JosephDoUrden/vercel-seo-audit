import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolve } from 'node:path';
import { resolveIgnore, parseIgnoreFile } from './ignore.js';

vi.mock('node:fs', () => ({
  readFileSync: vi.fn(),
}));

import { readFileSync } from 'node:fs';
const mockReadFileSync = vi.mocked(readFileSync);

function enoent(): NodeJS.ErrnoException {
  const err: NodeJS.ErrnoException = new Error('ENOENT: no such file or directory');
  err.code = 'ENOENT';
  return err;
}

beforeEach(() => {
  vi.resetAllMocks();
  mockReadFileSync.mockImplementation(() => {
    throw enoent();
  });
});

describe('parseIgnoreFile', () => {
  it('reads one code per line, skipping blanks and comments', () => {
    const codes = parseIgnoreFile([
      '# accepted for now',
      'ROBOTS_MISSING',
      '',
      '   ',
      '  FAVICON_MISSING  ',
      'HSTS_MISSING # set at the CDN',
      '#TITLE_MISSING',
    ].join('\n'));
    expect(codes).toEqual(['ROBOTS_MISSING', 'FAVICON_MISSING', 'HSTS_MISSING']);
  });

  it('handles CRLF line endings', () => {
    expect(parseIgnoreFile('ROBOTS_MISSING\r\nFAVICON_MISSING\r\n')).toEqual(['ROBOTS_MISSING', 'FAVICON_MISSING']);
  });
});

describe('resolveIgnore', () => {
  it('returns an empty list when no source sets anything', () => {
    expect(resolveIgnore({ cwd: '/project' })).toEqual([]);
  });

  it('reads codes from the CLI only', () => {
    expect(resolveIgnore({ cliValues: ['ROBOTS_MISSING,FAVICON_MISSING'], cwd: '/project' }))
      .toEqual(['ROBOTS_MISSING', 'FAVICON_MISSING']);
  });

  it('accepts a repeated --ignore and trims empty entries', () => {
    expect(resolveIgnore({ cliValues: ['ROBOTS_MISSING, ', ' FAVICON_MISSING,,'], cwd: '/project' }))
      .toEqual(['ROBOTS_MISSING', 'FAVICON_MISSING']);
  });

  it('reads codes from .seoauditignore in cwd only', () => {
    mockReadFileSync.mockReturnValue('# comment\nHSTS_MISSING\n');
    expect(resolveIgnore({ cwd: '/project' })).toEqual(['HSTS_MISSING']);
    expect(mockReadFileSync).toHaveBeenCalledWith(resolve('/project', '.seoauditignore'), 'utf-8');
  });

  it('reads codes from the config only', () => {
    expect(resolveIgnore({ cwd: '/project', config: { ignore: ['TITLE_MISSING'] } })).toEqual(['TITLE_MISSING']);
  });

  it('takes the union of all three sources without duplicates', () => {
    mockReadFileSync.mockReturnValue('HSTS_MISSING\nROBOTS_MISSING\n');
    const codes = resolveIgnore({
      cliValues: ['ROBOTS_MISSING'],
      cwd: '/project',
      config: { ignore: ['TITLE_MISSING', 'HSTS_MISSING'] },
    });
    expect([...codes].sort()).toEqual(['HSTS_MISSING', 'ROBOTS_MISSING', 'TITLE_MISSING']);
  });

  it('names --ignore when the CLI has an unknown code', () => {
    expect(() => resolveIgnore({ cliValues: ['ROBOTS_MISING'], cwd: '/project' }))
      .toThrow('Error in --ignore: unknown issue code "ROBOTS_MISING"');
  });

  it('names .seoauditignore when the file has an unknown code', () => {
    mockReadFileSync.mockReturnValue('NOT_A_CODE\n');
    expect(() => resolveIgnore({ cwd: '/project' }))
      .toThrow('Error in .seoauditignore: unknown issue code "NOT_A_CODE"');
  });

  it('names .seoauditrc.json when the config has an unknown code', () => {
    expect(() => resolveIgnore({ cwd: '/project', config: { ignore: ['NOPE'] } }))
      .toThrow('Error in .seoauditrc.json: unknown issue code "NOPE"');
  });

  it('matches codes case-sensitively', () => {
    expect(() => resolveIgnore({ cliValues: ['robots_missing'], cwd: '/project' }))
      .toThrow('unknown issue code "robots_missing"');
  });

  it('rethrows read errors other than ENOENT', () => {
    const err: NodeJS.ErrnoException = new Error('EACCES: permission denied');
    err.code = 'EACCES';
    mockReadFileSync.mockImplementation(() => {
      throw err;
    });
    expect(() => resolveIgnore({ cwd: '/project' })).toThrow('Error in .seoauditignore: EACCES: permission denied');
  });
});
