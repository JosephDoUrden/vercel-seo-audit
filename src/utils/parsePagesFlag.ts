export function parsePagesFlag(input: string): string[] {
  const paths = input.split(',').map((p) => p.trim()).filter((p) => p.length > 0);
  if (paths.length === 0) {
    throw new Error('--pages must contain at least one path');
  }
  for (const p of paths) {
    if (!p.startsWith('/')) {
      throw new Error(`Invalid page path "${p}": each path must start with "/"`);
    }
  }
  return paths;
}
