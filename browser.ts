/**
 * The fetch engine: SSRF guard + a shared (lazy) Playwright browser + `fetchHtml`
 * with static / browser / auto render modes.
 *
 * Dependency-free of pi so it can be unit-tested directly with Node.
 */

import { isIP } from "node:net";
import { lookup } from "node:dns/promises";
import type { Browser } from "playwright";
import { chromium } from "playwright";
import { config, type RenderMode } from "./config.ts";

// ---------------------------------------------------------------- SSRF guard

function isPrivateV4(ip: string): boolean {
	return (
		/^127\./.test(ip) || // loopback
		/^10\./.test(ip) || // private
		/^192\.168\./.test(ip) || // private
		/^169\.254\./.test(ip) || // link-local / metadata
		/^172\.(1[6-9]|2\d|3[01])\./.test(ip) || // private
		/^0\./.test(ip) || // this host
		ip === "0.0.0.0"
	);
}

function isPrivateV6(ip: string): boolean {
	const s = ip.toLowerCase();
	return (
		s === "::1" || // loopback
		s === "::" ||
		s.startsWith("fe80:") || // link-local
		s.startsWith("fc") || // unique-local fc00::/7
		s.startsWith("fd") ||
		s.startsWith("::ffff:127.") || // mapped loopback
		s.startsWith("::ffff:10.") ||
		s.startsWith("::ffff:192.168.") ||
		s.startsWith("::ffff:169.254.")
	);
}

export function isPrivateAddress(ip: string): boolean {
	return isIP(ip) === 6 ? isPrivateV6(ip) : isPrivateV4(ip);
}

/** Throw unless `url` is a public http(s) URL (unless WEBTOOLS_ALLOW_PRIVATE). */
export async function assertPublicUrl(url: string): Promise<URL> {
	let u: URL;
	try {
		u = new URL(url);
	} catch {
		throw new Error(`Invalid URL: ${url}`);
	}
	if (u.protocol !== "http:" && u.protocol !== "https:") {
		throw new Error(`Blocked non-http(s) URL: ${url}`);
	}
	if (config.allowPrivate) return u;

	const host = u.hostname.replace(/^\[|\]$/g, "");
	if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) {
		throw new Error(`Blocked local hostname "${host}". Set WEBTOOLS_ALLOW_PRIVATE=1 to override.`);
	}

	let ips: string[];
	if (isIP(host)) {
		ips = [host];
	} else {
		const resolved = await lookup(host, { all: true }).catch(() => [] as { address: string }[]);
		ips = resolved.map((r) => r.address);
	}
	for (const ip of ips) {
		if (isPrivateAddress(ip)) {
			throw new Error(
				`Blocked private/loopback address ${ip} for ${host}. Set WEBTOOLS_ALLOW_PRIVATE=1 to override.`,
			);
		}
	}
	return u;
}

// ------------------------------------------------------------ shared browser

let browserPromise: Promise<Browser> | undefined;

function launchBrowser(): Promise<Browser> {
	if (config.cdp) return chromium.connectOverCDP(config.cdp);
	if (config.wsEndpoint) return chromium.connect(config.wsEndpoint);
	return chromium.launch({ headless: true });
}

export async function getBrowser(): Promise<Browser> {
	if (!browserPromise) browserPromise = launchBrowser();
	try {
		return await browserPromise;
	} catch (err) {
		browserPromise = undefined;
		throw new Error(
			`Failed to start Playwright. Install browsers with "npx playwright install --with-deps chromium" or set PLAYWRIGHT_CDP. Cause: ${(err as Error).message}`,
		);
	}
}

export async function closeBrowser(): Promise<void> {
	if (!browserPromise) return;
	const p = browserPromise;
	browserPromise = undefined;
	const b = await p.catch(() => undefined);
	if (b) await b.close().catch(() => {});
}

// ------------------------------------------------------------------- fetchHtml

export interface FetchOptions {
	render?: RenderMode;
	timeoutMs?: number;
	maxBytes?: number;
}

export interface FetchResult {
	finalUrl: string;
	status: number;
	html: string;
	contentType: string;
	renderUsed: "static" | "browser";
	truncated: boolean;
	bytes: number;
}

function throwIfAborted(signal?: AbortSignal): void {
	if (signal?.aborted) throw new Error("web fetch aborted");
}

