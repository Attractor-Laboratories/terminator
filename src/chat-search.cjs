// Chat search: the text of every Claude and Codex chat (your prompts and the replies, not tool output), and a search
// over it. The worker (chat-search-worker.cjs) keeps the index; this module only reads chat files and searches.
const fs = require('node:fs');
const path = require('node:path');
const {cleanPrompt} = require('./prompt-text.cjs');

const MAX_MESSAGE = 4000;     // characters kept per message
const MAX_CHAT = 400000;      // characters kept per chat
const MAX_LINE = 2000000;     // longer lines are tool output or images, never a prompt worth searching

function newChat(provider, file) {
  return {provider, file, id: null, cwd: null, title: '', firstPrompt: '', started: 0, updated: 0, size: 0, messages: []};
}

function addMessage(chat, role, text, at) {
  text = (role === 'u' ? cleanPrompt(text) : String(text || '')).trim();
  if (!text) return;
  if (role === 'u' && !chat.firstPrompt) chat.firstPrompt = text.slice(0, 200);
  if (chat.size >= MAX_CHAT) return;
  const t = text.slice(0, MAX_MESSAGE);
  chat.messages.push({r: role, t, at: at || 0});
  chat.size += t.length;
}

const time = value => { const n = typeof value === 'number' ? value : Date.parse(value); return Number.isFinite(n) ? n : 0; };

// One line of a Claude chat file (~/.claude/projects/<folder>/<id>.jsonl).
function readClaudeLine(chat, v) {
  if (v.sessionId && !chat.id) chat.id = v.sessionId;
  if (typeof v.cwd === 'string' && !chat.cwd) chat.cwd = v.cwd;
  if (v.type === 'ai-title' && typeof v.aiTitle === 'string') chat.title = v.aiTitle;
  if (v.type === 'custom-title' && typeof v.customTitle === 'string') chat.title = v.customTitle;
  if (v.isSidechain || v.isMeta || (v.type !== 'user' && v.type !== 'assistant')) return;
  const at = time(v.timestamp); if (at) { chat.started ||= at; chat.updated = Math.max(chat.updated, at); }
  const content = v.message?.content;
  if (v.type === 'user') {
    if (typeof content === 'string') addMessage(chat, 'u', content, at);
    else if (Array.isArray(content)) for (const c of content) if (c?.type === 'text') addMessage(chat, 'u', c.text, at);
  } else if (Array.isArray(content)) for (const c of content) if (c?.type === 'text') addMessage(chat, 'a', c.text, at);
}

// Codex wraps its own instructions as user messages; they are not your prompts.
// Codex sends its own context, instructions and handoffs as user messages (each one a tagged block); they are not
// your prompts. Images you attach are kept out of the text.
const codexContext = text => /^\s*<(?!image\b)[a-z][\w-]*[\s>]/i.test(text) || /^\s*(# AGENTS\.md instructions|The following is the Codex agent history)/.test(text);
const codexPrompt = text => text.replace(/<image\b[^>]*>|<\/image>/gi, '');

// One line of a Codex chat file (~/.codex/sessions/YYYY/MM/DD/rollout-…-<id>.jsonl).
function readCodexLine(chat, v) {
  const p = v.payload || {};
  if (v.type === 'session_meta') { chat.id ||= p.id || p.session_id || null; if (typeof p.cwd === 'string') chat.cwd ||= p.cwd; chat.started ||= time(p.timestamp || v.timestamp); return; }
  if (v.type === 'event_msg' && p.type === 'thread_name_updated' && typeof p.thread_name === 'string') { chat.title = p.thread_name; return; }
  if (v.type !== 'response_item' || p.type !== 'message' || !['user', 'assistant'].includes(p.role)) return;
  const at = time(v.timestamp); if (at) { chat.started ||= at; chat.updated = Math.max(chat.updated, at); }
  for (const c of p.content || []) {
    const text = c?.text; if (typeof text !== 'string') continue;
    if (p.role === 'user' && c.type === 'input_text' && !codexContext(text)) addMessage(chat, 'u', codexPrompt(text), at);
    if (p.role === 'assistant' && c.type === 'output_text') addMessage(chat, 'a', text, at);
  }
}

// Reads a chat file from `offset` on (0: the whole file), adding to `chat`. Returns the offset read up to: only whole
// lines count, so a line still being written is read next time.
function readChat(chat, offset = 0) {
  const read = chat.provider === 'claude' ? readClaudeLine : readCodexLine;
  let fd; try {
    fd = fs.openSync(chat.file, 'r'); const size = fs.fstatSync(fd).size; const chunk = Buffer.alloc(1 << 20); let pos = offset, rest = Buffer.alloc(0);
    while (pos < size) {
      const n = fs.readSync(fd, chunk, 0, Math.min(chunk.length, size - pos), pos); if (n <= 0) break; pos += n;
      let buf = rest.length ? Buffer.concat([rest, chunk.subarray(0, n)]) : chunk.subarray(0, n), start = 0, nl;
      while ((nl = buf.indexOf(10, start)) !== -1) {
        if (nl - start < MAX_LINE) { try { read(chat, JSON.parse(buf.toString('utf8', start, nl))); } catch {} }
        start = nl + 1;
      }
      rest = Buffer.from(buf.subarray(start));
      if (rest.length > MAX_LINE) rest = Buffer.alloc(0), offset = pos; // a huge line: skip it
      else offset = pos - rest.length;
    }
  } catch {} finally { if (fd !== undefined) fs.closeSync(fd); }
  if (!chat.id) { const m = path.basename(chat.file).match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i); if (m) chat.id = m[1]; }
  return offset;
}

