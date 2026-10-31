import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MODULE_IDS, MODULE_PACKS } from './types.js';

const readme = readFileSync(fileURLToPath(new URL('../README.md', import.meta.url)), 'utf-8');

// [id, pack] from the first two columns of the module table under "### Running some modules only".
function tableRows(): [string, string][] {
  const section = readme.split('### Running some modules only')[1]?.split(/\n#{2,3} /)[0] ?? '';
  return [...section.matchAll(/^\| `([A-Za-z0-9]+)` \| ([a-z]+) \|/gm)].map((m): [string, string] => [m[1], m[2]]);
}

describe('README module table', () => {
  it('lists every module id, in run order, and nothing else', () => {
    expect(tableRows().map(([id]) => id)).toEqual([...MODULE_IDS]);
  });

  it('gives each module the pack MODULE_PACKS gives it', () => {
    expect(Object.fromEntries(tableRows())).toEqual(MODULE_PACKS);
  });
});

describe('AGENTS.md', () => {
  const agents = readFileSync(fileURLToPath(new URL('../AGENTS.md', import.meta.url)), 'utf-8');

  it('stays short and shows the two commands the README points at', () => {
    expect(agents.trimEnd().split('\n').length).toBeLessThanOrEqual(80);
    for (const command of ['npx vercel-seo-audit https://your-site.com --format agent', 'npx vercel-seo-audit explain ']) {
      expect(agents).toContain(command);
      expect(readme).toContain(command);
    }
  });
});
