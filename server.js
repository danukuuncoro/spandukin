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


function injectAiAssistantForm(buffer) {
  let html = buffer.toString('utf8');
  if (html.includes('id="aiGuidedForm"') || html.includes('spandukin-ai-guided-v1')) return Buffer.from(html);

  const style = `<style id="spandukin-ai-guided-v1">
.ai-mode-switch{display:flex;gap:8px;margin:12px 0}.ai-mode-btn{border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.06);color:inherit;padding:9px 13px;border-radius:10px;cursor:pointer;font-weight:700}.ai-mode-btn.active{background:#ffd21f;color:#151515;border-color:#ffd21f}.ai-step-flow{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin:10px 0 14px;font-size:12px;opacity:.82}.ai-step-flow span{padding:5px 8px;border-radius:999px;background:rgba(255,255,255,.07)}.ai-step-flow b{opacity:.55}.ai-guided-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.ai-guided-field{display:grid;gap:6px;font-size:13px;font-weight:700}.ai-guided-field.full{grid-column:1/-1}.ai-guided-field input,.ai-guided-field select,.ai-guided-field textarea{width:100%;box-sizing:border-box;border:1px solid rgba(255,255,255,.16);border-radius:10px;padding:10px 11px;background:rgba(0,0,0,.18);color:inherit;font:inherit}.ai-guided-field textarea{min-height:76px;resize:vertical}.ai-guided-help{margin:10px 0 4px;font-size:12px;opacity:.72}.ai-guided-error{margin:8px 0 0;padding:8px 10px;border-radius:9px;background:rgba(220,53,69,.13);color:#ffb7bf;font-size:12px}.ai-guided-custom[hidden]{display:none!important}@media(max-width:680px){.ai-guided-grid{grid-template-columns:1fr}.ai-guided-field.full{grid-column:auto}}
</style>`;

  const script = `<script>
(function(){
  function initGuidedAI(){
    var prompt=document.getElementById('aiPrompt');
    var btn=document.getElementById('aiBtn');
    if(!prompt||!btn||document.getElementById('aiGuidedForm')) return;
    var oldLabel=document.querySelector('label[for="aiPrompt"]');
    var box=document.createElement('div');
    box.id='aiGuidedForm';
    box.innerHTML=
      '<div class="ai-mode-switch">'+
        '<button type="button" class="ai-mode-btn active" data-ai-mode="form">Form Terpandu</button>'+
        '<button type="button" class="ai-mode-btn" data-ai-mode="free">Prompt Bebas</button>'+
      '</div>'+
      '<div class="ai-step-flow"><span>Nama Usaha</span><b>→</b><span>Ukuran</span><b>→</b><span>Menu</span><b>→</b><span>Warna</span><b>→</b><span>Gaya</span><b>→</b><span>Kontak</span><b>→</b><span>Generate</span></div>'+
      '<div class="ai-guided-grid">'+
        '<label class="ai-guided-field">1. Nama Usaha<input id="aiBizName" maxlength="80" placeholder="Contoh: Warkop Udin"></label>'+
        '<label class="ai-guided-field">2. Ukuran<select id="aiSize"><option value="3 x 1 meter">3 x 1 meter</option><option value="4 x 1 meter">4 x 1 meter</option><option value="5 x 1 meter">5 x 1 meter</option><option value="2 x 1 meter">2 x 1 meter</option><option value="custom">Ukuran lainnya</option></select><input id="aiSizeCustom" class="ai-guided-custom" hidden maxlength="40" placeholder="Contoh: 250 x 80 cm"></label>'+
        '<label class="ai-guided-field full">3. Menu / Produk<textarea id="aiMenu" maxlength="500" placeholder="Contoh: Kopi, Indomie, Wedang Jahe, Roti Bakar"></textarea></label>'+
        '<label class="ai-guided-field">4. Warna<select id="aiColor"><option value="Kuning dan hijau">Kuning + Hijau</option><option value="Merah dan kuning">Merah + Kuning</option><option value="Biru dan putih">Biru + Putih</option><option value="Hitam dan emas">Hitam + Emas</option><option value="Hijau dan putih">Hijau + Putih</option><option value="custom">Warna lainnya</option></select><input id="aiColorCustom" class="ai-guided-custom" hidden maxlength="60" placeholder="Contoh: Oranye + hitam"></label>'+
        '<label class="ai-guided-field">5. Gaya<select id="aiStyle"><option value="Modern, bersih, mudah dibaca dari jauh">Modern & Bersih</option><option value="Warung tradisional yang akrab dan merakyat">Warung Tradisional</option><option value="Cerah, ramai, dan kuat untuk promosi">Cerah & Ramai</option><option value="Minimalis dengan hierarki teks yang jelas">Minimalis</option><option value="Premium dan elegan">Premium Elegan</option><option value="Bebas, pilihkan gaya terbaik oleh AI">Bebas AI</option></select></label>'+
        '<label class="ai-guided-field full">6. Kontak<input id="aiContact" maxlength="120" placeholder="Contoh: WhatsApp 0813 1114 0044"></label>'+
      '</div>'+
      '<div class="ai-guided-help">Isi data di atas lalu klik <b>Generate</b>. Data akan otomatis dirangkai menjadi brief untuk Asisten AI.</div>'+
      '<div id="aiGuidedError" class="ai-guided-error" hidden></div>';
    prompt.parentNode.insertBefore(box,oldLabel||prompt);

    var mode='form';
    var size=document.getElementById('aiSize');
    var sizeCustom=document.getElementById('aiSizeCustom');
    var color=document.getElementById('aiColor');
    var colorCustom=document.getElementById('aiColorCustom');
    var error=document.getElementById('aiGuidedError');
    var freePlaceholder=prompt.getAttribute('placeholder')||'Ceritakan kebutuhan spanduk';

    function syncCustom(select,input){
      input.hidden=select.value!=='custom';
      if(input.hidden) input.value='';
    }
    size.addEventListener('change',function(){syncCustom(size,sizeCustom)});
    color.addEventListener('change',function(){syncCustom(color,colorCustom)});

    function setMode(next){
      mode=next;
      box.querySelectorAll('[data-ai-mode]').forEach(function(el){el.classList.toggle('active',el.getAttribute('data-ai-mode')===mode)});
      box.querySelector('.ai-step-flow').hidden=mode!=='form';
      box.querySelector('.ai-guided-grid').hidden=mode!=='form';
      box.querySelector('.ai-guided-help').hidden=mode!=='form';
      if(oldLabel) oldLabel.style.display=mode==='free'?'':'none';
      prompt.style.display=mode==='free'?'':'none';
      prompt.setAttribute('placeholder',freePlaceholder);
      btn.textContent=mode==='form'?'Generate':'Buat konsep';
      error.hidden=true;
    }

    box.querySelectorAll('[data-ai-mode]').forEach(function(el){
      el.addEventListener('click',function(){setMode(el.getAttribute('data-ai-mode'))});
    });

    function field(id){var el=document.getElementById(id);return el?String(el.value||'').trim():''}

    function buildPrompt(){
      var name=field('aiBizName');
      var menu=field('aiMenu');
      if(!name||!menu){
        error.textContent=!name?'Nama Usaha wajib diisi.':'Menu / Produk wajib diisi.';
        error.hidden=false;
        (!name?document.getElementById('aiBizName'):document.getElementById('aiMenu')).focus();
        return false;
      }
      error.hidden=true;
      var finalSize=size.value==='custom'?(field('aiSizeCustom')||'Belum ditentukan'):size.value;
      var finalColor=color.value==='custom'?(field('aiColorCustom')||'Pilihkan kombinasi warna terbaik'):color.value;
      var contact=field('aiContact')||'Tidak dicantumkan';
      prompt.value=[
        'Buat konsep spanduk siap desain berdasarkan data berikut:',
        'Nama Usaha: '+name,
        'Ukuran: '+finalSize,
        'Menu / Produk: '+menu,
        'Warna: '+finalColor,
        'Gaya: '+field('aiStyle'),
        'Kontak: '+contact,
        '',
        'Prioritaskan nama usaha sebagai headline utama, menu mudah terbaca dari jauh, warna kontras, dan tata letak sesuai ukuran spanduk.',
        'Pertahankan data kontak persis seperti yang diberikan. Jangan mengarang harga, promo, alamat, diskon, atau klaim yang tidak ada.'
      ].join('\n');
      prompt.dispatchEvent(new Event('input',{bubbles:true}));
      return true;
    }

    btn.addEventListener('click',function(ev){
      if(mode==='form'&&!buildPrompt()){
        ev.preventDefault();
        ev.stopImmediatePropagation();
      }
    },true);

    setMode('form');
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',initGuidedAI);
  else initGuidedAI();
})();
</script>`;

  html = html.replace('</head>', style + '</head>');
  html = html.replace('</body>', script + '</body>');
  return Buffer.from(html);
}

const indexHtml = injectAiAssistantForm(await loadIndex());

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
