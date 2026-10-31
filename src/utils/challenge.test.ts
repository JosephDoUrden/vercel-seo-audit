import { describe, it, expect } from 'vitest';
import { detectChallenge } from './challenge.js';

describe('detectChallenge', () => {
  it('reads x-vercel-mitigated from a Headers object', () => {
    expect(detectChallenge(new Headers({ 'X-Vercel-Mitigated': 'challenge' }), 403)).toEqual({
      status: 403,
      provider: 'vercel',
      header: 'x-vercel-mitigated',
    });
  });

  it('reads cf-mitigated from a plain record', () => {
    expect(detectChallenge({ 'cf-mitigated': 'challenge' }, 429)).toEqual({
      status: 429,
      provider: 'cloudflare',
      header: 'cf-mitigated',
    });
  });

  it('ignores the header on a status a challenge is not served with', () => {
    expect(detectChallenge({ 'x-vercel-mitigated': 'challenge' }, 200)).toBeUndefined();
    expect(detectChallenge({ 'cf-mitigated': 'challenge' }, 404)).toBeUndefined();
  });

  it('ignores a mitigated header with another value', () => {
    expect(detectChallenge({ 'x-vercel-mitigated': 'deny' }, 403)).toBeUndefined();
  });

  it('ignores a 403 without either header', () => {
    expect(detectChallenge(new Headers({ server: 'Vercel' }), 403)).toBeUndefined();
  });
});
