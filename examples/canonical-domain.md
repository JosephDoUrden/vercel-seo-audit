# Example: Canonical domain choice on Vercel (www vs non-www)

Serving the same content on `www.example.com` and `example.com` without a
redirect splits link equity and creates duplicate-content issues. Pick one and
redirect the other.

## Step 1: Choose your canonical domain

| Choice | Canonical | Redirects to canonical |
| ------ | --------- | ---------------------- |
| Apex   | `example.com` | `www.example.com → example.com` |
| www    | `www.example.com` | `example.com → www.example.com` |

Either is fine. The apex (non-www) option is more common for modern sites.

## Step 2: Configure Vercel redirects

In `vercel.json`:

```json
{
  "redirects": [
    {
      "source": "/:path(.*)",
      "has": [{ "type": "host", "value": "www.example.com" }],
      "destination": "https://example.com/:path",
      "permanent": true
    }
  ]
}
```

This redirects all `www` traffic to the apex domain with a 308 (permanent).

## Step 3: Align everything else

Once you've chosen your canonical domain, make sure **all** of these match:

1. **`<link rel="canonical">`** — must use the canonical domain.
2. **Sitemap URLs** — must use the canonical domain.
3. **`robots.txt` `Sitemap:` directive** — must use the canonical domain.
4. **Open Graph `og:url`** — must use the canonical domain.
5. **Hreflang `href` values** — must use the canonical domain.

### Example in Next.js App Router

```typescript
// app/layout.tsx
export const metadata = {
  metadataBase: new URL('https://example.com'),
  alternates: {
    canonical: '/',
  },
};
```

Setting `metadataBase` ensures all generated metadata (canonical, OG, sitemap)
uses the correct domain.

## Verify with vercel-seo-audit

```bash
npx vercel-seo-audit https://example.com --verbose
```

The tool checks for:

- `CANONICAL_MISMATCH` — canonical URL doesn't match the page URL
- `REDIRECT_CHAIN` — multiple hops (e.g. `http://www` → `https://www` → `https://apex`)
- `HTTP_TO_HTTPS_REDIRECT` — missing HTTPS redirect
- `SITEMAP_ROBOTS_MISMATCH` — sitemap URL in `robots.txt` differs from actual location
