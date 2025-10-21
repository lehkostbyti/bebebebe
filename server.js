const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { randomUUID } = require('crypto');
const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// ================= Storage =================
const DATA_DIR = path.join(__dirname, 'user_data');
const DATA_FILE = path.join(DATA_DIR, 'user_data.json');

function ensureStorage() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, '[]', 'utf-8');
  }
}

function safeReadArray(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf-8').trim();
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.error(`❌ Failed to read ${path.basename(filePath)}:`, e.message);
    return null;
  }
}

function readUsers() {
  ensureStorage();

  const records = safeReadArray(DATA_FILE);
  if (records === null) return [];
  return records.map(normalizeUserRecord).filter(Boolean);
}

async function writeUsers(users) {
  ensureStorage();
  const normalized = Array.isArray(users)
    ? users.map(normalizeUserRecord).filter(Boolean)
    : [];
  const payload = JSON.stringify(normalized, null, 2);

  async function writeJsonAtomic(filePath) {
    const tmp = `${filePath}.tmp`;
    await fsp.writeFile(tmp, payload, 'utf-8');
    await fsp.rename(tmp, filePath);
  }

  await writeJsonAtomic(DATA_FILE);
}

// ================= Helpers =================
app.use(cors());
app.use(express.json({ limit: '512kb' }));

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim() !== '';
}
function validReelLink(s) {
  return isNonEmptyString(s) && /^https:\/\/www\.instagram\.com\/reel\//.test(s);
}
function isFiniteNumber(n) {
  return Number.isFinite(n);
}
function isValidUtcOffset(s) {
  return isNonEmptyString(s) && /^UTC[+-]\d{2}:\d{2}$/.test(s);
}
function nowIso() { return new Date().toISOString(); }
function lastOnlineStr() { return new Date().toDateString(); }

function normalizeTelegramId(value) {
  if (value == null || value === '') return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric;
  if (typeof value === 'string' && value.trim() !== '') return value.trim();
  return null;
}

function normalizeReferrals(value) {
  if (!Array.isArray(value)) return undefined;
  const cleaned = value
    .map(v => {
      const num = Number(v);
      return Number.isFinite(num) ? num : null;
    })
    .filter(v => v != null);
  return Array.from(new Set(cleaned));
}

