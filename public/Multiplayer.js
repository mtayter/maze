// Multiplayer.js — presence client for the play view (roadmap
// phase 4). The server keeps room rosters in memory: this client
// POSTs its position on every move plus a heartbeat, and receives
// the room roster over Server-Sent Events. Rendering and collision
// live in the play view; this module owns the wire and the roster,
// plus the spawn-collision solver (a pure function, kept here so it
// can be unit-tested without a DOM).

import { getUser } from './Auth.js?v=4.0.1';

const API = '/app/maze';
const HEARTBEAT_MS = 5000;

let current = null; // { maze, x, z, yaw, y, onRoster }
let eventSource = null;
let heartbeatTimer = null;
let others = [];

export function getOthers() {
  return others;
}

function handleRoster(players) {
  const me = getUser();
  others = (players || []).filter((p) => !me || p.user_id !== me.user_id);
  if (current && current.onRoster) {
    current.onRoster(others);
  }
  return players || [];
}

async function sendPresence() {
  if (!current) {
    return [];
  }
  try {
    const response = await fetch(`${API}/presence`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        maze: current.maze, x: current.x, z: current.z, yaw: current.yaw, y: current.y,
      }),
    });
    if (response.status === 401) {
      window.dispatchEvent(new CustomEvent('maze-unauthorized'));
      return [];
    }
    if (!response.ok) {
      return [];
    }
    const data = await response.json();
    return handleRoster(data.players);
  } catch {
    return []; // server unreachable: stay single-player until it returns
  }
}

function onVisibility() {
  if (!document.hidden) {
    sendPresence();
  }
}

// Join a maze's room at the given position ({x, z, yaw, y}).
// Resolves with the full roster (including self) as the server sees
// it right after our first presence POST — the play view uses it to
// resolve spawn collisions. onRoster(others) fires on every later
// roster change.
export async function join(maze, pos, onRoster) {
  leave();
  current = { maze, x: pos.x, z: pos.z, yaw: pos.yaw, y: pos.y, onRoster };
  others = [];

  eventSource = new EventSource(`${API}/events?maze=${encodeURIComponent(maze)}`);
  eventSource.addEventListener('players', (event) => {
    try {
      handleRoster(JSON.parse(event.data));
    } catch {
      // Malformed event: ignore; the next one will be well-formed.
    }
  });

  heartbeatTimer = setInterval(sendPresence, HEARTBEAT_MS);
  document.addEventListener('visibilitychange', onVisibility);
  return sendPresence();
}

// Report a new position/facing/height ({x, z, yaw, y}).
// Fire-and-forget: the roster flows back over SSE and in the POST
// response.
export function update(pos) {
  if (!current) {
    return;
  }
  current.x = pos.x;
  current.z = pos.z;
  current.yaw = pos.yaw;
  current.y = pos.y;
  sendPresence();
}

export function leave() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  document.removeEventListener('visibilitychange', onVisibility);
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
  if (current) {
    // Best-effort goodbye so the room frees our cell immediately
    // instead of waiting for the presence TTL.
    fetch(`${API}/presence`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ maze: current.maze, leave: true }),
      keepalive: true,
    }).catch(() => {});
    current = null;
  }
  others = [];
}

// Spawn collision: if the start cell is occupied, the closest free
// cell (Manhattan rings, walls ignored — every cell is standable)
// wins. A completely full maze falls back to sharing the start.
export function findSpawn(occupied, startX, startZ, width, height) {
  const taken = new Set(occupied.map(([x, z]) => `${x},${z}`));
  if (!taken.has(`${startX},${startZ}`)) {
    return { x: startX, z: startZ };
  }
  const seen = new Set([`${startX},${startZ}`]);
  const queue = [[startX, startZ]];
  while (queue.length > 0) {
    const [cx, cz] = queue.shift();
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx;
      const nz = cz + dz;
      const key = `${nx},${nz}`;
      if (nx < 0 || nz < 0 || nx >= width || nz >= height || seen.has(key)) {
        continue;
      }
      if (!taken.has(key)) {
        return { x: nx, z: nz };
      }
      seen.add(key);
      queue.push([nx, nz]);
    }
  }
  return { x: startX, z: startZ };
}
