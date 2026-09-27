// Shared helpers: escaping, validation, ids, responses.

export const LIMITS = {
  title: { min: 3, max: 120 },
  author: { min: 2, max: 40 },
  body: { min: 2, max: 8000 },
  maxRepliesPerThread: 500,
  maxThreadsPerIndex: 1000,
  maxRequestBytes: 32 * 1024,
};

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;", "`": "&#96;" };

/** Escape any value for safe use in HTML text and quoted attributes. */
export function esc(value) {
  return String(value ?? "").replace(/[&<>"'`]/g, (ch) => ESC[ch]);
}

/** Escape, then turn blank-line-separated blocks into paragraphs and newlines into <br>. */
export function formatBody(text) {
  return String(text ?? "")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`)
    .join("\n");
}

/** Normalise user text: string, unify newlines, strip control chars (keep \n and \t), trim. */
export function clean(value, { singleLine = false } = {}) {
  let s = typeof value === "string" ? value : value == null ? "" : String(value);
  s = s.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g, "");
  if (singleLine) s = s.replace(/\s+/g, " ");
  else s = s.replace(/\n{3,}/g, "\n\n");
  return s.trim();
}

function checkLen(errors, field, label, value, { min, max }) {
  const len = [...value].length;
  if (len < min) errors.push({ field, message: `${label} muss mindestens ${min} Zeichen lang sein.` });
  else if (len > max) errors.push({ field, message: `${label} darf höchstens ${max} Zeichen lang sein.` });
}

export function validateThreadInput(input) {
  const data = {
    title: clean(input.title, { singleLine: true }),
    author: clean(input.author, { singleLine: true }),
    body: clean(input.body),
  };
  const errors = [];
  checkLen(errors, "title", "Der Titel", data.title, LIMITS.title);
  checkLen(errors, "author", "Der Name", data.author, LIMITS.author);
  checkLen(errors, "body", "Der Beitrag", data.body, LIMITS.body);
  return { data, errors };
}

export function validateReplyInput(input) {
  const data = {
    author: clean(input.author, { singleLine: true }),
    body: clean(input.body),
  };
  const errors = [];
  checkLen(errors, "author", "Der Name", data.author, LIMITS.author);
  checkLen(errors, "body", "Die Antwort", data.body, LIMITS.body);
  return { data, errors };
}

/** Time-sortable, URL-safe id: base36 timestamp + random suffix. */
export function newId() {
  const rnd = new Uint8Array(6);
  crypto.getRandomValues(rnd);
  const suffix = [...rnd].map((b) => b.toString(36).padStart(2, "0")).join("").slice(0, 8);
  return `${Date.now().toString(36)}${suffix}`;
}

export const ID_RE = /^[a-z0-9-]{4,40}$/;

export const SECURITY_HEADERS = {
  "Content-Security-Policy":
    "default-src 'none'; style-src 'self'; img-src 'self' data:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
  "X-Frame-Options": "DENY",
};

export function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
      ...SECURITY_HEADERS,
      ...extra,
    },
  });
}

export function html(body, status = 200, extra = {}) {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      ...SECURITY_HEADERS,
      ...extra,
    },
  });
}

export function redirect(location, status = 303) {
  return new Response(null, { status, headers: { Location: location, ...SECURITY_HEADERS } });
}

export function clientIp(request) {
  return request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() || "unknown";
}

/** Parse JSON or form-encoded bodies with a size cap. Returns { ok, data } or { ok:false, status, error }. */
export async function readInput(request) {
  const declared = Number(request.headers.get("Content-Length") || 0);
  if (declared > LIMITS.maxRequestBytes) return { ok: false, status: 413, error: "Anfrage zu groß." };
  const text = await request.text();
  if (text.length > LIMITS.maxRequestBytes) return { ok: false, status: 413, error: "Anfrage zu groß." };
  const type = (request.headers.get("Content-Type") || "").toLowerCase();
  try {
    if (type.includes("application/json")) {
      const data = JSON.parse(text || "{}");
      if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("not an object");
      return { ok: true, data };
    }
    if (type.includes("application/x-www-form-urlencoded")) {
      return { ok: true, data: Object.fromEntries(new URLSearchParams(text)) };
    }
  } catch {
    return { ok: false, status: 400, error: "Ungültiger Anfrage-Body." };
  }
  return { ok: false, status: 415, error: "Content-Type muss application/json oder application/x-www-form-urlencoded sein." };
}

export function formatDate(iso) {
  try {
    return new Intl.DateTimeFormat("de-DE", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Europe/Berlin",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}
