import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REPO_ROOT = path.resolve(__dirname, "..");
const INPUT_PATH = path.join(REPO_ROOT, "card_data.json");
const OUTPUT_PATH = path.join(REPO_ROOT, "src", "shared", "api", "mocks", "deckCards.json");
const DETAILS_DIR = path.join(REPO_ROOT, "src", "shared", "api", "mocks", "details");

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isSafeFileStem(value) {
  return typeof value === "string" && /^[a-zA-Z0-9_-]+$/.test(value);
}

function validateCard(card, index) {
  assert(card && typeof card === "object", `cards[${index}] must be an object`);
  assert(!("instanceId" in card), `cards[${index}].instanceId must not exist (mock omits runtime instanceId)`);

  assert(isNonEmptyString(card.id), `cards[${index}].id must be a non-empty string`);
  assert(isSafeFileStem(card.id), `cards[${index}].id must be safe for filenames (got: ${JSON.stringify(card.id)})`);

  const podcast = card.podcast;
  assert(podcast && typeof podcast === "object", `cards[${index}].podcast must be an object`);
  assert(isNonEmptyString(podcast.id), `cards[${index}].podcast.id must be a non-empty string`);
  assert(isNonEmptyString(podcast.title), `cards[${index}].podcast.title must be a non-empty string`);

  const episode = card.episode;
  assert(episode && typeof episode === "object", `cards[${index}].episode must be an object`);
  assert(isNonEmptyString(episode.id), `cards[${index}].episode.id must be a non-empty string`);
  assert(isNonEmptyString(episode.title), `cards[${index}].episode.title must be a non-empty string`);

  const audio = episode.audio;
  assert(audio && typeof audio === "object", `cards[${index}].episode.audio must be an object`);
  assert(isNonEmptyString(audio.url), `cards[${index}].episode.audio.url must be a non-empty string`);

  const highlight = card.highlight;
  assert(highlight && typeof highlight === "object", `cards[${index}].highlight must be an object`);
  assert(isNonEmptyString(highlight.id), `cards[${index}].highlight.id must be a non-empty string`);
  assert(isNonEmptyString(highlight.title), `cards[${index}].highlight.title must be a non-empty string`);

  const ui = card.ui;
  assert(ui && typeof ui === "object", `cards[${index}].ui must be an object`);
  assert(isNonEmptyString(ui.accent), `cards[${index}].ui.accent must be a non-empty string`);
}

function toPositiveIntOrUndefined(value) {
  if (typeof value !== "number") return undefined;
  if (!Number.isFinite(value)) return undefined;
  const n = Math.floor(value);
  return n > 0 ? n : undefined;
}

function withRandomHighlightSnippet(card) {
  const windowSeconds = 30;
  const durationSeconds = toPositiveIntOrUndefined(card?.episode?.durationSeconds);
  if (!durationSeconds || durationSeconds < windowSeconds) {
    if (card?.highlight && typeof card.highlight === "object" && "snippet" in card.highlight) {
      delete card.highlight.snippet;
    }
    return card;
  }

  const maxStartSeconds = durationSeconds - windowSeconds;
  const startSeconds = crypto.randomInt(0, maxStartSeconds + 1);
  const startMs = startSeconds * 1000;
  const durationMs = windowSeconds * 1000;

  card.highlight.snippet = { startMs, durationMs };
  return card;
}

async function writeJsonAtomic(destPath, value) {
  const dir = path.dirname(destPath);
  const base = path.basename(destPath);
  const tmpPath = path.join(dir, `${base}.tmp`);

  await writeFile(tmpPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  try {
    await rename(tmpPath, destPath);
  } catch (err) {
    if (err && typeof err === "object" && ("code" in err || "errno" in err)) {
      const code = err.code;
      if (code === "EEXIST" || code === "EPERM") {
        await rm(destPath, { force: true });
        await rename(tmpPath, destPath);
        return;
      }
    }
    throw err;
  }
}

async function main() {
  const startedAt = Date.now();
  const raw = await readFile(INPUT_PATH, "utf8");
  const parsed = JSON.parse(raw);

  assert(Array.isArray(parsed), `card_data.json must be a JSON array`);
  assert(parsed.length > 0, `card_data.json must not be empty`);

  for (let i = 0; i < parsed.length; i += 1) validateCard(parsed[i], i);
  const transformed = parsed.map((c) => withRandomHighlightSnippet(c));
  const deckCards = transformed.map((card) => {
    const { episodes, ...rest } = card;
    return rest;
  });
  const ids = new Set();
  for (let i = 0; i < transformed.length; i += 1) {
    const id = transformed[i]?.id;
    assert(!ids.has(id), `cards[${i}].id must be unique (duplicate: ${JSON.stringify(id)})`);
    ids.add(id);
  }

  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await mkdir(DETAILS_DIR, { recursive: true });

  await writeJsonAtomic(OUTPUT_PATH, deckCards);
  for (const card of transformed) {
    const detailPath = path.join(DETAILS_DIR, `${card.id}.json`);
    await writeJsonAtomic(detailPath, card);
  }

  const elapsedMs = Date.now() - startedAt;
  console.log(
    JSON.stringify(
      {
        input: path.relative(REPO_ROOT, INPUT_PATH),
        output: path.relative(REPO_ROOT, OUTPUT_PATH),
        detailsDir: path.relative(REPO_ROOT, DETAILS_DIR),
        detailsFiles: transformed.length,
        cards: deckCards.length,
        elapsedMs,
      },
      null,
      2,
    ),
  );
}

await main();
