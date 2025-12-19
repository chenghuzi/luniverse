import { readFile, rename, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import dns from "node:dns";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseFeed } from "feedsmith";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dns.setDefaultResultOrder("ipv4first");

const REPO_ROOT = path.resolve(__dirname, "..");
const PODCAST_LIST_PATH = path.join(REPO_ROOT, "src", "podcast_list.json");
const OUTPUT_PATH = path.join(REPO_ROOT, "card_data.json");

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_CONCURRENCY = 6;

const ACCENT_PALETTE = [
  "linear-gradient(135deg,#0ea5e9,#6366f1)",
  "linear-gradient(135deg,#22c55e,#14b8a6)",
  "linear-gradient(135deg,#f97316,#ef4444)",
  "linear-gradient(135deg,#a855f7,#ec4899)",
  "linear-gradient(135deg,#eab308,#f59e0b)",
  "linear-gradient(135deg,#06b6d4,#3b82f6)",
  "linear-gradient(135deg,#10b981,#84cc16)",
  "linear-gradient(135deg,#64748b,#0f172a)",
];

function sha1Hex(input) {
  return crypto.createHash("sha1").update(input).digest("hex");
}

function stableId(prefix, input, len) {
  return `${prefix}_${sha1Hex(String(input)).slice(0, len)}`;
}

function firstNonEmpty(...values) {
  for (const v of values) {
    if (typeof v === "string" && v.trim().length > 0) return v.trim();
  }
  return undefined;
}

function toIsoStringOrUndefined(value) {
  if (!value) return undefined;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  if (typeof value === "string") {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return undefined;
}

function parseDurationSeconds(value) {
  if (value == null) return undefined;
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.floor(value));
  if (typeof value !== "string") return undefined;

  const s = value.trim();
  if (s.length === 0) return undefined;
  if (/^\d+$/.test(s)) return Math.max(0, parseInt(s, 10));

  const parts = s.split(":").map((p) => p.trim());
  if (parts.some((p) => p.length === 0 || !/^\d+$/.test(p))) return undefined;
  const nums = parts.map((p) => parseInt(p, 10));
  if (nums.some((n) => Number.isNaN(n) || n < 0)) return undefined;

  if (nums.length === 2) {
    const [mm, ss] = nums;
    return mm * 60 + ss;
  }
  if (nums.length === 3) {
    const [hh, mm, ss] = nums;
    return hh * 3600 + mm * 60 + ss;
  }
  return undefined;
}

function stripHtml(text) {
  if (!text) return undefined;
  const s = String(text);
  const withoutTags = s.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  return withoutTags.length > 0 ? withoutTags : undefined;
}

function truncate(text, maxLen) {
  if (!text) return undefined;
  const s = String(text);
  if (s.length <= maxLen) return s;
  return `${s.slice(0, Math.max(0, maxLen - 1))}…`;
}

function pickAccent(seed) {
  const h = sha1Hex(String(seed));
  const n = parseInt(h.slice(0, 8), 16);
  return ACCENT_PALETTE[n % ACCENT_PALETTE.length];
}

async function fetchText(url, timeoutMs) {
  const controller = AbortSignal.timeout(timeoutMs);
  const res = await fetch(url, {
    signal: controller,
    headers: {
      "user-agent": "luniverse-fetch/1.0 (+https://local)",
      accept: "application/rss+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.1",
    },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }
  return await res.text();
}

function sleepMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchTextViaCurl(url, timeoutMs) {
  const timeoutSeconds = Math.max(1, Math.ceil(timeoutMs / 1000));
  const args = [
    "-fsSL",
    "--max-time",
    String(timeoutSeconds),
    "-H",
    "user-agent: luniverse-fetch/1.0 (+https://local)",
    "-H",
    "accept: application/rss+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.1",
    url,
  ];

  return await new Promise((resolve, reject) => {
    const child = spawn("curl", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (c) => {
      stdout += c;
    });
    child.stderr.on("data", (c) => {
      stderr += c;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) return resolve(stdout);
      reject(new Error(`curl failed (exit ${code}): ${stderr.trim()}`));
    });
  });
}

