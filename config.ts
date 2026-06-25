/**
 * Shared runtime configuration for @aprimediet/webtools.
 *
 * Defaults come from environment variables (WEBTOOLS_* / PLAYWRIGHT_*); index.ts
 * may override fields from CLI flags on session start. Kept dependency-free so the
 * logic modules can be unit-tested outside pi.
 */

export type RenderMode = "auto" | "static" | "browser";
export type SearchEngine = "duckduckgo" | "bing" | "brave";

const truthy = (v: string | undefined): boolean => /^(1|true|yes|on)$/i.test(v ?? "");

export const DEFAULT_USER_AGENT =
	"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 webtools-bot";

export interface WebToolsConfig {
	userAgent: string;
	renderDefault: RenderMode;
	searchEngine: SearchEngine;
	allowPrivate: boolean;
	ignoreRobots: boolean;
	cdp: string;
	wsEndpoint: string;
	timeoutMs: number;
	maxBytes: number;
}

export const config: WebToolsConfig = {
	userAgent: process.env.WEBTOOLS_USER_AGENT || DEFAULT_USER_AGENT,
	renderDefault: (process.env.WEBTOOLS_RENDER as RenderMode) || "auto",
	searchEngine: (process.env.WEBTOOLS_SEARCH_ENGINE as SearchEngine) || "duckduckgo",
	allowPrivate: truthy(process.env.WEBTOOLS_ALLOW_PRIVATE),
	ignoreRobots: truthy(process.env.WEBTOOLS_IGNORE_ROBOTS),
	cdp: process.env.PLAYWRIGHT_CDP || "",
	wsEndpoint: process.env.PLAYWRIGHT_WS_ENDPOINT || "",
	timeoutMs: 30_000,
	maxBytes: 5 * 1024 * 1024,
};
