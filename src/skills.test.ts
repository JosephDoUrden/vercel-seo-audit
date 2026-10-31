import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { sourceRows } from './utils/catalog.js';

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf-8');

const SKILL_DIR = 'vercel-seo-audit';
const skill = read(`../skills/${SKILL_DIR}/SKILL.md`);
const cli = read('./cli.ts');

// Just enough YAML for the frontmatter: one `key: value` per line, no nesting.
function frontmatter(text: string): Record<string, string> {
  const block = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!block) throw new Error('SKILL.md has no frontmatter');
  const fields: Record<string, string> = {};
  for (const line of block[1].split('\n')) {
    const match = /^([a-z-]+):\s*(.+)$/.exec(line);
    if (!match) throw new Error(`Unparsed frontmatter line: ${line}`);
    fields[match[1]] = match[2].trim();
  }
  return fields;
}

// Long and short flags declared with .option() in cli.ts, plus the built-ins commander adds.
function cliFlags(): Set<string> {
  const flags = new Set(['--help', '-h', '--version', '-V']);
  for (const [, spec] of cli.matchAll(/\.option\('([^']+)'/g)) {
    for (const part of spec.split(/,\s*/)) flags.add(part.split(' ')[0]);
  }
  return flags;
}

describe('Agent Skill', () => {
  const fields = frontmatter(skill);

  it('has the frontmatter the Agent Skills spec requires', () => {
    expect(fields.name).toBe(SKILL_DIR);
    expect(fields.name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(fields.name.length).toBeLessThanOrEqual(64);
    expect(fields.description.length).toBeGreaterThan(0);
    expect(fields.description.length).toBeLessThanOrEqual(1024);
    if (fields.compatibility) expect(fields.compatibility.length).toBeLessThanOrEqual(500);
  });

  it('stays at 120 lines or fewer', () => {
    expect(skill.trimEnd().split('\n').length).toBeLessThanOrEqual(120);
  });

  it('only uses flags that cli.ts declares', () => {
    const known = cliFlags();
    const commands = skill.split('\n').filter((line) => line.includes('npx vercel-seo-audit'));
    expect(commands.length).toBeGreaterThan(0);
    for (const command of commands) {
      for (const flag of command.match(/(?<=\s)--?[a-zA-Z][\w-]*/g) ?? []) {
        expect(known, `${flag} in: ${command.trim()}`).toContain(flag);
      }
    }
  });

  it('names only issue codes that exist', () => {
    const codes = sourceRows().map(([, , code]) => code as string);
    for (const [, name, wildcard] of skill.matchAll(/`([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*_?)(\*)?`/g)) {
      if (wildcard) expect(codes.some((code) => code.startsWith(name)), `${name}*`).toBe(true);
      else if (name.includes('_')) expect(codes, name).toContain(name);
    }
  });
});

describe('Claude Code plugin marketplace', () => {
  const marketplace = JSON.parse(read('../.claude-plugin/marketplace.json')) as {
    name: string;
    plugins: { name: string; source: string }[];
  };
  const plugin = JSON.parse(read(`../skills/${SKILL_DIR}/.claude-plugin/plugin.json`)) as { name: string };

  it('points its one plugin at the skill directory, with matching names', () => {
    expect(marketplace.plugins).toHaveLength(1);
    expect(marketplace.plugins[0].source).toBe(`./skills/${SKILL_DIR}`);
    expect(marketplace.plugins[0].name).toBe(plugin.name);
    expect(plugin.name).toBe(SKILL_DIR);
  });
});