function isRetryableError(err) {
  if (!err) return false;
  const msg = err instanceof Error ? err.message : String(err);
  if (/fetch failed/i.test(msg)) return true;
  if (/timed out/i.test(msg)) return true;
  if (/ECONNRESET|EAI_AGAIN|ENOTFOUND|ECONNREFUSED|ETIMEDOUT/i.test(msg)) return true;
  if (/^HTTP 429\b/.test(msg)) return true;
  if (/^HTTP 5\\d\\d\\b/.test(msg)) return true;
  return false;
}

async function fetchTextWithRetry(url, timeoutMs) {
  const maxAttempts = Number.parseInt(process.env.FETCH_RETRIES ?? "", 10) || 3;
  const useCurlFallback = (process.env.FETCH_CURL_FALLBACK ?? "1") !== "0";

  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await fetchText(url, timeoutMs);
    } catch (e) {
      lastErr = e;
      if (!isRetryableError(e) || attempt === maxAttempts) break;
      await sleepMs(250 * attempt);
    }
  }

  if (useCurlFallback && process.platform !== "win32") {
    try {
      return await fetchTextViaCurl(url, timeoutMs);
    } catch (e) {
      lastErr = e;
    }
  }

  throw lastErr;
}

function normalizePodcast(feed, feedUrl) {
  const title = firstNonEmpty(feed?.title) ?? feedUrl;
  const authorName = firstNonEmpty(feed?.itunes?.author) ?? undefined;
  const imageUrl = firstNonEmpty(feed?.itunes?.image) ?? undefined;
  const language = firstNonEmpty(feed?.language) ?? undefined;
  const categories = Array.isArray(feed?.itunes?.categories)
    ? feed.itunes.categories
        .map((c) => (c && typeof c === "object" ? c.text : undefined))
        .filter((c) => typeof c === "string" && c.trim().length > 0)
    : undefined;

  return { title, authorName, imageUrl, language, categories };
}

function pickAudioEnclosure(item) {
  const list = Array.isArray(item?.enclosures) ? item.enclosures : [];
  const audioFirst = list.find((e) => {
    const t = typeof e?.type === "string" ? e.type.toLowerCase() : "";
    return t.startsWith("audio/") || t.includes("audio");
  });
  const candidate = audioFirst ?? list[0];
  if (!candidate?.url || typeof candidate.url !== "string") return undefined;
  return candidate;
}

function normalizeEpisode(item, enclosure) {
  const title = firstNonEmpty(item?.title) ?? "Untitled episode";
  const link = firstNonEmpty(item?.link) ?? undefined;
  const publishedAt = toIsoStringOrUndefined(item?.pubDate) ?? undefined;
  const durationSeconds = parseDurationSeconds(item?.itunes?.duration) ?? undefined;

  const audio = {
    url: enclosure.url,
    mimeType: typeof enclosure.type === "string" ? enclosure.type : undefined,
    byteLength: typeof enclosure.length === "number" ? enclosure.length : undefined,
  };

  return { title, link, publishedAt, durationSeconds, audio };
}

function buildHighlight(item, podcastTitle, episodeTitle) {
  const title = firstNonEmpty(item?.title) ?? `${podcastTitle} • ${episodeTitle}`;
  const text = truncate(
    stripHtml(firstNonEmpty(item?.summary, item?.description, item?.content?.text, item?.content)),
    320,
  );
  return { title, text };
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const i = nextIndex;
      nextIndex += 1;
      if (i >= items.length) return;
      results[i] = await mapper(items[i], i);
    }
  }

  const workers = Array.from({ length: Math.max(1, concurrency) }, () => worker());
  await Promise.all(workers);
  return results;
}

