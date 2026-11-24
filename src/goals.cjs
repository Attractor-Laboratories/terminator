// Goals, subgoals and the hidden per-terminal reminder.
// A goal is attached to terminals (terminalIds; older records used a single terminalId).
// A subgoal always inherits its parent's terminals and may be attached to extra terminals of its own.
const crypto = require('node:crypto');

const MAX_SUBGOALS = 60, MAX_SUBGOAL_TEXT = 500;
const ids = list => [...new Set(Array.isArray(list) ? list : [])].filter(id => typeof id === 'string');
function goalTerminals(g) { return [...new Set([...ids(g.terminalIds), ...(g.terminalId ? [g.terminalId] : [])])].filter(id => typeof id === 'string'); }
function subgoalTerminals(goal, sub) { return [...new Set([...goalTerminals(goal), ...ids(sub.terminalIds)])]; }
function subgoals(goal) { return Array.isArray(goal.subgoals) ? goal.subgoals : []; }
function cleanText(text) {
  if (typeof text !== 'string') throw Error('Write a subgoal.');
  const value = text.replace(/\s+/g, ' ').trim();
  if (!value || value.length > MAX_SUBGOAL_TEXT || /[\x00-\x08\x0b-\x1f\x7f]/.test(text)) throw Error(`Write a subgoal of up to ${MAX_SUBGOAL_TEXT} characters.`);
  return value;
}
const same = (a, b) => a.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim() === b.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

// Returns the subgoal (existing one when the text duplicates an open subgoal).
function addSubgoal(goal, text, {source = 'user', terminalId = null, now = Date.now()} = {}) {
  const value = cleanText(text), list = subgoals(goal);
  const existing = list.find(s => same(s.text, value));
  if (existing) return existing;
  if (list.length >= MAX_SUBGOALS) throw Error('This goal has too many subgoals.');
  const sub = {id: crypto.randomUUID().slice(0, 8), text: value, createdAt: now, done: false, source, terminalIds: []};
  // A terminal that only works on a subgoal of this goal keeps seeing what it adds.
  if (terminalId && !goalTerminals(goal).includes(terminalId)) sub.terminalIds.push(terminalId);
  goal.subgoals = [...list, sub];
  return sub;
}
function updateSubgoal(goal, id, patch) {
  const list = subgoals(goal), sub = list.find(s => s.id === id);
  if (!sub) throw Error('Subgoal unavailable.');
  if (patch.remove) { goal.subgoals = list.filter(s => s !== sub); return null; }
  if (patch.text !== undefined) sub.text = cleanText(patch.text);
  if (patch.done !== undefined) { sub.done = !!patch.done; if (sub.done) sub.doneAt = Date.now(); else delete sub.doneAt; }
  if (patch.toggleTerminal) {
    const t = patch.toggleTerminal, own = ids(sub.terminalIds);
    sub.terminalIds = own.includes(t) ? own.filter(x => x !== t) : [...own, t];
  }
  return sub;
}

// Goals relevant to a terminal: attached directly, or through one of their subgoals.
function goalsForTerminal(workspaces, terminalId) {
  const result = [];
  for (const w of workspaces || []) for (const g of w.goals || []) {
    if (typeof g.text !== 'string') continue;
    const direct = goalTerminals(g).includes(terminalId);
    const assigned = subgoals(g).filter(s => ids(s.terminalIds).includes(terminalId));
    if (direct || assigned.length) result.push({goal: g, direct, assigned: new Set(assigned.map(s => s.id))});
  }
  return result;
}
function terminalsWithGoals(workspaces) {
  const set = new Set();
  for (const w of workspaces || []) for (const g of w.goals || []) { goalTerminals(g).forEach(id => set.add(id)); subgoals(g).forEach(s => ids(s.terminalIds).forEach(id => set.add(id))); }
  return set;
}
function localDate(time) { const d = new Date(time); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
const command = 'ELECTRON_RUN_AS_NODE=1 "$TS_NODE" "$TS_INTEGRATION/goal.cjs"';
function goalReminder(entries) {
  if (!entries.length) return '';
  const blocks = entries.map(({goal: g, direct, assigned}) => {
    const subs = subgoals(g);
    const lines = [`Goal ${g.id} (set ${localDate(g.createdAt || Date.now())}${g.progress ? `, ${g.progress}% done` : ''}):`, g.text];
    if (!direct) lines.push('(This terminal works on the subgoals marked ← of this goal.)');
    lines.push(subs.length ? 'Subgoals:' : 'Subgoals: none yet.');
    for (const s of subs) lines.push(`- [${s.done ? 'x' : ' '}] ${s.id}: ${s.text}${assigned.has(s.id) ? '  ←' : ''}`);
    return lines.join('\n');
  });
  return [
    `Reminder: this terminal is working toward ${entries.length === 1 ? 'this goal' : 'these goals'}. Keep every answer in service of it.`,
    ...blocks,
    `Keep the subgoals current as we talk. When a concrete, distinct subtask of a goal becomes clear (from what the user asks, from reading the code or tasks, or from your own plan), add it; when one is finished, mark it done. Run these in the shell without asking, and do not mention them unless asked:\n  ${command} add <goal id> "<short subgoal>"\n  ${command} done <subgoal id>\nDo not add duplicates of the subgoals listed above.`,
  ].join('\n\n');
}
module.exports = {goalTerminals, subgoalTerminals, subgoals, addSubgoal, updateSubgoal, goalsForTerminal, terminalsWithGoals, goalReminder, localDate, cleanText, MAX_SUBGOALS};
