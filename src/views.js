// Server-rendered HTML views (German UI). Every dynamic value goes through esc()/formatBody().
import { CATEGORIES } from "./categories.js";
import { esc, formatBody, formatDate, LIMITS } from "./util.js";

function layout({ title, body, active = "" }) {
  const nav = CATEGORIES.map(
    (c) => `<a href="/k/${esc(c.slug)}"${active === c.slug ? ' aria-current="page"' : ""}>${esc(c.name)}</a>`,
  ).join("");
  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<title>${esc(title)} · Lumina Forum</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/styles.css">
</head>
<body>
<div class="glow" aria-hidden="true"></div>
<header class="site-header">
  <div class="wrap header-inner">
    <a class="brand" href="/"><span class="brand-mark">✦</span> Lumina <span>Forum</span></a>
    <nav class="cat-nav" aria-label="Kategorien">${nav}</nav>
  </div>
</header>
<main class="wrap">
${body}
</main>
<footer class="site-footer wrap">
  <p>Lumina Forum · ein Ort zum Austauschen · <a href="/api/health">Status</a></p>
</footer>
</body>
</html>`;
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function errorList(errors) {
  if (!errors || !errors.length) return "";
  return `<div class="alert" role="alert"><strong>Bitte korrigieren:</strong><ul>${errors
    .map((e) => `<li>${esc(e.message)}</li>`)
    .join("")}</ul></div>`;
}

const honeypot = `<div class="hp" aria-hidden="true"><label>Website <input type="text" name="website" tabindex="-1" autocomplete="off"></label></div>`;

export function homePage(stats, counts) {
  const cards = stats
    .map(
      (c) => `
    <a class="card cat-card" href="/k/${esc(c.slug)}">
      <div class="cat-icon" aria-hidden="true">${esc(c.icon)}</div>
      <div class="cat-body">
        <h2>${esc(c.name)}</h2>
        <p>${esc(c.description)}</p>
        <div class="meta">${plural(c.threadCount, "Thema", "Themen")} · ${plural(c.replyCount, "Antwort", "Antworten")}${
          c.latest ? ` · Neu: <em>${esc(c.latest.title)}</em>` : ""
        }</div>
      </div>
    </a>`,
    )
    .join("");
  return layout({
    title: "Übersicht",
    body: `
<section class="hero">
  <h1>Willkommen im <span class="lumina">Lumina Forum</span></h1>
  <p>Diskutiere über Technik &amp; Nexus, Musik mit OUR BAND, handle auf dem Marktplatz oder plaudere Off-Topic.</p>
  <p class="stats">${plural(counts.threads, "Thema", "Themen")} · ${plural(counts.replies, "Antwort", "Antworten")}</p>
</section>
<section class="grid">${cards}</section>`,
  });
}

export function categoryPage(cat, threads, { errors = [], values = {} } = {}) {
  const rows = threads.length
    ? threads
        .map(
          (t) => `
      <li class="thread-row">
        <a href="/t/${esc(t.id)}"><h3>${esc(t.title)}</h3></a>
        <div class="meta">von <strong>${esc(t.author)}</strong> · ${esc(formatDate(t.createdAt))} · ${t.replyCount} ${
            t.replyCount === 1 ? "Antwort" : "Antworten"
          }</div>
      </li>`,
        )
        .join("")
    : `<li class="empty">Noch keine Themen. Starte das erste!</li>`;
  return layout({
    title: cat.name,
    active: cat.slug,
    body: `
<nav class="crumbs"><a href="/">Übersicht</a> › ${esc(cat.name)}</nav>
<section class="cat-head">
  <h1><span class="cat-icon" aria-hidden="true">${esc(cat.icon)}</span> ${esc(cat.name)}</h1>
  <p>${esc(cat.description)}</p>
</section>
<ul class="thread-list card">${rows}</ul>
<section class="card form-card" id="neu">
  <h2>Neues Thema erstellen</h2>
  ${errorList(errors)}
  <form method="post" action="/k/${esc(cat.slug)}/neu">
    <label>Titel <input name="title" required minlength="${LIMITS.title.min}" maxlength="${LIMITS.title.max}" value="${esc(values.title)}"></label>
    <label>Dein Name <input name="author" required minlength="${LIMITS.author.min}" maxlength="${LIMITS.author.max}" value="${esc(values.author)}"></label>
    <label>Beitrag <textarea name="body" rows="7" required minlength="${LIMITS.body.min}" maxlength="${LIMITS.body.max}">${esc(values.body)}</textarea></label>
    ${honeypot}
    <button type="submit">Thema veröffentlichen</button>
  </form>
</section>`,
  });
}

export function threadPage(cat, thread, { errors = [], values = {} } = {}) {
  const replies = thread.replies
    .map(
      (r, i) => `
    <article class="post card" id="r-${esc(r.id)}">
      <header class="post-head"><strong>${esc(r.author)}</strong><span>#${i + 1} · ${esc(formatDate(r.createdAt))}</span></header>
      <div class="post-body">${formatBody(r.body)}</div>
    </article>`,
    )
    .join("");
  const locked = thread.replies.length >= LIMITS.maxRepliesPerThread;
  return layout({
    title: thread.title,
    active: cat ? cat.slug : "",
    body: `
<nav class="crumbs"><a href="/">Übersicht</a> › ${
      cat ? `<a href="/k/${esc(cat.slug)}">${esc(cat.name)}</a> › ` : ""
    }${esc(thread.title)}</nav>
<article class="post card op">
  <h1>${esc(thread.title)}</h1>
  <header class="post-head"><strong>${esc(thread.author)}</strong><span>${esc(formatDate(thread.createdAt))}</span></header>
  <div class="post-body">${formatBody(thread.body)}</div>
</article>
<h2 class="replies-title">${thread.replies.length} ${thread.replies.length === 1 ? "Antwort" : "Antworten"}</h2>
${replies}
<section class="card form-card" id="antworten">
  ${
    locked
      ? `<p>Dieses Thema hat die maximale Anzahl an Antworten erreicht.</p>`
      : `<h2>Antworten</h2>
  ${errorList(errors)}
  <form method="post" action="/t/${esc(thread.id)}/antworten">
    <label>Dein Name <input name="author" required minlength="${LIMITS.author.min}" maxlength="${LIMITS.author.max}" value="${esc(values.author)}"></label>
    <label>Antwort <textarea name="body" rows="5" required minlength="${LIMITS.body.min}" maxlength="${LIMITS.body.max}">${esc(values.body)}</textarea></label>
    ${honeypot}
    <button type="submit">Antwort senden</button>
  </form>`
  }
</section>`,
  });
}

export function messagePage(title, message) {
  return layout({
    title,
    body: `<section class="card message"><h1>${esc(title)}</h1><p>${esc(message)}</p><p><a class="btn" href="/">Zur Übersicht</a></p></section>`,
  });
}
