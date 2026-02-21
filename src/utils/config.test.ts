import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadConfig, validateConfig } from './config.js';

vi.mock('node:fs', () => ({
  readFileSync: vi.fn(),
}));

import { readFileSync } from 'node:fs';
const mockReadFileSync = vi.mocked(readFileSync);

beforeEach(() => {
  vi.resetAllMocks();
});

describe('loadConfig', () => {
  it('returns a valid full config', () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({
      url: 'https://example.com',
      strict: true,
      verbose: true,
      userAgent: 'googlebot',
      pages: ['/about', '/pricing'],
      report: 'json',
      timeout: 5000,
    }));
    const config = loadConfig();
    expect(config).toEqual({
      url: 'https://example.com',
      strict: true,
      verbose: true,
      userAgent: 'googlebot',
      pages: ['/about', '/pricing'],
      report: 'json',
      timeout: 5000,
    });
  });

  it('returns a valid partial config', () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ url: 'https://example.com' }));
    const config = loadConfig();
    expect(config).toEqual({ url: 'https://example.com' });
  });

  it('returns a valid empty config', () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({}));
    const config = loadConfig();
    expect(config).toEqual({});
  });

  it('returns undefined when file not found', () => {
    const err = new Error('ENOENT') as NodeJS.ErrnoException;
    err.code = 'ENOENT';
    mockReadFileSync.mockImplementation(() => { throw err; });
    expect(loadConfig()).toBeUndefined();
  });

  it('throws on invalid JSON', () => {
    mockReadFileSync.mockReturnValue('{ invalid json }');
    expect(() => loadConfig()).toThrow('invalid JSON');
  });

  it('silently ignores unknown keys', () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ url: 'https://example.com', unknownKey: true }));
    const config = loadConfig();
    expect(config).toEqual({ url: 'https://example.com' });
  });
});

describe('validateConfig', () => {
  it('throws when config is not an object', () => {
    expect(() => validateConfig('string')).toThrow('config must be a JSON object');
    expect(() => validateConfig(null)).toThrow('config must be a JSON object');
    expect(() => validateConfig([])).toThrow('config must be a JSON object');
  });

  it('throws when timeout is a string', () => {
    expect(() => validateConfig({ timeout: 'abc' })).toThrow('"timeout" must be a number');
  });

  it('throws when timeout is negative', () => {
    expect(() => validateConfig({ timeout: -5 })).toThrow('"timeout" must be a positive number');
  });

  it('throws when timeout is zero', () => {
    expect(() => validateConfig({ timeout: 0 })).toThrow('"timeout" must be a positive number');
  });

  it('throws when strict is not a boolean', () => {
    expect(() => validateConfig({ strict: 1 })).toThrow('"strict" must be a boolean');
  });

  it('throws when verbose is not a boolean', () => {
    expect(() => validateConfig({ verbose: 'yes' })).toThrow('"verbose" must be a boolean');
  });

  it('throws when pages is a string instead of array', () => {
    expect(() => validateConfig({ pages: '/about' })).toThrow('"pages" must be an array of strings');
  });

  it('throws when pages contains non-strings', () => {
    expect(() => validateConfig({ pages: [123] })).toThrow('"pages" must be an array of strings');
  });

  it('throws when a page does not start with /', () => {
    expect(() => validateConfig({ pages: ['no-slash'] })).toThrow('each page must start with "/"');
  });

  it('throws when report is invalid', () => {
    expect(() => validateConfig({ report: 'pdf' })).toThrow('"report" must be "json", "md", or "html"');
  });

  it('throws when url is not a string', () => {
    expect(() => validateConfig({ url: 123 })).toThrow('"url" must be a string');
  });

  it('throws when url is invalid', () => {
    expect(() => validateConfig({ url: '://bad' })).toThrow('"url" must be a valid URL');
  });

  it('throws when userAgent is not a string', () => {
    expect(() => validateConfig({ userAgent: 42 })).toThrow('"userAgent" must be a string');
  });

  it('accepts url without protocol', () => {
    const config = validateConfig({ url: 'example.com' });
    expect(config.url).toBe('example.com');
  });
});
