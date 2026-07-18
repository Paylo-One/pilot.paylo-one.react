import "server-only";

/**
 * modules/news/providers.ts — the news provider adapters + registry (ADR-039).
 *
 * Each adapter implements the `NewsProvider` interface and returns normalised
 * items; nothing above the registry knows the vendor. MVP ships RSS + GDELT
 * (both keyless, production tier). Guardian/NewsAPI/NewsData are registered as
 * descriptors for the catalogue but not yet implemented (clearly marked).
 *
 * Failure isolation is the caller's job (ingest.ts) — adapters throw only on a
 * genuine transport/provider error, and return [] for "nothing matched".
 */

import type {
  NewsFetchQuery,
  NewsProvider,
  NormalisedNewsItem,
  ProviderRuntimeConfig,
} from "./index";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const FETCH_TIMEOUT_MS = 12_000;
const USER_AGENT = "PayloOne-NewsBriefing/1.0 (+https://paylo.one)";
const MAX_PROVIDER_ATTEMPTS = 3;
const MAX_PROVIDER_RETRY_MS = 3_000;
const RETRYABLE_PROVIDER_STATUSES = new Set([429, 500, 502, 503, 504]);

function isPrivateIp(address: string): boolean {
  if (address === "::1" || address.startsWith("fc") || address.startsWith("fd") || address.startsWith("fe80:")) {
    return true;
  }
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some(Number.isNaN)) return false;
  const [a, b] = parts;
  return (
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b !== undefined && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

/** Prevent tenant-supplied RSS URLs from becoming a server-side network probe. */
async function assertPublicHttpUrl(value: string): Promise<void> {
  const url = new URL(value);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("rss_url_protocol_not_allowed");
  }
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new Error("rss_url_host_not_allowed");
  }
  if (isIP(host)) {
    if (isPrivateIp(host)) throw new Error("rss_url_host_not_allowed");
    return;
  }
  const addresses = await lookup(host, { all: true });
  if (addresses.length === 0 || addresses.some((entry) => isPrivateIp(entry.address))) {
    throw new Error("rss_url_host_not_allowed");
  }
}

/** fetch with a hard timeout so one slow provider can't stall a run. */
async function timedFetch(url: string, init?: RequestInit): Promise<Response> {
  await assertPublicHttpUrl(url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: { "user-agent": USER_AGENT, ...(init?.headers ?? {}) },
      cache: "no-store",
    });
  } finally {
    clearTimeout(timer);
  }
}

function retryDelayMs(response: Response, attempt: number): number {
  const retryAfter = response.headers.get("retry-after")?.trim();
  if (retryAfter) {
    const seconds = Number(retryAfter);
    const parsed = Number.isFinite(seconds)
      ? seconds * 1_000
      : Date.parse(retryAfter) - Date.now();
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.min(parsed, MAX_PROVIDER_RETRY_MS);
    }
  }
  return Math.min(250 * 2 ** attempt, MAX_PROVIDER_RETRY_MS);
}

/** Bounded Retry-After/exponential backoff for rate-limited provider calls. */
export async function fetchNewsWithRetry(
  url: string,
  init?: RequestInit,
  options: {
    fetcher?: (url: string, init?: RequestInit) => Promise<Response>;
    sleep?: (milliseconds: number) => Promise<void>;
  } = {},
): Promise<Response> {
  const fetcher = options.fetcher ?? timedFetch;
  const sleep =
    options.sleep ??
    ((milliseconds: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));

  for (let attempt = 0; attempt < MAX_PROVIDER_ATTEMPTS; attempt += 1) {
    const response = await fetcher(url, init);
    const shouldRetry =
      RETRYABLE_PROVIDER_STATUSES.has(response.status) &&
      attempt < MAX_PROVIDER_ATTEMPTS - 1;
    if (!shouldRetry) return response;

    await response.body?.cancel().catch(() => undefined);
    await sleep(retryDelayMs(response, attempt));
  }
  throw new Error("news_provider_retry_exhausted");
}

