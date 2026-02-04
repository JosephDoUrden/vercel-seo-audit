import { describe, it, expect } from 'vitest';
import { getExitCode } from './exitCode.js';

describe('getExitCode', () => {
  it('returns 1 when errors > 0 and strict is false', () => {
    expect(getExitCode({ errors: 1, warnings: 0 }, false)).toBe(1);
  });

  it('returns 1 when errors > 0 and strict is true', () => {
    expect(getExitCode({ errors: 2, warnings: 0 }, true)).toBe(1);
  });

  it('returns 0 when warnings > 0 and strict is false', () => {
    expect(getExitCode({ errors: 0, warnings: 3 }, false)).toBe(0);
  });

  it('returns 1 when warnings > 0 and strict is true', () => {
    expect(getExitCode({ errors: 0, warnings: 1 }, true)).toBe(1);
  });

  it('returns 0 when no errors or warnings and strict is false', () => {
    expect(getExitCode({ errors: 0, warnings: 0 }, false)).toBe(0);
  });

  it('returns 0 when no errors or warnings and strict is true', () => {
    expect(getExitCode({ errors: 0, warnings: 0 }, true)).toBe(0);
  });
});
