const test = require('node:test');
const assert = require('node:assert/strict');
const {createModes, trackModes, clearModes, mouseModes, restoreSequence} = require('../src/terminal-modes.cjs');

test('follows the mouse modes a program turns on and off', () => {
  const s = createModes();
  trackModes(s, 'hello\x1b[?1049h\x1b[?1000h\x1b[?1002h\x1b[?1003h\x1b[?1006hscreen');
  assert.deepEqual(mouseModes(s), [1000, 1002, 1003, 1006]);
  trackModes(s, '\x1b[?1003l\x1b[?25l');
  assert.deepEqual(mouseModes(s), [1000, 1002, 1006]);
  trackModes(s, '\x1b[?1000;1002;1006l');
  assert.deepEqual(mouseModes(s), []);
});

test('reads a sequence split across output chunks once', () => {
  const s = createModes();
  trackModes(s, 'text\x1b[?10'); trackModes(s, '00h more');
  assert.deepEqual(mouseModes(s), [1000]);
  trackModes(s, '\x1b[?1000'); trackModes(s, 'l');
  assert.deepEqual(mouseModes(s), []);
  // A sequence already counted is not counted again when the next chunk arrives.
  trackModes(s, '\x1b[?1006h'); trackModes(s, '\x1b[?1006l'); trackModes(s, 'x');
  assert.deepEqual(mouseModes(s), []);
});

test('the shell prompt clears them', () => {
  const s = createModes(); trackModes(s, '\x1b[?1000h\x1b[?1006h'); clearModes(s);
  assert.deepEqual(mouseModes(s), []);
});

test('restoring turns every mouse mode off, then on those in use', () => {
  assert.equal(restoreSequence(), '\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1005l\x1b[?1006l\x1b[?1015l');
  assert.ok(restoreSequence([1000, 1006, 1049]).endsWith('\x1b[?1015l\x1b[?1000h\x1b[?1006h'));
});
