import type { AuditContext, AuditFinding } from '../types.js';
import { fetchHead, fetchPage } from '../utils/http.js';
import { getImages } from '../utils/html-parser.js';

const LARGE_FILE_THRESHOLD = 200 * 1024; // 200KB
const MAX_HEAD_REQUESTS = 5;

export async function auditImages(ctx: AuditContext): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];

  let html = ctx.html;
  if (!html) {
    try {
      const page = await fetchPage(ctx.normalizedUrl, ctx.fetchOptions);
      html = page.body;
      ctx.html = html;
    } catch {
      return findings;
    }
  }

  const images = getImages(html);
  if (images.length === 0) return findings;

  const isNextjs = ctx.headers?.['x-powered-by']?.includes('Next.js') ?? false;

  // 1. Missing alt attribute
  const missingAlt = images.filter((img) => !img.hasAlt);
  if (missingAlt.length > 0) {
    findings.push({
      code: 'IMG_MISSING_ALT',
      severity: 'warning',
      category: 'images',
      message: `${missingAlt.length} image(s) missing alt attribute`,
      explanation:
        'Images without alt attributes are inaccessible to screen readers and may hurt SEO rankings.',
      suggestion:
        'Add descriptive alt text to all images. Use alt="" only for purely decorative images.',
      details: { count: missingAlt.length, srcs: missingAlt.map((i) => i.src) },
      url: ctx.normalizedUrl,
    });
  }

  // 2. Empty alt on potentially non-decorative images
  const emptyAlt = images.filter((img) => img.hasAlt && img.alt === '');
  if (emptyAlt.length > 0) {
    findings.push({
      code: 'IMG_EMPTY_ALT',
      severity: 'info',
      category: 'images',
      message: `${emptyAlt.length} image(s) with empty alt attribute`,
      explanation:
        'Empty alt text marks images as decorative. Verify these images are truly decorative and not content-bearing.',
      suggestion:
        'Review images with alt="" and add descriptive text if they convey meaningful content.',
      details: { count: emptyAlt.length, srcs: emptyAlt.map((i) => i.src) },
      url: ctx.normalizedUrl,
    });
  }

  // 3. Not using next/image on Next.js sites
  if (isNextjs) {
    const noNextImage = images.filter((img) => !img.isNextImage);
    if (noNextImage.length > 0) {
      findings.push({
        code: 'IMG_NO_NEXT_IMAGE',
        severity: 'info',
        category: 'images',
        message: `${noNextImage.length} image(s) not using next/image component`,
        explanation:
          'The next/image component provides automatic optimization, lazy loading, and responsive sizing.',
        suggestion:
          'Replace <img> tags with the Next.js <Image> component for automatic optimization.',
        details: { count: noNextImage.length, srcs: noNextImage.map((i) => i.src) },
        url: ctx.normalizedUrl,
      });
    }
  }

  // 4. Missing lazy loading on non-first images
  const nonFirstImages = images.slice(1);
  const noLazy = nonFirstImages.filter((img) => img.loading !== 'lazy');
  if (noLazy.length > 0) {
    findings.push({
      code: 'IMG_NO_LAZY_LOADING',
      severity: 'info',
      category: 'images',
      message: `${noLazy.length} below-fold image(s) missing loading="lazy"`,
      explanation:
        'Images without lazy loading are fetched immediately, increasing initial page load time and hurting LCP.',
      suggestion:
        'Add loading="lazy" to images that appear below the fold to defer loading until needed.',
      details: { count: noLazy.length, srcs: noLazy.map((i) => i.src) },
      url: ctx.normalizedUrl,
    });
  }

  // 5. Large file sizes (HEAD requests, max 5)
  const absoluteImages = images
    .filter((img) => img.src.startsWith('http://') || img.src.startsWith('https://'))
    .slice(0, MAX_HEAD_REQUESTS);

  const largeFiles: { src: string; size: number }[] = [];
  for (const img of absoluteImages) {
    try {
      const { headers } = await fetchHead(img.src, ctx.fetchOptions);
      const contentLength = headers.get('content-length');
      if (contentLength) {
        const size = parseInt(contentLength, 10);
        if (size > LARGE_FILE_THRESHOLD) {
          largeFiles.push({ src: img.src, size });
        }
      }
    } catch {
      // Skip images we can't reach
    }
  }

  if (largeFiles.length > 0) {
    findings.push({
      code: 'IMG_LARGE_FILE',
      severity: 'warning',
      category: 'images',
      message: `${largeFiles.length} image(s) exceed 200KB`,
      explanation:
        'Large images significantly slow page load times and negatively impact Core Web Vitals (LCP).',
      suggestion:
        'Compress images, use modern formats like WebP or AVIF, and serve appropriately sized images.',
      details: {
        files: largeFiles.map((f) => ({
          src: f.src,
          sizeKB: Math.round(f.size / 1024),
        })),
      },
      url: ctx.normalizedUrl,
    });
  }

  // 6. Missing dimensions
  const missingDimensions = images.filter((img) => !img.width || !img.height);
  if (missingDimensions.length > 0) {
    findings.push({
      code: 'IMG_MISSING_DIMENSIONS',
      severity: 'warning',
      category: 'images',
      message: `${missingDimensions.length} image(s) missing width/height attributes`,
      explanation:
        'Images without explicit dimensions cause layout shifts (CLS) as the browser cannot reserve space before loading.',
      suggestion:
        'Add width and height attributes to all images to prevent cumulative layout shift.',
      details: { count: missingDimensions.length, srcs: missingDimensions.map((i) => i.src) },
      url: ctx.normalizedUrl,
    });
  }

  return findings;
}
