// Maze SPA shell: hash router + version check.
//
// Routes: #/play (the game) and #/create (the editor). Views are modules
// with mount(el, shared) / unmount(); every listener a view registers
// uses the AbortSignal it is handed, so unmounting tears the view down
// completely and views can be swapped freely.
//
// The views are independent: each remembers its own loaded maze (and
// the play view even restores your position), so loading a maze in one
// view never changes the other. The only shell-level shared state is
// the editor's dirty flag, so the version check never force-reloads
// over unsaved work.

import { mount as mountPlay, unmount as unmountPlay } from './views/play.js';
import { mount as mountCreate, unmount as unmountCreate } from './views/create.js';

const shared = {
  editorDirty: false,
};

const VIEWS = {
  play: { mount: mountPlay, unmount: unmountPlay, title: 'Do Maze 🌀', nav: 'navPlay' },
  create: { mount: mountCreate, unmount: unmountCreate, title: 'Create Maze ✏️', nav: 'navCreate' },
};

let currentRoute = null;

function routeFromHash() {
  const name = window.location.hash.replace(/^#\/?/, '');
  return VIEWS[name] ? name : 'play';
}

async function render() {
  const route = routeFromHash();
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
await render();
initVersionCheck();