// Every chat file: Claude's top-level chats per folder (not subagents), and Codex's sessions by date.
function chatFiles({claudeHome, codexHome}) {
  const files = [];
  const list = dir => { try { return fs.readdirSync(dir, {withFileTypes: true}); } catch { return []; } };
  for (const d of list(path.join(claudeHome, 'projects'))) if (d.isDirectory())
    for (const f of list(path.join(claudeHome, 'projects', d.name))) if (f.isFile() && f.name.endsWith('.jsonl')) files.push({provider: 'claude', file: path.join(claudeHome, 'projects', d.name, f.name)});
  const walk = (dir, depth) => { for (const d of list(dir)) { const p = path.join(dir, d.name); if (d.isDirectory() && depth < 3) walk(p, depth + 1); else if (d.isFile() && d.name.endsWith('.jsonl')) files.push({provider: 'codex', file: p}); } };
  walk(path.join(codexHome, 'sessions'), 0);
  return files;
}

const words = query => [...new Set(String(query || '').toLowerCase().split(/\s+/).filter(w => w.length > 0))].slice(0, 8);
const titleOf = chat => (chat.title || chat.firstPrompt || 'Untitled chat').replace(/\s+/g, ' ').trim().slice(0, 160);

// A piece of text around the first match, cut on word boundaries, with the matched part marked.
function snippet(text, at, length, width = 70) {
  let start = Math.max(0, at - width), end = Math.min(text.length, at + length + width * 2);
  if (start > 0) { const s = text.lastIndexOf(' ', at); start = s > start ? text.indexOf(' ', start) + 1 : start; }
  const flat = s => s.replace(/\s+/g, ' ');
  return {before: (start > 0 ? '…' : '') + flat(text.slice(start, at)).trimStart(), match: flat(text.slice(at, at + length)), after: flat(text.slice(at + length, end)).trimEnd() + (end < text.length ? '…' : '')};
}

// Chats holding every word of the query (in the title or any message). Ranked: the whole query in the title, every
// word in the title, then more matching messages, then the newest.
function searchChats(chats, query, limit = 40) {
  const ws = words(query); if (!ws.length) return [];
  const phrase = ws.join(' '), out = [];
  for (const chat of chats) {
    if (!chat.id || (!chat.messages.length && !chat.title)) continue;
    const title = titleOf(chat), lowTitle = title.toLowerCase();
    const lows = chat.messages.map(m => m.t.toLowerCase());
    if (!ws.every(w => lowTitle.includes(w) || lows.some(t => t.includes(w)))) continue;
    let hits = 0, best = null;
    lows.forEach((t, i) => {
      const found = ws.filter(w => t.includes(w)); if (!found.length) return; hits++;
      // The best message to show: the whole query, else every word, else the most (and longest) words.
      const p = t.indexOf(phrase), kind = p !== -1 ? 3 : found.length === ws.length ? 2 : 1, score = kind * 1000 + found.join('').length;
      if (!best || score > best.score) { const w = p !== -1 ? phrase : found.sort((a, b) => b.length - a.length)[0]; best = {score, kind, i, at: p !== -1 ? p : t.indexOf(w), length: w.length}; }
    });
    const inTitle = lowTitle.includes(phrase) ? 2 : ws.every(w => lowTitle.includes(w)) ? 1 : 0;
    const m = best && chat.messages[best.i];
    out.push({provider: chat.provider, id: chat.id, cwd: chat.cwd, title, updated: chat.updated || chat.started, hits, rank: [inTitle, best?.kind || 0, hits],
      snippet: m ? {...snippet(m.t, best.at, best.length), role: m.r === 'u' ? 'you' : chat.provider === 'codex' ? 'Codex' : 'Claude'} : null});
  }
  out.sort((a, b) => b.rank[0] - a.rank[0] || b.rank[1] - a.rank[1] || Math.min(b.hits, 5) - Math.min(a.hits, 5) || b.updated - a.updated);
  return out.slice(0, limit).map(({rank, ...r}) => r);
}

// The names Codex gives its chats (~/.codex/session_index.jsonl), by chat id.
function codexNames(codexHome) {
  const names = new Map();
  try { for (const line of fs.readFileSync(path.join(codexHome, 'session_index.jsonl'), 'utf8').split('\n')) { try { const v = JSON.parse(line); if (v.id && typeof v.thread_name === 'string' && v.thread_name.trim()) names.set(v.id, v.thread_name.trim()); } catch {} } } catch {}
  return names;
}

module.exports = {codexNames, newChat, readChat, chatFiles, searchChats, snippet, words, MAX_MESSAGE};
