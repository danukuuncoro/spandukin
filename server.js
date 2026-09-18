import http from "node:http";
import crypto from "node:crypto";
import { gunzipSync } from "node:zlib";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "0.0.0.0";
const aiProvider = "openai";
const model = process.env.OPENAI_MODEL || "gpt-5.6-luna";
const apiKey = String(process.env.OPENAI_API_KEY || "").trim();
const timeoutMs = Math.max(1000, Number(process.env.OPENAI_TIMEOUT_MS || 45000));
const limitMax = Math.max(1, Number(process.env.AI_RATE_LIMIT_MAX || 30));
const limitWindowMs = Math.max(60000, Number(process.env.AI_RATE_LIMIT_WINDOW_MS || 86400000));

async function loadIndex() {
  try {
    const dir = join(here, "frontend");
    const names = (await readdir(dir))
      .filter(x => x.startsWith("index.html.gz.b64.") && x.endsWith(".part"))
      .sort();
    if (!names.length) throw new Error("Frontend belum diunggah.");
    let encoded = "";
    for (const name of names) encoded += await readFile(join(dir, name), "utf8");
    return gunzipSync(Buffer.from(encoded, "base64"));
  } catch (error) {
    console.warn("Frontend lengkap belum siap: " + error.message);
    return Buffer.from('<!doctype html><html lang="id"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Spandukin Backend</title><style>body{font:16px system-ui;background:#101820;color:#fff;display:grid;place-items:center;min-height:100vh;margin:0}.card{max-width:680px;background:#18232e;padding:28px;border-radius:18px}b{color:#ffcc00}code{background:#0b1117;padding:3px 7px;border-radius:6px}</style><div class="card"><h1>Spandukin</h1><p><b>Backend aktif.</b> Frontend lengkap sedang disinkronkan dari repository.</p><p>Status AI: <code>/api/status</code></p><p>Health check: <code>/healthz</code></p></div></html>');
  }
}

const indexHtml = await loadIndex();
const buckets = new Map();

function security(res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Cache-Control", "no-store");
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

async function readJson(req, max = 32768) {
  let total = 0;
  const chunks = [];
  for await (const chunk of req) {
    total += chunk.length;
    if (total > max) {
      const e = new Error("Request terlalu besar.");
      e.status = 413;
      throw e;
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    const e = new Error("Body JSON tidak valid.");
    e.status = 400;
    throw e;
  }
}

function clientIp(req) {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd) return fwd.split(",")[0].trim();
  return req.socket?.remoteAddress || "unknown";
}

function takeRate(key) {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || now >= b.resetAt) b = { count: 0, resetAt: now + limitWindowMs };
  b.count++;
  buckets.set(key, b);
  return {
    allowed: b.count <= limitMax,
    remaining: Math.max(0, limitMax - b.count),
    resetAt: b.resetAt
  };
}

const HEX = /^#[0-9A-F]{6}$/i;
const clean = (v, max, fallback) =>
  (String(v ?? "").replace(/\s+/g, " ").trim() || fallback).slice(0, max);
const color = (v, fallback) =>
  HEX.test(String(v ?? "").trim()) ? String(v).trim().toUpperCase() : fallback;

function normalizeConcept(raw) {
  return {
    headline: clean(raw?.headline, 80, "WARUNG"),
    slogan: clean(raw?.slogan, 120, "Murah • Lengkap • Dekat"),
    products: clean(raw?.products, 180, "Sembako • Minuman • Kebutuhan Harian"),
    note: clean(raw?.note, 220, "Gunakan teks besar dan kontras agar mudah dibaca dari jauh."),
    background: color(raw?.background, "#FFCC00"),
    accent: color(raw?.accent, "#E94235"),
    textColor: color(raw?.textColor, "#101820")
  };
}

const schema = {
  type: "object",
  properties: {
    headline: { type: "string", description: "Nama usaha atau kategori utama yang paling menonjol" },
    slogan: { type: "string", description: "Pesan utama singkat tanpa mengarang promo" },
    products: { type: "string", description: "Produk atau jasa utama, dipisahkan karakter •" },
    note: { type: "string", description: "Satu saran layout praktis untuk desainer" },
    background: { type: "string", description: "Warna latar hex #RRGGBB" },
    accent: { type: "string", description: "Warna aksen hex #RRGGBB" },
    textColor: { type: "string", description: "Warna teks hex #RRGGBB" }
  },
  required: ["headline", "slogan", "products", "note", "background", "accent", "textColor"],
  additionalProperties: false
};

const instructions = [
  "Anda adalah art director khusus spanduk warung dan UMKM Indonesia.",
  "Keluaran harus ringkas, mudah dibaca dari jarak jauh, kontras, dan realistis untuk dicetak.",
  "Gunakan Bahasa Indonesia kecuali brief jelas meminta bahasa lain.",
  "Jangan mengarang harga, alamat, nomor telepon, diskon, sertifikasi, atau klaim yang tidak ada di brief.",
  "Gunakan kode warna hex #RRGGBB untuk background, accent, dan textColor.",
  "Hasil harus mengikuti schema JSON yang diminta."
].join("\n");

