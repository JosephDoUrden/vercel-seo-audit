# Example: Next.js App Router `robots.ts` + `sitemap.ts`

A common cause of "Discovered — currently not indexed" in Search Console is a
missing or misconfigured `robots.txt` and `sitemap.xml`. In the App Router these
are generated from TypeScript files.

## `app/robots.ts`

```typescript
import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/api/', '/admin/'],
      },
    ],
    sitemap: 'https://example.com/sitemap.xml',
  };
}
```

Key points:

- The `sitemap` field must be an **absolute URL** — relative paths won't work.
- Make sure the sitemap URL matches the canonical domain exactly (see [canonical-domain.md](./canonical-domain.md)).
- Don't accidentally block `/api/` routes that serve public JSON-LD or OG images.

## `app/sitemap.ts`

```typescript
import type { MetadataRoute } from 'next';

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: 'https://example.com',
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 1,
    },
    {
      url: 'https://example.com/about',
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.8,
    },
    // Add all public pages here
  ];
}
```

Key points:

- All URLs must be **absolute** and use the canonical domain.
- `lastModified` should reflect real content changes, not just build time.
- For large sites (> 50,000 URLs), use [sitemap index files](https://nextjs.org/docs/app/api-reference/file-conventions/metadata/sitemap#generating-multiple-sitemaps).

## Verify with vercel-seo-audit

```bash
npx vercel-seo-audit https://example.com --verbose
```

This will check that:

- `robots.txt` exists and doesn't block Googlebot
- `robots.txt` contains a `Sitemap:` directive
- `sitemap.xml` exists, isn't empty, and has valid URLs
- The `Sitemap:` directive in `robots.txt` matches the actual sitemap location
