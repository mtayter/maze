import { listMazes } from './MazeDB.js?v=4.8.2';

// A dialog listing every maze — name plus owner — with each name a
// pick target. This replaces the native <select> maze pickers: a
// long native menu misfires on some desktop browsers (the retired
// SelectGuard only papered over that) and a dropdown can't show
// who owns what. One picker at a time; it lives inside the calling
// view's element, so a view switch takes it down with the view.
let openPicker = null;

export function openMazePicker({ container, title, current, onPick, signal }) {
  if (openPicker) openPicker();

  const backdrop = document.createElement('div');
  backdrop.className = 'picker-backdrop';
  backdrop.innerHTML = `
    <div class="picker-card" role="dialog" aria-modal="true">
      <div class="picker-head">
        <h2></h2>
        <button class="btn picker-close" type="button" aria-label="Close">✕</button>
      </div>
      <div class="picker-list">Loading…</div>
    </div>`;
  backdrop.querySelector('.picker-card').setAttribute('aria-label', title);
  backdrop.querySelector('h2').textContent = title;
  const list = backdrop.querySelector('.picker-list');
  container.appendChild(backdrop);

  const close = () => {
    backdrop.remove();
    if (openPicker === close) openPicker = null;
  };
  openPicker = close;
  if (signal) {
    signal.addEventListener('abort', () => {
      if (openPicker === close) openPicker = null;
    }, { once: true });
  }

  backdrop.addEventListener('pointerdown', (e) => {
    if (e.target === backdrop) close();
  }, { signal });
  backdrop.querySelector('.picker-close')
    .addEventListener('click', close, { signal });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  }, { signal });

  listMazes().then((mazes) => {
    if (!backdrop.isConnected) return;
    list.textContent = '';
    if (mazes.length === 0) {
      list.textContent = 'No mazes yet.';
      return;
    }
    const renderSection = (label, group, showOwner) => {
      if (group.length === 0) return;
      const head = document.createElement('div');
      head.className = 'picker-section';
      head.textContent = label;
      list.appendChild(head);
      for (const m of group) {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'picker-row' + (m.name === current ? ' current' : '');
        const name = document.createElement('span');
        name.className = 'picker-name';
        name.textContent = m.name;
        row.appendChild(name);
        if (showOwner) {
          const owner = document.createElement('span');
          owner.className = 'picker-owner';
          owner.textContent = m.owner_name || '';
          row.appendChild(owner);
        }
        row.addEventListener('click', () => {
          close();
          onPick(m.name);
        });
        list.appendChild(row);
      }
    };
    renderSection('Your mazes', mazes.filter((m) => m.mine), false);
    renderSection('Other mazes', mazes.filter((m) => !m.mine), true);
  }).catch(() => {
    if (backdrop.isConnected) {
      list.textContent = 'Could not load the maze list.';
    }
  });
}