/** A small/empty body or a known SPA mount point ⇒ escalate to the browser. */
function looksLikeShell(html: string): boolean {
	if (!html) return true;
	const lower = html.toLowerCase();
	const body = lower.match(/<body[^>]*>([\s\S]*?)<\/body>/)?.[1] ?? lower;
	const text = body
		.replace(/<script[\s\S]*?<\/script>/g, "")
		.replace(/<style[\s\S]*?<\/style>/g, "")
		.replace(/<[^>]+>/g, " ")
		.replace(/\s+/g, " ")
		.trim();
	if (text.length < 200) return true;
	return /<div id="(root|app|__next|__nuxt)">\s*<\/div>/.test(lower);
}

async function staticFetch(url: string, opts: Required<FetchOptions>, signal?: AbortSignal): Promise<FetchResult> {
	throwIfAborted(signal);
	const ctrl = new AbortController();
	const onAbort = () => ctrl.abort();
	signal?.addEventListener("abort", onAbort, { once: true });
	const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs);
	try {
		const res = await fetch(url, {
			redirect: "follow",
			signal: ctrl.signal,
			headers: { "user-agent": config.userAgent, accept: "text/html,application/xhtml+xml,*/*" },
		});
		const contentType = res.headers.get("content-type") ?? "";
		const reader = res.body?.getReader();
		const decoder = new TextDecoder();
		let html = "";
		let bytes = 0;
		let truncated = false;
		if (reader) {
			for (;;) {
				const { done, value } = await reader.read();
				if (done) break;
				bytes += value.byteLength;
				if (bytes > opts.maxBytes) {
					html += decoder.decode(value.slice(0, Math.max(0, value.byteLength - (bytes - opts.maxBytes))));
					truncated = true;
					await reader.cancel().catch(() => {});
					break;
				}
				html += decoder.decode(value, { stream: true });
			}
			if (!truncated) html += decoder.decode();
		} else {
			html = await res.text();
			bytes = Buffer.byteLength(html);
		}
		return { finalUrl: res.url || url, status: res.status, html, contentType, renderUsed: "static", truncated, bytes };
	} catch (err) {
		if (signal?.aborted) throw new Error("web fetch aborted");
		throw new Error(`static fetch failed for ${url}: ${(err as Error).message}`);
	} finally {
		clearTimeout(timer);
		signal?.removeEventListener("abort", onAbort);
	}
}

async function browserFetch(url: string, opts: Required<FetchOptions>, signal?: AbortSignal): Promise<FetchResult> {
	throwIfAborted(signal);
	const browser = await getBrowser();
	const context = await browser.newContext({ userAgent: config.userAgent });
	const page = await context.newPage();
	try {
		const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: opts.timeoutMs });
		throwIfAborted(signal);
		const html = await page.content();
		let bytes = Buffer.byteLength(html);
		let truncated = false;
		let body = html;
		if (bytes > opts.maxBytes) {
			body = html.slice(0, opts.maxBytes);
			bytes = Buffer.byteLength(body);
			truncated = true;
		}
		return {
			finalUrl: page.url(),
			status: response?.status() ?? 0,
			html: body,
			contentType: response?.headers()["content-type"] ?? "text/html",
			renderUsed: "browser",
			truncated,
			bytes,
		};
	} finally {
		await page.close().catch(() => {});
		await context.close().catch(() => {});
	}
}

export async function fetchHtml(url: string, options: FetchOptions = {}, signal?: AbortSignal): Promise<FetchResult> {
	await assertPublicUrl(url);
	const opts: Required<FetchOptions> = {
		render: options.render ?? config.renderDefault,
		timeoutMs: options.timeoutMs ?? config.timeoutMs,
		maxBytes: options.maxBytes ?? config.maxBytes,
	};

	if (opts.render === "static") return staticFetch(url, opts, signal);
	if (opts.render === "browser") return browserFetch(url, opts, signal);

	// auto: try static, escalate to the browser if it looks like a JS shell or non-HTML.
	const s = await staticFetch(url, opts, signal).catch(() => undefined);
	if (s && /html/i.test(s.contentType || "html") && !looksLikeShell(s.html)) return s;
	return browserFetch(url, opts, signal);
}
