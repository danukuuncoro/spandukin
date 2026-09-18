import http from 'node:http';
import crypto from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ApiManager } from './api-manager.js';

const here = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '0.0.0.0';
const api = new ApiManager(process.env);

async function loadIndex() {
  try {
    const dir = join(here, 'frontend');
    const names = (await readdir(dir))
      .filter(x => x.startsWith('index.html.gz.b64.') && x.endsWith('.part'))
      .sort();
    if (!names.length) throw new Error('Frontend belum diunggah.');
    let encoded = '';
    for (const name of names) encoded += await readFile(join(dir, name), 'utf8');
    return gunzipSync(Buffer.from(encoded, 'base64'));
  } catch (error) {
    console.warn(`Frontend lengkap belum siap: ${error.message}`);
    return Buffer.from('<!doctype html><html lang="id"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Spandukin Backend</title><style>body{font:16px system-ui;background:#101820;color:#fff;display:grid;place-items:center;min-height:100vh;margin:0}.card{max-width:720px;background:#18232e;padding:28px;border-radius:18px}b{color:#ffcc00}code{background:#0b1117;padding:3px 7px;border-radius:6px}</style><div class="card"><h1>Spandukin API Backend</h1><p><b>Backend aktif.</b></p><p>Status: <code>/api/status</code></p><p>Settings: <code>/api/settings</code></p><p>Health: <code>/healthz</code></p></div></html>');
  }
}

const indexHtml = await loadIndex();

function security(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cache-Control', 'no-store');
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

async function readJson(req, max = 32768) {
  let total = 0;
  const chunks = [];
  for await (const chunk of req) {
    total += chunk.length;
    if (total > max) {
      const e = new Error('Request terlalu besar.');
      e.status = 413;
      throw e;
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    const e = new Error('Body JSON tidak valid.');
    e.status = 400;
    throw e;
  }
}

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd) return fwd.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

const server = http.createServer(async (req, res) => {
  const requestId = crypto.randomUUID();
  security(res);
  res.setHeader('X-Request-Id', requestId);
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  try {
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Length': indexHtml.length,
        'Cache-Control': 'no-cache'
      });
      return res.end(indexHtml);
    }

    if (req.method === 'GET' && url.pathname === '/healthz') {
      return sendJson(res, 200, {
        ok: true,
        service: 'spandukin',
        uptimeSeconds: Math.floor(process.uptime()),
        provider: api.activeProvider,
        model: api.activeModel
      });
    }

    if (req.method === 'GET' && url.pathname === '/api/status') {
      const settings = api.publicSettings();
      return sendJson(res, 200, {
        ok: true,
        storage: true,
        user: 'spandukin-railway',
        openai: settings.providers.openai.configured,
        openaiModel: settings.providers.openai.model,
        aiProvider: settings.provider,
        aiModel: settings.model,
        aiReady: settings.provider === 'openai'
          ? settings.providers.openai.configured
          : settings.providers.gemini.configured,
        aiLimitPerWindow: settings.rateLimitMax,
        aiLimitWindowMs: settings.rateLimitWindowMs
      });
    }

    if (req.method === 'GET' && url.pathname === '/api/settings') {
      return sendJson(res, 200, { ok: true, settings: api.publicSettings() });
    }

    if (req.method === 'GET' && url.pathname === '/api/providers') {
      const s = api.publicSettings();
      return sendJson(res, 200, {
        ok: true,
        active: s.provider,
        providers: s.providers
      });
    }

    if (req.method === 'POST' && url.pathname === '/api/ai') {
      const rate = api.takeRate(clientIp(req));
      res.setHeader('X-RateLimit-Limit', String(api.runtime.rateLimitMax));
      res.setHeader('X-RateLimit-Remaining', String(rate.remaining));
      res.setHeader('X-RateLimit-Reset', String(Math.ceil(rate.resetAt / 1000)));
      if (!rate.allowed) {
        return sendJson(res, 429, {
          ok: false,
          requestId,
          message: 'Batas pembuatan konsep AI tercapai. Coba lagi setelah periode limit berakhir.'
        });
      }
      const body = await readJson(req);
      const result = await api.generate(body?.prompt, { requestId });
      return sendJson(res, 200, { ok: true, requestId, ...result });
    }

    if (url.pathname.startsWith('/api/admin/')) {
      api.requireAdmin(req);

      if (req.method === 'GET' && url.pathname === '/api/admin/overview') {
        return sendJson(res, 200, { ok: true, ...api.getAdminSnapshot() });
      }

      if (req.method === 'GET' && url.pathname === '/api/admin/settings') {
        return sendJson(res, 200, { ok: true, settings: api.publicSettings() });
      }

      if (req.method === 'PATCH' && url.pathname === '/api/admin/settings') {
        const body = await readJson(req);
        const settings = api.updateRuntimeSettings(body);
        return sendJson(res, 200, {
          ok: true,
          persisted: false,
          note: 'Perubahan berlaku sampai service restart. Untuk permanen, simpan nilai yang sama sebagai Railway environment variables.',
          settings
        });
      }

      if (req.method === 'POST' && url.pathname === '/api/admin/test') {
        const body = await readJson(req).catch(() => ({}));
        const provider = String(body?.provider || api.activeProvider).toLowerCase();
        if (!['openai', 'gemini'].includes(provider)) {
          return sendJson(res, 400, { ok: false, requestId, message: 'Provider harus openai atau gemini.' });
        }
        const result = await api.testProvider(provider);
        return sendJson(res, 200, { requestId, ...result });
      }

      if (req.method === 'GET' && url.pathname === '/api/admin/logs') {
        const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') || 50)));
        return sendJson(res, 200, { ok: true, logs: api.logs.slice(-limit).reverse() });
      }

      if (req.method === 'GET' && url.pathname === '/api/admin/stats') {
        return sendJson(res, 200, { ok: true, stats: { ...api.stats } });
      }
    }

    return sendJson(res, 404, { ok: false, requestId, message: 'Endpoint tidak ditemukan.' });
  } catch (err) {
    const status = Number.isInteger(err?.status) ? err.status : 500;
    console.error(JSON.stringify({
      requestId,
      method: req.method,
      path: url.pathname,
      status,
      message: err?.message
    }));
    return sendJson(res, status >= 400 && status <= 599 ? status : 500, {
      ok: false,
      requestId,
      message: status === 500 ? 'Terjadi kesalahan internal.' : err.message
    });
  }
});

server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;
server.requestTimeout = 70000;

server.listen(port, host, () => {
  console.log(`Spandukin aktif di ${host}:${port} | provider=${api.activeProvider} | model=${api.activeModel}`);
});