function decodeEntities(text: string): string {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#?\w+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tag(block: string, name: string): string | null {
  const m =
    block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i")) ??
    null;
  return m ? decodeEntities(m[1]!) : null;
}

/** Atom <link href="…"/> or RSS <link>…</link>. */
function linkOf(block: string): string | null {
  const href = block.match(/<link[^>]*href=["']([^"']+)["']/i);
  if (href) return href[1]!;
  return tag(block, "link");
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function toIso(value: string | null): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// --- RSS / Atom --------------------------------------------------------------

/**
 * A small curated default feed set per topic, used when a tenant has not added
 * its own `preferred_sources` feed URLs. Trusted, broadly-licensed publications.
 */
const DEFAULT_RSS_FEEDS: readonly string[] = [
  "https://feeds.bbci.co.uk/news/world/rss.xml",
  "https://www.reutersagency.com/feed/?best-topics=business-finance&post_type=best",
  "https://www.ft.com/rss/home",
];

function parseFeed(xml: string, feedUrl: string): NormalisedNewsItem[] {
  const channelName = tag(xml.slice(0, 10_000), "title");
  const sourceName = channelName || hostOf(feedUrl);
  const blocks = [
    ...xml.matchAll(/<item[\s\S]*?<\/item>/gi),
    ...xml.matchAll(/<entry[\s\S]*?<\/entry>/gi),
  ].map((m) => m[0]);

  const items: NormalisedNewsItem[] = [];
  for (const block of blocks) {
    const title = tag(block, "title");
    const url = linkOf(block);
    if (!title || !url) continue;
    const published = toIso(tag(block, "pubDate") ?? tag(block, "published") ?? tag(block, "updated"));
    const snippet = tag(block, "description") ?? tag(block, "summary");
    items.push({
      providerKey: "rss",
      externalId: tag(block, "guid"),
      title,
      snippet: snippet ? snippet.slice(0, 500) : null,
      canonicalUrl: url,
      sourceName: sourceName || "rss",
      language: null,
      publishedAt: published,
      category: null,
      country: null,
      rawPayload: { feedUrl },
    });
  }
  return items;
}

const rssProvider: NewsProvider = {
  key: "rss",
  name: "RSS feeds",
  tier: "production",
  capabilities: { byCategory: true, byKeyword: true, byRegion: false, bySource: true },
  async fetchLatest(query, cfg) {
    const feeds = (cfg.feedUrls && cfg.feedUrls.length > 0 ? cfg.feedUrls : DEFAULT_RSS_FEEDS).slice(0, 20);
    const results = await Promise.allSettled(
      feeds.map(async (feed) => {
        const res = await timedFetch(feed);
        if (!res.ok) throw new Error(`rss_${res.status}`);
        return parseFeed(await res.text(), feed);
      }),
    );
    let items = results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
    const sources = (query.sources ?? [])
      .filter((source) => !/^https?:\/\//i.test(source))
      .map((source) => source.toLowerCase());
    if (sources.length > 0) {
      items = items.filter((item) =>
        sources.some((source) =>
          `${item.sourceName} ${item.canonicalUrl}`.toLowerCase().includes(source),
        ),
      );
    }
    // Post-fetch keyword filter (RSS has no server-side query).
    const keywords = (query.keywords ?? []).map((k) => k.toLowerCase());
    if (keywords.length > 0) {
      items = items.filter((i) => {
        const hay = `${i.title} ${i.snippet ?? ""}`.toLowerCase();
        return keywords.some((k) => hay.includes(k));
      });
    }
    return items
      .toSorted((a, b) => Date.parse(b.publishedAt ?? "") - Date.parse(a.publishedAt ?? ""))
      .slice(0, query.limit ?? 100);
  },
  async test(cfg) {
    const feed = cfg.feedUrls?.[0] ?? DEFAULT_RSS_FEEDS[0]!;
    try {
      const res = await timedFetch(feed);
      return res.ok
        ? { ok: true, detail: `Reached ${hostOf(feed)} (${res.status}).` }
        : { ok: false, detail: `Feed responded ${res.status}.` };
    } catch (cause) {
      return { ok: false, detail: cause instanceof Error ? cause.message : "fetch failed" };
    }
  },
};

// --- GDELT 2.0 Doc API -------------------------------------------------------

interface GdeltArticle {
  url?: string;
  title?: string;
  seendate?: string;
  domain?: string;
  language?: string;
  sourcecountry?: string;
}

/** GDELT seendate is like "20260613T120000Z". */
function parseGdeltDate(value: string | undefined): string | null {
  if (!value) return null;
  const m = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (!m) return toIso(value);
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`;
}

function buildGdeltQuery(query: NewsFetchQuery): string {
  const terms = [...(query.keywords ?? [])];
  if (terms.length === 0 && query.categories?.length) terms.push(...query.categories.map((c) => c.replace(/_/g, " ")));
  const phrase = terms.length > 0 ? terms.map((t) => `"${t}"`).join(" OR ") : "world news";
  const parts = [`(${phrase})`];
  const country = query.countries?.[0];
  if (country) parts.push(`sourcecountry:${country}`);
  const lang = query.languages?.[0];
  if (lang) parts.push(`sourcelang:${lang}`);
  return parts.join(" ");
}

const gdeltProvider: NewsProvider = {
  key: "gdelt",
  name: "GDELT 2.0",
  tier: "production",
  capabilities: { byCategory: true, byKeyword: true, byRegion: true, bySource: false },
  async fetchLatest(query) {
    const params = new URLSearchParams({
      query: buildGdeltQuery(query),
      mode: "ArtList",
      format: "json",
      maxrecords: String(Math.min(query.limit ?? 75, 250)),
      sort: "datedesc",
    });
    const res = await fetchNewsWithRetry(
      `https://api.gdeltproject.org/api/v2/doc/doc?${params.toString()}`,
    );
    if (!res.ok) throw new Error(`gdelt_${res.status}`);
    // GDELT occasionally returns non-JSON on bad queries; guard the parse.
    const text = await res.text();
    let data: { articles?: GdeltArticle[] };
    try {
      data = JSON.parse(text) as { articles?: GdeltArticle[] };
    } catch {
      return [];
    }
    return (data.articles ?? [])
      .filter((a): a is GdeltArticle & { url: string; title: string } => Boolean(a.url && a.title))
      .map((a) => ({
        providerKey: "gdelt",
        externalId: a.url,
        title: a.title,
        snippet: null,
        canonicalUrl: a.url,
        sourceName: a.domain ?? hostOf(a.url),
        language: a.language ?? null,
        publishedAt: parseGdeltDate(a.seendate),
        category: null,
        country: a.sourcecountry ?? null,
        rawPayload: a,
      }));
  },
  async test() {
    try {
      const res = await fetchNewsWithRetry(
        "https://api.gdeltproject.org/api/v2/doc/doc?query=test&mode=ArtList&format=json&maxrecords=1",
      );
      return res.ok
        ? { ok: true, detail: `GDELT reachable (${res.status}).` }
        : { ok: false, detail: `GDELT responded ${res.status}.` };
    } catch (cause) {
      return { ok: false, detail: cause instanceof Error ? cause.message : "fetch failed" };
    }
  },
};

// --- Registry ----------------------------------------------------------------

/** Implemented adapters (MVP). Guardian/NewsAPI/NewsData are registered in the
 *  DB `news_provider` registry but not yet implemented here. */
const REGISTRY: Readonly<Record<string, NewsProvider>> = {
  rss: rssProvider,
  gdelt: gdeltProvider,
};

/** Resolve an implemented adapter by key, or null when not yet implemented. */
export function getNewsProvider(key: string): NewsProvider | null {
  return REGISTRY[key] ?? null;
}

/** All implemented adapters (the ones an ingestion run can actually call). */
export function implementedProviders(): NewsProvider[] {
  return Object.values(REGISTRY);
}
