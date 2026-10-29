const express = require('express');
const mysql = require('mysql2/promise');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

// ---------------------------------------------------------------------------
// Configuration.
//
// All secrets and deployment settings come from the environment. A config
// file (default: ~/.config/maze/config.env, override with MAZE_CONFIG_FILE)
// is loaded first; real environment variables take precedence over it.
//
// The config file is created by install.sh, lives OUTSIDE the repo checkout,
// and must never be committed (see .gitignore). It contains KEY="value"
// lines; values may be double-quoted with \" and \\ escapes.
//
// MAZE_GOOGLE_CLIENT_ID enables Google SSO (see the auth section below);
// MAZE_OWNER_EMAIL designates the owner who claims all pre-SSO mazes on
// first sign-in.
// ---------------------------------------------------------------------------

function loadConfigFile() {
  const configPath = process.env.MAZE_CONFIG_FILE
    || path.join(os.homedir(), '.config', 'maze', 'config.env');
  let text;
  try {
    text = fs.readFileSync(configPath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return; // no config file: env vars only
    throw err;
  }
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
      value = value
        .slice(1, -1)
        .replace(/\\(.)/g, '$1');
    }
    // Environment wins over the file, so only fill unset keys.
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadConfigFile();

const REQUIRED = [
  'MAZE_DB_HOST',
  'MAZE_DB_PORT',
  'MAZE_DB_NAME',
  'MAZE_DB_USER',
  'MAZE_DB_PASSWORD',
];
const missing = REQUIRED.filter((k) => !process.env[k]);
if (missing.length > 0) {
  console.error(
    'Missing required configuration (set via environment or '
    + 'MAZE_CONFIG_FILE): ' + missing.join(', ')
  );
  process.exit(1);
}

const LISTEN_HOST = process.env.MAZE_HOST || '127.0.0.1';
const LISTEN_PORT = parseInt(process.env.MAZE_PORT || '3000', 10);
const GOOGLE_CLIENT_ID = process.env.MAZE_GOOGLE_CLIENT_ID || '';
const OWNER_EMAIL = (process.env.MAZE_OWNER_EMAIL || '').toLowerCase();

const app = express();
app.use(express.json());

function dbConfig() {
  return {
    host: process.env.MAZE_DB_HOST,
    port: parseInt(process.env.MAZE_DB_PORT, 10),
    user: process.env.MAZE_DB_USER,
    password: process.env.MAZE_DB_PASSWORD,
    database: process.env.MAZE_DB_NAME,
  };
}

async function withDb(fn) {
  const connection = await mysql.createConnection(dbConfig());
  try {
    return await fn(connection);
  } finally {
    await connection.end();
  }
}

// ---------------------------------------------------------------------------
// Schema migration (additive; runs at startup).
// Table names are singular. `user`.user_id is the primary key and the
// foreign-key column name in `session` and `maze` alike.
// ---------------------------------------------------------------------------

async function migrate() {
  await withDb(async (db) => {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS user (
        user_id INT AUTO_INCREMENT PRIMARY KEY,
        sub VARCHAR(255) NOT NULL UNIQUE,
        email VARCHAR(255),
        name VARCHAR(255),
        picture VARCHAR(512),
        avatar_color VARCHAR(7) NOT NULL DEFAULT '#22c55e',
        created_at DATETIME NOT NULL
      )`);
    await db.execute(`
      CREATE TABLE IF NOT EXISTS session (
        token_hash CHAR(64) PRIMARY KEY,
        user_id INT NOT NULL,
        created_at DATETIME NOT NULL,
        expires_at DATETIME NOT NULL,
        INDEX (user_id)
      )`);
    await db.execute(
      'ALTER TABLE maze ADD COLUMN IF NOT EXISTS user_id INT NULL');
  });
}

// ---------------------------------------------------------------------------
// Auth — mirrors the Math Quest (mathsaic) SSO setup: the client signs in
// with Google Identity Services and POSTs the ID token here; we verify it
// against Google's tokeninfo endpoint, upsert the user by Google `sub`,
// and issue our own session (random token, SHA-256 hash stored, 30-day
// expiry) in an HttpOnly cookie. Everything except /config and /auth
// requires a session.
// ---------------------------------------------------------------------------

const SESSION_COOKIE = 'maze_session';
const SESSION_DAYS = 30;

function utcStr(date) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

function sha256Hex(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function sessionCookieHeader(token) {
  return `${SESSION_COOKIE}=${token}; Path=/; Max-Age=${SESSION_DAYS * 86400}; HttpOnly; SameSite=Lax; Secure`;
}

function parseCookies(req) {
  const out = {};
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    out[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
  }
  return out;
}

async function verifyGoogleToken(idToken) {
  if (!GOOGLE_CLIENT_ID) {
    return [null, 'server not configured'];
  }
  let info;
  try {
    const url = 'https://oauth2.googleapis.com/tokeninfo?id_token='
      + encodeURIComponent(idToken || '');
    const resp = await fetch(url, { headers: { 'User-Agent': 'maze' } });
    if (!resp.ok) {
      return [null, 'token rejected'];
    }
    info = await resp.json();
  } catch (err) {
    return [null, 'token rejected'];
  }
  if (info.aud !== GOOGLE_CLIENT_ID) {
    return [null, 'audience mismatch'];
  }
  if (Number(info.exp || 0) < Math.floor(Date.now() / 1000)) {
    return [null, 'token expired'];
  }
  return [info, null];
}

function publicUser(row) {
  return {
    user_id: row.user_id,
    name: row.name,
    email: row.email,
    picture: row.picture,
    avatar_color: row.avatar_color,
  };
}

async function getOrCreateUser(info) {
  return withDb(async (db) => {
    const [rows] = await db.execute('SELECT * FROM user WHERE sub = ?', [info.sub]);
    if (rows.length > 0) {
      await db.execute('UPDATE user SET name = ?, picture = ?, email = ? WHERE user_id = ?',
        [info.name || null, info.picture || null, info.email || null, rows[0].user_id]);
      return { ...rows[0], name: info.name || null, picture: info.picture || null, email: info.email || null };
    }
    const [result] = await db.execute(
      'INSERT INTO user (sub, email, name, picture, created_at) VALUES (?,?,?,?,?)',
      [info.sub, info.email || null, info.name || null, info.picture || null, utcStr(new Date())]);
    const [created] = await db.execute('SELECT * FROM user WHERE user_id = ?', [result.insertId]);
    return created[0];
  });
}

// The designated owner claims every pre-SSO (unowned) maze on sign-in.
async function claimUnownedMazes(user) {
  if (!OWNER_EMAIL || (user.email || '').toLowerCase() !== OWNER_EMAIL) {
    return;
  }
  await withDb(async (db) => {
    await db.execute('UPDATE maze SET user_id = ? WHERE user_id IS NULL', [user.user_id]);
  });
}

async function sessionUser(req) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token) return null;
  const tokenHash = sha256Hex(token);
  return withDb(async (db) => {
    const [rows] = await db.execute(
      `SELECT u.* FROM session s JOIN user u ON u.user_id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > ?`,
      [tokenHash, utcStr(new Date())]);
    if (rows.length === 0) {
      await db.execute('DELETE FROM session WHERE token_hash = ?', [tokenHash]);
      return null;
    }
    return rows[0];
  });
}

async function requireAuth(req, res, next) {
  try {
    const user = await sessionUser(req);
    if (!user) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    req.user = user;
    next();
  } catch (err) {
    console.error('Auth error:', err);
    res.status(500).json({ error: 'server error' });
  }
}

app.get('/app/maze/config', (req, res) => {
  res.json({ google_client_id: GOOGLE_CLIENT_ID });
});

app.post('/app/maze/auth', async (req, res) => {
  try {
    const [info, err] = await verifyGoogleToken(req.body && req.body.id_token);
    if (err) {
      res.status(401).json({ ok: false, error: err });
      return;
    }
    const user = await getOrCreateUser(info);
    await claimUnownedMazes(user);
    const token = crypto.randomBytes(32).toString('hex');
    const now = new Date();
    const expires = new Date(now.getTime() + SESSION_DAYS * 86400 * 1000);
    await withDb(async (db) => {
      await db.execute(
        'INSERT INTO session (token_hash, user_id, created_at, expires_at) VALUES (?,?,?,?)',
        [sha256Hex(token), user.user_id, utcStr(now), utcStr(expires)]);
    });
    res.setHeader('Set-Cookie', sessionCookieHeader(token));
    res.json({ ok: true, user: publicUser(user) });
  } catch (err) {
    console.error('Auth error:', err);
    res.status(500).json({ ok: false, error: 'server error' });
  }
});

app.get('/app/maze/me', async (req, res) => {
  try {
    const user = await sessionUser(req);
    if (!user) {
      res.json({ ok: false });
      return;
    }
    res.json({ ok: true, user: publicUser(user) });
  } catch (err) {
    console.error('Auth error:', err);
    res.status(500).json({ ok: false, error: 'server error' });
  }
});

app.post('/app/maze/logout', async (req, res) => {
  try {
    const token = parseCookies(req)[SESSION_COOKIE];
    if (token) {
      await withDb(async (db) => {
        await db.execute('DELETE FROM session WHERE token_hash = ?', [sha256Hex(token)]);
      });
    }
    res.setHeader('Set-Cookie',
      `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax; Secure`);
    res.json({ ok: true });
  } catch (err) {
    console.error('Auth error:', err);
    res.status(500).json({ ok: false, error: 'server error' });
  }
});

app.post('/app/maze/settings', requireAuth, async (req, res) => {
  try {
    const color = req.body && req.body.avatar_color;
    if (typeof color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(color)) {
      res.status(400).json({ ok: false, error: 'avatar_color must be #rrggbb' });
      return;
    }
    await withDb(async (db) => {
      await db.execute('UPDATE user SET avatar_color = ? WHERE user_id = ?',
        [color, req.user.user_id]);
    });
    res.json({ ok: true, user: publicUser({ ...req.user, avatar_color: color }) });
  } catch (err) {
    console.error('Settings error:', err);
    res.status(500).json({ ok: false, error: 'server error' });
  }
});

// ---------------------------------------------------------------------------
// Maze endpoints (session required).
// ---------------------------------------------------------------------------

app.post('/app/maze/get', requireAuth, async (req, res) => {
  try {
    const rows = await getMaze(req.body.maze);
    if (!rows || rows.length === 0) {
      res.status(404).json({ error: 'Maze not found' });
      return;
    }
    // MariaDB treats LONGTEXT columns with a json_valid() check as its JSON
    // type, and mysql2 returns those already parsed (arrays, not strings).
    // Parse only when the driver handed us a string; pass arrays through.
    rows[0].h = typeof rows[0].h === 'string' ? JSON.parse(rows[0].h) : rows[0].h;
    rows[0].v = typeof rows[0].v === 'string' ? JSON.parse(rows[0].v) : rows[0].v;
    rows[0].mine = rows[0].user_id === req.user.user_id;
    delete rows[0].user_id;
    res.status(200).json(rows[0]);
  } catch (err) {
    console.error('Database error:', err);
    res.status(500).json({ error: 'server error' });
  }
});

app.get('/app/maze/list', requireAuth, async (req, res) => {
  try {
    const rows = await listMazes();
    res.status(200).json(rows.map((row) => ({
      name: row.name,
      owner_name: row.owner_name,
      mine: row.user_id === req.user.user_id,
    })));
  } catch (err) {
    console.error('Database error:', err);
    res.status(500).json({ error: 'server error' });
  }
});

app.post('/app/maze/save', requireAuth, async (req, res) => {
  try {
    const postData = req.body;
    const owner = await mazeOwner(postData.maze);
    if (owner !== null && owner !== req.user.user_id) {
      res.status(403).json({ error: 'That maze belongs to someone else' });
      return;
    }
    await uploadMaze(postData.maze,
                     postData.h,
                     postData.v,
                     postData.start_x,
                     postData.start_y,
                     postData.end_x,
                     postData.end_y,
                     postData.direction,
                     req.user.user_id);
    res.json({ success: true });
  } catch (err) {
    console.error('Database error:', err);
    res.status(500).json({ error: 'server error' });
  }
});

async function getMaze(maze) {
  return withDb(async (db) => {
    const [rows] = await db.execute(
      `SELECT m.h, m.v, m.start_x, m.start_y, m.end_x, m.end_y, m.direction,
              m.user_id, u.name AS owner_name
       FROM maze m LEFT JOIN user u ON u.user_id = m.user_id
       WHERE m.name = ?`, [maze]);
    return rows;
  });
}

async function listMazes() {
  return withDb(async (db) => {
    const [rows] = await db.execute(
      `SELECT m.name, m.user_id, u.name AS owner_name
       FROM maze m LEFT JOIN user u ON u.user_id = m.user_id
       ORDER BY m.name`);
    return rows;
  });
}

async function mazeOwner(name) {
  return withDb(async (db) => {
    const [rows] = await db.execute('SELECT user_id FROM maze WHERE name = ?', [name]);
    return rows.length === 0 ? null : rows[0].user_id;
  });
}

async function uploadMaze(name, h, v, start_x, start_y, end_x, end_y, direction, userId) {
  return withDb(async (db) => {
    await db.execute(
      `INSERT INTO maze (name, h, v, start_x, start_y, end_x, end_y, direction, user_id)
       VALUES (?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE
         h = VALUES(h), v = VALUES(v),
         start_x = VALUES(start_x), start_y = VALUES(start_y),
         end_x = VALUES(end_x), end_y = VALUES(end_y),
         direction = VALUES(direction), user_id = VALUES(user_id)`,
      [name, JSON.stringify(h), JSON.stringify(v),
       start_x, start_y, end_x, end_y, direction, userId]);
  });
}

migrate()
  .then(() => {
    app.listen(LISTEN_PORT, LISTEN_HOST, () => {
      console.log(`Server running at http://${LISTEN_HOST}:${LISTEN_PORT}`);
    });
  })
  .catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
  });
