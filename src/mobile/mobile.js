// Terminator on your phone: same layout as the desktop sidebar (workspaces, goals, priority, rest),
// each terminal opens full screen with its live output, a reply box and the keys a phone keyboard lacks.
import {Terminal} from '@xterm/xterm';
import {FitAddon} from '@xterm/addon-fit';
import {restoreSequence} from '../terminal-modes.cjs';

const $ = s => document.querySelector(s);
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const KEYS = {esc: '\x1b', tab: '\t', shifttab: '\x1b[Z', up: '\x1b[A', down: '\x1b[B', right: '\x1b[C', left: '\x1b[D', enter: '\r', ctrlc: '\x03', 1: '1', 2: '2', 3: '3'};
const STATUS = {running: 'running', attention: 'needs you', done: 'done', ready: 'ready', error: 'error', starting: 'starting', closed: 'closed'};

let token = null;
try { const m = location.hash.match(/[#&]t=([A-Za-z0-9_-]+)/); if (m) { localStorage.setItem('terminator-token', m[1]); history.replaceState(null, '', location.pathname); } token = localStorage.getItem('terminator-token'); } catch {}
let state = {workspaces: [], sessions: [], order: {}, activeWorkspaceId: null};
let shown = null;              // workspace shown on the phone (independent of the Mac's active tab)
let viewing = null, term = null, fit = null, stream = null, toastTimer = null;
try { shown = localStorage.getItem('terminator-workspace'); } catch {}
let fontSize = 11; try { fontSize = Number(localStorage.getItem('terminator-font')) || 11; } catch {}

async function api(path, body) {
  const res = await fetch(path, {method: body ? 'POST' : 'GET', headers: {Authorization: 'Bearer ' + token, ...(body ? {'Content-Type': 'application/json'} : {})}, body: body ? JSON.stringify(body) : undefined, cache: 'no-store'});
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) { showPair(data.error); throw Error(data.error || 'Not paired'); }
  if (!res.ok) throw Error(data.error || 'Request failed');
  return data;
}
function showPair(message) { $('#pair').hidden = false; $('#home').hidden = true; $('#term-view').hidden = true; $('#pair-error').textContent = message || ''; }
function toast(text) { const t = $('#toast'); t.textContent = text; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => t.hidden = true, 4500); try { navigator.vibrate?.(60); } catch {} }
const session = id => state.sessions.find(s => s.id === id);

// ---- live updates (server-sent events) ----
function connect(watch = null) {
  stream?.close();
  let url = '/api/events?t=' + encodeURIComponent(token);
  if (watch) url += `&watch=${encodeURIComponent(watch.id)}&cols=${watch.cols}&rows=${watch.rows}`;
  const es = new EventSource(url); stream = es;
  es.addEventListener('hello', () => { $('#offline').hidden = true; if (!watch) refresh(); });
  es.addEventListener('session', e => { const s = JSON.parse(e.data); const before = session(s.id); upsert(s); notifyChange(before, s); render(); if (viewing === s.id) renderTermHead(); });
  es.addEventListener('workspaces', e => { state.workspaces = JSON.parse(e.data); render(); });
  es.addEventListener('output', e => { const {id, data} = JSON.parse(e.data); if (id === viewing && term) term.write(data); });
  es.onerror = () => { if (stream === es) $('#offline').hidden = false; };
}
function upsert(s) { const i = state.sessions.findIndex(x => x.id === s.id); if (i >= 0) state.sessions[i] = {...state.sessions[i], ...s}; else state.sessions.push(s); }
function notifyChange(before, s) {
  if (!before || s.id === viewing) return;
  if (s.status === 'attention' && before.status !== 'attention') toast(`${s.title}: needs your answer`);
  else if (s.unreadDone && !before.unreadDone) toast(`${s.title}: done`);
}
async function refresh() { try { state = await api('/api/state'); $('#pair').hidden = true; if (!viewing) $('#home').hidden = false; render(); } catch {} }

// ---- home ----
function counts() {
  const all = state.sessions, n = f => all.filter(f).length, box = $('#counts');
  const item = (v, label, cls) => { const e = el('span', 'count ' + cls); e.append(el('i'), el('b', '', String(v)), document.createTextNode(' ' + label)); return e; };
  const waiting = n(s => s.status === 'attention');
  box.replaceChildren(item(n(s => s.status === 'done'), 'done', 'done'), item(n(s => s.status === 'running'), 'running', 'running'), ...(waiting ? [item(waiting, 'waiting', 'waiting')] : []), item(all.length, 'open', 'open'));
}
function render() {
  if (!state.workspaces.length) return;
  if (!state.workspaces.some(w => w.id === shown)) shown = state.activeWorkspaceId || state.workspaces[0].id;
  const tabs = $('#tabs'); tabs.replaceChildren();
  for (const w of state.workspaces) {
    const t = el('button', 'tab' + (w.id === shown ? ' active' : ''), w.title);
    const done = state.sessions.filter(s => s.workspaceId === w.id && s.unreadDone && s.status !== 'running');
    if (done.length) { const dots = el('span', 'tab-dots'); for (const s of done.slice(0, 8)) { const d = el('i', 'tab-dot'); d.style.background = s.color || '#888'; dots.append(d); } if (done.length > 8) dots.append(el('small', '', '+' + (done.length - 8))); t.append(dots); }
    t.onclick = () => { shown = w.id; try { localStorage.setItem('terminator-workspace', w.id); } catch {} render(); };
    tabs.append(t);
  }
  tabs.querySelector('.active')?.scrollIntoView({inline: 'nearest', block: 'nearest'});
  counts();
  const list = $('#list'); list.replaceChildren();
  const w = state.workspaces.find(x => x.id === shown), mine = state.sessions.filter(s => s.workspaceId === shown);
  const goals = (w?.goals || []).filter(g => typeof g.text === 'string' && !g.removedAt);
  if (goals.length) {
    list.append(el('div', 'section', 'Goals'));
    for (const g of goals) {
      const box = el('div', 'goal'); box.append(el('div', 'goal-text', g.text));
      const subs = g.subgoals || [], meta = el('div', 'goal-meta'), bar = el('div', 'bar'), fill = el('i');
      fill.style.width = (g.progress || 0) + '%'; bar.append(fill); meta.append(bar, el('span', '', `${g.progress || 0}%${subs.length ? ` · ${subs.filter(s => s.done).length}/${subs.length}` : ''}`));
      box.append(meta);
      if (subs.length) { const ul = el('ul', 'subgoals'); for (const s of subs) ul.append(el('li', s.done ? 'done' : '', (s.done ? '✓ ' : '○ ') + s.text)); box.append(ul); }
      list.append(box);
    }
  }
  const order = state.order?.[shown] || {}, byId = new Map(mine.map(s => [s.id, s]));
  const priority = [...new Set(order.priority || [])].filter(id => byId.has(id));
  const rest = [...new Set([...(order.rest || []), ...mine.map(s => s.id)])].filter(id => byId.has(id) && !priority.includes(id));
  if (priority.length) { list.append(el('div', 'section', 'Priority')); priority.forEach((id, i) => list.append(row(byId.get(id), i + 1))); }
  list.append(el('div', 'section', priority.length ? 'Rest' : 'Terminals'));
  if (!rest.length && !priority.length) list.append(el('p', 'section', 'No terminals in this workspace.'));
  rest.forEach(id => list.append(row(byId.get(id))));
}
function row(s, number) {
  const r = el('button', 'row' + (s.unreadDone && s.status !== 'running' ? ' unread' : '') + (s.status === 'attention' ? ' attention' : ''));
  r.style.setProperty('--c', s.color || '#888');
  r.append(number ? el('span', 'num', String(number)) : el('span', 'dot'));
  const body = el('div', 'body'), title = el('div', 'title');
  title.append(el('strong', '', s.title), el('span', 'status ' + s.status, STATUS[s.status] || s.status));
  body.append(title);
  if (s.latestPrompt) body.append(el('div', 'prompt', s.latestPrompt.replace(/\s+/g, ' ')));
  const model = [s.model, s.effort].filter(Boolean).join(' · ') + (s.remoteControl ? ' · 📱' : '');
  if (model) body.append(el('div', 'model', model));
  r.append(body);
  r.onclick = () => openTerminal(s.id);
  return r;
}

// ---- terminal ----
// Width the history was written at, for servers that don't send it: Claude's divider lines span the whole terminal.
function recordedWidth(text) { let best = 0; for (const m of text.matchAll(/─{30,}/g)) best = Math.max(best, m[0].length); return best >= 30 && best <= 300 ? best : 0; }
function theme() {
  const dark = matchMedia('(prefers-color-scheme: dark)').matches;
  return dark ? {background: '#232328', foreground: '#e6e6ea', cursor: '#e6e6ea', selectionBackground: '#3a4b6e'}
    : {background: '#ffffff', foreground: '#24272c', cursor: '#34343b', selectionBackground: '#dce4f2', black: '#30343b', red: '#b63d47', green: '#337449', yellow: '#916214', blue: '#315fb0', magenta: '#8651a4', cyan: '#237785', white: '#70757c', brightBlack: '#7d828a', brightWhite: '#90959d'};
}
function renderTermHead() {
  const s = session(viewing); if (!s) return;
  $('#term-view').style.setProperty('--c', s.color || '#888');
  $('#term-title').textContent = s.title;
  $('#term-meta').textContent = [STATUS[s.status] || s.status, s.model, s.remoteControl ? '📱' : ''].filter(Boolean).join(' · ');
  const p = $('#term-prompt'); p.hidden = !s.latestPrompt; p.textContent = s.latestPrompt || '';
  const actions = $('#term-actions'); actions.replaceChildren();
  if (!s.agent && ['ready', 'done', 'error'].includes(s.status)) {
    if (s.resumeAvailable && s.lastSession) actions.append(Object.assign(el('button', '', 'Resume chat'), {onclick: () => api('/api/action', {kind: 'resume', id: s.id}).catch(e => toast(e.message))}));
    actions.append(Object.assign(el('button', '', 'New Claude chat'), {onclick: () => api('/api/action', {kind: 'claude', id: s.id}).catch(e => toast(e.message))}));
  }
  actions.hidden = !actions.childElementCount;
}
async function openTerminal(id) {
  viewing = id; $('#home').hidden = true; $('#term-view').hidden = false; renderTermHead();
  term?.dispose(); $('#term-host').replaceChildren();
  term = new Terminal({fontFamily: '"SF Mono", Menlo, monospace', fontSize, lineHeight: 1.15, scrollback: 5000, disableStdin: true, cursorBlink: false, theme: theme()});
  fit = new FitAddon(); term.loadAddon(fit); term.open($('#term-host')); followViewport(); if (!keyboardOpen()) fit.fit(); term.onScroll(syncBottom); term.onWriteParsed(syncBottom); syncBottom();
  // Replay the history at the width it was written at (the Mac's): Claude/Codex draw with cursor moves that only land right at that width.
  // Then fit to the phone, which re-wraps the lines to the phone's width, like resizing a terminal window.
  try {
    const b = await api('/api/buffer?id=' + encodeURIComponent(id)); if (viewing !== id) return;
    let text = String(b.data || '').slice(-300000); const nl = text.indexOf('\n'); if (nl > 0 && nl < 4000) text = text.slice(nl + 1); // start on a whole line
    const cols = b.cols || recordedWidth(text), room = term.cols;
    // Full-width divider and box lines would wrap into several rows on the phone: shorten them to the phone's width.
    if (cols > room) text = text.replace(new RegExp(`─{${room - 1},}`, 'g'), '─'.repeat(room - 2));
    if (cols && cols !== term.cols) term.resize(Math.max(20, Math.min(300, cols)), Math.max(8, Math.min(200, b.rows || term.rows)));
    // The cut history may no longer hold the moment Claude turned the mouse on: put back the modes it uses (scrolling sends it wheel events).
    await new Promise(r => term.write(text + restoreSequence(b.modes), r)); if (viewing !== id) return;
    if (!keyboardOpen()) fit.fit(); term.scrollToBottom();
  } catch (e) { toast(e.message); }
  // Watching resizes the terminal to the phone; Claude redraws for this size. Leaving gives the Mac its size back.
  connect({id, cols: term.cols, rows: term.rows});
  api('/api/action', {kind: 'read', id}).catch(() => {});
}
// Touch scrolling: xterm 6 does not scroll on touch, so a finger drag scrolls the scrollback (with momentum, like a native list).
function cellHeight() { const rows = $('#term-host .xterm-rows'); return term && rows ? (rows.getBoundingClientRect().height / term.rows) || 16 : 16; }
let drag = null, glide = 0;
// Claude Code draws full-screen (alternate screen, mouse tracking on): there is no scrollback, it scrolls itself on mouse-wheel
// events. Then a swipe sends wheel events (one per WHEEL_ROWS rows of finger travel), batched into one request per frame.
const WHEEL_ROWS = 3; let wheel = '', wheelFrame = 0;
const appScrolls = () => term.modes.mouseTrackingMode !== 'none';
function sendWheel(steps) {
  const code = steps > 0 ? 64 : 65, at = `${Math.ceil(term.cols / 2)};${Math.ceil(term.rows / 2)}`; // 64: wheel up, 65: wheel down (SGR)
  wheel += `\x1b[<${code};${at}M`.repeat(Math.abs(steps));
  wheelFrame ||= requestAnimationFrame(() => { const data = wheel, id = viewing; wheel = ''; wheelFrame = 0; if (data && id) api('/api/input', {id, data}).catch(e => toast(e.message)); });
}
function scrollBy(px) {
  if (!term) return; drag.rest += px; const step = cellHeight() * (appScrolls() ? WHEEL_ROWS : 1), n = Math.trunc(drag.rest / step); if (!n) return;
  drag.rest -= n * step; if (appScrolls()) sendWheel(n); else term.scrollLines(-n);
}
const host = $('#term-host');
host.addEventListener('pointerdown', e => { if (e.pointerType === 'mouse' || !term) return; cancelAnimationFrame(glide); drag = {id: e.pointerId, y: e.clientY, rest: 0, v: 0, t: performance.now()}; try { host.setPointerCapture(e.pointerId); } catch {} });
host.addEventListener('pointermove', e => { if (!drag || e.pointerId !== drag.id) return; e.preventDefault(); const now = performance.now(), dy = e.clientY - drag.y; drag.v = 0.8 * (dy / Math.max(1, now - drag.t)) + 0.2 * drag.v; drag.y = e.clientY; drag.t = now; scrollBy(dy); });
const endDrag = e => { if (!drag || e.pointerId !== drag.id) return; let v = performance.now() - drag.t > 80 ? 0 : drag.v * 16; const d = drag;
  const step = () => { if (Math.abs(v) < 0.5 || !term) { drag = null; return; } drag = d; scrollBy(v); v *= 0.95; glide = requestAnimationFrame(step); }; drag = null; if (v) { drag = d; glide = requestAnimationFrame(step); } };
host.addEventListener('pointerup', endDrag); host.addEventListener('pointercancel', endDrag);
// "↓" shows while you read older output; tap it to jump back to the latest.
function syncBottom() { const b = term?.buffer.active; $('#to-bottom').hidden = !b || b.viewportY >= b.baseY; }
$('#to-bottom').onclick = () => { cancelAnimationFrame(glide); drag = null; term?.scrollToBottom(); syncBottom(); };
// Keyboard: iPhone keeps the page height when the keyboard opens, so the view follows the visible area instead
// (the reply box stays above the keyboard). The terminal keeps its size meanwhile — showing its latest lines — so Claude does not redraw.
const vv = window.visualViewport;
const keyboardOpen = () => !!vv && vv.height < window.innerHeight - 120;
function followViewport() { if (!vv) return; const view = $('#term-view'); view.style.height = vv.height + 'px'; view.style.transform = `translateY(${vv.offsetTop}px)`; document.body.classList.toggle('keyboard', keyboardOpen()); }
vv?.addEventListener('resize', () => { followViewport(); if (term && viewing && !keyboardOpen()) dispatchEvent(new Event('resize')); }); vv?.addEventListener('scroll', followViewport);

function closeTerminal() { viewing = null; term?.dispose(); term = null; $('#term-view').hidden = true; $('#home').hidden = false; connect(); render(); }
$('#back').onclick = closeTerminal;
$('#term-prompt').onclick = () => $('#term-prompt').classList.toggle('open');
$('#term-more').onclick = () => { fontSize = fontSize >= 14 ? 9 : fontSize + 1; try { localStorage.setItem('terminator-font', String(fontSize)); } catch {} toast(`Text size ${fontSize}`); if (viewing) openTerminal(viewing); };
document.querySelectorAll('.keys button').forEach(b => b.onclick = () => { if (viewing) api('/api/input', {id: viewing, data: KEYS[b.dataset.key]}).catch(e => toast(e.message)); });
const message = $('#message');
message.addEventListener('input', () => { message.style.height = 'auto'; message.style.height = Math.min(140, message.scrollHeight) + 'px'; });
message.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('#composer').requestSubmit(); } });
$('#composer').onsubmit = async e => {
  e.preventDefault(); const text = message.value.trim(); if (!text || !viewing) return;
  $('#send').disabled = true;
  try { await api('/api/send', {id: viewing, text}); message.value = ''; message.style.height = ''; } catch (error) { toast(error.message); } finally { $('#send').disabled = false; }
};
addEventListener('resize', () => { followViewport(); if (!term || !viewing || keyboardOpen()) return; clearTimeout(window.__fitTimer); window.__fitTimer = setTimeout(() => { const {cols, rows} = term; fit.fit(); if (term.cols !== cols || term.rows !== rows) connect({id: viewing, cols: term.cols, rows: term.rows}); }, 250); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { refresh(); if (viewing && term) connect({id: viewing, cols: term.cols, rows: term.rows}); else connect(); } });

if (!token) showPair(); else { refresh().then(() => connect()); }
