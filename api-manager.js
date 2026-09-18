import crypto from 'node:crypto';

const HEX = /^#[0-9A-F]{6}$/i;
const clampInt = (value, min, max, fallback) => {
  const n = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
const clean = (value, max, fallback = '') => {
  const v = String(value ?? '').replace(/\s+/g, ' ').trim();
  return (v || fallback).slice(0, max);
};
const color = (value, fallback) => HEX.test(String(value ?? '').trim()) ? String(value).trim().toUpperCase() : fallback;

export class ApiManager {
  constructor(env = process.env) {
    this.env = env;
    this.runtime = {
      provider: String(env.AI_PROVIDER || 'openai').trim().toLowerCase(),
      openaiModel: String(env.OPENAI_MODEL || 'gpt-5.6-luna').trim(),
      geminiModel: String(env.GEMINI_MODEL || 'gemini-3.1-flash-lite').trim(),
      timeoutMs: clampInt(env.OPENAI_TIMEOUT_MS || env.AI_TIMEOUT_MS, 1000, 120000, 45000),
      rateLimitMax: clampInt(env.AI_RATE_LIMIT_MAX, 1, 10000, 30),
      rateLimitWindowMs: clampInt(env.AI_RATE_LIMIT_WINDOW_MS, 60000, 604800000, 86400000),
      maxPromptLength: clampInt(env.AI_MAX_PROMPT_LENGTH, 100, 20000, 2000)
    };
    this.controlToken = String(env.API_ADMIN_TOKEN || '').trim();
    this.buckets = new Map();
    this.logs = [];
    this.stats = {
      startedAt: new Date().toISOString(),
      requests: 0,
      success: 0,
      failed: 0,
      byProvider: { openai: 0, gemini: 0 },
      lastRequestAt: null,
      lastErrorAt: null
    };
  }

  get activeProvider() {
    return ['openai', 'gemini'].includes(this.runtime.provider) ? this.runtime.provider : 'openai';
  }

  get activeModel() {
    return this.activeProvider === 'gemini' ? this.runtime.geminiModel : this.runtime.openaiModel;
  }

  get activeKey() {
    return this.activeProvider === 'gemini'
      ? String(this.env.GEMINI_API_KEY || '').trim()
      : String(this.env.OPENAI_API_KEY || '').trim();
  }

  providerReady(provider) {
    if (provider === 'openai') return Boolean(String(this.env.OPENAI_API_KEY || '').trim());
    if (provider === 'gemini') return Boolean(String(this.env.GEMINI_API_KEY || '').trim());
    return false;
  }

  publicSettings() {
    return {
      provider: this.activeProvider,
      model: this.activeModel,
      timeoutMs: this.runtime.timeoutMs,
      rateLimitMax: this.runtime.rateLimitMax,
      rateLimitWindowMs: this.runtime.rateLimitWindowMs,
      maxPromptLength: this.runtime.maxPromptLength,
      providers: {
        openai: {
          configured: this.providerReady('openai'),
          model: this.runtime.openaiModel
        },
        gemini: {
          configured: this.providerReady('gemini'),
          model: this.runtime.geminiModel
        }
      },
      adminEnabled: Boolean(this.controlToken)
    };
  }

  isAdmin(req) {
    if (!this.controlToken) return false;
    const auth = String(req.headers.authorization || '');
    const bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    const header = String(req.headers['x-api-admin-token'] || '').trim();
    const supplied = bearer || header;
    if (!supplied) return false;
    const a = Buffer.from(supplied);
    const b = Buffer.from(this.controlToken);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  requireAdmin(req) {
    if (!this.controlToken) {
      const e = new Error('Modul admin API belum diaktifkan. Set API_ADMIN_TOKEN di Railway.');
      e.status = 503;
      throw e;
    }
    if (!this.isAdmin(req)) {
      const e = new Error('Akses admin API ditolak.');
      e.status = 401;
      throw e;
    }
  }

  updateRuntimeSettings(patch = {}) {
    if (patch.provider !== undefined) {
      const p = String(patch.provider).trim().toLowerCase();
      if (!['openai', 'gemini'].includes(p)) {
        const e = new Error('Provider harus openai atau gemini.');
        e.status = 400;
        throw e;
      }
      this.runtime.provider = p;
    }
    if (patch.openaiModel !== undefined) this.runtime.openaiModel = clean(patch.openaiModel, 120, this.runtime.openaiModel);
    if (patch.geminiModel !== undefined) this.runtime.geminiModel = clean(patch.geminiModel, 120, this.runtime.geminiModel);
    if (patch.timeoutMs !== undefined) this.runtime.timeoutMs = clampInt(patch.timeoutMs, 1000, 120000, this.runtime.timeoutMs);
    if (patch.rateLimitMax !== undefined) this.runtime.rateLimitMax = clampInt(patch.rateLimitMax, 1, 10000, this.runtime.rateLimitMax);
    if (patch.rateLimitWindowMs !== undefined) this.runtime.rateLimitWindowMs = clampInt(patch.rateLimitWindowMs, 60000, 604800000, this.runtime.rateLimitWindowMs);
    if (patch.maxPromptLength !== undefined) this.runtime.maxPromptLength = clampInt(patch.maxPromptLength, 100, 20000, this.runtime.maxPromptLength);
    return this.publicSettings();
  }

  takeRate(key) {
    const now = Date.now();
    let bucket = this.buckets.get(key);
    if (!bucket || now >= bucket.resetAt) {
      bucket = { count: 0, resetAt: now + this.runtime.rateLimitWindowMs };
    }
    bucket.count++;
    this.buckets.set(key, bucket);
    return {
      allowed: bucket.count <= this.runtime.rateLimitMax,
      remaining: Math.max(0, this.runtime.rateLimitMax - bucket.count),
      resetAt: bucket.resetAt
    };
  }

  log(entry) {
    const row = {
      at: new Date().toISOString(),
      ...entry
    };
    this.logs.push(row);
    if (this.logs.length > 250) this.logs.splice(0, this.logs.length - 250);
  }

  getAdminSnapshot() {
    return {
      settings: this.publicSettings(),
      stats: { ...this.stats },
      recentLogs: this.logs.slice(-50).reverse()
    };
  }

  normalizeConcept(raw) {
    return {
      headline: clean(raw?.headline, 80, 'WARUNG'),
      slogan: clean(raw?.slogan, 120, 'Murah • Lengkap • Dekat'),
      products: clean(raw?.products, 180, 'Sembako • Minuman • Kebutuhan Harian'),
      note: clean(raw?.note, 220, 'Gunakan teks besar dan kontras agar mudah dibaca dari jauh.'),
      background: color(raw?.background, '#FFCC00'),
      accent: color(raw?.accent, '#E94235'),
      textColor: color(raw?.textColor, '#101820')
    };
  }

  schema() {
    return {
      type: 'object',
      properties: {
        headline: { type: 'string', description: 'Nama usaha atau kategori utama yang paling menonjol' },
        slogan: { type: 'string', description: 'Pesan utama singkat tanpa mengarang promo' },
        products: { type: 'string', description: 'Produk atau jasa utama, dipisahkan karakter •' },
        note: { type: 'string', description: 'Satu saran layout praktis untuk desainer' },
        background: { type: 'string', description: 'Warna latar hex #RRGGBB' },
        accent: { type: 'string', description: 'Warna aksen hex #RRGGBB' },
        textColor: { type: 'string', description: 'Warna teks hex #RRGGBB' }
      },
      required: ['headline', 'slogan', 'products', 'note', 'background', 'accent', 'textColor'],
      additionalProperties: false
    };
  }

  instructions() {
    return [
      'Anda adalah art director khusus spanduk warung dan UMKM Indonesia.',
      'Keluaran harus ringkas, mudah dibaca dari jarak jauh, kontras, dan realistis untuk dicetak.',
      'Gunakan Bahasa Indonesia kecuali brief jelas meminta bahasa lain.',
      'Jangan mengarang harga, alamat, nomor telepon, diskon, sertifikasi, atau klaim yang tidak ada di brief.',
      'Gunakan kode warna hex #RRGGBB untuk background, accent, dan textColor.',
      'Hasil harus mengikuti schema JSON yang diminta.'
    ].join('\n');
  }

  openAIOutputText(data) {
    if (typeof data?.output_text === 'string' && data.output_text.trim()) return data.output_text.trim();
    for (const item of Array.isArray(data?.output) ? data.output : []) {
      for (const part of Array.isArray(item?.content) ? item.content : []) {
        if (part?.type === 'output_text' && typeof part.text === 'string' && part.text.trim()) return part.text.trim();
      }
    }
    return '';
  }

  geminiOutputText(data) {
    if (typeof data?.output_text === 'string' && data.output_text.trim()) return data.output_text.trim();
    for (const step of Array.isArray(data?.steps) ? data.steps.slice().reverse() : []) {
      if (step?.type !== 'model_output') continue;
      for (const part of step?.content || []) {
        if (part?.type === 'text' && typeof part.text === 'string' && part.text.trim()) return part.text.trim();
      }
    }
    for (const item of Array.isArray(data?.outputs) ? data.outputs.slice().reverse() : []) {
      if (item?.type === 'text' && typeof item.text === 'string' && item.text.trim()) return item.text.trim();
    }
    return '';
  }

  async requestOpenAI(prompt) {
    const apiKey = String(this.env.OPENAI_API_KEY || '').trim();
    if (!apiKey) {
      const e = new Error('OPENAI_API_KEY belum dikonfigurasi.');
      e.status = 503;
      throw e;
    }
    const response = await this.fetchWithTimeout('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: this.runtime.openaiModel,
        instructions: this.instructions(),
        input: prompt,
        store: false,
        text: {
          format: {
            type: 'json_schema',
            name: 'spandukin_concept',
            strict: true,
            schema: this.schema()
          }
        }
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const e = new Error(data?.error?.message || `OpenAI error ${response.status}`);
      e.status = response.status >= 500 ? 502 : response.status;
      throw e;
    }
    const text = this.openAIOutputText(data);
    if (!text) {
      const e = new Error('OpenAI tidak mengembalikan konsep.');
      e.status = 502;
      throw e;
    }
    let parsed;
    try { parsed = JSON.parse(text); }
    catch {
      const e = new Error('Format JSON OpenAI tidak valid.');
      e.status = 502;
      throw e;
    }
    return {
      provider: 'openai',
      model: data.model || this.runtime.openaiModel,
      concept: this.normalizeConcept(parsed),
      usage: data.usage || null
    };
  }

  async requestGemini(prompt) {
    const apiKey = String(this.env.GEMINI_API_KEY || '').trim();
    if (!apiKey) {
      const e = new Error('GEMINI_API_KEY belum dikonfigurasi.');
      e.status = 503;
      throw e;
    }
    const response = await this.fetchWithTimeout('https://generativelanguage.googleapis.com/v1beta/interactions', {
      method: 'POST',
      headers: {
        'x-goog-api-key': apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: this.runtime.geminiModel,
        input: `${this.instructions()}\n\nBrief pengguna:\n${prompt}`,
        response_format: {
          type: 'text',
          mime_type: 'application/json',
          schema: this.schema()
        }
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const e = new Error(data?.error?.message || `Gemini error ${response.status}`);
      e.status = response.status >= 500 ? 502 : response.status;
      throw e;
    }
    const text = this.geminiOutputText(data);
    if (!text) {
      const e = new Error('Gemini tidak mengembalikan konsep.');
      e.status = 502;
      throw e;
    }
    let parsed;
    try { parsed = JSON.parse(text); }
    catch {
      const e = new Error('Format JSON Gemini tidak valid.');
      e.status = 502;
      throw e;
    }
    return {
      provider: 'gemini',
      model: data.model || this.runtime.geminiModel,
      concept: this.normalizeConcept(parsed),
      usage: data.usage || data.usageMetadata || null
    };
  }

  async fetchWithTimeout(url, init) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.runtime.timeoutMs);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } catch (err) {
      const e = new Error(err?.name === 'AbortError' ? 'Permintaan AI timeout.' : 'Backend gagal menghubungi provider AI.');
      e.status = err?.name === 'AbortError' ? 504 : 502;
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  async generate(prompt, meta = {}) {
    const normalized = String(prompt ?? '').trim();
    if (normalized.length < 3 || normalized.length > this.runtime.maxPromptLength) {
      const e = new Error(`Brief harus 3–${this.runtime.maxPromptLength.toLocaleString('id-ID')} karakter.`);
      e.status = 400;
      throw e;
    }

    const provider = this.activeProvider;
    const started = Date.now();
    this.stats.requests++;
    this.stats.byProvider[provider] = (this.stats.byProvider[provider] || 0) + 1;
    this.stats.lastRequestAt = new Date().toISOString();

    try {
      const result = provider === 'gemini'
        ? await this.requestGemini(normalized)
        : await this.requestOpenAI(normalized);
      this.stats.success++;
      this.log({
        requestId: meta.requestId,
        provider,
        model: result.model,
        ok: true,
        durationMs: Date.now() - started
      });
      return result;
    } catch (err) {
      this.stats.failed++;
      this.stats.lastErrorAt = new Date().toISOString();
      this.log({
        requestId: meta.requestId,
        provider,
        model: this.activeModel,
        ok: false,
        status: err?.status || 500,
        message: String(err?.message || 'Unknown error').slice(0, 300),
        durationMs: Date.now() - started
      });
      throw err;
    }
  }

  async testProvider(provider = this.activeProvider) {
    const original = this.runtime.provider;
    this.runtime.provider = provider;
    try {
      const result = await this.generate('Tes koneksi. Buat konsep singkat untuk WARUNG TEST dengan produk Kopi dan Roti.', {
        requestId: `test-${crypto.randomUUID()}`
      });
      return {
        ok: true,
        provider: result.provider,
        model: result.model,
        sample: result.concept
      };
    } finally {
      this.runtime.provider = original;
    }
  }
}
