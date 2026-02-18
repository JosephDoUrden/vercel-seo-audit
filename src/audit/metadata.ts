import type { AuditContext, AuditFinding } from '../types.js';
import { fetchPage, fetchHead } from '../utils/http.js';
import {
  getCanonicalUrl,
  getNoindexDirective,
  getCharset,
  getViewport,
  getTitle,
  getMetaTag,
} from '../utils/html-parser.js';
import { isSameOrigin } from '../utils/url.js';

export async function auditMetadata(ctx: AuditContext): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];
  const { normalizedUrl, fetchOptions } = ctx;

  let html: string;
  let headers: Headers;
  let finalUrl: string;

  try {
    const page = await fetchPage(normalizedUrl, fetchOptions);
    html = page.body;
    headers = page.headers;
    finalUrl = page.finalUrl;
    ctx.html = html;
    ctx.headers = Object.fromEntries(headers.entries());
  } catch {
    return findings;
  }

  // 1. Noindex check — meta tag
  if (getNoindexDirective(html)) {
    findings.push({
      code: 'NOINDEX_DETECTED',
      severity: 'error',
      category: 'indexing',
      message: 'noindex meta tag detected on homepage',
      explanation:
        'A noindex directive tells search engines not to include this page in search results.',
      suggestion:
        'Remove the noindex directive unless you intentionally want to prevent indexing.',
      url: normalizedUrl,
    });
  }

  // 2. Noindex check — X-Robots-Tag header
  const xRobots = headers.get('x-robots-tag') ?? '';
  if (xRobots.toLowerCase().includes('noindex')) {
    findings.push({
      code: 'X_ROBOTS_NOINDEX',
      severity: 'error',
      category: 'indexing',
      message: 'X-Robots-Tag: noindex header detected',
      explanation:
        'The X-Robots-Tag header with noindex prevents search engines from indexing this page.',
      suggestion:
        'Remove the X-Robots-Tag noindex header from your server configuration or middleware.',
      details: { header: xRobots },
      url: normalizedUrl,
    });
  }

  // 3. Canonical URL checks
  const canonical = getCanonicalUrl(html);
  if (!canonical) {
    findings.push({
      code: 'CANONICAL_MISSING',
      severity: 'warning',
      category: 'metadata',
      message: 'No canonical URL found on homepage',
      explanation:
        'Without a canonical tag, search engines may index duplicate versions of your page.',
      suggestion:
        'Add a <link rel="canonical"> tag pointing to the preferred URL of this page.',
      url: normalizedUrl,
    });
  } else {
    try {
      const canonicalFull = new URL(canonical, finalUrl).href;

      if (canonicalFull !== finalUrl && canonicalFull !== normalizedUrl) {
        findings.push({
          code: 'CANONICAL_MISMATCH',
          severity: 'warning',
          category: 'metadata',
          message: 'Canonical URL does not match the page URL',
          explanation:
            'A mismatched canonical signals to search engines that this page is a duplicate of another.',
          suggestion:
            'Ensure the canonical URL matches the page URL, or verify the mismatch is intentional.',
          details: { canonical: canonicalFull, pageUrl: finalUrl },
          url: normalizedUrl,
        });
      }

      if (!isSameOrigin(canonicalFull, normalizedUrl)) {
        findings.push({
          code: 'CANONICAL_EXTERNAL',
          severity: 'info',
          category: 'metadata',
          message: 'Canonical URL points to a different domain',
          explanation:
            'An external canonical tells search engines that this content originates on another domain.',
          suggestion:
            'Verify this is intentional. External canonicals transfer ranking signals to the other domain.',
          details: { canonical: canonicalFull },
          url: normalizedUrl,
        });
      }
    } catch {
      // Invalid canonical URL
    }
  }

  // 4. Charset
  const charset = getCharset(html);
  if (!charset) {
    findings.push({
      code: 'CHARSET_MISSING',
      severity: 'info',
      category: 'metadata',
      message: 'No charset declaration found',
      explanation:
        'Without a charset declaration, browsers may misinterpret special characters on your page.',
      suggestion: 'Add <meta charset="utf-8"> to the <head> of your document.',
      url: normalizedUrl,
    });
  }

  // 5. Viewport
  const viewport = getViewport(html);
  if (!viewport) {
    findings.push({
      code: 'VIEWPORT_MISSING',
      severity: 'warning',
      category: 'metadata',
      message: 'No viewport meta tag found',
      explanation:
        'Without a viewport tag, mobile devices may render the page at desktop width, harming mobile SEO.',
      suggestion: 'Add <meta name="viewport" content="width=device-width, initial-scale=1">.',
      url: normalizedUrl,
    });
  }

  // 6. Title
  const title = getTitle(html);
  if (!title) {
    findings.push({
      code: 'TITLE_MISSING',
      severity: 'warning',
      category: 'metadata',
      message: 'No <title> tag found',
      explanation:
        'The title tag is one of the most important on-page SEO elements. Missing titles hurt rankings.',
      suggestion: 'Add a unique, descriptive <title> tag to your page.',
      url: normalizedUrl,
    });
  }

  // 7. Meta description
  const description = getMetaTag(html, 'description');
  if (!description) {
    findings.push({
      code: 'DESCRIPTION_MISSING',
      severity: 'info',
      category: 'metadata',
      message: 'No meta description found',
      explanation:
        'Meta descriptions appear in search results and can improve click-through rates.',
      suggestion: 'Add a <meta name="description"> tag with a compelling summary of your page.',
      url: normalizedUrl,
    });
  }

  // 8. Open Graph tags
  const ogTitle = getMetaTag(html, 'og:title');
  const ogDescription = getMetaTag(html, 'og:description');
  const ogImage = getMetaTag(html, 'og:image');

  if (!ogTitle) {
    findings.push({
      code: 'OG_TITLE_MISSING',
      severity: 'info',
      category: 'metadata',
      message: 'No og:title meta tag found',
      explanation:
        'Open Graph tags control how your page appears when shared on social media platforms.',
      suggestion: 'Add <meta property="og:title"> for better social sharing previews.',
      url: normalizedUrl,
    });
  }

  if (!ogDescription) {
    findings.push({
      code: 'OG_DESCRIPTION_MISSING',
      severity: 'info',
      category: 'metadata',
      message: 'No og:description meta tag found',
      explanation:
        'og:description controls the description shown in social media previews.',
      suggestion: 'Add <meta property="og:description"> for better social sharing.',
      url: normalizedUrl,
    });
  }

  if (!ogImage) {
    findings.push({
      code: 'OG_IMAGE_MISSING',
      severity: 'info',
      category: 'metadata',
      message: 'No og:image meta tag found',
      explanation:
        'Social media platforms display a default placeholder when no og:image is set.',
      suggestion: 'Add <meta property="og:image"> with a representative image URL.',
      url: normalizedUrl,
    });
  } else {
    // 8a. Check if og:image uses a relative URL
    if (!ogImage.startsWith('http://') && !ogImage.startsWith('https://')) {
      findings.push({
        code: 'OG_IMAGE_RELATIVE',
        severity: 'warning',
        category: 'metadata',
        message: 'og:image uses a relative URL',
        explanation:
          'Many social media crawlers do not resolve relative URLs for og:image, which means your image may not appear in previews.',
        suggestion: 'Use an absolute URL (starting with https://) for og:image.',
        details: { ogImage },
        url: normalizedUrl,
      });
    }

    // 8b. Verify og:image URL returns 2xx
    try {
      const absoluteOgImage = ogImage.startsWith('http') ? ogImage : new URL(ogImage, finalUrl).href;
      const { status } = await fetchHead(absoluteOgImage, fetchOptions);
      if (status < 200 || status >= 300) {
        findings.push({
          code: 'OG_IMAGE_BROKEN',
          severity: 'warning',
          category: 'metadata',
          message: `og:image URL returned HTTP ${status}`,
          explanation:
            'A broken og:image means social media platforms cannot display your preview image.',
          suggestion: 'Ensure the og:image URL is accessible and returns a valid image.',
          details: { ogImage: absoluteOgImage, status },
          url: normalizedUrl,
        });
      }
    } catch {
      findings.push({
        code: 'OG_IMAGE_BROKEN',
        severity: 'warning',
        category: 'metadata',
        message: 'og:image URL could not be fetched',
        explanation:
          'A broken og:image means social media platforms cannot display your preview image.',
        suggestion: 'Ensure the og:image URL is accessible and returns a valid image.',
        details: { ogImage },
        url: normalizedUrl,
      });
    }
  }

  // 9. Twitter Card tags
  const twitterCard = getMetaTag(html, 'twitter:card');
  const twitterImage = getMetaTag(html, 'twitter:image');

  if (!twitterCard) {
    findings.push({
      code: 'TWITTER_CARD_MISSING',
      severity: 'info',
      category: 'metadata',
      message: 'No twitter:card meta tag found',
      explanation:
        'Without a twitter:card tag, Twitter/X may not display rich previews when your page is shared.',
      suggestion:
        'Add <meta name="twitter:card" content="summary_large_image"> for rich previews.',
      url: normalizedUrl,
    });
  }

  if (!twitterImage) {
    findings.push({
      code: 'TWITTER_IMAGE_MISSING',
      severity: 'info',
      category: 'metadata',
      message: 'No twitter:image meta tag found',
      explanation:
        'Without a twitter:image, Twitter/X falls back to og:image or shows no preview image.',
      suggestion:
        'Add <meta name="twitter:image"> with a URL to your preview image (recommended: 1200x628px).',
      url: normalizedUrl,
    });
  } else {
    // 9a. Verify twitter:image URL returns 2xx
    try {
      const absoluteTwitterImage = twitterImage.startsWith('http') ? twitterImage : new URL(twitterImage, finalUrl).href;
      const { status } = await fetchHead(absoluteTwitterImage, fetchOptions);
      if (status < 200 || status >= 300) {
        findings.push({
          code: 'TWITTER_IMAGE_BROKEN',
          severity: 'warning',
          category: 'metadata',
          message: `twitter:image URL returned HTTP ${status}`,
          explanation:
            'A broken twitter:image means Twitter/X cannot display your preview image.',
          suggestion: 'Ensure the twitter:image URL is accessible and returns a valid image.',
          details: { twitterImage: absoluteTwitterImage, status },
          url: normalizedUrl,
        });
      }
    } catch {
      findings.push({
        code: 'TWITTER_IMAGE_BROKEN',
        severity: 'warning',
        category: 'metadata',
        message: 'twitter:image URL could not be fetched',
        explanation:
          'A broken twitter:image means Twitter/X cannot display your preview image.',
        suggestion: 'Ensure the twitter:image URL is accessible and returns a valid image.',
        details: { twitterImage },
        url: normalizedUrl,
      });
    }
  }

  return findings;
}
