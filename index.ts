/**
 * @aprimediet/webtools
 *
 * Self-hosted web tools for the pi coding agent — fetch, extract, search, crawl.
 * Engine: Playwright (+ static fetch). Extraction: Mozilla Readability + Turndown.
 * Search: Playwright scrapes a public engine's HTML. No MCP, no hosted APIs.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";

import { closeBrowser, fetchHtml } from "./browser.ts";
import { config, type RenderMode, type SearchEngine } from "./config.ts";
import { webCrawl } from "./crawl.ts";
import { extractArticle } from "./extract.ts";
import { extractTitle, pageToMarkdown, pageToText, sanitizeHtml } from "./markdown.ts";
import { webSearch } from "./search.ts";

const RENDER = StringEnum(["auto", "static", "browser"] as const);
const FETCH_FORMAT = StringEnum(["markdown", "text", "html"] as const);
const TEXT_FORMAT = StringEnum(["markdown", "text"] as const);
const ENGINE = StringEnum(["duckduckgo", "bing", "brave"] as const);

export default function webtoolsExtension(pi: ExtensionAPI): void {
	// ----------------------------------------------------------- web_fetch
	pi.registerTool({
		name: "web_fetch",
		label: "Web Fetch",
		description:
			"Fetch a URL and return its content as clean markdown, text, or html. Renders JavaScript when needed (render:auto/browser). Use for raw page content; prefer web_extract for article bodies.",
		promptSnippet: "Fetch a web page as markdown/text/html",
		parameters: Type.Object({
			url: Type.String({ description: "The URL to fetch (http/https)" }),
			render: Type.Optional(RENDER),
			format: Type.Optional(FETCH_FORMAT),
			timeoutMs: Type.Optional(Type.Number({ description: "Per-request timeout (ms)" })),
			maxBytes: Type.Optional(Type.Number({ description: "Max bytes to read" })),
		}),
		async execute(_id, params, signal) {
			const res = await fetchHtml(
				params.url,
				{ render: params.render as RenderMode, timeoutMs: params.timeoutMs, maxBytes: params.maxBytes },
				signal,
			);
			const format = params.format ?? "markdown";
			const text =
				format === "html"
					? sanitizeHtml(res.html, res.finalUrl)
					: format === "text"
						? pageToText(res.html, res.finalUrl)
						: pageToMarkdown(res.html, res.finalUrl);
			const title = extractTitle(res.html, res.finalUrl);
			return {
				content: [{ type: "text" as const, text: text || "(empty document)" }],
				details: {
					finalUrl: res.finalUrl,
					status: res.status,
					title,
					contentType: res.contentType,
					renderUsed: res.renderUsed,
					bytes: res.bytes,
					truncated: res.truncated,
				},
			};
		},
		renderResult(result, _opts, theme) {
			const d = result.details as { title?: string; finalUrl?: string; bytes?: number; renderUsed?: string };
			return new Text(
				`${theme.fg("toolTitle", theme.bold("web_fetch "))}${theme.fg("muted", d.title ?? d.finalUrl ?? "")} ${theme.fg("dim", `(${d.bytes ?? 0}b · ${d.renderUsed ?? "?"})`)}`,
				0,
				0,
			);
		},
	});

	// --------------------------------------------------------- web_extract
	pi.registerTool({
		name: "web_extract",
		label: "Web Extract",
		description:
			"Extract the main readable article (content + title/byline/date/lang metadata) from a URL or supplied HTML. Optionally pull structured fields via CSS selectors. Deterministic — no LLM, no service.",
		promptSnippet: "Extract the main article + metadata from a page",
		parameters: Type.Object({
			url: Type.String({ description: "The URL to extract from" }),
			html: Type.Optional(Type.String({ description: "Extract from this HTML instead of fetching" })),
			render: Type.Optional(RENDER),
			format: Type.Optional(TEXT_FORMAT),
			includeMetadata: Type.Optional(Type.Boolean({ description: "Include title/byline/etc. (default true)" })),
			selectors: Type.Optional(
				Type.Record(Type.String(), Type.String(), {
					description: "Map of field name → CSS selector for structured extraction",
				}),
			),
		}),
		async execute(_id, params, signal) {
			let html = params.html;
			let finalUrl = params.url;
			if (!html) {
				const res = await fetchHtml(params.url, { render: params.render as RenderMode }, signal);
				html = res.html;
				finalUrl = res.finalUrl;
			}
			const ex = extractArticle(html, finalUrl, {
				format: params.format as "markdown" | "text" | undefined,
				includeMetadata: params.includeMetadata,
				selectors: params.selectors as Record<string, string> | undefined,
			});
			const note = ex.fallback ? "\n\n_(no article detected — full-page extraction)_" : "";
			return {
				content: [{ type: "text" as const, text: (ex.content || "(no content)") + note }],
				details: {
					url: finalUrl,
					...ex.meta,
					fields: ex.fields,
					fallback: ex.fallback,
				},
			};
		},
		renderResult(result, _opts, theme) {
			const d = result.details as { title?: string; url?: string; fallback?: boolean };
			return new Text(
				`${theme.fg("toolTitle", theme.bold("web_extract "))}${theme.fg("muted", d.title ?? d.url ?? "")}${d.fallback ? theme.fg("dim", " (full-page)") : ""}`,
				0,
				0,
			);
		},
	});

	// ---------------------------------------------------------- web_search
	pi.registerTool({
		name: "web_search",
		label: "Web Search",
		description:
			"Search the web by driving a headless browser over a public search engine's HTML results. Returns a list of {title, url, snippet}. Use to find URLs, then web_fetch/web_extract them.",
		promptSnippet: "Search the web for URLs",
		parameters: Type.Object({
			query: Type.String({ description: "The search query" }),
			limit: Type.Optional(Type.Number({ description: "Max results (default 10)" })),
			engine: Type.Optional(ENGINE),
		}),
		async execute(_id, params, signal) {
			const engine = (params.engine as SearchEngine) ?? config.searchEngine;
			const limit = Math.max(1, Math.min(params.limit ?? 10, 25));
			const { results } = await webSearch(params.query, limit, engine, signal);
			const text = results.map((r, i) => `${i + 1}. [${r.title}](${r.url})${r.snippet ? ` — ${r.snippet}` : ""}`).join("\n");
			return {
				content: [{ type: "text" as const, text }],
				details: { engine, query: params.query, results },
			};
		},
		renderResult(result, _opts, theme) {
			const d = result.details as { engine?: string; results?: unknown[] };
			return new Text(
				`${theme.fg("toolTitle", theme.bold("web_search "))}${theme.fg("muted", `${d.results?.length ?? 0} results`)} ${theme.fg("dim", `via ${d.engine ?? "?"}`)}`,
				0,
				0,
			);
		},
	});

	// ----------------------------------------------------------- web_crawl
	pi.registerTool({
		name: "web_crawl",
		label: "Web Crawl",
		description:
			"Breadth-first crawl from a start URL (same-origin by default), extracting each page to markdown. Depth/page-capped, robots-aware, concurrency-limited. Use to ingest a docs section.",
		promptSnippet: "Crawl a site section and extract pages",
		parameters: Type.Object({
			startUrl: Type.String({ description: "The URL to start crawling from" }),
			maxPages: Type.Optional(Type.Number({ description: "Max pages (default 20, cap 100)" })),
			maxDepth: Type.Optional(Type.Number({ description: "Max link depth (default 2)" })),
			sameOrigin: Type.Optional(Type.Boolean({ description: "Restrict to the start origin (default true)" })),
			include: Type.Optional(Type.String({ description: "Only crawl URLs matching this regex/substring" })),
			exclude: Type.Optional(Type.String({ description: "Skip URLs matching this regex/substring" })),
			render: Type.Optional(RENDER),
			format: Type.Optional(TEXT_FORMAT),
			concurrency: Type.Optional(Type.Number({ description: "Parallel fetches (default 3, cap 5)" })),
		}),
		async execute(_id, params, signal, onUpdate) {
			const { pages, markdown, truncated } = await webCrawl(
				params as Parameters<typeof webCrawl>[0],
				signal,
				(p) =>
					onUpdate?.({
						content: [{ type: "text", text: `crawled ${p.length} page(s)…` }],
						details: { pages: p.map((x) => ({ url: x.url, title: x.title, depth: x.depth, bytes: x.bytes })) },
					}),
			);
			const header = `Crawled ${pages.length} page(s) from ${params.startUrl}${truncated ? " (output truncated)" : ""}.\n`;
			return {
				content: [{ type: "text" as const, text: header + markdown }],
				details: {
					startUrl: params.startUrl,
					pageCount: pages.length,
					truncated,
					pages: pages.map((p) => ({ url: p.url, title: p.title, depth: p.depth, bytes: p.bytes })),
				},
			};
		},
		renderResult(result, _opts, theme) {
			const d = result.details as { pageCount?: number; startUrl?: string };
			return new Text(
				`${theme.fg("toolTitle", theme.bold("web_crawl "))}${theme.fg("muted", `${d.pageCount ?? 0} pages`)} ${theme.fg("dim", d.startUrl ?? "")}`,
				0,
				0,
			);
		},
	});

	// ------------------------------------------------------------- flags
	pi.registerFlag("render-default", { description: "Default render mode: auto, static, browser", type: "string" });
	pi.registerFlag("search-engine", { description: "Default search engine: duckduckgo, bing, brave", type: "string" });
	pi.registerFlag("user-agent", { description: "HTTP/browser User-Agent string", type: "string" });
	pi.registerFlag("allow-private", { description: "Allow fetching private/loopback addresses (SSRF)", type: "boolean" });

	function applyFlags(): void {
		const render = pi.getFlag("render-default");
		if (typeof render === "string" && render) config.renderDefault = render as RenderMode;
		const engine = pi.getFlag("search-engine");
		if (typeof engine === "string" && engine) config.searchEngine = engine as SearchEngine;
		const ua = pi.getFlag("user-agent");
		if (typeof ua === "string" && ua) config.userAgent = ua;
		if (pi.getFlag("allow-private") === true) config.allowPrivate = true;
	}

	pi.on("session_start", async () => applyFlags());

	// ------------------------------------------------------- /webtools cmd
	pi.registerCommand("webtools", {
		description: "Show webtools config and backend availability",
		handler: async (_args, ctx: ExtensionContext) => {
			const lines = [
				`render default : ${config.renderDefault}`,
				`search engine  : ${config.searchEngine}`,
				`user agent     : ${config.userAgent}`,
				`allow private  : ${config.allowPrivate}`,
				`ignore robots  : ${config.ignoreRobots}`,
				`browser        : ${config.cdp ? `CDP ${config.cdp}` : config.wsEndpoint ? `WS ${config.wsEndpoint}` : "local Playwright (npx playwright install chromium)"}`,
			];
			if (ctx.hasUI) ctx.ui.notify(lines.join("\n"), "info");
		},
	});

	// --------------------------------------------------------- cleanup
	pi.on("session_shutdown", async () => closeBrowser());
}
