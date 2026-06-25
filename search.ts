/**
 * Playwright-only web search: drive the shared headless browser over a public
 * search engine's HTML results and scrape the rows. No search API, no service.
 */

import { config, type SearchEngine } from "./config.ts";
import { getBrowser } from "./browser.ts";

export interface SearchHit {
	title: string;
	url: string;
	snippet: string;
}

interface EngineSpec {
	url: (q: string) => string;
	row: string;
	titleSel: string;
	snippetSel: string;
	/** Some engines wrap result hrefs in a redirect; how to recover the real URL. */
	unwrap?: "ddg" | "bing";
}

// Keep selectors in one table so they're trivial to update when a SERP changes.
const ENGINES: Record<SearchEngine, EngineSpec> = {
	duckduckgo: {
		url: (q) => `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`,
		row: ".result",
		titleSel: "a.result__a",
		snippetSel: ".result__snippet",
		unwrap: "ddg",
	},
	bing: {
		url: (q) => `https://www.bing.com/search?q=${encodeURIComponent(q)}`,
		row: "li.b_algo",
		titleSel: "h2 a",
		snippetSel: ".b_caption p",
		unwrap: "bing",
	},
	brave: {
		url: (q) => `https://search.brave.com/search?q=${encodeURIComponent(q)}`,
		row: "[data-type=web]",
		titleSel: "a",
		snippetSel: ".snippet-description",
	},
};

function unwrapDdg(href: string): string {
	try {
		const u = new URL(href, "https://duckduckgo.com");
		const real = u.searchParams.get("uddg");
		return real ? real : u.toString();
	} catch {
		return href;
	}
}

/** Bing wraps results in `bing.com/ck/a?...&u=a1<base64url(realUrl)>`. */
function unwrapBing(href: string): string {
	try {
		const u = new URL(href, "https://www.bing.com");
		const param = u.searchParams.get("u");
		if (param) {
			const enc = param.startsWith("a1") ? param.slice(2) : param;
			const decoded = Buffer.from(enc.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
			if (/^https?:\/\//.test(decoded)) return decoded;
		}
		return u.toString();
	} catch {
		return href;
	}
}

function unwrapHref(kind: EngineSpec["unwrap"], href: string): string {
	if (kind === "ddg") return unwrapDdg(href);
	if (kind === "bing") return unwrapBing(href);
	return href;
}

export async function webSearch(
	query: string,
	limit: number,
	engineName: SearchEngine,
	signal?: AbortSignal,
): Promise<{ engine: SearchEngine; results: SearchHit[] }> {
	const spec = ENGINES[engineName];
	if (!spec) throw new Error(`Unknown search engine: ${engineName}`);

	const browser = await getBrowser();
	const context = await browser.newContext({ userAgent: config.userAgent });
	const page = await context.newPage();
	try {
		await page.goto(spec.url(query), { waitUntil: "domcontentloaded", timeout: config.timeoutMs });
		if (signal?.aborted) throw new Error("web search aborted");

		const raw = (await page
			.$$eval(
				spec.row,
				(rows, sel) =>
					rows.map((el) => {
						const a = el.querySelector(sel.titleSel) as HTMLAnchorElement | null;
						const snip = el.querySelector(sel.snippetSel);
						return {
							title: (a?.textContent ?? "").replace(/\s+/g, " ").trim(),
							href: a?.getAttribute("href") ?? "",
							snippet: (snip?.textContent ?? "").replace(/\s+/g, " ").trim(),
						};
					}),
				{ titleSel: spec.titleSel, snippetSel: spec.snippetSel },
			)
			.catch(() => [] as { title: string; href: string; snippet: string }[])) as {
			title: string;
			href: string;
			snippet: string;
		}[];

		const results: SearchHit[] = [];
		for (const r of raw) {
			if (!r.href || !r.title) continue;
			let url = unwrapHref(spec.unwrap, r.href);
			try {
				url = new URL(url, spec.url(query)).toString();
			} catch {
				continue;
			}
			if (!/^https?:/.test(url)) continue;
			results.push({ title: r.title, url, snippet: r.snippet });
			if (results.length >= limit) break;
		}

		if (results.length === 0) {
			throw new Error(
				`web_search: no results from "${engineName}". The page may be a consent/captcha/"unusual traffic" page, or its markup changed. Try engine:"bing" or "brave".`,
			);
		}
		return { engine: engineName, results };
	} finally {
		await page.close().catch(() => {});
		await context.close().catch(() => {});
	}
}
