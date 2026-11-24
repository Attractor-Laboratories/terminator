// The mouse modes a full-screen program (Claude Code, vim…) turns on, followed in the program's output.
// Claude Code turns mouse reporting on once, at startup. A terminal replayed from its history (the window loading,
// the phone opening it) may no longer hold that moment, so the screen is put back in the state recorded here;
// otherwise clicks and the wheel would stop reaching the program.
const MOUSE = [1000, 1002, 1003, 1005, 1006, 1015];
const SEQUENCE = /\x1b\[\?([\d;]+)([hl])/g;
const KEEP = 32; // a sequence split across two output chunks is never longer than this

function createModes() { return {mouse: new Set(), tail: ''}; }

function trackModes(state, output) {
  const text = state.tail + output;
  let end = 0;
  for (const m of text.matchAll(SEQUENCE)) {
    for (const n of m[1].split(';').map(Number)) if (MOUSE.includes(n)) m[2] === 'h' ? state.mouse.add(n) : state.mouse.delete(n);
    end = m.index + m[0].length;
  }
  state.tail = text.slice(Math.max(end, text.length - KEEP));
}

// Back at the shell prompt: whatever ran is gone, and so is its use of the mouse.
function clearModes(state) { state.mouse.clear(); state.tail = ''; }

const mouseModes = state => [...state.mouse].sort((a, b) => a - b);

// Turns every mouse mode off, then on again those the program uses.
function restoreSequence(modes = []) {
  return MOUSE.map(n => `\x1b[?${n}l`).join('') + modes.filter(n => MOUSE.includes(n)).map(n => `\x1b[?${n}h`).join('');
}

module.exports = {createModes, trackModes, clearModes, mouseModes, restoreSequence, MOUSE};
