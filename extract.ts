/**
 * Readable-article extraction (Mozilla Readability) + optional CSS-selector fields.
 *
 * Dependency-free of pi so it can be unit-tested directly with Node.
 */

import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import { htmlToMarkdown, pageToMarkdown, pageToText } from "./markdown.ts";

export interface ExtractOptions {
	format?: "markdown" | "text";
	includeMetadata?: boolean;
	selectors?: Record<string, string>;
}

export interface ExtractMeta {
	title?: string;
	byline?: string;
	siteName?: string;
	publishedTime?: string;
	lang?: string;
	length?: number;
	excerpt?: string;
}

export interface ExtractResult {
	content: string;
	meta: ExtractMeta;
	fields?: Record<string, string | string[]>;
	fallback: boolean;
}

function collectFields(doc: Document, selectors: Record<string, string>): Record<string, string | string[]> {
	const fields: Record<string, string | string[]> = {};
	for (const [name, sel] of Object.entries(selectors)) {
		try {
			const els = [...doc.querySelectorAll(sel)];
			const vals = els.map((e) => (e.textContent ?? "").replace(/\s+/g, " ").trim()).filter(Boolean);
			fields[name] = vals.length <= 1 ? (vals[0] ?? "") : vals;
		} catch {
			fields[name] = "";
		}
	}
	return fields;
}

/**
 * Extract the main article from `html`. Selectors are evaluated BEFORE Readability
 * (which mutates/strips the DOM). Falls back to full-page conversion when the page
 * is not article-like.
 */
export function extractArticle(html: string, url: string, options: ExtractOptions = {}): ExtractResult {
	const format = options.format ?? "markdown";
	const dom = new JSDOM(html, { url });
	const doc = dom.window.document;

	const fields = options.selectors ? collectFields(doc, options.selectors) : undefined;
	const docLang = doc.documentElement.getAttribute("lang") ?? undefined;

	let article: ReturnType<Readability["parse"]> = null;
	try {
		// Readability mutates the document, so clone for a clean parse.
		article = new Readability(doc.cloneNode(true) as Document).parse();
	} catch {
		article = null;
	}

	if (article?.content) {
		const content = format === "text" ? (article.textContent ?? "").trim() : htmlToMarkdown(article.content);
		const meta: ExtractMeta =
			options.includeMetadata === false
				? {}
				: {
						title: article.title ?? undefined,
						byline: article.byline ?? undefined,
						siteName: article.siteName ?? undefined,
						publishedTime: (article as { publishedTime?: string }).publishedTime,
						lang: article.lang ?? docLang,
						length: article.length ?? undefined,
						excerpt: article.excerpt ?? undefined,
					};
		return { content, meta, fields, fallback: false };
	}

	// Fallback: non-article page → clean full-page conversion.
	const content = format === "text" ? pageToText(html, url) : pageToMarkdown(html, url);
	const meta: ExtractMeta = options.includeMetadata === false ? {} : { title: doc.title?.trim() || undefined, lang: docLang };
	return { content, meta, fields, fallback: true };
}
