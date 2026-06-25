# AGENTS.md — @aprimediet/webtools

Guide for coding agents working in this repository. Product context (goals, users, features, success metrics): see [docs/PRD.md](docs/PRD.md).

## Summary
A pi coding agent extension that registers 4 web tools (`web_fetch`, `web_extract`, `web_search`, `web_crawl`) using Playwright as the headless-browser engine, Mozilla Readability for article extraction, and Turndown for HTML→markdown conversion. No MCP, no hosted APIs.

## Tech Stack
- **Language:** TypeScript (ESM, `"type": "module"`)
- **Runtime:** Node.js, pi coding agent extension SDK (`@earendil-works/pi-coding-agent`, `@earendil-works/pi-ai`, `@earendil-works/pi-tui`, `typebox`)
- **Package Manager:** npm
- **Key Dependencies:** playwright, @mozilla/readability, jsdom, turndown, turndown-plugin-gfm
- **Infrastructure:** Local Playwright browser (or remote via CDP/WS); no Docker, no cloud services

## Project Structure
```
webtools/
├── package.json          # pi extension manifest + dependencies
├── index.ts              # Factory: registers 4 tools, 4 CLI flags, /webtools command, session cleanup
├── browser.ts            # SSRF guard + shared lazy Playwright browser + fetchHtml (static/browser/auto modes)
├── extract.ts            # Mozilla Readability extraction + CSS selector field extraction
├── search.ts             # Playwright-based SERP scraping (DuckDuckGo / Bing / Brave)
├── crawl.ts              # BFS crawler (robots.txt-aware, depth/page-capped, concurrency-limited)
├── markdown.ts           # HTML→Markdown/text helpers via Turndown + jsdom
├── config.ts             # Runtime config from env vars (WEBTOOLS_*, PLAYWRIGHT_*) + defaults
├── docs/
│   └── PRD.md            # Product requirements (human audience)
├── README.md             # User-facing docs
├── AGENTS.md             # This file
└── CLAUDE.md             # Claude Code pointer
```

## Commands
- **Setup:** `npm install` (installs js deps; Playwright binary needs `npx playwright install --with-deps chromium`)
- **Build:** The extension runs interpreted via pi; no build step needed (TypeScript is loaded directly)
- **Test:** No test framework configured yet
- **Run:** `pi -e ./extensions/webtools/index.ts` or `pi install npm:@aprimediet/webtools` then `/reload`
- **Lint:** Not configured

## Conventions
- **Naming:** camelCase for functions/variables, PascalCase for types/exports
- **Imports:** Bare `import` with `.ts` extension (e.g. `import { fetchHtml } from "./browser.ts"`)
- **Module structure:** Each `.ts` file is a self-contained module with a single responsibility
- **Error handling:** Throw descriptive `Error` messages; callers at the pi tool `execute` level catch them
- **Pi SDK pattern:** `registerTool({ name, label, description, promptSnippet, parameters, execute, renderResult })`
- **Comments:** JSDoc on exported functions describing intent and param/return shape
- **No Svelte/React/UI kit** — only native `Text` TUI component for rendering results
- **Portability:** Core logic modules (browser.ts, extract.ts, search.ts, crawl.ts, markdown.ts, config.ts) are dependency-free of pi SDK so they can be unit-tested directly with Node.js

## Boundaries (technical)
- **DO NOT** remove the SSRF guard (`assertPublicUrl` in browser.ts) — it's a security invariant
- **DO NOT** remove or reduce the caps/limits (maxBytes, timeoutMs, concurrency cap, page cap) — they prevent runaway resource usage
- **DO NOT** hardcode API keys or service URLs — the whole point is zero external services
- **DO NOT** persist user data or cache pages across sessions — the tools are stateless per-session
- **DO NOT** modify `package.json#pi.extensions` path without updating the manifest — pi discovers from there
- The `@ts-expect-error` in `markdown.ts:9` for `turndown-plugin-gfm` missing types is intentional and acceptable
- Config defaults come from env vars first, then CLI flags override on `session_start`

## Known Issues & Gotchas
- No test suite or test config exists — test coverage should be added
- No `tsconfig.json` — TypeScript is resolved by pi's SDK at runtime
- Search engines change their HTML structure frequently — selectors in `search.ts` may need updating
- `render:auto` mode may false-positive on very short pages that aren't SPA shells
- Crawler's `include`/`exclude` patterns are passed to `new RegExp()` — special chars must be escaped

## Companion Extensions
- **minion:** detected active (project `webtools-d79b18b1`, 0 open tasks). Check the kanban board before starting work to track ongoing tasks.
- **memory:** detected active (0 stored entries). Record durable facts (decisions, gotchas, progress) using `memory_write` with `scope: "project"`.

## Current Focus
The project just reached v1.0.0 (2 commits total). Current state: stable release with all 4 tools implemented. Next likely steps: add test coverage, refine error handling for search engine markup changes.
