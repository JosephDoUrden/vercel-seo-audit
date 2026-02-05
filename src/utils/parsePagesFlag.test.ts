import { describe, it, expect } from 'vitest';
import { parsePagesFlag } from './parsePagesFlag.js';

describe('parsePagesFlag', () => {
  it('parses a single path', () => {
    expect(parsePagesFlag('/about')).toEqual(['/about']);
  });

  it('parses multiple comma-separated paths', () => {
    expect(parsePagesFlag('/about,/pricing,/blog')).toEqual(['/about', '/pricing', '/blog']);
  });

  it('trims whitespace around paths', () => {
    expect(parsePagesFlag(' /about , /pricing ')).toEqual(['/about', '/pricing']);
  });

  it('ignores empty segments from trailing commas', () => {
    expect(parsePagesFlag('/about,/pricing,')).toEqual(['/about', '/pricing']);
  });

  it('throws on path missing leading /', () => {
    expect(() => parsePagesFlag('about')).toThrow('each path must start with "/"');
  });

  it('throws on mixed valid/invalid paths', () => {
    expect(() => parsePagesFlag('/about,pricing')).toThrow('each path must start with "/"');
  });

  it('throws on empty input', () => {
    expect(() => parsePagesFlag('')).toThrow('--pages must contain at least one path');
  });

  it('throws on only-commas input', () => {
    expect(() => parsePagesFlag(',,,')).toThrow('--pages must contain at least one path');
  });
});
