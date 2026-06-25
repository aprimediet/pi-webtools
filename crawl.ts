/**
 * Breadth-first crawler built on `fetchHtml` + `extractArticle`.
 * Same-origin by default, depth/page-capped, robots-aware, concurrency-limited.
 */

import { assertPublicUrl, fetchHtml, type FetchResult } from "./browser.ts";
import { config, type RenderMode } from "./config.ts";
import { extractArticle } from "./extract.ts";
import { extractLinks } from "./markdown.ts";

export interface CrawlOptions {
	startUrl: string;
	maxPages?: number;
	maxDepth?: number;
	sameOrigin?: boolean;
	include?: string;
	exclude?: string;
	render?: RenderMode;
	format?: "markdown" | "text";
	concurrency?: number;
}

export interface CrawlPage {
	url: string;
	title?: string;
	depth: number;
	markdown: string;
	bytes: number;
}

const HARD_MAX_PAGES = 100;
const MAX_CONCURRENCY = 5;
const TOTAL_OUTPUT_CAP = 200 * 1024;
const PER_PAGE_CAP = 30 * 1024;
const PER_ORIGIN_DELAY_MS = 250;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Minimal robots.txt parser for `User-agent: *` Disallow rules. */
function parseDisallow(robotsTxt: string): string[] {
	const lines = robotsTxt.split(/\r?\n/);
	const disallow: string[] = [];
	let appliesToAll = false;
	for (const line of lines) {
		const clean = line.replace(/#.*$/, "").trim();
		if (!clean) continue;
		const [rawKey, ...rest] = clean.split(":");
		const key = rawKey.toLowerCase().trim();
		const value = rest.join(":").trim();
		if (key === "user-agent") appliesToAll = value === "*";
		else if (key === "disallow" && appliesToAll && value) disallow.push(value);
	}
	return disallow;
}

async function loadRobots(origin: string, signal?: AbortSignal): Promise<string[]> {
	if (config.ignoreRobots) return [];
	try {
		const res = await fetchHtml(`${origin}/robots.txt`, { render: "static", maxBytes: 256 * 1024 }, signal);
		return res.status >= 200 && res.status < 300 ? parseDisallow(res.html) : [];
	} catch {
		return [];
	}
}

function isAllowed(url: string, disallow: string[]): boolean {
	if (!disallow.length) return true;
	const path = new URL(url).pathname;
	return !disallow.some((rule) => path.startsWith(rule));
}

function matches(pattern: string | undefined, url: string): boolean {
	if (!pattern) return false;
	try {
		return new RegExp(pattern).test(url);
	} catch {
		return url.includes(pattern);
	}
}

export async function webCrawl(
	options: CrawlOptions,
	signal?: AbortSignal,
	onProgress?: (pages: CrawlPage[]) => void,
): Promise<{ pages: CrawlPage[]; markdown: string; truncated: boolean }> {
	const start = await assertPublicUrl(options.startUrl);
	const maxPages = Math.min(options.maxPages ?? 20, HARD_MAX_PAGES);
	const maxDepth = options.maxDepth ?? 2;
	const sameOrigin = options.sameOrigin ?? true;
	const concurrency = Math.min(Math.max(options.concurrency ?? 3, 1), MAX_CONCURRENCY);
	const render = options.render;
	const format = options.format ?? "markdown";

	const disallowByOrigin = new Map<string, string[]>();
	disallowByOrigin.set(start.origin, await loadRobots(start.origin, signal));

	const queue: { url: string; depth: number }[] = [{ url: start.toString(), depth: 0 }];
	const visited = new Set<string>();
	const pages: CrawlPage[] = [];

	while (queue.length && pages.length < maxPages) {
		if (signal?.aborted) throw new Error("web crawl aborted");

		const batch: { url: string; depth: number }[] = [];
		while (queue.length && batch.length < concurrency && pages.length + batch.length < maxPages) {
			const item = queue.shift();
			if (!item || visited.has(item.url)) continue;
			visited.add(item.url);

			const origin = new URL(item.url).origin;
			if (!disallowByOrigin.has(origin)) disallowByOrigin.set(origin, await loadRobots(origin, signal));
			if (!isAllowed(item.url, disallowByOrigin.get(origin) ?? [])) continue;

			batch.push(item);
		}
		if (!batch.length) break;

		const results = await Promise.all(
			batch.map(async (item): Promise<{ page: CrawlPage; links: string[] } | null> => {
				if (signal?.aborted) throw new Error("web crawl aborted");
				let fetched: FetchResult;
				try {
					fetched = await fetchHtml(item.url, { render }, signal);
				} catch {
					return null;
				}
				let markdown = "";
				let title: string | undefined;
				try {
					const ex = extractArticle(fetched.html, fetched.finalUrl, { format });
					markdown = ex.content;
					title = ex.meta.title;
				} catch {
					/* keep empty markdown */
				}
				if (markdown.length > PER_PAGE_CAP) markdown = `${markdown.slice(0, PER_PAGE_CAP)}\n\n…[page truncated]`;
				const links = extractLinks(fetched.html, fetched.finalUrl);
				return {
					page: { url: fetched.finalUrl, title, depth: item.depth, markdown, bytes: Buffer.byteLength(markdown) },
					links,
				};
			}),
		);

		for (const r of results) {
			if (!r) continue;
			pages.push(r.page);
			onProgress?.(pages);
			if (r.page.depth >= maxDepth) continue;
			for (const link of r.links) {
				if (visited.has(link)) continue;
				try {
					if (sameOrigin && new URL(link).origin !== start.origin) continue;
				} catch {
					continue;
				}
				if (options.include && !matches(options.include, link)) continue;
				if (options.exclude && matches(options.exclude, link)) continue;
				queue.push({ url: link, depth: r.page.depth + 1 });
			}
		}

		await sleep(PER_ORIGIN_DELAY_MS);
	}

	// Assemble combined markdown, capped.
	let markdown = "";
	let truncated = false;
	for (const p of pages) {
		const section = `\n\n## ${p.title ?? p.url}\n${p.url}\n\n${p.markdown}\n`;
		if (Buffer.byteLength(markdown) + Buffer.byteLength(section) > TOTAL_OUTPUT_CAP) {
			truncated = true;
			break;
		}
		markdown += section;
	}
	return { pages, markdown: markdown.trim(), truncated };
}
