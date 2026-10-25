import { MODULE_IDS } from '../types.js';
import type { ModuleId, SeoAuditConfig } from '../types.js';
import { CONFIG_FILE } from './config.js';

const knownIds = new Set<string>(MODULE_IDS);

/**
 * Returns the modules to run from `--only` or, when the CLI sets none, the
 * `only` array in `.seoauditrc.json`. The CLI replaces the config rather than
 * adding to it. Returns undefined when neither sets anything (a full run). An
 * unknown id throws an error that names the source it came from.
 */
export function resolveOnly(opts: { cliValues?: string[]; config?: SeoAuditConfig }): ModuleId[] | undefined {
  const cli = (opts.cliValues ?? []).flatMap((v) => v.split(',')).map((id) => id.trim()).filter(Boolean);
  const [source, values]: [string, string[]] = cli.length > 0
    ? ['--only', cli]
    : [CONFIG_FILE, opts.config?.only ?? []];
  if (values.length === 0) return undefined;

  const ids = new Set<ModuleId>();
  for (const id of values) {
    if (!knownIds.has(id)) {
      throw new Error(`Error in ${source}: unknown module "${id}" (valid: ${MODULE_IDS.join(', ')})`);
    }
    ids.add(id as ModuleId);
  }
  return [...ids];
}
