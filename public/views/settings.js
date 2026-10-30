// Settings view: profile summary + avatar color picker.
// The avatar color is saved on the user row (server: POST
// /app/maze/settings) and will identify the player in multiplayer.

import { getUser, setUser, saveSettings } from '../Auth.js?v=4.6.0';

const SWATCHES = [
  '#22c55e', '#ef4444', '#f59e0b', '#eab308',
  '#3b82f6', '#a855f7', '#ec4899', '#14b8a6',
];

let ac = null;
let selected = '#22c55e';

export async function mount(el) {
  ac = new AbortController();
  const signal = ac.signal;
  const user = getUser();
  selected = (user && user.avatar_color) || '#22c55e';

  el.className = 'view-settings';
  el.innerHTML = `
    <div class="settings-card">
      <div class="profile-row">
        ${user && user.picture ? `<img class="profile-pic" src="${user.picture}" alt="" referrerpolicy="no-referrer">` : ''}
        <div>
          <h2 id="settingsName"></h2>
          <p class="muted" id="settingsEmail"></p>
        </div>
      </div>
      <h3>Avatar color</h3>
      <p class="muted">This is the color other players will see you as in multiplayer.</p>
      <div class="swatches" role="radiogroup" aria-label="Avatar color">
        ${SWATCHES.map(c => `<button type="button" class="swatch" data-color="${c}" style="background:${c}" role="radio" aria-checked="${c === selected}" aria-label="${c}"></button>`).join('')}
        <span class="avatar-preview" id="avatarPreview" style="background:${selected}" title="Your color"></span>
      </div>
      <label class="field">Custom
        <input type="color" id="customColor" value="${selected}">
      </label>
      <div class="settings-actions">
        <button class="btn btn-primary" id="saveSettingsBtn" type="button">💾 Save</button>
        <span class="saved-note" id="savedNote" role="status"></span>
      </div>
    </div>
  `;

  document.getElementById('settingsName').textContent = (user && user.name) || 'Player';
  document.getElementById('settingsEmail').textContent = (user && user.email) || '';

  const preview = document.getElementById('avatarPreview');
  const custom = document.getElementById('customColor');
  function choose(color) {
    selected = color;
    preview.style.background = color;
    custom.value = color;
    document.querySelectorAll('.swatch').forEach(s => {
      s.setAttribute('aria-checked', String(s.dataset.color === color));
    });
    document.getElementById('savedNote').textContent = '';
  }
  document.querySelectorAll('.swatch').forEach(swatch => {
    swatch.addEventListener('click', () => choose(swatch.dataset.color), { signal });
  });
  custom.addEventListener('input', () => choose(custom.value), { signal });

  document.getElementById('saveSettingsBtn').addEventListener('click', async () => {
    const note = document.getElementById('savedNote');
    try {
      const updated = await saveSettings(selected);
      setUser(updated);
      note.textContent = 'Saved ✓';
    } catch (err) {
      console.error('Failed to save settings:', err);
      note.textContent = 'Could not save — try again.';
    }
  }, { signal });
}

export function unmount() {
  if (ac) {
    ac.abort();
    ac = null;
  }
}
