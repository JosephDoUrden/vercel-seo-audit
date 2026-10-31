import { describe, it, expect } from 'vitest';
import { resolveSkipPacks } from './skipPacks.js';

describe('resolveSkipPacks', () => {
  it('returns no packs when neither the CLI nor the config sets any', () => {
    expect(resolveSkipPacks({})).toEqual([]);
    expect(resolveSkipPacks({ cliValues: [], config: {} })).toEqual([]);
  });

  it('accepts a repeated --skip-pack, trims spaces and drops empty entries and duplicates', () => {
    expect(resolveSkipPacks({ cliValues: ['vercel, ', ' nextjs,,', 'vercel'] })).toEqual(['vercel', 'nextjs']);
  });

  it('reads packs from the config', () => {
    expect(resolveSkipPacks({ config: { skipPacks: ['nextjs'] } })).toEqual(['nextjs']);
  });

  it('lets the CLI replace the config', () => {
    expect(resolveSkipPacks({ cliValues: ['vercel'], config: { skipPacks: ['nextjs'] } })).toEqual(['vercel']);
  });

  it('treats an empty --skip-pack as unset and falls back to the config', () => {
    expect(resolveSkipPacks({ cliValues: [], config: { skipPacks: ['vercel'] } })).toEqual(['vercel']);
  });

  it('names the flag when the CLI gives an unknown pack', () => {
    expect(() => resolveSkipPacks({ cliValues: ['generic'] })).toThrow('Error in --skip-pack: unknown pack "generic" (valid: vercel, nextjs)');
  });

  it('names the config file when the config gives an unknown pack', () => {
    expect(() => resolveSkipPacks({ config: { skipPacks: ['Vercel'] } })).toThrow('Error in .seoauditrc.json: unknown pack "Vercel"');
  });
});