async function main() {
  const startedAt = Date.now();
  const timeoutMs = Number.parseInt(process.env.FETCH_TIMEOUT_MS ?? "", 10) || DEFAULT_TIMEOUT_MS;
  const concurrency = Number.parseInt(process.env.FETCH_CONCURRENCY ?? "", 10) || DEFAULT_CONCURRENCY;

  const rawListText = await readFile(PODCAST_LIST_PATH, "utf8");
  const rawList = (() => {
    try {
      return JSON.parse(rawListText);
    } catch {
      const sanitized = rawListText
        .replace(/^\uFEFF/, "")
        .replace(/,\s*([}\]])/g, "$1");
      return JSON.parse(sanitized);
    }
  })();
  const urls = Array.isArray(rawList?.results) ? rawList.results : [];
  const uniqueUrls = [];
  const seen = new Set();
  for (const u of urls) {
    if (typeof u !== "string" || u.trim().length === 0) continue;
    const url = u.trim();
    if (seen.has(url)) continue;
    seen.add(url);
    uniqueUrls.push(url);
  }

  const failures = [];

  const cards = (
    await mapWithConcurrency(uniqueUrls, concurrency, async (feedUrl) => {
      try {
        const xml = await fetchTextWithRetry(feedUrl, timeoutMs);
        const parsed = await parseFeed(xml);
        const feed = parsed?.feed;
        const items = Array.isArray(feed?.items) ? feed.items : [];

        const audioItems = items
          .map((it) => ({ it, enclosure: pickAudioEnclosure(it) }))
          .filter((x) => Boolean(x.enclosure));

        if (audioItems.length === 0) {
          failures.push({ url: feedUrl, reason: "no_audio_enclosure" });
          return null;
        }

        audioItems.sort((a, b) => {
          const ap = new Date(a.it?.pubDate ?? 0).getTime();
          const bp = new Date(b.it?.pubDate ?? 0).getTime();
          return (Number.isFinite(bp) ? bp : 0) - (Number.isFinite(ap) ? ap : 0);
        });

        const chosen = audioItems[0];
        const podcast = normalizePodcast(feed, feedUrl);
        const podcastId = stableId("p", feedUrl, 12);

        const episodeSeed =
          firstNonEmpty(
            chosen.it?.guid,
            chosen.it?.link,
            chosen.enclosure?.url,
            `${feedUrl}#0`,
          ) ?? `${feedUrl}#0`;
        const episodeId = stableId("e", episodeSeed, 12);

        const episode = normalizeEpisode(chosen.it, chosen.enclosure);
        const episodeImageUrl = firstNonEmpty(feed?.itunes?.image) ?? undefined;

        const highlightSeed = `${podcastId}:${episodeId}`;
        const highlightBase = buildHighlight(chosen.it, podcast.title, episode.title);

        const card = {
          id: stableId("c", `${podcastId}:${episodeId}`, 12),
          podcast: {
            id: podcastId,
            title: podcast.title,
            authorName: podcast.authorName,
            imageUrl: podcast.imageUrl,
            language: podcast.language,
            categories: podcast.categories,
          },
          episode: {
            id: episodeId,
            title: episode.title,
            link: episode.link,
            publishedAt: episode.publishedAt,
            durationSeconds: episode.durationSeconds,
            imageUrl: episodeImageUrl,
            audio: episode.audio,
          },
          highlight: {
            id: stableId("h", highlightSeed, 12),
            title: highlightBase.title,
            text: highlightBase.text,
          },
          ui: { accent: pickAccent(podcastId) },
        };

        return card;
      } catch (e) {
        failures.push({ url: feedUrl, reason: e instanceof Error ? e.message : String(e) });
        return null;
      }
    })
  ).filter(Boolean);

  const tmpPath = `${OUTPUT_PATH}.tmp`;
  await writeFile(tmpPath, `${JSON.stringify(cards, null, 2)}\n`, "utf8");
  await rename(tmpPath, OUTPUT_PATH);

  const elapsedMs = Date.now() - startedAt;
  const ok = cards.length;
  const total = uniqueUrls.length;
  const failed = failures.length;

  console.log(
    JSON.stringify(
      {
        output: path.relative(REPO_ROOT, OUTPUT_PATH),
        totalFeeds: total,
        okFeeds: ok,
        failedFeeds: failed,
        elapsedMs,
      },
      null,
      2,
    ),
  );
  if (failed > 0) {
    console.error(`Failures: ${failed}/${total}`);
    console.error(JSON.stringify(failures.slice(0, 20), null, 2));
  }
}

await main();
