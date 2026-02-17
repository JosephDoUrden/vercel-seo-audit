# Project Rules

## Git & PR conventions
- Never add `Co-Authored-By` lines to commits
- Never add "Generated with Claude" or similar attribution to PR descriptions
- All commits and PRs should appear as if authored solely by the user
- Follow existing commit style: `type: description (#issue)` (e.g. `feat:`, `fix:`, `chore:`, `docs:`)

## Tech stack
- TypeScript 5.3, Node.js 18+, ES modules (`"type": "module"`)
- Build: `npm run build` (tsc only)
- Test: `npm test` (vitest)
- No linter/formatter configured — follow existing code style

## Code conventions
- Use `.js` extensions in all imports (ESM requirement): `import { x } from './file.js'`
- Use `import type` for type-only imports
- camelCase for functions/variables, PascalCase for types, SCREAMING_SNAKE_CASE for constants
- All types live in `src/types.ts`
- Audit modules follow the pattern: `async function auditX(ctx: AuditContext): Promise<AuditFinding[]>`
- Output formatters live in `src/utils/output.ts` — three formats: console (chalk), JSON, Markdown
- Error handling: try-catch with `process.exit(2)` for CLI errors, `Promise.allSettled()` for audit modules

## Project structure
- `src/cli.ts` — CLI entry point (Commander)
- `src/runner.ts` — Audit orchestration (two-phase parallel execution)
- `src/audit/` — Individual audit modules (redirects, robots, sitemap, metadata, favicon, nextjs)
- `src/utils/` — HTTP, HTML/XML parsing, URL normalization, output formatting
- `src/constants.ts` — Default values and presets
- `src/exitCode.ts` — Exit code logic
- `bin/` — Executable entry point
- `dist/` — Build output (gitignored)

## CI
- GitHub Actions runs build + test on Node 18 & 20 for PRs to main
- npm publish triggered by GitHub Releases
