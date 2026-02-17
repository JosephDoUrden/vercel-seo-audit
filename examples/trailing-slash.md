# Example: Handling `trailingSlash` in Next.js

Next.js has a `trailingSlash` config option that causes **308 Permanent Redirect**
responses. This is one of the most common SEO issues we detect.

## The problem

By default, Next.js strips trailing slashes:

```
/about/ → 308 → /about
```

If you set `trailingSlash: true` in `next.config.js`:

```
/about → 308 → /about/
```

Either choice is fine — **but you must be consistent**. Problems arise when:

1. Your canonical URLs don't match the redirect target.
2. Your sitemap contains URLs with the wrong slash style.
3. Internal links use the wrong style, causing unnecessary 308 hops.

## Recommended: pick one style and enforce it everywhere

### Option A: No trailing slash (default)

```javascript
// next.config.js
/** @type {import('next').NextConfig} */
const nextConfig = {
  // trailingSlash defaults to false — no config needed
};

export default nextConfig;
```

Then ensure:

- **Canonical URLs** never end with `/` (except the homepage).
- **Sitemap URLs** never end with `/` (except the homepage).
- **Internal `<Link>` hrefs** never end with `/`.

### Option B: Trailing slash

```javascript
// next.config.js
/** @type {import('next').NextConfig} */
const nextConfig = {
  trailingSlash: true,
};

export default nextConfig;
```

Then ensure:

- **Canonical URLs** always end with `/`.
- **Sitemap URLs** always end with `/`.
- **Internal `<Link>` hrefs** always end with `/`.

## Verify with vercel-seo-audit

```bash
npx vercel-seo-audit https://example.com --pages /about,/blog,/pricing
```

The tool checks for trailing-slash 308 redirect chains and reports them as
`NEXTJS_TRAILING_SLASH_308`. If you see this finding, your slash style isn't
consistent.
