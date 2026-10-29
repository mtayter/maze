const express = require('express');
const mysql = require('mysql2/promise');
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

app.post('/app/maze/get', async (req, res) => {
  const postData = req.body;
  const rows = await getMaze(postData.maze);
  if (!rows || rows.length === 0) {
    res.status(404).json({ error: 'Maze not found' });
    return;
  }
  // MariaDB treats LONGTEXT columns with a json_valid() check as its JSON
  // type, and mysql2 returns those already parsed (arrays, not strings).
  // Parse only when the driver handed us a string; pass arrays through.
  rows[0].h = typeof rows[0].h === 'string' ? JSON.parse(rows[0].h) : rows[0].h;
  rows[0].v = typeof rows[0].v === 'string' ? JSON.parse(rows[0].v) : rows[0].v;
  res.status(200).json(rows[0]);
});

app.get('/app/maze/list', async (req, res) => {
  const rows = await listMazes();
  res.status(200).json(rows);
});

app.post('/app/maze/save', async (req, res) => {
  const postData = req.body;
  uploadMaze(postData.maze,
             postData.h,
             postData.v,
             postData.start_x,
             postData.start_y,
             postData.end_x,
             postData.end_y,
             postData.direction);
  res.json({ success: true });
});

app.listen(LISTEN_PORT, LISTEN_HOST, () => {
  console.log(`Server running at http://${LISTEN_HOST}:${LISTEN_PORT}`);
});

async function getMaze(maze) {
  const connection = await mysql.createConnection(dbConfig());

  try {
    const [rows, fields] = await connection.execute('SELECT h, v, start_x, start_y, end_x, end_y, direction FROM maze WHERE name = ?', [maze]);
    return rows;
  } catch (err) {
    console.error('Database error:', err);
  } finally {
    await connection.end();
  }
}

async function listMazes() {
  const connection = await mysql.createConnection(dbConfig());

  try {
    const [rows, fields] = await connection.execute('SELECT name FROM maze ORDER BY name');
    return rows;
  } catch (err) {
    console.error('Database error:', err);
  } finally {
    await connection.end();
  }
}

async function uploadMaze(name, h, v, start_x, start_y, end_x, end_y, direction) {
  const connection = await mysql.createConnection(dbConfig());

  try {
    await connection.execute('INSERT INTO maze (name, h, v, start_x, start_y, end_x, end_y, direction) VALUES (?,?,?,?,?,?,?,?)', [
      name,
      JSON.stringify(h),
      JSON.stringify(v),
      start_x,
      start_y,
      end_x,
      end_y,
      direction]);
  } catch (err) {
    console.error('Database error:', err);
  } finally {
    await connection.end();
  }
}
