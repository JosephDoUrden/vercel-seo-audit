import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { SeoAuditConfig } from '../types.js';

const CONFIG_FILE = '.seoauditrc.json';

export function loadConfig(): SeoAuditConfig | undefined {
  const filePath = resolve(process.cwd(), CONFIG_FILE);
  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf-8');
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined;
    }
    throw err;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Error in ${CONFIG_FILE}: invalid JSON`);
  }

  return validateConfig(parsed);
}

export function validateConfig(raw: unknown): SeoAuditConfig {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error(`Error in ${CONFIG_FILE}: config must be a JSON object`);
  }

  const obj = raw as Record<string, unknown>;
  const config: SeoAuditConfig = {};

  if ('url' in obj) {
    if (typeof obj.url !== 'string') {
      throw new Error(`Error in ${CONFIG_FILE}: "url" must be a string`);
    }
    try {
      const testUrl = /^https?:\/\//i.test(obj.url) ? obj.url : `https://${obj.url}`;
      new URL(testUrl);
    } catch {
      throw new Error(`Error in ${CONFIG_FILE}: "url" must be a valid URL`);
    }
    config.url = obj.url;
  }

  if ('strict' in obj) {
    if (typeof obj.strict !== 'boolean') {
      throw new Error(`Error in ${CONFIG_FILE}: "strict" must be a boolean`);
    }
    config.strict = obj.strict;
  }

  if ('verbose' in obj) {
    if (typeof obj.verbose !== 'boolean') {
      throw new Error(`Error in ${CONFIG_FILE}: "verbose" must be a boolean`);
    }
    config.verbose = obj.verbose;
  }

  if ('userAgent' in obj) {
    if (typeof obj.userAgent !== 'string') {
      throw new Error(`Error in ${CONFIG_FILE}: "userAgent" must be a string`);
    }
    config.userAgent = obj.userAgent;
  }

  if ('pages' in obj) {
    if (!Array.isArray(obj.pages) || !obj.pages.every((p): p is string => typeof p === 'string')) {
      throw new Error(`Error in ${CONFIG_FILE}: "pages" must be an array of strings`);
    }
    for (const page of obj.pages) {
      if (!page.startsWith('/')) {
        throw new Error(`Error in ${CONFIG_FILE}: each page must start with "/", got "${page}"`);
      }
    }
    config.pages = obj.pages;
  }

  if ('report' in obj) {
    if (obj.report !== 'json' && obj.report !== 'md' && obj.report !== 'html') {
      throw new Error(`Error in ${CONFIG_FILE}: "report" must be "json", "md", or "html"`);
    }
    config.report = obj.report;
  }

  if ('timeout' in obj) {
    if (typeof obj.timeout !== 'number' || !isFinite(obj.timeout)) {
      throw new Error(`Error in ${CONFIG_FILE}: "timeout" must be a number`);
    }
    if (obj.timeout <= 0) {
      throw new Error(`Error in ${CONFIG_FILE}: "timeout" must be a positive number`);
    }
    config.timeout = obj.timeout;
  }

  return config;
}
