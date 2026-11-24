// Chat archive: when a terminal is closed (or its workspace archived), the text of every Claude/Codex
// conversation it held is written to <userData>/archive/<date> <title> (<id>)/ as chat.md, next to copies of
// the original session files. Deleting a terminal from History never deletes its archive.
const fs = require('node:fs'), path = require('node:path');

const SKIP_USER = /^<(command-|local-command-|system-reminder|task-notification|bash-|user-memory)/;
function textOf(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter(b => b && (b.type === 'text' || b.type === 'input_text' || b.type === 'output_text') && typeof b.text === 'string').map(b => b.text).join('\n\n');
}
function toolLine(b) {
  const input = b.input || {};
  const detail = input.command || input.file_path || input.path || input.url || input.pattern || input.query || input.description || '';
  return `▸ ${b.name}${detail ? `: ${String(detail).split('\n')[0].slice(0, 200)}` : ''}`;
}
const stamp = t => { const d = new Date(t); return Number.isFinite(d.getTime()) ? d.toLocaleString('en-GB', {dateStyle: 'medium', timeStyle: 'short'}) : ''; };

// Readable text of a Claude Code transcript: your prompts, Claude's replies, and one line per tool call.
function claudeChat(file) {
  const out = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    let r; try { r = JSON.parse(line); } catch { continue; }
    if (r.isSidechain || r.isMeta) continue;
    if (r.type === 'user' && r.message) {
      if (r.isCompactSummary) { out.push(`*— conversation compacted —*`); continue; }
      const text = textOf(r.message.content).trim();
      if (text && !SKIP_USER.test(text)) out.push(`### You · ${stamp(r.timestamp)}\n\n${text}`);
    } else if (r.type === 'assistant' && Array.isArray(r.message?.content)) {
      const parts = r.message.content.map(b => b.type === 'text' ? b.text?.trim() : b.type === 'tool_use' ? toolLine(b) : '').filter(Boolean);
      if (parts.length) out.push(`### Claude · ${stamp(r.timestamp)}\n\n${parts.join('\n\n')}`);
    }
  }
  return out.join('\n\n');
}
// Readable text of a Codex rollout file.
function codexChat(file) {
  const out = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    let r; try { r = JSON.parse(line); } catch { continue; }
    const p = r.payload;
    if (r.type !== 'response_item' || p?.type !== 'message' || !['user', 'assistant'].includes(p.role)) continue;
    const text = textOf(p.content).trim();
    if (!text || (p.role === 'user' && /^<(environment_context|user_instructions|permissions)/.test(text))) continue;
    out.push(`### ${p.role === 'user' ? 'You' : 'Codex'} · ${stamp(r.timestamp)}\n\n${text}`);
  }
  return out.join('\n\n');
}

function findClaude(record, claudeHome) {
  if (record.transcript && fs.existsSync(record.transcript)) return record.transcript;
  try { for (const d of fs.readdirSync(path.join(claudeHome, 'projects'))) { const f = path.join(claudeHome, 'projects', d, record.id + '.jsonl'); if (fs.existsSync(f)) return f; } } catch {}
  return null;
}
function findCodex(record, codexHome) {
  const root = path.join(codexHome, 'sessions');
  const walk = (dir, depth) => { let entries; try { entries = fs.readdirSync(dir, {withFileTypes: true}); } catch { return null; }
    for (const e of entries.sort((a, b) => b.name.localeCompare(a.name))) { const p = path.join(dir, e.name);
      if (e.isDirectory() && depth < 3) { const hit = walk(p, depth + 1); if (hit) return hit; } else if (e.isFile() && e.name.endsWith(record.id + '.jsonl')) return p; }
    return null; };
  return walk(root, 0);
}
const safeName = s => String(s || 'Terminal').replace(/[\/\\:*?"<>|\x00-\x1f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'Terminal';
function folderStamp(t) { const d = new Date(t), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}${p(d.getMinutes())}`; }

// Writes the archive for a closed-terminal record and returns its folder (null when there is nothing to keep).
function archiveChat(record, {root, claudeHome, codexHome, backupDir, now = Date.now()}) {
  const sessions = [...new Map([...(record.sessionHistory || []), ...(record.lastSession ? [record.lastSession] : [])]
    .filter(s => s && typeof s.id === 'string' && ['claude', 'codex'].includes(s.provider)).map(s => [s.provider + ':' + s.id, s])).values()];
  const dir = path.join(root, `${folderStamp(record.closedAt || now)} ${safeName(record.title)} (${String(record.archiveId || record.id).slice(0, 8)})`);
  const sections = [], copied = [];
  for (const s of sessions.reverse()) { // oldest first
    let file = s.provider === 'claude' ? findClaude(s, claudeHome) : findCodex(s, codexHome);
    if (!file && backupDir) { const b = path.join(backupDir, s.id + '.jsonl'); if (fs.existsSync(b)) file = b; }
    if (!file) { sections.push(`## ${s.provider === 'claude' ? 'Claude' : 'Codex'} session ${s.id}\n\n*The session file no longer exists.*`); continue; }
    fs.mkdirSync(path.join(dir, 'sessions'), {recursive: true});
    fs.copyFileSync(file, path.join(dir, 'sessions', `${s.provider}-${s.id}.jsonl`)); copied.push(s.id);
    let text = ''; try { text = s.provider === 'claude' ? claudeChat(file) : codexChat(file); } catch {}
    sections.push(`## ${s.provider === 'claude' ? 'Claude' : 'Codex'} session ${s.id}\n\nFolder: ${s.cwd || record.cwd || ''}\n\n${text || '*No messages.*'}`);
  }
  if (!sections.length && !record.latestPrompt) return null;
  fs.mkdirSync(dir, {recursive: true});
  const head = [`# ${record.title || 'Terminal'}`, '', `Closed ${stamp(record.closedAt || now)} · folder ${record.cwd || ''}`, '',
    'Archived by Terminator. The original session files are in sessions/; resume one with `claude --resume <id>` (or `codex resume <id>`) while its file still exists in Claude/Codex.', ''];
  if (!sections.length) head.push('## Last prompt', '', record.latestPrompt, '');
  fs.writeFileSync(path.join(dir, 'chat.md'), [...head, ...sections].join('\n') + '\n');
  fs.writeFileSync(path.join(dir, 'info.json'), JSON.stringify({title: record.title, cwd: record.cwd, closedAt: record.closedAt, terminalId: record.id, archiveId: record.archiveId, sessions, copied}, null, 1));
  return dir;
}
module.exports = {archiveChat, claudeChat, codexChat};
