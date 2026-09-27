// KV data layer.
//
// Key layout (namespace binding STORE):
//   thread:<id>        full thread JSON incl. replies array
//   index:<category>   JSON array of thread summaries, newest first (capped)
//   meta:counts        { threads, replies } totals for /api/health
//   meta:seeded        "1" once the welcome thread was written
//   rl:<ip>            rate-limit counter, expires via TTL
//
// Note: KV is eventually consistent and has no transactions. Index/count updates are
// read-modify-write, so truly simultaneous posts can overwrite each other's index entry.
// Fine for a small community; move to D1 or a Durable Object for stronger guarantees.

import { CATEGORIES } from "./categories.js";
import { LIMITS, newId } from "./util.js";

const WELCOME_ID = "willkommen";

const threadKey = (id) => `thread:${id}`;
const indexKey = (cat) => `index:${cat}`;

function summarize(t) {
  return {
    id: t.id,
    category: t.category,
    title: t.title,
    author: t.author,
    createdAt: t.createdAt,
    lastActivityAt: t.lastActivityAt,
    replyCount: t.replies.length,
  };
}

export async function getThread(env, id) {
  return env.STORE.get(threadKey(id), "json");
}

export async function listThreads(env, category) {
  const list = (await env.STORE.get(indexKey(category), "json")) || [];
  return list.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
}

export async function getCounts(env) {
  return (await env.STORE.get("meta:counts", "json")) || { threads: 0, replies: 0 };
}

async function bumpCounts(env, dThreads, dReplies) {
  const c = await getCounts(env);
  c.threads = Math.max(0, (c.threads || 0) + dThreads);
  c.replies = Math.max(0, (c.replies || 0) + dReplies);
  await env.STORE.put("meta:counts", JSON.stringify(c));
  return c;
}

async function upsertIndex(env, thread) {
  const list = (await env.STORE.get(indexKey(thread.category), "json")) || [];
  const next = [summarize(thread), ...list.filter((s) => s.id !== thread.id)]
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
    .slice(0, LIMITS.maxThreadsPerIndex);
  await env.STORE.put(indexKey(thread.category), JSON.stringify(next));
}

export async function createThread(env, { category, title, author, body }, id = newId()) {
  const now = new Date().toISOString();
  const thread = { id, category, title, author, body, createdAt: now, lastActivityAt: now, replies: [] };
  await env.STORE.put(threadKey(id), JSON.stringify(thread));
  await upsertIndex(env, thread);
  await bumpCounts(env, 1, 0);
  return thread;
}

/** Returns { thread, reply } or { error: "not_found" | "locked" }. */
export async function addReply(env, id, { author, body }) {
  const thread = await getThread(env, id);
  if (!thread) return { error: "not_found" };
  if (thread.replies.length >= LIMITS.maxRepliesPerThread) return { error: "locked" };
  const now = new Date().toISOString();
  const reply = { id: newId(), author, body, createdAt: now };
  thread.replies.push(reply);
  thread.lastActivityAt = now;
  await env.STORE.put(threadKey(id), JSON.stringify(thread));
  await upsertIndex(env, thread);
  await bumpCounts(env, 0, 1);
  return { thread, reply };
}

/** Seed a welcome thread once, only when the forum is empty. Uses a fixed id so it stays idempotent. */
export async function ensureSeeded(env) {
  if (await env.STORE.get("meta:seeded")) return;
  const counts = await getCounts(env);
  const existing = await env.STORE.get(threadKey(WELCOME_ID));
  if (!existing && counts.threads === 0) {
    await createThread(
      env,
      {
        category: "allgemein",
        title: "Willkommen im Lumina Forum ✦",
        author: "Sven",
        body:
          "Schön, dass du da bist!\n\n" +
          "Das Lumina Forum ist unser neuer Treffpunkt für Technik & Nexus, Musik mit OUR BAND, den Marktplatz und alles dazwischen.\n\n" +
          "Ein paar Regeln:\n– Freundlich bleiben.\n– Kein Spam.\n– Passende Kategorie wählen.\n\n" +
          "Stell dich gern hier in den Antworten kurz vor!",
      },
      WELCOME_ID,
    );
  }
  await env.STORE.put("meta:seeded", "1");
}

export async function categoryStats(env) {
  return Promise.all(
    CATEGORIES.map(async (c) => {
      const list = await listThreads(env, c.slug);
      const latest = [...list].sort((a, b) => (a.lastActivityAt < b.lastActivityAt ? 1 : -1))[0] || null;
      return {
        ...c,
        threadCount: list.length,
        replyCount: list.reduce((n, s) => n + (s.replyCount || 0), 0),
        latest,
      };
    }),
  );
}

/**
 * Simple per-IP rate limit on writes via a KV counter with TTL (KV minimum TTL is 60s).
 * Allows `max` writes per ~60s window. Best-effort only (KV is eventually consistent).
 */
export async function rateLimit(env, ip, max = 5, ttl = 60) {
  const key = `rl:${ip}`;
  const current = Number((await env.STORE.get(key)) || 0);
  if (current >= max) return { ok: false, retryAfter: ttl };
  await env.STORE.put(key, String(current + 1), { expirationTtl: ttl });
  return { ok: true };
}
