const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {newChat, readChat, chatFiles, searchChats, codexNames} = require('../src/chat-search.cjs');

const CLAUDE_ID = '11111111-2222-3333-4444-555555555555', CODEX_ID = '019a0000-1111-7222-8333-944444444444';
const lines = rows => rows.map(r => JSON.stringify(r)).join('\n') + '\n';

function homes() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-search-'));
  const claudeHome = path.join(root, 'claude'), codexHome = path.join(root, 'codex');
  const project = path.join(claudeHome, 'projects', '-Users-me-site');
  fs.mkdirSync(path.join(project, CLAUDE_ID, 'subagents'), {recursive: true});
  const claudeFile = path.join(project, CLAUDE_ID + '.jsonl');
  fs.writeFileSync(claudeFile, lines([
    {type: 'user', sessionId: CLAUDE_ID, cwd: '/Users/me/site', timestamp: '2026-11-20T10:00:00Z', message: {role: 'user', content: 'Make the pricing page show yearly plans'}},
    {type: 'user', isMeta: true, sessionId: CLAUDE_ID, timestamp: '2026-11-20T10:00:01Z', message: {role: 'user', content: 'Caveat: hidden meta text'}},
    {type: 'user', sessionId: CLAUDE_ID, timestamp: '2026-11-20T10:00:02Z', message: {role: 'user', content: '<command-name>/clear</command-name>'}},
    {type: 'assistant', sessionId: CLAUDE_ID, timestamp: '2026-11-20T10:00:05Z', message: {role: 'assistant', content: [{type: 'thinking', thinking: 'secret thoughts'}, {type: 'text', text: 'I added a Yearly toggle to the pricing page.'}, {type: 'tool_use', name: 'Edit', input: {x: 'tool input words'}}]}},
    {type: 'user', sessionId: CLAUDE_ID, timestamp: '2026-11-20T10:00:06Z', message: {role: 'user', content: [{type: 'tool_result', content: 'tool output words'}]}},
    {type: 'assistant', isSidechain: true, sessionId: CLAUDE_ID, message: {role: 'assistant', content: [{type: 'text', text: 'sidechain words'}]}},
    {type: 'ai-title', aiTitle: 'Yearly pricing toggle', sessionId: CLAUDE_ID},
  ]));
  fs.writeFileSync(path.join(project, CLAUDE_ID, 'subagents', 'agent-1.jsonl'), lines([{type: 'user', message: {content: 'subagent'}}]));
  const day = path.join(codexHome, 'sessions', '2026', '11', '21'); fs.mkdirSync(day, {recursive: true});
  const codexFile = path.join(day, `rollout-2026-11-21T09-00-00-${CODEX_ID}.jsonl`);
  fs.writeFileSync(codexFile, lines([
    {type: 'session_meta', timestamp: '2026-11-21T09:00:00Z', payload: {id: CODEX_ID, cwd: '/Users/me/api', timestamp: '2026-11-21T09:00:00Z'}},
    {type: 'response_item', timestamp: '2026-11-21T09:00:01Z', payload: {type: 'message', role: 'user', content: [{type: 'input_text', text: '<environment_context>cwd</environment_context>'}]}},
    {type: 'response_item', timestamp: '2026-11-21T09:00:02Z', payload: {type: 'message', role: 'developer', content: [{type: 'input_text', text: 'developer rules'}]}},
    {type: 'response_item', timestamp: '2026-11-21T09:00:02Z', payload: {type: 'message', role: 'user', content: [{type: 'input_text', text: '# AGENTS.md instructions for /Users/me/api'}, {type: 'input_text', text: '<guardian_tool_descriptions>rules</guardian_tool_descriptions>'}]}},
    {type: 'response_item', timestamp: '2026-11-21T09:00:02Z', payload: {type: 'message', role: 'user', content: [{type: 'input_text', text: 'The following is the Codex agent history whose request…'}]}},
    {type: 'response_item', timestamp: '2026-11-21T09:00:03Z', payload: {type: 'message', role: 'user', content: [{type: 'input_text', text: 'Fix the login timeout in the api'}]}},
    {type: 'response_item', timestamp: '2026-11-21T09:00:03Z', payload: {type: 'message', role: 'user', content: [{type: 'input_text', text: '<image name=[Image #1] path="/tmp/a.png">'}, {type: 'input_text', text: '</image>'}]}},
    {type: 'response_item', timestamp: '2026-11-21T09:00:04Z', payload: {type: 'function_call_output', output: 'tool output words'}},
    {type: 'response_item', timestamp: '2026-11-21T09:00:09Z', payload: {type: 'message', role: 'assistant', content: [{type: 'output_text', text: 'The login timeout is now 30 minutes.'}]}},
  ]));
  return {claudeHome, codexHome, claudeFile, codexFile};
}

