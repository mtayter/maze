// Admin view: the logins list (server: GET /app/maze/admin/logins).
// One row per login session, newest first: name, email, avatar
// color, the maze the user is standing in right now (if any), and
// login / logout times. Admins only — the server enforces it (403);
// the shell only shows the nav button to admins in the first place.

const API = '/app/maze';
const REFRESH_MS = 15000;

let ac = null;
let timer = null;

// Server datetimes are UTC 'YYYY-MM-DD HH:MM:SS'; parse them as UTC
// and let toLocaleString render them in the viewer's timezone.
function fmtTime(utcString) {
  if (!utcString) return '—';
  const d = new Date(utcString.replace(' ', 'T') + 'Z');
  return Number.isNaN(d.getTime()) ? utcString : d.toLocaleString();
}

function cell(text) {
  const td = document.createElement('td');
  td.textContent = text;
  return td;
}

async function load() {
  const tbody = document.getElementById('adminRows');
  const note = document.getElementById('adminNote');
  if (!tbody) return;
  try {
    const response = await fetch(`${API}/admin/logins`, { signal: ac.signal });
    if (response.status === 401) {
      window.dispatchEvent(new CustomEvent('maze-unauthorized'));
      return;
    }
    if (response.status === 403) {
      note.textContent = 'Admins only.';
      return;
    }
    if (!response.ok) throw new Error(`status ${response.status}`);
    const data = await response.json();
    tbody.innerHTML = '';
    for (const row of data.logins) {
      const tr = document.createElement('tr');
      tr.appendChild(cell(row.name || ''));
      tr.appendChild(cell(row.email || ''));
      const avatar = document.createElement('td');
      if (row.avatar_color) {
        const dot = document.createElement('span');
        dot.className = 'admin-dot';
        dot.style.background = row.avatar_color;
        avatar.appendChild(dot);
      } else {
        avatar.textContent = '—';
      }
      tr.appendChild(avatar);
      tr.appendChild(cell(row.current_maze || '—'));
      tr.appendChild(cell(fmtTime(row.login_at)));
      tr.appendChild(cell(fmtTime(row.logout_at)));
      tbody.appendChild(tr);
    }
    note.textContent = data.logins.length ? '' : 'No logins recorded yet.';
  } catch (err) {
    if (err.name !== 'AbortError') {
      note.textContent = 'Could not load logins — try Refresh.';
    }
  }
}

export async function mount(el) {
  ac = new AbortController();
  el.className = 'view-admin';
  el.innerHTML = `
    <div class="admin-card">
      <h2>🛡️ Logins</h2>
      <p class="muted">Every login session, newest first. Current maze is live — it shows only while someone is in a maze.</p>
      <div class="settings-actions">
        <button class="btn" id="adminRefreshBtn" type="button">🔄 Refresh</button>
        <span class="saved-note" id="adminNote" role="status"></span>
      </div>
      <div class="admin-table-wrap">
        <table class="admin-table">
          <thead>
            <tr><th>Name</th><th>Email</th><th>Avatar</th><th>Current maze</th><th>Login</th><th>Logout</th></tr>
          </thead>
          <tbody id="adminRows"></tbody>
        </table>
      </div>
    </div>
  `;
  document.getElementById('adminRefreshBtn').addEventListener('click', load, { signal: ac.signal });
  await load();
  timer = setInterval(load, REFRESH_MS);
}

export function unmount() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  if (ac) {
    ac.abort();
    ac = null;
  }
}
