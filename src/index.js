// Lumina Forum: Cloudflare Worker entry point (routing for HTML pages + JSON API).
import { CATEGORIES, getCategory } from "./categories.js";
import {
  addReply, categoryStats, createThread, ensureSeeded, getCounts, getThread, listThreads, rateLimit,
} from "./store.js";
import {
  ID_RE, LIMITS, clientIp, html, json, readInput, redirect, validateReplyInput, validateThreadInput,
} from "./util.js";
import { categoryPage, homePage, messagePage, threadPage } from "./views.js";

export default {
  async fetch(request, env, ctx) {
    try {
      return await route(request, env, ctx);
    } catch (err) {
      console.error(JSON.stringify({ msg: "unhandled", error: String(err?.stack || err) }));
      const url = new URL(request.url);
      if (url.pathname.startsWith("/api/")) return json({ ok: false, error: "Interner Fehler." }, 500);
      return html(messagePage("Fehler", "Da ist etwas schiefgelaufen. Bitte versuche es später erneut."), 500);
    }
  },
};

async function route(request, env) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const method = request.method.toUpperCase();

  if (method === "OPTIONS" && path.startsWith("/api/")) {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "86400",
      },
    });
  }

  await ensureSeeded(env);

  if (path.startsWith("/api/")) return api(request, env, url, path, method);

  let m;
  if (path === "/" && (method === "GET" || method === "HEAD")) {
    const [stats, counts] = await Promise.all([categoryStats(env), getCounts(env)]);
    return html(homePage(stats, counts));
  }
  if ((m = path.match(/^\/k\/([a-z0-9-]+)$/)) && method === "GET") {
    const cat = getCategory(m[1]);
    if (!cat) return notFound();
    return html(categoryPage(cat, await listThreads(env, cat.slug)));
  }
  if ((m = path.match(/^\/k\/([a-z0-9-]+)\/neu$/)) && method === "POST") {
    const cat = getCategory(m[1]);
    if (!cat) return notFound();
    const input = await readInput(request);
    if (!input.ok) return html(messagePage("Fehler", input.error), input.status);
    if (input.data.website) return redirect(`/k/${cat.slug}`); // honeypot: silently drop bots
    const { data, errors } = validateThreadInput(input.data);
    if (errors.length) return html(categoryPage(cat, await listThreads(env, cat.slug), { errors, values: data }), 400);
    const rl = await rateLimit(env, clientIp(request));
    if (!rl.ok) return tooManyHtml(rl.retryAfter);
    const thread = await createThread(env, { ...data, category: cat.slug });
    return redirect(`/t/${thread.id}`);
  }
  if ((m = path.match(/^\/t\/([a-z0-9-]+)$/)) && method === "GET") {
    if (!ID_RE.test(m[1])) return notFound();
    const thread = await getThread(env, m[1]);
    if (!thread) return notFound();
    return html(threadPage(getCategory(thread.category), thread));
  }
  if ((m = path.match(/^\/t\/([a-z0-9-]+)\/antworten$/)) && method === "POST") {
    if (!ID_RE.test(m[1])) return notFound();
    const thread = await getThread(env, m[1]);
    if (!thread) return notFound();
    const input = await readInput(request);
    if (!input.ok) return html(messagePage("Fehler", input.error), input.status);
    if (input.data.website) return redirect(`/t/${thread.id}`);
    const { data, errors } = validateReplyInput(input.data);
    if (errors.length) return html(threadPage(getCategory(thread.category), thread, { errors, values: data }), 400);
    const rl = await rateLimit(env, clientIp(request));
    if (!rl.ok) return tooManyHtml(rl.retryAfter);
    const res = await addReply(env, thread.id, data);
    if (res.error === "locked") return html(messagePage("Gesperrt", "Maximale Anzahl an Antworten erreicht."), 409);
    if (res.error) return notFound();
    return redirect(`/t/${thread.id}#r-${res.reply.id}`);
  }
  if (["GET", "HEAD", "POST"].includes(method)) return notFound();
  return html(messagePage("Nicht erlaubt", "Diese Methode wird nicht unterstützt."), 405, { Allow: "GET, POST" });
}

