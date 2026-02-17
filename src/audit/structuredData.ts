import * as cheerio from 'cheerio';
import type { AuditContext, AuditFinding } from '../types.js';
import { fetchPage } from '../utils/http.js';

const REQUIRED_FIELDS: Record<string, string[]> = {
  Article: ['headline', 'author'],
  BreadcrumbList: ['itemListElement'],
  FAQPage: ['mainEntity'],
  Product: ['name'],
  Organization: ['name'],
  WebSite: ['name', 'url'],
  LocalBusiness: ['name', 'address'],
};

export async function auditStructuredData(ctx: AuditContext): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];
  const { normalizedUrl, fetchOptions } = ctx;

  let html = ctx.html;
  if (!html) {
    try {
      const page = await fetchPage(normalizedUrl, fetchOptions);
      html = page.body;
      ctx.html = html;
    } catch {
      return findings;
    }
  }

  const $ = cheerio.load(html);
  const scripts = $('script[type="application/ld+json"]');

  if (scripts.length === 0) {
    findings.push({
      code: 'JSONLD_MISSING',
      severity: 'warning',
      category: 'structured-data',
      message: 'No JSON-LD structured data found',
      explanation:
        'Structured data helps search engines understand your content and can enable rich results (FAQ snippets, breadcrumbs, product cards).',
      suggestion:
        'Add a <script type="application/ld+json"> block with schema.org markup relevant to your page content.',
      url: normalizedUrl,
    });
    return findings;
  }

  const detectedTypes: string[] = [];

  scripts.each((_, el) => {
    const raw = $(el).text().trim();
    if (!raw) return;

    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      findings.push({
        code: 'JSONLD_INVALID_JSON',
        severity: 'error',
        category: 'structured-data',
        message: 'Invalid JSON in JSON-LD block',
        explanation:
          'A <script type="application/ld+json"> block contains malformed JSON that search engines cannot parse.',
        suggestion: 'Fix the JSON syntax error. Validate your JSON-LD at https://search.google.com/test/rich-results.',
        details: { snippet: raw.slice(0, 200) },
        url: normalizedUrl,
      });
      return;
    }

    const objects = Array.isArray(data) ? data : [data];

    for (const obj of objects) {
      if (typeof obj !== 'object' || obj === null) continue;
      const record = obj as Record<string, unknown>;

      if (!record['@context']) {
        findings.push({
          code: 'JSONLD_MISSING_CONTEXT',
          severity: 'warning',
          category: 'structured-data',
          message: 'JSON-LD block missing @context',
          explanation:
            'Without @context, search engines may not recognize the structured data vocabulary.',
          suggestion: 'Add "@context": "https://schema.org" to your JSON-LD object.',
          url: normalizedUrl,
        });
      }

      if (!record['@type']) {
        findings.push({
          code: 'JSONLD_MISSING_TYPE',
          severity: 'warning',
          category: 'structured-data',
          message: 'JSON-LD block missing @type',
          explanation:
            'Without @type, search engines cannot determine what kind of entity the data describes.',
          suggestion: 'Add an @type property (e.g. "WebSite", "Organization", "Article").',
          url: normalizedUrl,
        });
        continue;
      }

      const type = String(record['@type']);
      detectedTypes.push(type);

      const required = REQUIRED_FIELDS[type];
      if (required) {
        const missing = required.filter((field) => {
          const value = record[field];
          if (value === undefined || value === null || value === '') return true;
          if (Array.isArray(value) && value.length === 0) return true;
          return false;
        });

        if (missing.length > 0) {
          findings.push({
            code: 'JSONLD_EMPTY_FIELDS',
            severity: 'warning',
            category: 'structured-data',
            message: `JSON-LD ${type} missing required fields: ${missing.join(', ')}`,
            explanation:
              `The ${type} schema is missing fields that Google expects for rich result eligibility.`,
            suggestion:
              `Add the missing properties: ${missing.join(', ')}. See https://schema.org/${type} for details.`,
            details: { type, missingFields: missing },
            url: normalizedUrl,
          });
        }
      }
    }
  });

  if (detectedTypes.length > 0) {
    findings.push({
      code: 'JSONLD_MISSING' as const,
      severity: 'pass',
      category: 'structured-data',
      message: `Found structured data: ${detectedTypes.join(', ')}`,
      explanation: 'Valid JSON-LD structured data was detected on the page.',
      suggestion: 'Verify your structured data at https://search.google.com/test/rich-results.',
      details: { types: detectedTypes },
      url: normalizedUrl,
    });
  }

  return findings;
}
