// Auth.js — Google SSO for the Maze SPA, mirroring the Math Quest
// (mathsaic) setup: Google Identity Services renders the sign-in
// button; the credential (ID token) is POSTed to the server, which
// verifies it and issues its own session cookie. This module owns the
// client side: boot-time /me check, the sign-in screen, sign-out, and
// notifying the shell when auth state changes.

const API = '/app/maze';

let user = null;
let clientId = null;
let ssoInit = false;
let onAuthChange = null;

export function getUser() {
  return user;
}

export function setUser(next) {
  user = next;
}

// Called once by the shell. Fetches the client id and any existing
// session; returns the signed-in user (or null). cb runs again
// whenever auth state changes afterwards (sign-in, sign-out, a 401
// from the API via noteUnauthorized).
export async function initAuth(cb) {
  onAuthChange = cb;
  window.addEventListener('maze-unauthorized', () => {
    if (user) {
      user = null;
      if (onAuthChange) onAuthChange();
    }
  });
  try {
    const cfg = await (await fetch(`${API}/config`)).json();
    clientId = cfg.google_client_id || null;
  } catch {
    clientId = null;
  }
  try {
    const me = await (await fetch(`${API}/me`)).json();
    if (me && me.ok) {
      user = me.user;
    }
  } catch {
    // API unreachable: treat as signed out; the sign-in screen's
    // button will fail gracefully if the server stays down.
  }
  return user;
}

export async function signOut() {
  try {
    await fetch(`${API}/logout`, { method: 'POST' });
  } catch {
    // Even if the server call fails, drop local state.
  }
  user = null;
  if (onAuthChange) onAuthChange();
}

export async function saveSettings(avatarColor) {
  const response = await fetch(`${API}/settings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ avatar_color: avatarColor }),
  });
  if (response.status === 401) {
    window.dispatchEvent(new CustomEvent('maze-unauthorized'));
    throw new Error('unauthorized');
  }
  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }
  const data = await response.json();
  user = data.user;
  return user;
}

async function onGoogleCredential(resp) {
  const errorEl = document.getElementById('signinError');
  try {
    const r = await (await fetch(`${API}/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id_token: resp.credential }),
    })).json();
    if (r && r.ok) {
      user = r.user;
      if (onAuthChange) onAuthChange();
      return;
    }
  } catch {
    // fall through to the error message
  }
  if (errorEl) {
    errorEl.textContent = 'Sign-in failed — please try again.';
  }
}

function initSignInButton() {
  const box = document.getElementById('ssoBox');
  if (!box) return;
  if (!window.google || !google.accounts) {
    box.innerHTML = '<p class="muted">Loading Google sign-in…</p>';
    setTimeout(initSignInButton, 800);
    return;
  }
  if (ssoInit) {
    return; // google.accounts.id.initialize() must run once
  }
  ssoInit = true;
  box.innerHTML = '';
  google.accounts.id.initialize({
    client_id: clientId,
    callback: onGoogleCredential,
    ux_mode: 'popup',
  });
  google.accounts.id.renderButton(box, {
    theme: 'outline', size: 'large', width: 280, text: 'signin_with',
  });
}

// Renders the signed-out screen into el (the shell's view container).
export function renderSignIn(el) {
  el.className = 'view-signin';
  if (!clientId) {
    el.innerHTML = `
      <div class="signin-card">
        <div class="win-emoji">⚙️</div>
        <h2>One-time setup needed</h2>
        <p>Sign-in isn't configured yet. The site owner needs to add a Google OAuth client ID:</p>
        <ol class="setup-steps">
          <li>Go to <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener">Google Cloud → Credentials</a></li>
          <li>Create Credentials → <b>OAuth client ID</b> → Web application</li>
          <li>Under <b>Authorized JavaScript origins</b>, add this site's own origin</li>
          <li>Copy the client ID into the maze server config as <code>MAZE_GOOGLE_CLIENT_ID</code> and restart the service</li>
        </ol>
      </div>`;
    return;
  }
  el.innerHTML = `
    <div class="signin-card">
      <img class="signin-icon" src="maze-icon.svg" alt="">
      <h2>Welcome to Maze</h2>
      <p>Sign in with Google to play and create mazes.</p>
      <div id="ssoBox"></div>
      <p class="signin-error" id="signinError" role="alert"></p>
    </div>`;
  initSignInButton();
}