async function api(request, env, url, path, method) {
  let m;
  if (path === "/api/health" && method === "GET") {
    const counts = await getCounts(env);
    return json({ ok: true, name: env.FORUM_NAME || "Lumina Forum", categories: CATEGORIES.length, ...counts, time: new Date().toISOString() });
  }
  if (path === "/api/categories" && method === "GET") {
    const stats = await categoryStats(env);
    return json({ ok: true, categories: stats });
  }
  if (path === "/api/threads" && method === "GET") {
    const slug = url.searchParams.get("category");
    if (!slug) return json({ ok: false, error: "Parameter 'category' fehlt.", categories: CATEGORIES.map((c) => c.slug) }, 400);
    const cat = getCategory(slug);
    if (!cat) return json({ ok: false, error: "Unbekannte Kategorie." }, 404);
    return json({ ok: true, category: cat.slug, threads: await listThreads(env, cat.slug) });
  }
  if (path === "/api/threads" && method === "POST") {
    const input = await readInput(request);
    if (!input.ok) return json({ ok: false, error: input.error }, input.status);
    const cat = getCategory(input.data.category);
    const { data, errors } = validateThreadInput(input.data);
    if (!cat) errors.unshift({ field: "category", message: "Unbekannte Kategorie." });
    if (errors.length) return json({ ok: false, errors }, 400);
    const rl = await rateLimit(env, clientIp(request));
    if (!rl.ok) return json({ ok: false, error: "Zu viele Beiträge. Bitte kurz warten." }, 429, { "Retry-After": String(rl.retryAfter) });
    const thread = await createThread(env, { ...data, category: cat.slug });
    return json({ ok: true, thread }, 201, { Location: `/api/threads/${thread.id}` });
  }
  if ((m = path.match(/^\/api\/threads\/([^/]+)$/)) && method === "GET") {
    if (!ID_RE.test(m[1])) return json({ ok: false, error: "Thema nicht gefunden." }, 404);
    const thread = await getThread(env, m[1]);
    if (!thread) return json({ ok: false, error: "Thema nicht gefunden." }, 404);
    return json({ ok: true, thread });
  }
  if ((m = path.match(/^\/api\/threads\/([^/]+)\/replies$/)) && method === "POST") {
    if (!ID_RE.test(m[1])) return json({ ok: false, error: "Thema nicht gefunden." }, 404);
    const input = await readInput(request);
    if (!input.ok) return json({ ok: false, error: input.error }, input.status);
    const { data, errors } = validateReplyInput(input.data);
    if (errors.length) return json({ ok: false, errors }, 400);
    if (!(await getThread(env, m[1]))) return json({ ok: false, error: "Thema nicht gefunden." }, 404);
    const rl = await rateLimit(env, clientIp(request));
    if (!rl.ok) return json({ ok: false, error: "Zu viele Beiträge. Bitte kurz warten." }, 429, { "Retry-After": String(rl.retryAfter) });
    const res = await addReply(env, m[1], data);
    if (res.error === "locked") return json({ ok: false, error: `Maximal ${LIMITS.maxRepliesPerThread} Antworten pro Thema.` }, 409);
    if (res.error) return json({ ok: false, error: "Thema nicht gefunden." }, 404);
    return json({ ok: true, reply: res.reply, threadId: m[1] }, 201);
  }
  return json({ ok: false, error: "Nicht gefunden." }, 404);
}

function notFound() {
  return html(messagePage("Nicht gefunden", "Diese Seite oder dieses Thema existiert nicht."), 404);
}

function tooManyHtml(retryAfter) {
  return html(messagePage("Langsamer bitte", "Zu viele Beiträge in kurzer Zeit. Bitte warte eine Minute."), 429, {
    "Retry-After": String(retryAfter),
  });
}
