// Native <select> menus on some desktop browsers (Chrome on Linux
// in particular) can turn the opening press into an instant pick:
// the menu opens on mousedown, and the same press's mouseup lands
// on an item — firing change for whatever happened to be under the
// cursor. A scrollable ancestor (the editor's sidebar rail) throws
// the menu's aim off by a few rows, so the "pick" is essentially
// random. A genuine pick takes longer than a single press, so this
// wrapper swallows a change that lands within 250 ms of the
// mousedown that opened the menu and restores the previous value.
// Keyboard and touch pickers never send that mousedown, so they
// pass straight through.
export function guardSelect(select, onChange, signal) {
  let pressAt = 0;
  let prevValue = select.value;
  select.addEventListener('mousedown', () => {
    pressAt = Date.now();
    prevValue = select.value;
  }, { signal });
  select.addEventListener('change', (event) => {
    if (Date.now() - pressAt < 250) {
      select.value = prevValue;
      return;
    }
    onChange(event);
  }, { signal });
}
