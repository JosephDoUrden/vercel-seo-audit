import type { AuditFinding, FixSuggestion, IssueCode } from '../types.js';

type FixGenerator = (finding: AuditFinding, url: string) => FixSuggestion | null;

function fixRobotsMissing(_finding: AuditFinding, url: string): FixSuggestion {
  let sitemapUrl: string;
  try {
    const parsed = new URL(url);
    sitemapUrl = `${parsed.origin}/sitemap.xml`;
  } catch {
    sitemapUrl = `${url}/sitemap.xml`;
  }

  return {
    code: 'ROBOTS_MISSING',
    filePath: 'public/robots.txt',
    description: 'Create a robots.txt that allows all crawlers and references your sitemap',
    content: `User-agent: *\nAllow: /\n\nSitemap: ${sitemapUrl}\n`,
  };
}

function fixSitemapMissing(_finding: AuditFinding, url: string): FixSuggestion {
  let loc: string;
  try {
    const parsed = new URL(url);
    loc = parsed.origin + '/';
  } catch {
    loc = url;
  }

  return {
    code: 'SITEMAP_MISSING',
    filePath: 'public/sitemap.xml',
    description: 'Create a basic sitemap.xml with your homepage',
    content: `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${loc}</loc>
  </url>
</urlset>
`,
  };
}

function fixTrailingSlash308(_finding: AuditFinding, _url: string): FixSuggestion {
  return {
    code: 'NEXTJS_TRAILING_SLASH_308',
    filePath: 'next.config.js',
    description: 'Enable trailingSlash in Next.js config to avoid 308 redirects',
    content: `/** @type {import('next').NextConfig} */
const nextConfig = {
  trailingSlash: true,
};

module.exports = nextConfig;
`,
  };
}

const fixGenerators: Partial<Record<IssueCode, FixGenerator>> = {
  ROBOTS_MISSING: fixRobotsMissing,
  SITEMAP_MISSING: fixSitemapMissing,
  NEXTJS_TRAILING_SLASH_308: fixTrailingSlash308,
};

export function generateFixes(findings: AuditFinding[], url: string): FixSuggestion[] {
  const fixes: FixSuggestion[] = [];

  for (const finding of findings) {
    const generator = fixGenerators[finding.code];
    if (generator) {
      const fix = generator(finding, url);
      if (fix) {
        fixes.push(fix);
      }
    }
  }

  return fixes;
}