function openAIOutputText(data) {
  if (typeof data?.output_text === "string" && data.output_text.trim()) {
    return data.output_text.trim();
  }
  const output = Array.isArray(data?.output) ? data.output : [];
  for (const item of output) {
    const parts = Array.isArray(item?.content) ? item.content : [];
    for (const part of parts) {
      if (part?.type === "output_text" && typeof part.text === "string" && part.text.trim()) {
        return part.text.trim();
      }
    }
  }
  return "";
}

async function generateConcept(prompt) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;

  try {
    response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + apiKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        instructions,
        input: prompt,
        store: false,
        text: {
          format: {
            type: "json_schema",
            name: "spandukin_concept",
            strict: true,
            schema
          }
        }
      }),
      signal: controller.signal
    });
  } catch (err) {
    const e = new Error(
      err?.name === "AbortError"
        ? "OpenAI timeout. Coba lagi."
        : "Backend gagal menghubungi OpenAI."
    );
    e.status = err?.name === "AbortError" ? 504 : 502;
    throw e;
  } finally {
    clearTimeout(timer);
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    let message = data?.error?.message || "Permintaan ke OpenAI gagal.";
    if (response.status === 400) message = "Konfigurasi OpenAI ditolak: " + message;
    if (response.status === 401 || response.status === 403) message = "OPENAI_API_KEY ditolak atau tidak memiliki akses.";
    if (response.status === 429) message = "Kuota atau rate limit OpenAI tercapai. Coba lagi setelah kuota tersedia.";
    const e = new Error(message);
    e.status = response.status >= 500 ? 502 : response.status;
    throw e;
  }

  const text = openAIOutputText(data);
  if (!text) {
    const e = new Error("OpenAI tidak mengembalikan konsep.");
    e.status = 502;
    throw e;
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    const e = new Error("Format konsep AI tidak valid.");
    e.status = 502;
    throw e;
  }

  return {
    concept: normalizeConcept(parsed),
    model: data.model || model,
    provider: aiProvider,
    usage: data.usage || null
  };
}

const server = http.createServer(async (req, res) => {
  const requestId = crypto.randomUUID();
  security(res);
  res.setHeader("X-Request-Id", requestId);
  const url = new URL(req.url, "http://" + (req.headers.host || "localhost"));

  try {
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Length": indexHtml.length,
        "Cache-Control": "no-cache"
      });
      return res.end(indexHtml);
    }

    if (req.method === "GET" && url.pathname === "/healthz") {
      return sendJson(res, 200, {
        ok: true,
        service: "spandukin",
        uptimeSeconds: Math.floor(process.uptime())
      });
    }

    if (req.method === "GET" && url.pathname === "/api/status") {
      return sendJson(res, 200, {
        ok: true,
        storage: true,
        user: "spandukin-railway",
        openai: Boolean(apiKey),
        openaiModel: model,
        aiProvider,
        aiModel: model,
        aiReady: Boolean(apiKey),
        aiLimitPerWindow: limitMax,
        aiLimitWindowMs: limitWindowMs
      });
    }

    if (req.method === "POST" && url.pathname === "/api/ai") {
      if (!apiKey) {
        return sendJson(res, 503, {
          ok: false,
          requestId,
          message: "OPENAI_API_KEY belum dipasang pada backend."
        });
      }

      const ip = clientIp(req);
      const rate = takeRate(ip);
      res.setHeader("X-RateLimit-Limit", String(limitMax));
      res.setHeader("X-RateLimit-Remaining", String(rate.remaining));

      if (!rate.allowed) {
        return sendJson(res, 429, {
          ok: false,
          requestId,
          message: "Batas pembuatan konsep AI tercapai. Coba lagi setelah periode limit berakhir."
        });
      }

      const body = await readJson(req);
      const prompt = String(body?.prompt ?? "").trim();

      if (prompt.length < 3 || prompt.length > 2000) {
        return sendJson(res, 400, {
          ok: false,
          requestId,
          message: "Brief harus 3–2.000 karakter."
        });
      }

      const result = await generateConcept(prompt);
      return sendJson(res, 200, { ok: true, requestId, ...result });
    }

    return sendJson(res, 404, {
      ok: false,
      requestId,
      message: "Endpoint tidak ditemukan."
    });
  } catch (err) {
    const status = Number.isInteger(err?.status) ? err.status : 500;
    console.error(JSON.stringify({
      requestId,
      method: req.method,
      path: url.pathname,
      status,
      message: err?.message
    }));

    return sendJson(
      res,
      status >= 400 && status <= 599 ? status : 500,
      {
        ok: false,
        requestId,
        message: status === 500 ? "Terjadi kesalahan internal." : err.message
      }
    );
  }
});

server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;
server.requestTimeout = 70000;

server.listen(port, host, () => {
  console.log(
    "Spandukin aktif di " + host + ":" + port +
    " | " + aiProvider + " " + (apiKey ? "aktif" : "belum dikonfigurasi") +
    " | " + model
  );
});
