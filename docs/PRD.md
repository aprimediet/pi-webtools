# Product Requirements Document: @aprimediet/webtools

**Version:** 1.0
**Date:** 2026-06-25
**Status:** Draft

## Overview
A self-hosted set of web tools (fetch, extract, search, crawl) that gives the pi coding agent headless-browser capabilities — no MCP, no hosted APIs, no API keys.

## Problem Statement
Coding agents need real-time access to the open web — searching for information, fetching pages, extracting article content, crawling docs sites — but existing solutions either require paid API keys, external services (MCP servers), or heavy dependency chains. Developers using the pi coding agent need a zero-friction, self-bootstrapping way to browse the internet from their agent.

## Goals
- Provide the pi coding agent with headless browser capabilities (search, fetch, extract, crawl websites)
- Minimum dependencies — only `npx` needed to get started; everything else self-installs
- Zero API keys required — no third-party services to sign up for
- Zero Docker requirement — runs purely on npm packages
- SSRF-safe by default — block private/loopback addresses unless explicitly allowed
- Respect robots.txt and rate-limit during crawls

## Non-Goals
- This is a set of tools, not a research assistant — the agent decides how to use them
- Not a general-purpose browser or scraping framework
- Not a search engine index or caching layer
- No cloud/hosted offering — fully self-hosted local
- No persistent storage or database integration
- No authentication/authz layer — it's a tool inside the agent's sandbox

## Target Users
Developers who use the pi coding agent and need their agent to access web content (developers building agent workflows, researchers using AI coding tools, technical users automating web research).

## Key Features
### Web Fetch (`web_fetch`)
Fetch any public URL and return its content as clean markdown, text, or raw HTML. Auto-detects JavaScript-rendered pages and escalates to a headless browser when the static response looks like a single-page app shell.

### Article Extraction (`web_extract`)
Extract the readable article from a page using Mozilla Readability — stripping navigation, ads, sidebars. Returns structured metadata (title, byline, publish date, site name). Optional CSS selector support for custom field extraction.

### Web Search (`web_search`)
Drive a headless browser over a public search engine's HTML results (DuckDuckGo, Bing, Brave). No API key needed — the browser scrapes the same HTML a human would see. Returns titles, URLs, and snippets.

### Web Crawl (`web_crawl`)
Breadth-first crawl from a starting URL, extracting each page to markdown. Depth- and page-capped, robots.txt-aware, concurrency-limited. Ideal for ingesting documentation sections.

## Success Metrics
- When the pi coding agent needs to search, fetch, extract, or crawl a website, the tool "just works" — no configuration, no API key setup, no service onboarding
- A new developer can get started with a single `pi install npm:@aprimediet/webtools` command
- The tools gracefully handle failures (JS shell pages, consent walls, changed SERP markup) with clear error messages

## Scope & Boundaries
- Only http/https URLs are supported (SSRF guard blocks all other protocols by default)
- Private/loopback addresses are blocked unless `WEBTOOLS_ALLOW_PRIVATE=1` is set
- Crawl respects robots.txt, rate-limits (250ms per origin), caps at 100 pages / depth 5
- Search engines are scraped — best-effort; if a SERP changes or shows a captcha, the error tells the user to try another engine
- Browser binary must be installed separately (`npx playwright install --with-deps chromium`) or a remote CDP/WS endpoint used

## Open Questions
- Should we add more search engines (e.g. Google via a different approach)?
- Should there be a caching layer for repeated fetches within a session?
- How should consent/captcha pages be handled more gracefully?
