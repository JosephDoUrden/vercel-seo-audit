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
