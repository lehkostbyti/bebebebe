const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// ================= Storage (ported style from old_version) =================
const DATA_DIR = path.join(__dirname, 'user_data');
const DATA_FILE = path.join(DATA_DIR, 'users.json');

function ensureStorage() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, '[]', 'utf-8');
}

function readUsers() {
  try {
    ensureStorage();
    const raw = fs.readFileSync(DATA_FILE, 'utf-8').trim();
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.error('❌ readUsers error:', e.message);
    fs.writeFileSync(DATA_FILE, '[]', 'utf-8');
    return [];
  }
}

async function writeUsers(users) {
  try {
    ensureStorage();
    const tmp = DATA_FILE + '.tmp';
    await fsp.writeFile(tmp, JSON.stringify(users, null, 2), 'utf-8');
    await fsp.rename(tmp, DATA_FILE);
  } catch (e) {
    console.error('❌ writeUsers error:', e.message);
  }
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

function mergeUser(existing, incoming) {
  const out = { ...(existing || {}) };

  // identity
  if (incoming.telegram_id != null) out.telegram_id = incoming.telegram_id;
  if (isNonEmptyString(incoming.user_id)) out.user_id = incoming.user_id;
  if (!out.user_id && incoming.telegram_id != null) out.user_id = String(incoming.telegram_id);

  // profile
  if (isNonEmptyString(incoming.username)) out.username = incoming.username;
  if (isNonEmptyString(incoming.first_name)) out.first_name = incoming.first_name;
  if (isNonEmptyString(incoming.photo_url)) out.photo_url = incoming.photo_url;

  // selections
  if (isNonEmptyString(incoming.region)) out.region = incoming.region; // USA, Mexico, Canada, BRAZIL
  if (isNonEmptyString(incoming.language)) out.language = incoming.language; // en, es, fr, pt
  if (isValidUtcOffset(incoming.utc_offset)) out.utc_offset = incoming.utc_offset;

  // referrals
  if (Array.isArray(incoming.referrals)) out.referrals = incoming.referrals;
  if (incoming.referrer_id != null && isNonEmptyString(String(incoming.referrer_id))) out.referrer_id = String(incoming.referrer_id);

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
  if (validReelLink(incoming.reels_link)) out.reels_link = incoming.reels_link;
  if (isNonEmptyString(incoming.reels_status)) {
    const prev = out.reels_status;
    out.reels_status = incoming.reels_status; // pending/approved/rejected/active
    if (prev && prev !== out.reels_status) out.moderated_at = nowIso();
  }

  // timestamps
  out.updated_at = nowIso();
  out.last_online = lastOnlineStr();

  return out;
}

// ================= Routes =================
app.get('/', (_req,res)=> res.json({ status: 'ok', service: 'miniapp-api', file: DATA_FILE }));

// GET /api/users?user_id=..&telegram_id=..
app.get('/api/users', (req,res)=>{
  const users = readUsers();
  const { user_id, telegram_id } = req.query || {};
  let result = users;
  if (user_id) result = users.filter(u => String(u.user_id) === String(user_id));
  if (telegram_id) result = users.filter(u => String(u.telegram_id) === String(telegram_id));
  if (user_id || telegram_id) return res.json(result[0] || null);
  res.json(users);
});

// POST /api/users (upsert, partial-safe)
app.post('/api/users', async (req,res)=>{
  const payload = req.body || {};
  if (payload == null) return res.status(400).json({ error: 'Empty payload' });
  const key = payload.user_id || payload.telegram_id;
  if (!key) return res.status(400).json({ error: 'user_id or telegram_id required' });

  const users = readUsers();
  const idx = users.findIndex(u => String(u.user_id || u.telegram_id) === String(key));
  const merged = mergeUser(idx >= 0 ? users[idx] : null, payload);
  if (idx >= 0) users[idx] = merged; else users.push(merged);
  await writeUsers(users);
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
  await writeUsers(users);
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
  await writeUsers(users);
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
