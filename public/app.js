// Maze SPA shell: hash router + version check + SSO gate.
//
// Routes: #/play (the game), #/create (the editor), #/settings
// (profile + avatar color), #/admin (logins list, admins only).
// Views are modules with mount(el, shared) /
// unmount(); every listener a view registers uses the AbortSignal it
// is handed, so unmounting tears the view down completely.
//
// SSO gates everything: until Auth reports a signed-in user, the only
// screen is the sign-in screen. The one piece of shell-level shared
// state is the editor's dirty flag, so the version check never
// force-reloads over unsaved work.

import { mount as mountPlay, unmount as unmountPlay } from './views/play.js?v=4.1.4';
import { mount as mountCreate, unmount as unmountCreate } from './views/create.js?v=4.1.4';
import { mount as mountSettings, unmount as unmountSettings } from './views/settings.js?v=4.1.4';
import { mount as mountAdmin, unmount as unmountAdmin } from './views/admin.js?v=4.1.4';
import { initAuth, getUser, renderSignIn, signOut } from './Auth.js?v=4.1.4';

const shared = {
  editorDirty: false,
};

const VIEWS = {
  play: { mount: mountPlay, unmount: unmountPlay, title: 'Do Maze', nav: 'navPlay' },
  create: { mount: mountCreate, unmount: unmountCreate, title: 'Create Maze ✏️', nav: 'navCreate' },
  settings: { mount: mountSettings, unmount: unmountSettings, title: 'Settings ⚙️', nav: 'navSettings' },
  admin: { mount: mountAdmin, unmount: unmountAdmin, title: 'Admin 🛡️', nav: 'navAdmin' },
};

let currentRoute = null;

function routeFromHash() {
  const name = window.location.hash.replace(/^#\/?/, '');
  return VIEWS[name] ? name : 'play';
}

async function render() {
  if (!getUser()) {
    showSignIn();
    return;
  }
  let route = routeFromHash();
  if (route === 'admin' && !getUser().is_admin) {
    route = 'play'; // the admin page is admins-only (server enforces it too)
  }
  if (route === currentRoute) {
    return;
  }
  if (currentRoute) {
    VIEWS[currentRoute].unmount();
  }
  currentRoute = route;

  const view = document.getElementById('view');
  view.innerHTML = '';
  document.title = VIEWS[route].title;
  for (const key of Object.keys(VIEWS)) {
    document.getElementById(VIEWS[key].nav).removeAttribute('aria-current');
  }
  document.getElementById(VIEWS[route].nav).setAttribute('aria-current', 'page');

  await VIEWS[route].mount(view, shared);
}

function showSignIn() {
  if (currentRoute) {
    VIEWS[currentRoute].unmount();
    currentRoute = null;
  }
  document.title = 'Maze — Sign in';
  renderSignIn(document.getElementById('view'));
}

function updateChrome() {
  const user = getUser();
  document.body.classList.toggle('signed-out', !user);
  document.getElementById('navAdmin').style.display = user && user.is_admin ? '' : 'none';
  const slot = document.getElementById('authSlot');
  if (!user) {
    slot.innerHTML = '';
    return;
  }
  const firstName = (user.name || '').split(' ')[0] || 'Player';
  slot.innerHTML = `
    <span class="user-chip">
      ${user.picture ? `<img class="user-pic" src="${user.picture}" alt="" referrerpolicy="no-referrer">` : ''}
      <span class="user-dot" style="background:${user.avatar_color || '#22c55e'}" title="Your avatar color"></span>
      <span class="user-name" id="userName"></span>
      <button class="btn signout-btn" id="signOutBtn" type="button">Sign out</button>
    </span>`;
  document.getElementById('userName').textContent = firstName;
  document.getElementById('signOutBtn').addEventListener('click', () => {
    signOut();
  });
}

function onAuthChange() {
  updateChrome();
  if (getUser()) {
    render();
  } else {
    showSignIn();
  }
}

// ---------------------------------------------------------------------------
// Version check.
//
// The shell's baked-in version is the <meta name="app-version"> stamp in
// index.html; the deployed version is version.json next to it. Both are
// bumped together at release time. If the server stamp is newer than
// what this page loaded (i.e. the browser served us a stale shell), we
// reload once to pick up the fresh files. Guards:
//   - never loop: if we already reloaded for that exact server version
//     and STILL see a mismatch, show the banner instead of reloading.
//   - never destroy unsaved editor work: if the editor is dirty, show
//     the banner instead of reloading.
// ---------------------------------------------------------------------------

const LOADED_VERSION = document.querySelector('meta[name="app-version"]')?.content ?? '';
const RELOAD_GUARD_KEY = 'maze-reloaded-for-version';

function showUpdateBanner() {
  document.getElementById('updateBanner').classList.add('show');
}
function hideUpdateBanner() {
  document.getElementById('updateBanner').classList.remove('show');
}

async function checkVersion() {
  let serverVersion;
  try {
    const response = await fetch('version.json', { cache: 'no-store' });
    if (!response.ok) return;
    serverVersion = (await response.json()).version;
  } catch {
    return; // offline / transient: try again on the next check
  }
  if (!serverVersion || serverVersion === LOADED_VERSION) {
    sessionStorage.removeItem(RELOAD_GUARD_KEY);
    hideUpdateBanner();
    return;
  }
  if (shared.editorDirty) {
    showUpdateBanner();
    return;
  }
  if (sessionStorage.getItem(RELOAD_GUARD_KEY) === serverVersion) {
    showUpdateBanner();
    return;
  }
  sessionStorage.setItem(RELOAD_GUARD_KEY, serverVersion);
  window.location.reload();
}

function initVersionCheck() {
  document.getElementById('updateReloadBtn').addEventListener('click', () => {
    sessionStorage.removeItem(RELOAD_GUARD_KEY);
    window.location.reload();
  });
  document.getElementById('updateDismissBtn').addEventListener('click', hideUpdateBanner);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      checkVersion();
    }
  });
  window.setInterval(checkVersion, 15 * 60 * 1000);
  checkVersion();
}

// iOS Safari ignores user-scalable=no; block its pinch gesture globally.
document.addEventListener('gesturestart', e => e.preventDefault());

window.addEventListener('hashchange', render);

if (!window.location.hash) {
  window.history.replaceState(null, '', '#/play');
}
await initAuth(onAuthChange);
updateChrome();
if (getUser()) {
  await render();
} else {
  showSignIn();
}
initVersionCheck();
