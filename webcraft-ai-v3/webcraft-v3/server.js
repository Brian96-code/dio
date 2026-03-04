/**
 * WebCraft AI v3.0 — Try Before You Buy
 *
 * Flow:
 * 1. User langsung pakai TANPA daftar — chat + generate 1 website GRATIS
 * 2. Preview website bisa dilihat gratis
 * 3. Mau Download / Deploy / Edit ulang → harus bayar (unlock)
 * 4. Setelah unlock → bebas download, deploy, generate lagi
 */

const http   = require('http');
const https  = require('https');
const fs     = require('fs');
const path   = require('path');
const url    = require('url');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;

const CONFIG = {
  OWNER_API_KEY:  process.env.ANTHROPIC_API_KEY || '',
  ADMIN_KEY:      process.env.ADMIN_KEY || 'webcraft-admin-2025',
  // Model untuk trial (pakai Haiku supaya hemat)
  TRIAL_MODEL:    'claude-haiku-4-5-20251001',
  // Model untuk paid users (Sonnet — lebih bagus)
  PAID_MODEL:     'claude-sonnet-4-20250514',
  MAX_TOKENS:     8000,
  // Berapa kali generate gratis (trial)
  FREE_GENERATES: 1,
  PACKAGES: {
    starter: { price: 49000,  label: 'Starter',  desc: 'Download + Deploy 1 website' },
    pro:     { price: 99000,  label: 'Pro',       desc: 'Unlimited 30 hari' },
    agency:  { price: 299000, label: 'Agency',    desc: 'Unlimited + 5 klien' },
  }
};

// ── DATABASE ──────────────────────────────────────
const DB_FILE = path.join(__dirname, 'db.json');
function loadDB() {
  try { return JSON.parse(fs.readFileSync(DB_FILE,'utf8')); }
  catch { return { sessions: {} }; }
}
function saveDB(db) { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2)); }

function getSession(sid) {
  const db = loadDB();
  if (!db.sessions[sid]) {
    db.sessions[sid] = {
      sid,
      plan: 'trial',          // trial | starter | pro | agency
      generates: 0,           // total kali generate
      unlockedAt: null,
      expiresAt: null,
      generatedSites: [],     // simpan HTML yang di-generate
      createdAt: new Date().toISOString()
    };
    saveDB(db);
  }
  return { db, session: db.sessions[sid] };
}

function canGenerate(session) {
  if (session.plan !== 'trial') return true;
  return session.generates < CONFIG.FREE_GENERATES;
}

function canDownload(session) {
  return session.plan !== 'trial';
}

function recordGenerate(sid, html) {
  const { db, session } = getSession(sid);
  session.generates += 1;
  session.generatedSites.push({
    html,
    createdAt: new Date().toISOString()
  });
  // Simpan hanya 3 terakhir supaya file tidak terlalu besar
  if (session.generatedSites.length > 3) session.generatedSites.shift();
  saveDB(db);
}

function unlockSession(sid, plan) {
  const { db, session } = getSession(sid);
  session.plan = plan;
  session.unlockedAt = new Date().toISOString();
  if (plan === 'starter') {
    // Starter: tidak expire
    session.expiresAt = null;
  } else {
    // Pro/Agency: 30 hari
    const d = new Date();
    d.setDate(d.getDate() + 30);
    session.expiresAt = d.toISOString();
  }
  saveDB(db);
  return session;
}

// ── HELPERS ──────────────────────────────────────
function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Session-ID');
}
function json(res, status, data) {
  cors(res); res.writeHead(status,{'Content-Type':'application/json'});
  res.end(JSON.stringify(data));
}
function readBody(req) {
  return new Promise((res,rej) => {
    let b=''; req.on('data',c=>b+=c);
    req.on('end',()=>{ try{res(JSON.parse(b))}catch{rej(new Error('Invalid JSON'))} });
  });
}
function callAnthropic(apiKey, payload) {
  return new Promise((resolve,reject) => {
    const body = JSON.stringify(payload);
    const req  = https.request({
      hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST',
      headers: {
        'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body),
        'x-api-key': apiKey, 'anthropic-version': '2023-06-01',
      }
    }, r => {
      let d=''; r.on('data',c=>d+=c);
      r.on('end',()=>{ try{resolve({status:r.statusCode,body:JSON.parse(d)})}catch{reject(new Error('Bad Anthropic response'))} });
    });
    req.on('error',reject); req.write(body); req.end();
  });
}

const MIME = {'.html':'text/html;charset=utf-8','.js':'application/javascript','.css':'text/css','.json':'application/json','.ico':'image/x-icon'};

// ── ROUTES ───────────────────────────────────────

