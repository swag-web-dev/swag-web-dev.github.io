const express = require('express');
const session = require('express-session');
const Database = require('better-sqlite3');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { TOTP, Secret } = require('otpauth');

const app = express();
const PORT = process.env.PORT || 5500;

// ── DATABASE SETUP ──
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'encriptor.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    display_name TEXT DEFAULT 'Anonymous',
    salt TEXT NOT NULL,
    settings TEXT DEFAULT '{}',
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS texts (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    label TEXT DEFAULT 'Untitled',
    ciphertext TEXT NOT NULL,
    iv TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS images (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    label TEXT DEFAULT 'Untitled',
    mime_type TEXT DEFAULT 'image/png',
    iv TEXT NOT NULL,
    ciphertext BLOB NOT NULL,
    size INTEGER DEFAULT 0,
    created_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS stegano (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    label TEXT DEFAULT 'Untitled',
    has_message INTEGER DEFAULT 1,
    image_data BLOB NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS rate_limits (
    ip_hash TEXT PRIMARY KEY,
    attempts TEXT DEFAULT '[]',
    blocked_until INTEGER DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_texts_user ON texts(user_id);
  CREATE INDEX IF NOT EXISTS idx_images_user ON images(user_id);
  CREATE INDEX IF NOT EXISTS idx_stegano_user ON stegano(user_id);
`);

// Audit log table
db.exec(`
  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    action TEXT NOT NULL,
    detail TEXT DEFAULT '',
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id);
`);

// Add strength column if missing (migration)
try { db.exec('ALTER TABLE texts ADD COLUMN strength INTEGER DEFAULT 256'); } catch (e) {}
try { db.exec('ALTER TABLE images ADD COLUMN strength INTEGER DEFAULT 256'); } catch (e) {}
try { db.exec('ALTER TABLE stegano ADD COLUMN iv TEXT DEFAULT ""'); } catch (e) {}
try { db.exec('ALTER TABLE stegano ADD COLUMN strength INTEGER DEFAULT 256'); } catch (e) {}
try { db.exec('ALTER TABLE texts ADD COLUMN custom_key INTEGER DEFAULT 0'); } catch (e) {}
try { db.exec('ALTER TABLE images ADD COLUMN custom_key INTEGER DEFAULT 0'); } catch (e) {}
try { db.exec('ALTER TABLE stegano ADD COLUMN custom_key INTEGER DEFAULT 0'); } catch (e) {}
try { db.exec('ALTER TABLE texts ADD COLUMN enc_type TEXT DEFAULT "aes-256-gcm"'); } catch (e) {}
try { db.exec('ALTER TABLE images ADD COLUMN enc_type TEXT DEFAULT "aes-256-gcm"'); } catch (e) {}
try { db.exec('ALTER TABLE stegano ADD COLUMN enc_type TEXT DEFAULT "aes-256-gcm"'); } catch (e) {}
try { db.exec("ALTER TABLE users ADD COLUMN totp_secret TEXT DEFAULT ''"); } catch (e) {}
try { db.exec("ALTER TABLE users ADD COLUMN pin_failures INTEGER DEFAULT 0"); } catch (e) {}

// Chat tables
db.exec(`
  CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    user1_id TEXT NOT NULL,
    user2_id TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    sender_id TEXT NOT NULL,
    ciphertext_user1 TEXT NOT NULL,
    ciphertext_user2 TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
  );
`);
try { db.exec('CREATE INDEX IF NOT EXISTS idx_conv_user1 ON conversations(user1_id)'); } catch(e) {}
try { db.exec('CREATE INDEX IF NOT EXISTS idx_conv_user2 ON conversations(user2_id)'); } catch(e) {}
try { db.exec('CREATE INDEX IF NOT EXISTS idx_msg_conv ON messages(conversation_id, created_at)'); } catch(e) {}
try { db.exec("ALTER TABLE users ADD COLUMN unique_id TEXT DEFAULT ''"); } catch(e) {}
try { db.exec("ALTER TABLE users ADD COLUMN pin_failures INTEGER DEFAULT 0"); } catch(e) {}
try { db.exec("ALTER TABLE users ADD COLUMN chat_public_key TEXT DEFAULT ''"); } catch(e) {}
try { db.exec("ALTER TABLE users ADD COLUMN chat_private_key_enc TEXT DEFAULT ''"); } catch(e) {}
try { db.exec("ALTER TABLE users ADD COLUMN chat_private_key_iv TEXT DEFAULT ''"); } catch(e) {}
try { db.exec("ALTER TABLE conversations ADD COLUMN status TEXT DEFAULT 'pending'"); } catch(e) {}
try { db.exec("ALTER TABLE conversations ADD COLUMN initiated_by TEXT DEFAULT ''"); } catch(e) {}
db.exec(`
  CREATE TABLE IF NOT EXISTS blocked_users (
    blocker_id TEXT NOT NULL,
    blocked_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (blocker_id, blocked_id)
  );
`);

const VALID_ENC_TYPES = ['aes-128-gcm','aes-256-gcm','aes-128-cbc','aes-192-cbc','aes-256-cbc','chacha20','rsa','rsa-1024','rsa-2048','rsa-3072','rsa-4096','ecdh','sha-256','sha-384'];

// ── MIDDLEWARE ──
app.use(express.json({ limit: '15mb' }));
app.use((req, res, next) => {
  if (req.url.startsWith('/api/')) console.log(`${req.method} ${req.url}`);
  next();
});

// ── GLOBAL API RATE LIMITER (100 requests per minute per IP) ──
const apiRateLimits = new Map();
const API_RATE_LIMIT = 100;
const API_RATE_WINDOW = 60 * 1000; // 1 minute

// Clean up stale entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of apiRateLimits) {
    if (now - entry.windowStart > API_RATE_WINDOW) apiRateLimits.delete(key);
  }
}, 5 * 60 * 1000);

app.use('/api/', (req, res, next) => {
  const ip = req.ip || 'unknown';
  const now = Date.now();
  let entry = apiRateLimits.get(ip);

  if (!entry || now - entry.windowStart > API_RATE_WINDOW) {
    entry = { windowStart: now, count: 0 };
    apiRateLimits.set(ip, entry);
  }

  entry.count++;

  if (entry.count > API_RATE_LIMIT) {
    return res.status(429).json({ success: false, error: 'Too many requests. Please wait a moment.' });
  }

  next();
});

app.use('/assets', express.static(path.join(__dirname, 'assets')));
app.use(session({
  secret: (function() {
    const secretPath = path.join(dataDir, '.session-secret');
    if (fs.existsSync(secretPath)) return fs.readFileSync(secretPath, 'utf8').trim();
    const s = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(secretPath, s);
    return s;
  })(),
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: false, maxAge: 24 * 60 * 60 * 1000 },
}));

// ── HELPERS ──
function genId() {
  return crypto.randomBytes(8).toString('hex');
}

function sanitizeId(id) {
  return (id || '').replace(/[^a-f0-9]/g, '');
}

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ success: false, error: 'Unauthorized' });
  next();
}

function verifyCsrf(req, res, next) {
  // Skip CSRF check for GET/HEAD/OPTIONS (non-mutating methods)
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  // Skip CSRF check for auth endpoints (no token available yet)
  if (req.path.startsWith('/auth/') || req.path.startsWith('/api/auth/')) return next();
  const token = req.headers['x-csrf-token'];
  if (!token || token !== req.session.csrfToken) {
    return res.status(403).json({ success: false, error: 'Invalid CSRF token' });
  }
  next();
}

// Apply CSRF check to all non-GET API requests (auth routes are exempted inside verifyCsrf)
app.use('/api/', verifyCsrf);

function auditLog(userId, action, detail) {
  db.prepare('INSERT INTO audit_log (user_id, action, detail, created_at) VALUES (?, ?, ?, ?)').run(userId, action, detail || '', new Date().toISOString());
}

function ok(res, data = null) {
  res.json({ success: true, data });
}

function fail(res, msg, code = 400) {
  res.status(code).json({ success: false, error: msg });
}

// ── SEED PHRASE ──
const wordlist = JSON.parse(fs.readFileSync(path.join(__dirname, 'vendor', 'bip39-wordlist.json'), 'utf8'));

function generateSeedPhrase() {
  const entropy = crypto.randomBytes(32); // 256 bits
  const hash = crypto.createHash('sha256').update(entropy).digest();

  let bits = '';
  for (let i = 0; i < 32; i++) {
    bits += entropy[i].toString(2).padStart(8, '0');
  }
  // 8 checksum bits for 256-bit entropy
  bits += hash[0].toString(2).padStart(8, '0');

  const words = [];
  for (let i = 0; i < 24; i++) {
    const index = parseInt(bits.slice(i * 11, (i + 1) * 11), 2);
    words.push(wordlist[index]);
  }
  return words.join(' ');
}

function hashSeed(phrase) {
  const normalized = phrase.toLowerCase().trim().replace(/\s+/g, ' ');
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

// ══════════════════════════════════════
//  ROUTES
// ══════════════════════════════════════

// ── AUTH ──
app.post('/api/auth/register', (req, res) => {
  try {
  const phrase = generateSeedPhrase();
  const userId = hashSeed(phrase);

  const existing = db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
  if (existing) {
    return fail(res, 'Collision, try again');
  }

  const salt = crypto.randomBytes(16).toString('hex');
  const uniqueId = 'user_' + crypto.randomBytes(4).toString('hex');
  db.prepare('INSERT INTO users (id, display_name, salt, settings, unique_id, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(userId, 'Anonymous', salt, JSON.stringify({ auto_clear: false, confirm_delete: true }), uniqueId, new Date().toISOString());

  req.session.userId = userId;
  req.session.csrfToken = crypto.randomBytes(32).toString('hex');

  auditLog(userId, 'register', 'Account created');
  ok(res, { seed_phrase: phrase, csrf_token: req.session.csrfToken, salt });
  } catch (e) {
    console.error('Register error:', e);
    fail(res, e.message || 'Registration failed', 500);
  }
});

app.post('/api/auth/login', (req, res) => {
  const phrase = (req.body.seed_phrase || '').trim();
  if (!phrase) return fail(res, 'Seed phrase is required');

  // Rate limit
  const ip = crypto.createHash('sha256').update(req.ip || 'unknown').digest('hex');
  const now = Math.floor(Date.now() / 1000);

  let rate = db.prepare('SELECT * FROM rate_limits WHERE ip_hash = ?').get(ip);
  let attempts = rate ? JSON.parse(rate.attempts) : [];
  let blockedUntil = rate ? rate.blocked_until : 0;

  attempts = attempts.filter(t => (now - t) < 900);

  if (blockedUntil && now < blockedUntil) {
    return fail(res, 'Too many attempts. Try again later.', 429);
  }

  const userId = hashSeed(phrase);
  const user = db.prepare('SELECT id, salt, pin_hash, totp_secret, pin_failures FROM users WHERE id = ?').get(userId);

  if (!user) {
    attempts.push(now);
    const blocked = attempts.length >= 5 ? now + 900 : 0;
    db.prepare('INSERT OR REPLACE INTO rate_limits (ip_hash, attempts, blocked_until) VALUES (?, ?, ?)')
      .run(ip, JSON.stringify(attempts), blocked);
    return fail(res, 'Invalid seed phrase', 401);
  }

  // Check if account requires additional verification
  const needsPin = !!user.pin_hash;
  const needsTotp = !!user.totp_secret;
  const pin = (req.body.pin || '').trim();
  const totpToken = (req.body.totp_token || '').trim();

  // If verification is needed but not provided yet, tell the client what's required
  if ((needsPin || needsTotp) && !pin && !totpToken) {
    return ok(res, { requires_verification: true, needs_pin: needsPin, needs_totp: needsTotp });
  }

  // Verify PIN if required
  if (needsPin) {
    if (!pin) return fail(res, 'PIN is required', 401);
    const pinHash = crypto.createHash('sha256').update(pin).digest('hex');
    if (pinHash !== user.pin_hash) {
      const failures = (user.pin_failures || 0) + 1;
      db.prepare('UPDATE users SET pin_failures = ? WHERE id = ?').run(failures, userId);

      if (failures >= 3) {
        // Wipe all account data
        db.prepare('DELETE FROM texts WHERE user_id = ?').run(userId);
        db.prepare('DELETE FROM images WHERE user_id = ?').run(userId);
        db.prepare('DELETE FROM stegano WHERE user_id = ?').run(userId);
        auditLog(userId, 'pin_wipe', 'Data wiped after 3 failed PIN attempts');
        return fail(res, 'Too many failed PIN attempts. All vault data has been wiped.', 401);
      }

      const remaining = 3 - failures;
      return fail(res, 'Invalid PIN. ' + remaining + ' attempt' + (remaining !== 1 ? 's' : '') + ' remaining before data wipe.', 401);
    }
    // Reset failures on success
    if (user.pin_failures > 0) {
      db.prepare('UPDATE users SET pin_failures = 0 WHERE id = ?').run(userId);
    }
  }

  // Verify TOTP if required
  if (needsTotp) {
    if (!totpToken) return fail(res, 'Authenticator code is required', 401);
    const totp = new TOTP({ secret: Secret.fromBase32(user.totp_secret), digits: 6, period: 30 });
    const delta = totp.validate({ token: totpToken, window: 1 });
    if (delta === null) {
      return fail(res, 'Invalid authenticator code', 401);
    }
  }

  db.prepare('DELETE FROM rate_limits WHERE ip_hash = ?').run(ip);

  // Assign unique_id if missing (legacy accounts)
  const fullUser = db.prepare('SELECT unique_id FROM users WHERE id = ?').get(userId);
  if (!fullUser.unique_id) {
    const autoId = 'user_' + crypto.randomBytes(4).toString('hex');
    db.prepare('UPDATE users SET unique_id = ? WHERE id = ?').run(autoId, userId);
  }

  req.session.userId = userId;
  req.session.csrfToken = crypto.randomBytes(32).toString('hex');

  auditLog(userId, 'login', 'Login success');
  ok(res, { csrf_token: req.session.csrfToken, salt: user.salt, has_pin: !!user.pin_hash });
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => ok(res));
});

app.post('/api/auth/check', (req, res) => {
  if (req.session.userId) {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
    if (user) {
      if (!req.session.csrfToken) req.session.csrfToken = crypto.randomBytes(32).toString('hex');
      return ok(res, {
        authenticated: true,
        csrf_token: req.session.csrfToken,
        profile: {
          display_name: user.display_name,
          created_at: user.created_at,
          settings: JSON.parse(user.settings),
        },
        salt: user.salt,
      });
    }
  }
  ok(res, { authenticated: false });
});

// ── TEXTS ──
app.get('/api/text/list', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT id, label, strength, custom_key, enc_type, created_at FROM texts WHERE user_id = ? ORDER BY created_at DESC').all(req.session.userId);
  ok(res, rows);
});

app.get('/api/text/get', requireAuth, (req, res) => {
  const id = sanitizeId(req.query.id);
  if (!id) return fail(res, 'Missing ID');
  const row = db.prepare('SELECT * FROM texts WHERE id = ? AND user_id = ?').get(id, req.session.userId);
  if (!row) return fail(res, 'Not found', 404);
  ok(res, row);
});

app.post('/api/text/save', requireAuth, verifyCsrf, (req, res) => {
  const { label, ciphertext, iv, strength, custom_key, enc_type } = req.body;
  if (!ciphertext) return fail(res, 'Missing encrypted data');
  const bits = [128, 192, 256].includes(strength) ? strength : 256;
  const et = VALID_ENC_TYPES.includes(enc_type) ? enc_type : 'aes-256-gcm';

  const id = genId();
  db.prepare('INSERT INTO texts (id, user_id, label, ciphertext, iv, strength, custom_key, enc_type, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, req.session.userId, (label || 'Untitled').slice(0, 100), ciphertext, iv || '', bits, custom_key ? 1 : 0, et, new Date().toISOString());

  auditLog(req.session.userId, 'text_save', (label || 'Untitled').slice(0, 100));
  ok(res, { id });
});

app.post('/api/text/delete', requireAuth, verifyCsrf, (req, res) => {
  const id = sanitizeId(req.body.id);
  if (!id) return fail(res, 'Missing ID');
  db.prepare('DELETE FROM texts WHERE id = ? AND user_id = ?').run(id, req.session.userId);
  auditLog(req.session.userId, 'text_delete', id);
  ok(res);
});

app.post('/api/text/rename', requireAuth, verifyCsrf, (req, res) => {
  const { id, label } = req.body;
  if (!id || !label) return fail(res, 'Missing ID or label');
  db.prepare('UPDATE texts SET label = ? WHERE id = ? AND user_id = ?').run((label || '').slice(0, 100), sanitizeId(id), req.session.userId);
  ok(res);
});

// ── IMAGES ──
app.get('/api/image/list', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT id, label, size, strength, custom_key, enc_type, created_at FROM images WHERE user_id = ? ORDER BY created_at DESC').all(req.session.userId);
  ok(res, rows);
});

app.get('/api/image/get', requireAuth, (req, res) => {
  const id = sanitizeId(req.query.id);
  if (!id) return fail(res, 'Missing ID');
  const row = db.prepare('SELECT id, label, iv, mime_type, strength, custom_key, enc_type, ciphertext FROM images WHERE id = ? AND user_id = ?').get(id, req.session.userId);
  if (!row) return fail(res, 'Not found', 404);
  ok(res, {
    id: row.id,
    label: row.label,
    iv: row.iv,
    mime_type: row.mime_type,
    strength: row.strength || 256,
    custom_key: row.custom_key || 0,
    enc_type: row.enc_type || 'aes-256-gcm',
    ciphertext: Buffer.from(row.ciphertext).toString('base64'),
  });
});

app.post('/api/image/save', requireAuth, verifyCsrf, (req, res) => {
  const { label, ciphertext, iv, mime_type, strength, custom_key, enc_type } = req.body;
  if (!ciphertext) return fail(res, 'Missing encrypted data');
  if (ciphertext.length > 14 * 1024 * 1024) return fail(res, 'File too large (max 10MB)');
  const bits = [128, 192, 256].includes(strength) ? strength : 256;
  const et = VALID_ENC_TYPES.includes(enc_type) ? enc_type : 'aes-256-gcm';

  const id = genId();
  const buf = custom_key ? Buffer.from(ciphertext, 'utf8') : Buffer.from(ciphertext, 'base64');

  db.prepare('INSERT INTO images (id, user_id, label, mime_type, iv, ciphertext, size, strength, custom_key, enc_type, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, req.session.userId, (label || 'Untitled').slice(0, 100), mime_type || 'image/png', iv || '', buf, buf.length, bits, custom_key ? 1 : 0, et, new Date().toISOString());

  auditLog(req.session.userId, 'image_save', (label || 'Untitled').slice(0, 100));
  ok(res, { id });
});

app.post('/api/image/delete', requireAuth, verifyCsrf, (req, res) => {
  const id = sanitizeId(req.body.id);
  if (!id) return fail(res, 'Missing ID');
  db.prepare('DELETE FROM images WHERE id = ? AND user_id = ?').run(id, req.session.userId);
  auditLog(req.session.userId, 'image_delete', id);
  ok(res);
});

app.post('/api/image/rename', requireAuth, verifyCsrf, (req, res) => {
  const { id, label } = req.body;
  if (!id || !label) return fail(res, 'Missing ID or label');
  db.prepare('UPDATE images SET label = ? WHERE id = ? AND user_id = ?').run((label || '').slice(0, 100), sanitizeId(id), req.session.userId);
  ok(res);
});

// ── STEGANO ──
app.get('/api/stegano/list', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT id, label, has_message, strength, custom_key, enc_type, created_at FROM stegano WHERE user_id = ? ORDER BY created_at DESC').all(req.session.userId);
  rows.forEach(r => r.has_message = !!r.has_message);
  ok(res, rows);
});

app.get('/api/stegano/get', requireAuth, (req, res) => {
  const id = sanitizeId(req.query.id);
  if (!id) return fail(res, 'Missing ID');
  const row = db.prepare('SELECT id, label, image_data, iv, strength, custom_key, enc_type FROM stegano WHERE id = ? AND user_id = ?').get(id, req.session.userId);
  if (!row) return fail(res, 'Not found', 404);
  ok(res, {
    id: row.id,
    label: row.label,
    image_data: Buffer.from(row.image_data).toString('base64'),
    iv: row.iv || '',
    strength: row.strength || 256,
    custom_key: row.custom_key || 0,
    enc_type: row.enc_type || 'aes-256-gcm',
  });
});

app.post('/api/stegano/save', requireAuth, verifyCsrf, (req, res) => {
  const { label, image_data, has_message, iv, strength, custom_key, enc_type } = req.body;
  if (!image_data) return fail(res, 'Missing image data');
  if (image_data.length > 14 * 1024 * 1024) return fail(res, 'File too large (max 10MB)');

  const id = genId();
  const buf = Buffer.from(image_data, 'base64');
  const bits = [128, 192, 256].includes(strength) ? strength : 256;

  const et = VALID_ENC_TYPES.includes(enc_type) ? enc_type : 'aes-256-gcm';
  db.prepare('INSERT INTO stegano (id, user_id, label, has_message, image_data, iv, strength, custom_key, enc_type, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, req.session.userId, (label || 'Untitled').slice(0, 100), has_message ? 1 : 0, buf, iv || '', bits, custom_key ? 1 : 0, et, new Date().toISOString());

  auditLog(req.session.userId, 'stegano_save', (label || 'Untitled').slice(0, 100));
  ok(res, { id });
});

app.post('/api/stegano/delete', requireAuth, verifyCsrf, (req, res) => {
  const id = sanitizeId(req.body.id);
  if (!id) return fail(res, 'Missing ID');
  db.prepare('DELETE FROM stegano WHERE id = ? AND user_id = ?').run(id, req.session.userId);
  auditLog(req.session.userId, 'stegano_delete', id);
  ok(res);
});

app.post('/api/stegano/rename', requireAuth, verifyCsrf, (req, res) => {
  const { id, label } = req.body;
  if (!id || !label) return fail(res, 'Missing ID or label');
  db.prepare('UPDATE stegano SET label = ? WHERE id = ? AND user_id = ?').run((label || '').slice(0, 100), sanitizeId(id), req.session.userId);
  ok(res);
});

// ── SETTINGS ──
app.get('/api/settings/get', requireAuth, (req, res) => {
  const uid = req.session.userId;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(uid);
  if (!user) return fail(res, 'Not found', 404);

  const textCount = db.prepare('SELECT COUNT(*) as c FROM texts WHERE user_id = ?').get(uid).c;
  const imageCount = db.prepare('SELECT COUNT(*) as c FROM images WHERE user_id = ?').get(uid).c;
  const stegCount = db.prepare('SELECT COUNT(*) as c FROM stegano WHERE user_id = ?').get(uid).c;

  ok(res, {
    user_id: uid,
    display_name: user.display_name,
    created_at: user.created_at,
    settings: JSON.parse(user.settings),
    user_hash: uid.slice(0, 12) + '...',
    unique_id: user.unique_id || '',
    has_pin: !!(user.pin_hash),
    has_totp: !!(user.totp_secret),
    stats: { texts: textCount, images: imageCount, stegano: stegCount },
  });
});

app.get('/api/settings/session', requireAuth, (req, res) => {
  const uid = req.session.userId;
  // Get last login time from audit log
  const lastLogin = db.prepare("SELECT created_at FROM audit_log WHERE user_id = ? AND action = 'login' ORDER BY created_at DESC LIMIT 1").get(uid);
  ok(res, {
    login_time: lastLogin ? lastLogin.created_at : null,
    ip: req.ip || req.socket?.remoteAddress || 'unknown',
    user_agent: req.headers['user-agent'] || 'unknown',
  });
});

app.get('/api/settings/audit', requireAuth, (req, res) => {
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
  const rows = db.prepare('SELECT action, detail, created_at FROM audit_log WHERE user_id = ? AND created_at > ? ORDER BY created_at DESC').all(req.session.userId, threeDaysAgo);
  ok(res, rows);
});

app.post('/api/settings/update', requireAuth, verifyCsrf, (req, res) => {
  const uid = req.session.userId;
  if (req.body.display_name !== undefined) {
    db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(req.body.display_name.slice(0, 50), uid);
  }
  if (req.body.settings) {
    const current = JSON.parse(db.prepare('SELECT settings FROM users WHERE id = ?').get(uid).settings);
    const merged = { ...current, ...req.body.settings };
    db.prepare('UPDATE users SET settings = ? WHERE id = ?').run(JSON.stringify(merged), uid);
  }
  ok(res);
});

app.post('/api/settings/change-uid', requireAuth, verifyCsrf, (req, res) => {
  const uid = req.session.userId;
  let newId = (req.body.unique_id || '').trim();

  // Validate: 3-30 chars, only letters, numbers, underscores, dots
  if (!newId || newId.length < 3 || newId.length > 30) return fail(res, 'Username must be 3-30 characters');
  if (!/^[a-zA-Z0-9_.]+$/.test(newId)) return fail(res, 'Only letters, numbers, underscores and dots allowed');

  // Check uniqueness (case-sensitive - "Hello" and "hello" are different)
  const existing = db.prepare('SELECT id FROM users WHERE unique_id = ? AND id != ?').get(newId, uid);
  if (existing) return fail(res, 'This username is already taken');

  db.prepare('UPDATE users SET unique_id = ? WHERE id = ?').run(newId, uid);
  auditLog(uid, 'change_uid', '@' + newId);
  ok(res);
});

app.post('/api/settings/set-pin', requireAuth, verifyCsrf, (req, res) => {
  const uid = req.session.userId;
  const pin = (req.body.pin || '').trim();
  console.log('SET PIN - length:', pin.length, 'chars:', pin.split('').map(c => c.charCodeAt(0)));
  if (!pin || pin.length < 4 || pin.length > 6) return fail(res, 'PIN must be 4-6 characters');
  const pinHash = crypto.createHash('sha256').update(pin).digest('hex');
  db.prepare('UPDATE users SET pin_hash = ? WHERE id = ?').run(pinHash, uid);
  auditLog(uid, 'pin_set', 'PIN enabled');
  ok(res);
});

app.post('/api/settings/remove-pin', requireAuth, verifyCsrf, (req, res) => {
  const uid = req.session.userId;
  const pin = (req.body.pin || '').trim();
  const user = db.prepare('SELECT pin_hash FROM users WHERE id = ?').get(uid);
  if (user && user.pin_hash) {
    const pinHash = crypto.createHash('sha256').update(pin).digest('hex');
    console.log('REMOVE PIN - input hash:', pinHash.slice(0,16), 'stored:', user.pin_hash.slice(0,16), 'match:', pinHash === user.pin_hash);
    if (pinHash !== user.pin_hash) {
      return fail(res, 'Wrong PIN', 403);
    }
  }
  db.prepare("UPDATE users SET pin_hash = '' WHERE id = ?").run(uid);
  auditLog(uid, 'pin_remove', 'PIN disabled');
  ok(res);
});

app.post('/api/settings/totp-setup', requireAuth, verifyCsrf, (req, res) => {
  const user = db.prepare('SELECT display_name FROM users WHERE id = ?').get(req.session.userId);
  const secret = new Secret({ size: 20 });
  const totp = new TOTP({ issuer: 'Encriptor', label: user.display_name || 'User', secret, digits: 6, period: 30 });
  req.session.pendingTotpSecret = secret.base32;
  ok(res, { secret: secret.base32, uri: totp.toString() });
});

app.post('/api/settings/totp-confirm', requireAuth, verifyCsrf, (req, res) => {
  const token = (req.body.token || '').trim();
  const pendingSecret = req.session.pendingTotpSecret;
  if (!pendingSecret) return fail(res, 'No pending TOTP setup. Start setup again.');
  const totp = new TOTP({ secret: Secret.fromBase32(pendingSecret), digits: 6, period: 30 });
  const delta = totp.validate({ token, window: 1 });
  if (delta !== null) {
    db.prepare('UPDATE users SET totp_secret = ? WHERE id = ?').run(pendingSecret, req.session.userId);
    delete req.session.pendingTotpSecret;
    auditLog(req.session.userId, 'totp_enable', 'TOTP enabled');
    ok(res);
  } else {
    fail(res, 'Invalid code. Try again.');
  }
});

app.post('/api/settings/totp-disable', requireAuth, verifyCsrf, (req, res) => {
  const token = (req.body.token || '').trim();
  const user = db.prepare('SELECT totp_secret FROM users WHERE id = ?').get(req.session.userId);
  if (!user || !user.totp_secret) return fail(res, 'TOTP is not enabled');
  const totp = new TOTP({ secret: Secret.fromBase32(user.totp_secret), digits: 6, period: 30 });
  const delta = totp.validate({ token, window: 1 });
  if (delta !== null) {
    db.prepare("UPDATE users SET totp_secret = '' WHERE id = ?").run(req.session.userId);
    auditLog(req.session.userId, 'totp_disable', 'TOTP disabled');
    ok(res);
  } else {
    fail(res, 'Invalid code');
  }
});

app.post('/api/settings/regen-seed', requireAuth, verifyCsrf, (req, res) => {
  const uid = req.session.userId;
  const token = (req.body.totp_token || '').trim();

  // Require TOTP
  const user = db.prepare('SELECT totp_secret FROM users WHERE id = ?').get(uid);
  if (!user || !user.totp_secret) return fail(res, 'Two-factor authentication must be enabled');
  const totp = new TOTP({ secret: Secret.fromBase32(user.totp_secret), digits: 6, period: 30 });
  const delta = totp.validate({ token, window: 1 });
  if (delta === null) return fail(res, 'Invalid authenticator code', 401);

  // Generate new seed phrase
  const newPhrase = generateSeedPhrase();
  const newUserId = hashSeed(newPhrase);
  const newSalt = crypto.randomBytes(16).toString('hex');

  // Check collision
  const existing = db.prepare('SELECT id FROM users WHERE id = ?').get(newUserId);
  if (existing) return fail(res, 'Collision, try again');

  // Create new user with same settings
  const oldUser = db.prepare('SELECT * FROM users WHERE id = ?').get(uid);
  db.prepare('INSERT INTO users (id, display_name, salt, settings, pin_hash, totp_secret, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(newUserId, oldUser.display_name, newSalt, oldUser.settings, oldUser.pin_hash || '', oldUser.totp_secret || '', oldUser.created_at);

  // Move all data to new user
  db.prepare('UPDATE texts SET user_id = ? WHERE user_id = ?').run(newUserId, uid);
  db.prepare('UPDATE images SET user_id = ? WHERE user_id = ?').run(newUserId, uid);
  db.prepare('UPDATE stegano SET user_id = ? WHERE user_id = ?').run(newUserId, uid);
  db.prepare('UPDATE audit_log SET user_id = ? WHERE user_id = ?').run(newUserId, uid);

  // Delete old user
  db.prepare('DELETE FROM users WHERE id = ?').run(uid);

  // Update session
  req.session.userId = newUserId;
  auditLog(newUserId, 'regen_seed', 'Seed phrase regenerated');

  ok(res, { seed_phrase: newPhrase, salt: newSalt });
});

app.post('/api/settings/delete-all-data', requireAuth, verifyCsrf, (req, res) => {
  const uid = req.session.userId;
  db.prepare('DELETE FROM texts WHERE user_id = ?').run(uid);
  db.prepare('DELETE FROM images WHERE user_id = ?').run(uid);
  db.prepare('DELETE FROM stegano WHERE user_id = ?').run(uid);
  auditLog(uid, 'delete_all_data', 'All data deleted');
  ok(res);
});

// ── EXPORT / IMPORT ──
app.get('/api/settings/export', requireAuth, (req, res) => {
  const uid = req.session.userId;
  const texts = db.prepare('SELECT id, label, ciphertext, iv, strength, custom_key, enc_type, created_at FROM texts WHERE user_id = ? ORDER BY created_at DESC').all(uid);
  const imagesRaw = db.prepare('SELECT id, label, mime_type, iv, ciphertext, size, strength, custom_key, enc_type, created_at FROM images WHERE user_id = ? ORDER BY created_at DESC').all(uid);
  const images = imagesRaw.map(r => ({
    ...r,
    ciphertext: Buffer.from(r.ciphertext).toString('base64'),
  }));
  const steganoRaw = db.prepare('SELECT id, label, has_message, image_data, iv, strength, custom_key, enc_type, created_at FROM stegano WHERE user_id = ? ORDER BY created_at DESC').all(uid);
  const stegano = steganoRaw.map(r => ({
    ...r,
    image_data: Buffer.from(r.image_data).toString('base64'),
  }));
  ok(res, { texts, images, stegano });
});

app.post('/api/settings/import', requireAuth, verifyCsrf, (req, res) => {
  const uid = req.session.userId;
  const { texts, images, stegano } = req.body;

  if (Array.isArray(texts)) {
    const stmt = db.prepare('INSERT INTO texts (id, user_id, label, ciphertext, iv, strength, custom_key, enc_type, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    for (const t of texts) {
      const id = genId();
      stmt.run(id, uid, (t.label || 'Untitled').slice(0, 100), t.ciphertext || '', t.iv || '', t.strength || 256, t.custom_key ? 1 : 0, t.enc_type || 'aes-256-gcm', t.created_at || new Date().toISOString());
    }
  }

  if (Array.isArray(images)) {
    const stmt = db.prepare('INSERT INTO images (id, user_id, label, mime_type, iv, ciphertext, size, strength, custom_key, enc_type, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    for (const img of images) {
      const id = genId();
      const buf = Buffer.from(img.ciphertext || '', 'base64');
      stmt.run(id, uid, (img.label || 'Untitled').slice(0, 100), img.mime_type || 'image/png', img.iv || '', buf, buf.length, img.strength || 256, img.custom_key ? 1 : 0, img.enc_type || 'aes-256-gcm', img.created_at || new Date().toISOString());
    }
  }

  if (Array.isArray(stegano)) {
    const stmt = db.prepare('INSERT INTO stegano (id, user_id, label, has_message, image_data, iv, strength, custom_key, enc_type, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    for (const s of stegano) {
      const id = genId();
      const buf = Buffer.from(s.image_data || '', 'base64');
      stmt.run(id, uid, (s.label || 'Untitled').slice(0, 100), s.has_message ? 1 : 0, buf, s.iv || '', s.strength || 256, s.custom_key ? 1 : 0, s.enc_type || 'aes-256-gcm', s.created_at || new Date().toISOString());
    }
  }

  ok(res);
});

app.post('/api/settings/delete-account', requireAuth, verifyCsrf, (req, res) => {
  auditLog(req.session.userId, 'delete_account', 'Account deleted');
  db.prepare('DELETE FROM users WHERE id = ?').run(req.session.userId);
  req.session.destroy(() => ok(res));
});

// ── CHAT API ──

app.post('/api/chat/keys/save', requireAuth, verifyCsrf, (req, res) => {
  const { public_key, private_key_enc, private_key_iv } = req.body;
  if (!public_key || !private_key_enc || !private_key_iv) return res.status(400).json({ success: false, error: 'Missing key data' });
  db.prepare('UPDATE users SET chat_public_key = ?, chat_private_key_enc = ?, chat_private_key_iv = ? WHERE id = ?')
    .run(public_key, private_key_enc, private_key_iv, req.session.userId);
  ok(res);
});

app.get('/api/chat/keys/get', requireAuth, (req, res) => {
  const row = db.prepare('SELECT chat_public_key, chat_private_key_enc, chat_private_key_iv FROM users WHERE id = ?').get(req.session.userId);
  ok(res, { chat_public_key: row.chat_public_key || '', chat_private_key_enc: row.chat_private_key_enc || '', chat_private_key_iv: row.chat_private_key_iv || '' });
});

app.get('/api/chat/search', requireAuth, (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return ok(res, []);
  const rows = db.prepare("SELECT unique_id, display_name, chat_public_key FROM users WHERE unique_id LIKE ? AND id != ? LIMIT 10").all(q + '%', req.session.userId);
  ok(res, rows.map(r => ({ unique_id: r.unique_id, display_name: r.display_name, has_chat: !!r.chat_public_key })));
});

app.get('/api/chat/conversations', requireAuth, (req, res) => {
  const uid = req.session.userId;
  const rows = db.prepare(`
    SELECT c.id, c.user1_id, c.user2_id, c.status, c.initiated_by, c.created_at,
      CASE WHEN c.user1_id = ? THEN u2.display_name ELSE u1.display_name END AS other_user_name,
      CASE WHEN c.user1_id = ? THEN u2.unique_id ELSE u1.unique_id END AS other_user_uid,
      (SELECT MAX(m.created_at) FROM messages m WHERE m.conversation_id = c.id) AS last_message_at
    FROM conversations c
    JOIN users u1 ON u1.id = c.user1_id
    JOIN users u2 ON u2.id = c.user2_id
    WHERE c.user1_id = ? OR c.user2_id = ?
    ORDER BY last_message_at DESC NULLS LAST, c.created_at DESC
  `).all(uid, uid, uid, uid);
  ok(res, rows.map(r => ({
    id: r.id, other_user_name: r.other_user_name, other_user_uid: r.other_user_uid,
    last_message_at: r.last_message_at || r.created_at,
    status: r.status || 'accepted',
    is_request: r.status === 'pending' && r.initiated_by !== uid,
    is_pending: r.status === 'pending' && r.initiated_by === uid,
  })));
});

app.post('/api/chat/conversations/start', requireAuth, verifyCsrf, (req, res) => {
  const uid = req.session.userId;
  const targetUid = (req.body.unique_id || '').trim();
  if (!targetUid) return res.status(400).json({ success: false, error: 'Missing unique_id' });
  const target = db.prepare('SELECT id, chat_public_key FROM users WHERE unique_id = ?').get(targetUid);
  if (!target) return res.status(404).json({ success: false, error: 'User not found' });
  if (target.id === uid) return res.status(400).json({ success: false, error: 'Cannot chat with yourself' });

  // Check if blocked
  const blocked = db.prepare('SELECT 1 FROM blocked_users WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)').get(uid, target.id, target.id, uid);
  if (blocked) return res.status(403).json({ success: false, error: 'Cannot message this user' });

  // Normalize pair
  const [u1, u2] = [uid, target.id].sort();
  let conv = db.prepare('SELECT id, status FROM conversations WHERE user1_id = ? AND user2_id = ?').get(u1, u2);
  if (!conv) {
    const convId = genId();
    db.prepare('INSERT INTO conversations (id, user1_id, user2_id, status, initiated_by, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(convId, u1, u2, 'pending', uid, new Date().toISOString());
    conv = { id: convId, status: 'pending' };
  }

  const me = db.prepare('SELECT chat_public_key FROM users WHERE id = ?').get(uid);
  ok(res, { conversation_id: conv.id, status: conv.status, other_public_key: target.chat_public_key || '', my_public_key: me.chat_public_key || '', user1_id: u1, user2_id: u2 });
});

// Accept/Deny/Block conversation
app.post('/api/chat/conversations/accept', requireAuth, verifyCsrf, (req, res) => {
  const uid = req.session.userId;
  const convId = (req.body.conversation_id || '').trim();
  const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(convId);
  if (!conv) return fail(res, 'Conversation not found', 404);
  if (conv.user1_id !== uid && conv.user2_id !== uid) return fail(res, 'Not a participant', 403);
  if (conv.initiated_by === uid) return fail(res, 'You initiated this conversation', 400);
  db.prepare('UPDATE conversations SET status = ? WHERE id = ?').run('accepted', convId);
  ok(res);
});

app.post('/api/chat/conversations/deny', requireAuth, verifyCsrf, (req, res) => {
  const uid = req.session.userId;
  const convId = (req.body.conversation_id || '').trim();
  const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(convId);
  if (!conv) return fail(res, 'Conversation not found', 404);
  if (conv.user1_id !== uid && conv.user2_id !== uid) return fail(res, 'Not a participant', 403);
  // Delete the conversation and its messages
  db.prepare('DELETE FROM messages WHERE conversation_id = ?').run(convId);
  db.prepare('DELETE FROM conversations WHERE id = ?').run(convId);
  ok(res);
});

app.post('/api/chat/conversations/block', requireAuth, verifyCsrf, (req, res) => {
  const uid = req.session.userId;
  const convId = (req.body.conversation_id || '').trim();
  const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(convId);
  if (!conv) return fail(res, 'Conversation not found', 404);
  if (conv.user1_id !== uid && conv.user2_id !== uid) return fail(res, 'Not a participant', 403);
  const otherId = conv.user1_id === uid ? conv.user2_id : conv.user1_id;
  // Block the user
  db.prepare('INSERT OR IGNORE INTO blocked_users (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)').run(uid, otherId, new Date().toISOString());
  // Delete conversation and messages
  db.prepare('DELETE FROM messages WHERE conversation_id = ?').run(convId);
  db.prepare('DELETE FROM conversations WHERE id = ?').run(convId);
  auditLog(uid, 'chat_block', 'Blocked user');
  ok(res);
});

app.get('/api/chat/messages', requireAuth, (req, res) => {
  const uid = req.session.userId;
  const convId = (req.query.conversation_id || '').trim();
  const after = (req.query.after || '').trim();
  if (!convId) return res.status(400).json({ success: false, error: 'Missing conversation_id' });

  const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(convId);
  if (!conv) return res.status(404).json({ success: false, error: 'Conversation not found' });
  if (conv.user1_id !== uid && conv.user2_id !== uid) return res.status(403).json({ success: false, error: 'Not a participant' });

  let rows;
  if (after) {
    rows = db.prepare('SELECT id, conversation_id, sender_id, ciphertext_user1, ciphertext_user2, created_at FROM messages WHERE conversation_id = ? AND created_at > ? ORDER BY created_at ASC LIMIT 100').all(convId, after);
  } else {
    rows = db.prepare('SELECT id, conversation_id, sender_id, ciphertext_user1, ciphertext_user2, created_at FROM messages WHERE conversation_id = ? ORDER BY created_at ASC LIMIT 100').all(convId);
  }
  ok(res, rows);
});

app.post('/api/chat/messages/send', requireAuth, verifyCsrf, (req, res) => {
  const uid = req.session.userId;
  const { conversation_id, ciphertext_user1, ciphertext_user2 } = req.body;
  if (!conversation_id || !ciphertext_user1 || !ciphertext_user2) return res.status(400).json({ success: false, error: 'Missing fields' });

  const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(conversation_id);
  if (!conv) return res.status(404).json({ success: false, error: 'Conversation not found' });
  if (conv.user1_id !== uid && conv.user2_id !== uid) return res.status(403).json({ success: false, error: 'Not a participant' });

  // Only allow sending if accepted, or if you're the initiator (first message in pending)
  if (conv.status === 'pending' && conv.initiated_by !== uid) {
    return res.status(403).json({ success: false, error: 'Accept the request first' });
  }

  const id = genId();
  const created_at = new Date().toISOString();
  db.prepare('INSERT INTO messages (id, conversation_id, sender_id, ciphertext_user1, ciphertext_user2, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, conversation_id, uid, ciphertext_user1, ciphertext_user2, created_at);
  ok(res, { id, created_at });
});

// ── SERVE FRONTEND ──
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Global error handler (must be after all routes)
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ success: false, error: err.message || 'Internal server error' });
});

// ── START ──
app.listen(PORT, '0.0.0.0', () => {
  console.log(`ENCRIPTOR running at http://localhost:${PORT}`);
});
