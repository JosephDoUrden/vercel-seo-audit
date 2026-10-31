import { MODULE_PACK_IDS } from '../types.js';
import type { ModulePack, SeoAuditConfig } from '../types.js';
import { CONFIG_FILE } from './config.js';

const knownPacks = new Set<string>(MODULE_PACK_IDS);

/**
 * Returns the packs to leave out from `--skip-pack` or, when the CLI sets none,
 * the `skipPacks` array in `.seoauditrc.json`. The CLI replaces the config rather
 * than adding to it. Returns an empty array when neither sets anything. An
 * unknown pack throws an error that names the source it came from.
 */
export function resolveSkipPacks(opts: { cliValues?: string[]; config?: SeoAuditConfig }): ModulePack[] {
  const cli = (opts.cliValues ?? []).flatMap((v) => v.split(',')).map((pack) => pack.trim()).filter(Boolean);
  const [source, values]: [string, string[]] = cli.length > 0
    ? ['--skip-pack', cli]
    : [CONFIG_FILE, opts.config?.skipPacks ?? []];

  const packs = new Set<ModulePack>();
  for (const pack of values) {
    if (!knownPacks.has(pack)) {
      throw new Error(`Error in ${source}: unknown pack "${pack}" (valid: ${MODULE_PACK_IDS.join(', ')})`);
    }
    packs.add(pack as ModulePack);
  }
  return [...packs];
}
