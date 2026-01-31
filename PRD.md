# vercel-seo-audit – Product Requirements Document (PRD)

## Overview
`vercel-seo-audit` is a CLI tool that diagnoses SEO and indexing issues for
Next.js websites deployed on Vercel.

Its primary goal is to explain *why Google is not indexing a site* in a clear,
developer-friendly way.

---

## Problem Statement
Many Next.js + Vercel projects experience indexing issues such as:
- "Page with redirect"
- "Discovered – currently not indexed"
- Ignored sitemaps
- Incorrect favicon or metadata rendering

Google Search Console reports the symptoms but does not explain the causes
or actionable fixes.

---

## Goals
- Identify common SEO & indexing misconfigurations
- Provide clear, actionable explanations
- Detect Vercel / Next.js–specific pitfalls
- Run entirely as a CLI tool

---

## Non-Goals
- Keyword analysis
- Backlink analysis
- Performance scoring (Lighthouse alternative)

---

## Target Users
- Indie hackers
- SaaS founders
- Freelance developers
- Agencies using Next.js + Vercel

---

## Features

### 1. Redirect Analysis
- Detect 301 / 307 / 308 redirects
- Identify redirect chains
- Detect meta refresh redirects
- Check HTTP → HTTPS consistency

### 2. Indexing Signals
- robots.txt existence and accessibility
- sitemap.xml existence and status
- Redirected URLs inside sitemap
- Canonical tag validation
- noindex detection

### 3. Next.js / Vercel Checks
- Trailing slash mismatches
- Middleware redirect loops
- App Router metadata presence
- Static vs dynamic rendering hints

### 4. Metadata & Favicon
- favicon availability and conflicts
- og:title / og:description presence
- meta charset and viewport

---

## CLI Interface

### Basic Usage
```bash
npx vercel-seo-audit https://example.com
