# Contributing to vercel-seo-audit

Thanks for your interest in contributing! This guide covers everything you need to get started.

## Getting started

### 1. Fork and clone

```bash
# Fork the repo on GitHub, then:
git clone https://github.com/<your-username>/vercel-seo-audit.git
cd vercel-seo-audit
npm install
```

### 2. Create a branch

```bash
git checkout -b feat/my-feature
# or: fix/my-bugfix, docs/my-change
```

### 3. Build and test

```bash
npm run build        # compile TypeScript
npm test             # run all tests
npm run test:watch   # watch mode during development
npm run typecheck    # type-check without emitting
```

### 4. Make your changes

- Follow the existing code style (no linter configured — match what's there).
- Use `.js` extensions in all imports (ESM requirement).
- Use `import type` for type-only imports.

### 5. Submit a pull request

```bash
git push origin feat/my-feature
```

Then open a PR against `main` on GitHub. Fill in the PR template and link any related issues.

---

## How to add a new audit check

All audit modules live in `src/audit/`. Follow this pattern:

1. **Add issue codes** to `src/types.ts` — add entries to `IssueCode` and (if needed) `IssueCategory`.

2. **Create the module** at `src/audit/myCheck.ts`:

   ```typescript
   import type { AuditContext, AuditFinding } from '../types.js';

   export async function auditMyCheck(ctx: AuditContext): Promise<AuditFinding[]> {
     const findings: AuditFinding[] = [];

     // Reuse ctx.html if available, otherwise fetch
     let html = ctx.html;
     if (!html) {
       // fetch and assign to ctx.html
     }

     // Run checks, push findings…

     return findings;
   }
   ```

3. **Export it** from `src/audit/index.ts`.

4. **Register it** in `src/runner.ts` — add to `phase2Modules` (or `phase1Modules` if it must run before the HTML-dependent checks).

5. **Write tests** at `src/audit/myCheck.test.ts`. Use `ctx.html` directly (see `structuredData.test.ts` for the pattern). Mock HTTP calls with `vi.mock()`.

6. **Update `src/runner.test.ts`** — add the mock and include it in the "includes all module results" assertion.

---

## How to reproduce an issue

If you're investigating a bug or false positive:

```bash
# Run against the problem URL with verbose output
npx vercel-seo-audit https://example.com --verbose

# Save a JSON report for comparison
npx vercel-seo-audit https://example.com --report json

# Diff against a known-good baseline
npx vercel-seo-audit https://example.com --diff baseline.json
```

Include the verbose output and/or JSON report in your bug report.

---

## Reporting false positives

If the tool reports an issue that isn't actually a problem:

1. Open an issue using the **False positive** template.
2. Include the URL (or a minimal HTML snippet that triggers the finding).
3. State what the tool reported and why it's incorrect.

---

## Commit style

Follow the existing convention:

```
type: description (#issue)
```

Types: `feat`, `fix`, `chore`, `docs`, `test`, `refactor`.

---

## Code of Conduct

This project follows the [Contributor Covenant](./CODE_OF_CONDUCT.md). Please read it before participating.