test('reads a Claude chat: its title, folder, your prompts and the replies, nothing else', () => {
  const h = homes(), chat = newChat('claude', h.claudeFile); readChat(chat);
  assert.equal(chat.id, CLAUDE_ID); assert.equal(chat.cwd, '/Users/me/site'); assert.equal(chat.title, 'Yearly pricing toggle');
  assert.deepEqual(chat.messages.map(m => [m.r, m.t]), [['u', 'Make the pricing page show yearly plans'], ['a', 'I added a Yearly toggle to the pricing page.']]);
  assert.equal(chat.started, Date.parse('2026-11-20T10:00:00Z')); assert.equal(chat.updated, Date.parse('2026-11-20T10:00:06Z'));
});

test('reads a Codex chat without its own instructions or tool output', () => {
  const h = homes(), chat = newChat('codex', h.codexFile); readChat(chat);
  assert.equal(chat.id, CODEX_ID); assert.equal(chat.cwd, '/Users/me/api'); assert.equal(chat.firstPrompt, 'Fix the login timeout in the api');
  assert.deepEqual(chat.messages.map(m => m.r), ['u', 'a']);
});

test('finds the chat files, not subagent chats', () => {
  const h = homes(), files = chatFiles(h);
  assert.deepEqual(files.map(f => [f.provider, path.basename(f.file)]).sort(), [['claude', CLAUDE_ID + '.jsonl'], ['codex', path.basename(h.codexFile)]]);
});

test('reads only the new end of a chat that grew, and waits for a line still being written', () => {
  const h = homes(), chat = newChat('claude', h.claudeFile); let offset = readChat(chat);
  assert.equal(offset, fs.statSync(h.claudeFile).size);
  const more = JSON.stringify({type: 'user', sessionId: CLAUDE_ID, timestamp: '2026-11-20T11:00:00Z', message: {role: 'user', content: 'Now add a monthly discount'}});
  fs.appendFileSync(h.claudeFile, more.slice(0, 40)); offset = readChat(chat, offset);
  assert.equal(chat.messages.length, 2);
  fs.appendFileSync(h.claudeFile, more.slice(40) + '\n'); offset = readChat(chat, offset);
  assert.deepEqual(chat.messages.map(m => m.t).at(-1), 'Now add a monthly discount'); assert.equal(offset, fs.statSync(h.claudeFile).size);
});

test('search: every word must match; the snippet marks the match; tool output is never searched', () => {
  const h = homes(), chats = [newChat('claude', h.claudeFile), newChat('codex', h.codexFile)]; chats.forEach(c => readChat(c));
  const [r] = searchChats(chats, 'Login TIMEOUT');
  assert.equal(r.id, CODEX_ID); assert.equal(r.title, 'Fix the login timeout in the api'); assert.equal(searchChats(chats, 'login timeout').length, 1);
  assert.equal(r.snippet.match.toLowerCase(), 'login timeout');
  const multi = {...chats[1], title: '', firstPrompt: 'Fix the\n\nlogin'}; assert.equal(searchChats([multi], 'login')[0].title, 'Fix the login'); assert.equal(r.snippet.role, 'you');
  assert.deepEqual(searchChats(chats, 'login pricing'), []);
  assert.deepEqual(searchChats(chats, 'tool output'), []); assert.deepEqual(searchChats(chats, 'secret thoughts'), []); assert.deepEqual(searchChats(chats, 'sidechain'), []);
  assert.deepEqual(searchChats(chats, ' '), []);
});

test('search ranks a title match first, then the newest', () => {
  const mk = (id, title, text, updated) => ({provider: 'claude', id, cwd: '/x', title, firstPrompt: '', started: updated, updated, messages: [{r: 'u', t: text}]});
  const chats = [mk('a', 'Old chat', 'deploy the docs', 1), mk('b', 'Newer chat', 'deploy the docs', 5), mk('c', 'Deploy docs', 'something', 2)];
  assert.deepEqual(searchChats(chats, 'deploy docs').map(r => r.id), ['c', 'b', 'a']);
});

test('Codex chats take the name Codex gave them', () => {
  const h = homes(); fs.writeFileSync(path.join(h.codexHome, 'session_index.jsonl'), lines([{id: CODEX_ID, thread_name: 'Login timeout fix'}, {id: 'other', thread_name: ' '}]));
  assert.deepEqual([...codexNames(h.codexHome)], [[CODEX_ID, 'Login timeout fix']]);
});
