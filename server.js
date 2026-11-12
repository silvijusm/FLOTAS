// Flotas – automobilių sekimo sistema (įmonė + vairuotojai)
const express = require('express');
const crypto = require('crypto');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const PORT = process.env.PORT || 3000;
const DB_FILE = process.env.DB_FILE || path.join(__dirname, 'flotas.db');
const db = new DatabaseSync(DB_FILE);

db.exec(`
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS companies (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL,
  pass_hash TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY, company_id INTEGER NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS vehicles (
  id INTEGER PRIMARY KEY, company_id INTEGER NOT NULL, plate TEXT NOT NULL,
  label TEXT, driver_name TEXT,
  invite_code TEXT UNIQUE, device_token TEXT UNIQUE,
  last_lat REAL, last_lng REAL, last_speed REAL, last_heading REAL,
  last_ts INTEGER, state TEXT DEFAULT 'nezinoma', state_since INTEGER
);
CREATE TABLE IF NOT EXISTS points (
  id INTEGER PRIMARY KEY, vehicle_id INTEGER NOT NULL,
  lat REAL NOT NULL, lng REAL NOT NULL, speed REAL, ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_points_v_ts ON points(vehicle_id, ts);
`);

const now = () => Date.now();
const app = express();
app.use((req, res, next) => { // leidžiam mobiliajai programėlei (capacitor://localhost, https://localhost)
  res.set({ 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS' });
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.set('trust proxy', 1);
app.use(express.json({ limit: '50kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ---------- pagalbinės ----------
function hashPass(pw, salt = crypto.randomBytes(16).toString('hex')) {
  const h = crypto.scryptSync(pw, salt, 64).toString('hex');
  return `${salt}:${h}`;
}
function checkPass(pw, stored) {
  const [salt, h] = stored.split(':');
  const h2 = crypto.scryptSync(pw, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(h, 'hex'), Buffer.from(h2, 'hex'));
}
const newToken = () => crypto.randomBytes(24).toString('hex');
function newCode() {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (;;) {
    let c = '';
    for (let i = 0; i < 6; i++) c += abc[crypto.randomInt(abc.length)];
    if (!db.prepare('SELECT 1 FROM vehicles WHERE invite_code=?').get(c)) return c;
  }
}

// paprastas apsaugos nuo spamo limitas (IP + kelias)
const hits = new Map();
function limit(max, windowMs) {
  return (req, res, next) => {
    const k = req.ip + req.path;
    const t = now();
    const arr = (hits.get(k) || []).filter(x => t - x < windowMs);
    if (arr.length >= max) return res.status(429).json({ error: 'Per daug bandymų, palaukite.' });
    arr.push(t); hits.set(k, arr); next();
  };
}

function auth(req, res, next) {
  const t = (req.headers.authorization || '').replace('Bearer ', '');
  const s = t && db.prepare('SELECT company_id FROM sessions WHERE token=?').get(t);
  if (!s) return res.status(401).json({ error: 'Neprisijungta' });
  req.companyId = s.company_id; next();
}

const MOVING_KMH = 5;        // virš šio greičio – važiuoja
const OFFLINE_MS = 5 * 60e3; // 5 min be signalo – nėra ryšio

function publicVehicle(v) {
  let state = v.state;
  if (!v.last_ts) state = 'nezinoma';
  else if (now() - v.last_ts > OFFLINE_MS) state = 'neprisijunges';
  return {
    id: v.id, plate: v.plate, label: v.label, driver_name: v.driver_name,
    invite_code: v.device_token ? null : v.invite_code, // kodas rodomas tik kol nepanaudotas
    paired: !!v.device_token,
    lat: v.last_lat, lng: v.last_lng, speed: v.last_speed, heading: v.last_heading,
    last_ts: v.last_ts, state, state_since: v.state_since
  };
}

// ---------- ĮMONĖ ----------
app.post('/api/company/register', limit(10, 3600e3), (req, res) => {
  const { name, email, password } = req.body || {};
  if (!name || !email || !password || password.length < 6)
    return res.status(400).json({ error: 'Įveskite pavadinimą, el. paštą ir slaptažodį (min. 6 simboliai).' });
  const e = String(email).trim().toLowerCase();
  if (db.prepare('SELECT 1 FROM companies WHERE email=?').get(e))
    return res.status(409).json({ error: 'Toks el. paštas jau užregistruotas.' });
  const r = db.prepare('INSERT INTO companies(name,email,pass_hash,created_at) VALUES(?,?,?,?)')
    .run(String(name).trim(), e, hashPass(password), now());
  const token = newToken();
  db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(token, r.lastInsertRowid, now());
  res.json({ token });
});

app.post('/api/company/login', limit(20, 600e3), (req, res) => {
  const { email, password } = req.body || {};
  const c = db.prepare('SELECT * FROM companies WHERE email=?').get(String(email || '').trim().toLowerCase());
  if (!c || !checkPass(String(password || ''), c.pass_hash))
    return res.status(401).json({ error: 'Neteisingas el. paštas arba slaptažodis.' });
  const token = newToken();
  db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(token, c.id, now());
  res.json({ token });
});

app.get('/api/company/me', auth, (req, res) => {
  const c = db.prepare('SELECT id,name,email FROM companies WHERE id=?').get(req.companyId);
  res.json(c);
});

app.get('/api/vehicles', auth, (req, res) => {
  const rows = db.prepare('SELECT * FROM vehicles WHERE company_id=? ORDER BY plate').all(req.companyId);
  res.json(rows.map(publicVehicle));
});

app.post('/api/vehicles', auth, (req, res) => {
  const { plate, label, driver_name } = req.body || {};
  if (!plate) return res.status(400).json({ error: 'Įveskite valstybinį numerį.' });
  const r = db.prepare('INSERT INTO vehicles(company_id,plate,label,driver_name,invite_code) VALUES(?,?,?,?,?)')
    .run(req.companyId, String(plate).trim().toUpperCase(), label || null, driver_name || null, newCode());
  res.json(publicVehicle(db.prepare('SELECT * FROM vehicles WHERE id=?').get(r.lastInsertRowid)));
});

app.put('/api/vehicles/:id', auth, (req, res) => {
  const v = db.prepare('SELECT * FROM vehicles WHERE id=? AND company_id=?').get(req.params.id, req.companyId);
  if (!v) return res.status(404).json({ error: 'Nerasta' });
  const { plate, label, driver_name } = req.body || {};
  db.prepare('UPDATE vehicles SET plate=?, label=?, driver_name=? WHERE id=?')
    .run(plate ? String(plate).trim().toUpperCase() : v.plate, label ?? v.label, driver_name ?? v.driver_name, v.id);
  res.json(publicVehicle(db.prepare('SELECT * FROM vehicles WHERE id=?').get(v.id)));
});

// naujas kodas (arba atjungti seną telefoną)
app.post('/api/vehicles/:id/new-code', auth, (req, res) => {
  const v = db.prepare('SELECT * FROM vehicles WHERE id=? AND company_id=?').get(req.params.id, req.companyId);
  if (!v) return res.status(404).json({ error: 'Nerasta' });
  db.prepare('UPDATE vehicles SET invite_code=?, device_token=NULL WHERE id=?').run(newCode(), v.id);
  res.json(publicVehicle(db.prepare('SELECT * FROM vehicles WHERE id=?').get(v.id)));
});

app.delete('/api/vehicles/:id', auth, (req, res) => {
  const v = db.prepare('SELECT id FROM vehicles WHERE id=? AND company_id=?').get(req.params.id, req.companyId);
  if (!v) return res.status(404).json({ error: 'Nerasta' });
  db.prepare('DELETE FROM points WHERE vehicle_id=?').run(v.id);
  db.prepare('DELETE FROM vehicles WHERE id=?').run(v.id);
  res.json({ ok: true });
});

// maršruto istorija (pagal nutylėjimą 24 val.)
app.get('/api/vehicles/:id/track', auth, (req, res) => {
  const v = db.prepare('SELECT id FROM vehicles WHERE id=? AND company_id=?').get(req.params.id, req.companyId);
  if (!v) return res.status(404).json({ error: 'Nerasta' });
  const hours = Math.min(parseInt(req.query.hours) || 24, 168);
  const pts = db.prepare('SELECT lat,lng,speed,ts FROM points WHERE vehicle_id=? AND ts>? ORDER BY ts')
    .all(v.id, now() - hours * 3600e3);
  res.json(pts);
});

// ---------- VAIRUOTOJAS ----------
app.post('/api/driver/pair', limit(15, 600e3), (req, res) => {
  const code = String((req.body || {}).code || '').trim().toUpperCase();
  const v = db.prepare('SELECT * FROM vehicles WHERE invite_code=? AND device_token IS NULL').get(code);
  if (!v) return res.status(404).json({ error: 'Kodas neteisingas arba jau panaudotas.' });
  const token = newToken();
  db.prepare('UPDATE vehicles SET device_token=? WHERE id=?').run(token, v.id);
  const c = db.prepare('SELECT name FROM companies WHERE id=?').get(v.company_id);
  res.json({ token, plate: v.plate, company: c.name, driver_name: v.driver_name });
});

function driverAuth(req, res, next) {
  const t = (req.headers.authorization || '').replace('Bearer ', '');
  const v = t && db.prepare('SELECT * FROM vehicles WHERE device_token=?').get(t);
  if (!v) return res.status(401).json({ error: 'Įrenginys atjungtas. Įveskite naują kodą.' });
  req.vehicle = v; next();
}

app.get('/api/driver/me', driverAuth, (req, res) => {
  const v = req.vehicle;
  const c = db.prepare('SELECT name FROM companies WHERE id=?').get(v.company_id);
  res.json({ plate: v.plate, company: c.name, driver_name: v.driver_name });
});

app.post('/api/driver/location', driverAuth, (req, res) => {
  const v = req.vehicle;
  const lat = Number(req.body.lat), lng = Number(req.body.lng);
  if (!isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180)
    return res.status(400).json({ error: 'Blogos koordinatės' });
  const ts = now();
  let speed = req.body.speed != null ? Number(req.body.speed) * 3.6 : null; // m/s -> km/h
  if (speed == null || !isFinite(speed)) {
    // jei telefonas nesiunčia greičio – skaičiuojam iš atstumo
    if (v.last_lat != null && v.last_ts && ts - v.last_ts > 0) {
      const d = haversine(v.last_lat, v.last_lng, lat, lng);
      speed = (d / ((ts - v.last_ts) / 1000)) * 3.6;
    } else speed = 0;
  }
  const state = speed >= MOVING_KMH ? 'vaziuoja' : 'stovi';
  const stateSince = state === v.state && v.state_since ? v.state_since : ts;
  db.prepare(`UPDATE vehicles SET last_lat=?,last_lng=?,last_speed=?,last_heading=?,last_ts=?,state=?,state_since=? WHERE id=?`)
    .run(lat, lng, speed, req.body.heading ?? null, ts, state, stateSince, v.id);
  // istorijoje saugom ne dažniau nei kas 10 s, ir tik jei pasislinko ar praėjo 2 min
  const last = db.prepare('SELECT lat,lng,ts FROM points WHERE vehicle_id=? ORDER BY ts DESC LIMIT 1').get(v.id);
  if (!last || ts - last.ts > 120e3 || (ts - last.ts > 10e3 && haversine(last.lat, last.lng, lat, lng) > 15))
    db.prepare('INSERT INTO points(vehicle_id,lat,lng,speed,ts) VALUES(?,?,?,?,?)').run(v.id, lat, lng, speed, ts);
  res.json({ ok: true, state });
});

app.post('/api/driver/unpair', driverAuth, (req, res) => {
  db.prepare('UPDATE vehicles SET device_token=NULL, invite_code=? WHERE id=?').run(newCode(), req.vehicle.id);
  res.json({ ok: true });
});

function haversine(a, b, c, d) {
  const R = 6371000, r = x => x * Math.PI / 180;
  const dLat = r(c - a), dLng = r(d - b);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a)) * Math.cos(r(c)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// senų taškų valymas (>30 d.) ir sesijų (>90 d.)
setInterval(() => {
  db.prepare('DELETE FROM points WHERE ts<?').run(now() - 30 * 86400e3);
  db.prepare('DELETE FROM sessions WHERE created_at<?').run(now() - 90 * 86400e3);
}, 3600e3);

app.listen(PORT, () => console.log(`Flotas veikia: http://localhost:${PORT}`));
