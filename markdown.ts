/**
 * HTML → Markdown / text helpers (Turndown + jsdom).
 *
 * Dependency-free of pi so it can be unit-tested directly with Node.
 */

import { JSDOM } from "jsdom";
import TurndownService from "turndown";
// @ts-expect-error - no bundled types for the gfm plugin
import { gfm } from "turndown-plugin-gfm";

let turndown: TurndownService | undefined;

function getTurndown(): TurndownService {
	if (!turndown) {
		turndown = new TurndownService({
			headingStyle: "atx",
			codeBlockStyle: "fenced",
			bulletListMarker: "-",
		});
		try {
			turndown.use(gfm); // GFM tables / strikethrough / task lists
		} catch {
			/* plugin optional */
		}
		// Drop noise outright.
		turndown.remove(["script", "style", "noscript", "iframe", "svg", "head"]);
	}
	return turndown;
}

/** Convert an HTML fragment (e.g. Readability output) to Markdown. */
export function htmlToMarkdown(html: string): string {
	if (!html) return "";
	return getTurndown().turndown(html).trim();
}

function stripNoise(doc: Document): void {
	for (const sel of ["script", "style", "noscript", "iframe", "svg", "template"]) {
		for (const el of [...doc.querySelectorAll(sel)]) el.remove();
	}
}

/** Full-page HTML → Markdown: strip scripts/styles, convert the body. */
export function pageToMarkdown(html: string, url: string): string {
	const doc = new JSDOM(html, { url }).window.document;
	stripNoise(doc);
	const body = doc.body ?? doc.documentElement;
	return htmlToMarkdown(body.innerHTML);
}

/** Full-page HTML → collapsed plain text. */
export function pageToText(html: string, url: string): string {
	const doc = new JSDOM(html, { url }).window.document;
	stripNoise(doc);
	const body = doc.body ?? doc.documentElement;
	return (body.textContent ?? "").replace(/\s+/g, " ").trim();
}

/** Sanitized HTML: scripts/styles removed, body markup returned. */
export function sanitizeHtml(html: string, url: string): string {
	const doc = new JSDOM(html, { url }).window.document;
	stripNoise(doc);
	const body = doc.body ?? doc.documentElement;
	return body.innerHTML.trim();
}

/** Best-effort <title>. */
export function extractTitle(html: string, url: string): string | undefined {
	try {
		const doc = new JSDOM(html, { url }).window.document;
		return doc.title?.trim() || undefined;
	} catch {
		return undefined;
	}
}

/** Same-origin/absolute links found in the page (deduped, hash-stripped). */
export function extractLinks(html: string, baseUrl: string): string[] {
	const out = new Set<string>();
	try {
		const doc = new JSDOM(html, { url: baseUrl }).window.document;
		for (const a of [...doc.querySelectorAll("a[href]")]) {
			const raw = a.getAttribute("href");
			if (!raw || raw.startsWith("#") || raw.startsWith("mailto:") || raw.startsWith("javascript:")) continue;
			try {
				const u = new URL(raw, baseUrl);
				if (u.protocol !== "http:" && u.protocol !== "https:") continue;
				u.hash = "";
				out.add(u.toString());
			} catch {
				/* skip bad href */
			}
		}
	} catch {
		/* skip */
	}
	return [...out];
}