// POST /api/chat
async function handleChat(req, res) {
  try {
    const body = await readBody(req);
    const sid  = req.headers['x-session-id'] || crypto.randomUUID();
    const { session } = getSession(sid);

    // Cek apakah boleh generate (hanya saat website di-generate, bukan chat biasa)
    const isGenerating = (body.messages||[]).some(m =>
      typeof m.content === 'string' && /generate ulang|ya.*buatkan|lanjutkan/i.test(m.content)
    );

    // Untuk chat biasa (belum generate) → selalu boleh
    // Untuk generate → cek limit
    if (isGenerating && !canGenerate(session)) {
      return json(res, 402, {
        error: {
          type: 'trial_limit',
          message: 'Trial kamu sudah digunakan! Unlock untuk generate website lagi.',
          generates: session.generates,
          plan: session.plan
        }
      });
    }

    if (!CONFIG.OWNER_API_KEY) {
      return json(res, 500, { error: { message: 'Server belum dikonfigurasi. Hubungi admin.' } });
    }

    const model = session.plan === 'trial' ? CONFIG.TRIAL_MODEL : CONFIG.PAID_MODEL;
    const result = await callAnthropic(CONFIG.OWNER_API_KEY, {
      model, max_tokens: CONFIG.MAX_TOKENS,
      system: body.system || '', messages: body.messages || [],
    });

    if (result.body.error) return json(res, result.status, { error: result.body.error });

    // Kalau website berhasil di-generate → catat
    const text = (result.body.content||[]).map(c=>c.text||'').join('');
    const hasWebsite = text.includes('===WEBSITE_START===') && text.includes('===WEBSITE_END===');
    if (hasWebsite) {
      const htmlStart = text.indexOf('===WEBSITE_START===')+19;
      const htmlEnd   = text.indexOf('===WEBSITE_END===');
      const html = text.substring(htmlStart, htmlEnd).trim();
      recordGenerate(sid, html);
    }

    json(res, 200, {
      ...result.body,
      _meta: {
        sid,
        plan: session.plan,
        generates: session.generates,
        canDownload: canDownload(session),
        canGenerate: canGenerate({ ...session, generates: session.generates }),
        trialLimit: CONFIG.FREE_GENERATES,
      }
    });

  } catch(err) { json(res, 500, { error: { message: err.message } }); }
}

// GET /api/session
function handleGetSession(req, res) {
  const params = new url.URLSearchParams(url.parse(req.url).query);
  const sid = params.get('sid');
  if (!sid) return json(res, 400, { error: { message: 'sid required' } });
  const { session } = getSession(sid);
  json(res, 200, {
    sid: session.sid,
    plan: session.plan,
    generates: session.generates,
    canDownload: canDownload(session),
    canGenerate: canGenerate(session),
    trialLimit: CONFIG.FREE_GENERATES,
    unlockedAt: session.unlockedAt,
    expiresAt: session.expiresAt,
  });
}

// POST /api/unlock — admin konfirmasi setelah user bayar
async function handleUnlock(req, res) {
  try {
    const body = await readBody(req);
    const { sid, plan, adminKey } = body;
    if (adminKey !== CONFIG.ADMIN_KEY) return json(res, 403, { error: { message: 'Unauthorized' } });
    if (!sid || !plan) return json(res, 400, { error: { message: 'sid dan plan diperlukan' } });
    if (!CONFIG.PACKAGES[plan]) return json(res, 400, { error: { message: 'Plan tidak valid: starter | pro | agency' } });

    const session = unlockSession(sid, plan);
    console.log(`🔓 Unlocked: ${sid} → ${plan}`);
    json(res, 200, { success: true, sid, plan, unlockedAt: session.unlockedAt });
  } catch(err) { json(res, 500, { error: { message: err.message } }); }
}

// GET /health
function handleHealth(req, res) {
  json(res, 200, { status:'ok', version:'3.0.0', timestamp: new Date().toISOString() });
}

// ── MAIN ─────────────────────────────────────────
const MIME_MAP = {'.html':'text/html;charset=utf-8','.js':'application/javascript','.css':'text/css'};

http.createServer(async (req, res) => {
  const { pathname } = url.parse(req.url);
  if (req.method==='OPTIONS') { cors(res); res.writeHead(204); res.end(); return; }

  if (pathname==='/api/chat'    && req.method==='POST') return handleChat(req,res);
  if (pathname==='/api/session' && req.method==='GET')  return handleGetSession(req,res);
  if (pathname==='/api/unlock'  && req.method==='POST') return handleUnlock(req,res);
  if (pathname==='/health'      && req.method==='GET')  return handleHealth(req,res);

  let fp = path.join(__dirname,'public', pathname==='/'?'index.html':pathname);
  fs.readFile(fp,(err,data) => {
    if (err) {
      fs.readFile(path.join(__dirname,'public','index.html'),(e2,d2) => {
        if (e2) { res.writeHead(404); res.end('404'); return; }
        cors(res); res.writeHead(200,{'Content-Type':'text/html;charset=utf-8'}); res.end(d2);
      });
    } else {
      cors(res); res.writeHead(200,{'Content-Type':MIME_MAP[path.extname(fp)]||'text/plain'}); res.end(data);
    }
  });

}).listen(PORT, () => {
  console.log(`\n✦ WebCraft AI v3.0 (Try Before You Buy) — http://localhost:${PORT}`);
  console.log(`  Trial: ${CONFIG.FREE_GENERATES}x generate gratis, preview bebas`);
  console.log(`  Unlock: download + deploy (starter/pro/agency)\n`);
});
