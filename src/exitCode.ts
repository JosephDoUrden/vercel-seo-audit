/**
 * `2` when the audited page could not be fetched at all (nothing was audited),
 * otherwise `1` for errors, or for warnings under `strict`, and `0` for the rest.
 */
export function getExitCode(
  summary: { errors: number; warnings: number },
  strict: boolean,
  targetReached = true,
): number {
  if (!targetReached) return 2;
  if (summary.errors > 0) return 1;
  if (strict && summary.warnings > 0) return 1;
  return 0;
}

/** Commander's own exits: 0 stays 0 (--help, --version), and a usage error is 2, like any other bad input. */
export function usageExitCode(commanderExitCode: number): number {
  return commanderExitCode === 0 ? 0 : 2;
}