function coerceNumber(value, fallback = 0) {
  if (value == null) return fallback;
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function generateUserId() {
  return randomUUID();
}

function normalizeUserRecord(record) {
  if (!record || typeof record !== 'object') return null;
  const base = { ...record };

  base.telegram_id = normalizeTelegramId(base.telegram_id);
  if (base.telegram_id == null && base.user_id) {
    const derived = normalizeTelegramId(base.user_id);
    if (derived != null && typeof derived !== 'string') {
      base.telegram_id = derived;
    }
  }

  if (!isNonEmptyString(base.user_id)) {
    base.user_id = generateUserId();
  }

  base.username = isNonEmptyString(base.username) ? base.username : '';
  base.first_name = isNonEmptyString(base.first_name) ? base.first_name : '';
  base.photo_url = isNonEmptyString(base.photo_url) ? base.photo_url : '';
  base.region = isNonEmptyString(base.region) ? base.region : null;
  base.language = isNonEmptyString(base.language) ? base.language : null;
  base.utc_offset = isValidUtcOffset(base.utc_offset) ? base.utc_offset : null;

  const referrals = normalizeReferrals(base.referrals);
  base.referrals = referrals !== undefined ? referrals : [];

  if (base.referrer_id != null && isNonEmptyString(String(base.referrer_id))) {
    base.referrer_id = String(base.referrer_id);
  } else {
    base.referrer_id = null;
  }

  base.points_total = coerceNumber(base.points_total ?? base.points, 0);
  base.points_current = coerceNumber(base.points_current ?? base.points_total, 0);
  base.daily_points = coerceNumber(base.daily_points, 0);

  if (base.reels_link && !validReelLink(base.reels_link)) {
    base.reels_link = null;
  }
  base.reels_status = isNonEmptyString(base.reels_status) ? base.reels_status : 'pending';

  base.updated_at = base.updated_at || nowIso();
  base.moderated_at = base.moderated_at || null;
  base.last_online = base.last_online || lastOnlineStr();

  return base;
}

function mergeUser(existing, incoming = {}) {
  const base = normalizeUserRecord(existing || {}) || {};
  const out = { ...base };

  // identity
  const incomingTelegram = normalizeTelegramId(incoming.telegram_id);
  if (incomingTelegram != null) out.telegram_id = incomingTelegram;
  if (isNonEmptyString(incoming.user_id)) out.user_id = incoming.user_id.trim();
  if (!out.user_id) out.user_id = base.user_id || generateUserId();

  // profile
  if (isNonEmptyString(incoming.username)) out.username = incoming.username;
  if (isNonEmptyString(incoming.first_name)) out.first_name = incoming.first_name;
  if (isNonEmptyString(incoming.photo_url)) out.photo_url = incoming.photo_url;

  // selections
  if (isNonEmptyString(incoming.region)) out.region = incoming.region;
  if (isNonEmptyString(incoming.language)) out.language = incoming.language;
  if (isValidUtcOffset(incoming.utc_offset)) out.utc_offset = incoming.utc_offset;

  // referrals
  const referrals = normalizeReferrals(incoming.referrals);
  if (referrals !== undefined) out.referrals = referrals;
  if (incoming.referrer_id != null && isNonEmptyString(String(incoming.referrer_id))) {
    out.referrer_id = String(incoming.referrer_id);
  }

  // points (support both legacy and new fields)
  if (isFiniteNumber(incoming.points_total)) out.points_total = incoming.points_total;
  if (isFiniteNumber(incoming.points_current)) out.points_current = incoming.points_current;
  if (isFiniteNumber(incoming.daily_points)) out.daily_points = incoming.daily_points;
  // legacy mapping
  if (isFiniteNumber(incoming.points)) {
    out.points_total = incoming.points;
    if (out.points_current == null) out.points_current = incoming.points;
  }

  if (isNonEmptyString(incoming.last_reset)) out.last_reset = incoming.last_reset;

  // reels
  if (incoming.reels_link === null) {
    out.reels_link = null;
  } else if (validReelLink(incoming.reels_link)) {
    out.reels_link = incoming.reels_link;
  }
  if (isNonEmptyString(incoming.reels_status)) {
    const prev = out.reels_status;
    out.reels_status = incoming.reels_status; // pending/approved/rejected/active
    if (prev && prev !== out.reels_status) out.moderated_at = nowIso();
  }
  if (isNonEmptyString(incoming.moderated_at)) out.moderated_at = incoming.moderated_at;

  // timestamps
  out.updated_at = nowIso();
  out.last_online = lastOnlineStr();

  out.points_total = coerceNumber(out.points_total, 0);
  out.points_current = coerceNumber(out.points_current, out.points_total);
  out.daily_points = coerceNumber(out.daily_points, 0);
  if (!Array.isArray(out.referrals)) out.referrals = [];

  return out;
}

// ================= Routes =================
app.get('/', (_req,res)=> res.json({
  status: 'ok',
  service: 'miniapp-api',
  file: DATA_FILE
}));

// GET /api/users?user_id=..&telegram_id=..
app.get('/api/users', (req,res)=>{
  const users = readUsers();
  const { user_id, telegram_id } = req.query || {};
  let result = users;
  if (telegram_id) {
    result = users.filter(u => String(u.telegram_id) === String(telegram_id));
  } else if (user_id) {
    result = users.filter(u => String(u.user_id) === String(user_id));
  }
  if (user_id || telegram_id) return res.json(result[0] || null);
  res.json(users);
});

// POST /api/users (upsert, partial-safe)
app.post('/api/users', async (req,res)=>{
  const payload = req.body || {};
  if (payload == null) return res.status(400).json({ error: 'Empty payload' });
  if (payload.telegram_id == null && !isNonEmptyString(payload.user_id)) {
    return res.status(400).json({ error: 'user_id or telegram_id required' });
  }

  const users = readUsers();
  const idx = users.findIndex(u => {
    const sameTelegram = payload.telegram_id != null && u.telegram_id != null && String(u.telegram_id) === String(payload.telegram_id);
    if (sameTelegram) return true;
    if (isNonEmptyString(payload.user_id) && isNonEmptyString(u.user_id) && String(u.user_id) === String(payload.user_id)) {
      return true;
    }
    return false;
  });
  const merged = mergeUser(idx >= 0 ? users[idx] : null, payload);
  if (idx >= 0) users[idx] = merged; else users.push(merged);
  try {
    await writeUsers(users);
  } catch (e) {
    console.error('❌ Persist error on POST /api/users:', e.message);
    return res.status(500).json({ error: 'Failed to save user data' });
  }
  res.json(merged);
});

// PUT /api/users/:id/status  { reels_status }
app.put('/api/users/:id/status', async (req,res)=>{
  const id = req.params.id;
  const { reels_status } = req.body || {};
  if (!isNonEmptyString(reels_status)) return res.status(400).json({ error: 'reels_status required' });
  const users = readUsers();
  const idx = users.findIndex(u => String(u.user_id) === String(id) || String(u.telegram_id) === String(id));
  if (idx < 0) return res.status(404).json({ error: 'User not found' });
  const incoming = { reels_status };
  users[idx] = mergeUser(users[idx], incoming);
  try {
    await writeUsers(users);
  } catch (e) {
    console.error('❌ Persist error on PUT /api/users/:id/status:', e.message);
    return res.status(500).json({ error: 'Failed to save user data' });
  }
  res.json(users[idx]);
});

// Back-compat endpoints from old_version
app.post('/save_user_data', async (req,res)=>{
  const b = req.body || {};
  if (!b.telegram_id) return res.status(400).json({ error: 'Missing telegram_id' });
  const users = readUsers();
  const idx = users.findIndex(u => String(u.telegram_id) === String(b.telegram_id));
  const merged = mergeUser(idx >= 0 ? users[idx] : null, b);
  if (idx >= 0) users[idx] = merged; else users.push(merged);
  try {
    await writeUsers(users);
  } catch (e) {
    console.error('❌ Persist error on POST /save_user_data:', e.message);
    return res.status(500).json({ error: 'Failed to save user data' });
  }
  res.json({ success: true });
});
app.get('/get_user_data', (req,res)=>{
  const { telegram_id } = req.query || {};
  if (!telegram_id) return res.status(400).json({ error: 'telegram_id required' });
  const users = readUsers();
  const u = users.find(x => String(x.telegram_id) === String(telegram_id)) || null;
  res.json(u);
});
app.get('/debug/users', (_req,res)=>{
  res.type('application/json').send(JSON.stringify(readUsers(), null, 2));
});

// 404 for unknown /api
app.use((req,res,next)=>{
  if (req.path.startsWith('/api')) return res.status(404).json({ error: 'Not found' });
  next();
});

app.listen(PORT, ()=>{
  ensureStorage();
  console.log(`✅ API server on ${PORT} (data: ${DATA_FILE})`);
});
