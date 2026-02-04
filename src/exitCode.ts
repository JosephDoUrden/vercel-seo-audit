export function getExitCode(
  summary: { errors: number; warnings: number },
  strict: boolean,
): number {
  if (summary.errors > 0) return 1;
  if (strict && summary.warnings > 0) return 1;
  return 0;
}
