import { describe, it, expect } from 'vitest';
import { resolveOnly } from './only.js';
import { MODULE_IDS } from '../types.js';

describe('resolveOnly', () => {
  it('returns undefined when neither the CLI nor the config sets anything', () => {
    expect(resolveOnly({})).toBeUndefined();
    expect(resolveOnly({ cliValues: [], config: {} })).toBeUndefined();
  });

  it('reads module ids from the CLI', () => {
    expect(resolveOnly({ cliValues: ['metadata,vercel'] })).toEqual(['metadata', 'vercel']);
  });

  it('accepts a repeated --only, trims spaces and drops empty entries and duplicates', () => {
    expect(resolveOnly({ cliValues: ['metadata, ', ' vercel,,', 'metadata'] })).toEqual(['metadata', 'vercel']);
  });

  it('reads module ids from the config', () => {
    expect(resolveOnly({ config: { only: ['sitemap'] } })).toEqual(['sitemap']);
  });

  it('lets the CLI replace the config', () => {
    expect(resolveOnly({ cliValues: ['vercel'], config: { only: ['sitemap'] } })).toEqual(['vercel']);
  });

  it('treats an empty --only as unset and falls back to the config', () => {
    expect(resolveOnly({ cliValues: [], config: { only: ['sitemap'] } })).toEqual(['sitemap']);
  });

  it('treats an --only of only commas as unset', () => {
    expect(resolveOnly({ cliValues: [',', ' '] })).toBeUndefined();
  });

  it('names --only and lists the valid ids when the CLI has an unknown module', () => {
    expect(() => resolveOnly({ cliValues: ['metadata,sitemaps'] }))
      .toThrow(`Error in --only: unknown module "sitemaps" (valid: ${MODULE_IDS.join(', ')})`);
  });

  it('names .seoauditrc.json when the config has an unknown module', () => {
    expect(() => resolveOnly({ config: { only: ['seo'] } }))
      .toThrow('Error in .seoauditrc.json: unknown module "seo"');
  });

  it('matches ids case-sensitively', () => {
    expect(() => resolveOnly({ cliValues: ['structureddata'] })).toThrow('unknown module "structureddata"');
  });

  it('accepts every module id', () => {
    expect(resolveOnly({ cliValues: [MODULE_IDS.join(',')] })).toEqual([...MODULE_IDS]);
  });
});
