// Keeps the chat index for the search bar off the main process: reads every Claude and Codex chat once, saves the
// result to disk, then reads only what changed (the new end of a chat that grew). Answers searches while it reads.
const {parentPort, workerData} = require('node:worker_threads');
const fs = require('node:fs');
const {newChat, readChat, chatFiles, searchChats, codexNames} = require('./chat-search.cjs');

const VERSION = 2;
const {claudeHome, codexHome, cacheFile} = workerData;
const index = new Map(); // file -> {chat, offset, mtime}
let scanning = null, lastScan = 0, dirty = false, progress = {done: 0, total: 0};

try {
  const saved = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
  if (saved.version === VERSION) for (const e of saved.chats || []) if (e?.chat?.file) index.set(e.chat.file, e);
} catch {}

function save() {
  if (!dirty) return; dirty = false;
  try { const tmp = cacheFile + '.tmp'; fs.writeFileSync(tmp, JSON.stringify({version: VERSION, chats: [...index.values()]})); fs.renameSync(tmp, cacheFile); } catch {}
}

const pause = () => new Promise(resolve => setImmediate(resolve));

async function scan() {
  const files = chatFiles({claudeHome, codexHome}), seen = new Set();
  progress = {done: 0, total: files.length};
  for (const {provider, file} of files) {
    seen.add(file);
    let stat; try { stat = fs.statSync(file); } catch { progress.done++; continue; }
    const e = index.get(file);
    if (!e || stat.size < e.offset || e.chat.provider !== provider) {
      const chat = newChat(provider, file); index.set(file, {chat, offset: readChat(chat, 0), mtime: stat.mtimeMs}); dirty = true;
    } else if (stat.size > e.offset || stat.mtimeMs !== e.mtime) {
      e.offset = readChat(e.chat, e.offset); e.mtime = stat.mtimeMs; dirty = true;
    }
    progress.done++;
    await pause(); // let searches in between
  }
  for (const file of index.keys()) if (!seen.has(file)) { index.delete(file); dirty = true; }
  const names = codexNames(codexHome);
  for (const e of index.values()) if (e.chat.provider === 'codex') { const name = names.get(e.chat.id); if (name && e.chat.title !== name) { e.chat.title = name; dirty = true; } }
  lastScan = Date.now(); save();
}

function refresh() {
  if (!scanning && Date.now() - lastScan > 15000) scanning = scan().catch(() => {}).finally(() => { scanning = null; });
  return scanning;
}

parentPort.on('message', async ({id, query}) => {
  refresh();
  const chats = [...index.values()].map(e => e.chat);
  parentPort.postMessage({id, results: searchChats(chats, query), indexing: scanning ? {...progress} : null, chats: chats.length});
});

refresh();
