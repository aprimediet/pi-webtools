# @aprimediet/webtools

Self-hosted **web tools** for the [pi coding agent](https://www.npmjs.com/package/@earendil-works/pi-coding-agent): fetch, extract, search, and crawl — using only npm/npx/docker backends. **No MCP, no hosted scraping APIs.** The engine is **Playwright**; extraction is **Mozilla Readability + Turndown**; search drives the browser over a public engine's HTML.

## Tools

| Tool | Params | Returns |
|---|---|---|
| `web_fetch` | `url`, `render?`(auto/static/browser), `format?`(markdown/text/html), `timeoutMs?`, `maxBytes?` | page content as markdown/text/html + `{finalUrl,status,title,bytes,renderUsed,truncated}` |
| `web_extract` | `url`, `html?`, `render?`, `format?`(markdown/text), `includeMetadata?`, `selectors?`(name→CSS) | main article markdown + `{title,byline,siteName,publishedTime,lang,excerpt,fields}` |
| `web_search` | `query`, `limit?`, `engine?`(duckduckgo/bing/brave) | `[{title,url,snippet}]` scraped from the engine's HTML |
| `web_crawl` | `startUrl`, `maxPages?`(20, cap 100), `maxDepth?`(2), `sameOrigin?`, `include?`/`exclude?`, `render?`, `format?`, `concurrency?`(3, cap 5) | combined per-page markdown + `{pageCount,pages[]}` (streams progress) |

`render:auto` fetches statically and **escalates to the headless browser** if the page looks like a JS shell. The browser is launched **once** and reused, then closed on session shutdown.

## Setup (self-hosted backends)

Third-party libs (`playwright`, `@mozilla/readability`, `jsdom`, `turndown`, `turndown-plugin-gfm`) install automatically with the package. **Playwright browser binaries do not** — install them once:

```bash
npx playwright install --with-deps chromium
```

Or point at a **Docker / remote browser** (zero local install) and set:

```bash
export PLAYWRIGHT_CDP=http://localhost:9222         # Chrome DevTools Protocol endpoint
# or
export PLAYWRIGHT_WS_ENDPOINT=ws://localhost:3000   # a Playwright server / browserless container
```

## Configuration (env + flags)

| Env | Flag | Meaning |
|---|---|---|
| `WEBTOOLS_RENDER` | `--render-default` | default render mode (`auto`) |
| `WEBTOOLS_SEARCH_ENGINE` | `--search-engine` | default engine (`duckduckgo`) |
| `WEBTOOLS_USER_AGENT` | `--user-agent` | UA string |
| `WEBTOOLS_ALLOW_PRIVATE` | `--allow-private` | allow private/loopback hosts (off by default) |
| `WEBTOOLS_IGNORE_ROBOTS` | — | crawl ignores robots.txt (off by default) |
| `PLAYWRIGHT_CDP` / `PLAYWRIGHT_WS_ENDPOINT` | — | connect to a remote/Docker browser |

`/webtools` prints the current config and chosen browser backend.

## Safety

- **SSRF guard:** `web_fetch`/`web_extract`/`web_crawl` resolve the host and **block loopback/private/link-local ranges** (`127/8`, `10/8`, `172.16/12`, `192.168/16`, `169.254/16`, `::1`, `fc00::/7`, `*.local`) unless `WEBTOOLS_ALLOW_PRIVATE=1`.
- **Caps:** per-request timeout (30s) and `maxBytes` (~5 MB); crawl caps per-page (30 KB) and total output (200 KB), honors robots.txt, rate-limits, and a concurrency cap.
- **Search** scrapes a public engine's HTML, so it's best-effort: on a consent/captcha/changed page it **throws** a clear error (try another `engine`).

## Install / run

```bash
pi install npm:@aprimediet/webtools
pi list

# Quick try without installing
pi -e ./extensions/webtools/index.ts

# Hot-reload during dev
/reload
```

## Layout

```
webtools/                 # @aprimediet/webtools
├── package.json          # pi manifest + deps
├── index.ts              # factory: 4 tools + flags + /webtools + cleanup
├── browser.ts            # SSRF guard + shared Playwright + fetchHtml
├── extract.ts            # Readability + selectors
├── search.ts             # Playwright SERP scraping (ddg/bing/brave)
├── crawl.ts              # BFS crawler
├── markdown.ts           # Turndown/jsdom HTML→markdown/text helpers
└── config.ts             # env/flag-driven config
```
