// What a terminal worked on and which tests it ran, read from its Claude transcripts (no AI):
// - folders: every folder Claude worked in (each transcript record carries the current folder), with the last time;
// - runs: every test command Claude ran (npm test, node --test, pytest, vitest, jest, playwright, go, cargo…),
//   the folder it ran in, and the passed/failed/skipped counts read from its output.
// Files are read incrementally: only bytes appended since the last scan are parsed.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');

const TEST_COMMAND = /\b(?:(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test(?::[\w:-]+)?|npx\s+(?:vitest|jest|playwright\s+test)|vitest(?:\s+run)?|jest|pytest|python\d?(?:\.\d+)?\s+-m\s+(?:pytest|unittest)|node\s+--test|go\s+test|cargo\s+test|playwright\s+test|deno\s+test)\b/;

// Pass/fail counts from the usual test-runner summaries. Returns {passed, failed, skipped} or null when none found.
function testCounts(text) {
  const t = String(text || '');
  const last = (re) => { let m, v = null; const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'); while ((m = g.exec(t))) v = m; return v; };
  const num = (re) => { const m = last(re); return m ? Number(m[1]) : null; };
  // node --test: "ℹ pass 74" / "ℹ fail 0" / "ℹ skipped 1"  (also "# pass 74" in TAP output)
  let passed = num(/^[ℹ#]\s*pass\s+(\d+)/m), failed = num(/^[ℹ#]\s*fail\s+(\d+)/m);
  if (passed !== null || failed !== null) return {passed: passed || 0, failed: failed || 0, skipped: num(/^[ℹ#]\s*skipped\s+(\d+)/m) || 0};
  // jest: "Tests:       1 failed, 11 passed, 12 total"
  let m = last(/Tests:\s+([^\n]*\d+ total)/);
  if (m) return {passed: Number(/(\d+) passed/.exec(m[1])?.[1] || 0), failed: Number(/(\d+) failed/.exec(m[1])?.[1] || 0), skipped: Number(/(\d+) skipped/.exec(m[1])?.[1] || 0)};
  // vitest: "Tests  1 failed | 11 passed (12)"
  m = last(/^\s*Tests\s+([^\n]*\(\d+\))/m);
  if (m) return {passed: Number(/(\d+) passed/.exec(m[1])?.[1] || 0), failed: Number(/(\d+) failed/.exec(m[1])?.[1] || 0), skipped: Number(/(\d+) skipped/.exec(m[1])?.[1] || 0)};
  // cargo: "test result: ok. 12 passed; 0 failed; 1 ignored"
  m = last(/test result: \w+\. (\d+) passed; (\d+) failed(?:; (\d+) ignored)?/);
  if (m) return {passed: Number(m[1]), failed: Number(m[2]), skipped: Number(m[3] || 0)};
  // pytest: "==== 5 passed, 1 failed, 2 skipped in 0.12s ====" (also "1 error")
  m = last(/=+ ([^=\n]*\b(?:passed|failed|error|errors)\b[^=\n]*) in [\d.]+s/);
  if (m) return {passed: Number(/(\d+) passed/.exec(m[1])?.[1] || 0), failed: Number(/(\d+) failed/.exec(m[1])?.[1] || 0) + Number(/(\d+) errors?/.exec(m[1])?.[1] || 0), skipped: Number(/(\d+) skipped/.exec(m[1])?.[1] || 0)};
  // unittest: "Ran 12 tests in 0.1s" + "OK" / "FAILED (failures=2, errors=1)"
  m = last(/Ran (\d+) tests? in/);
  if (m) { const f = last(/FAILED \(([^)]*)\)/); const bad = f ? Number(/failures=(\d+)/.exec(f[1])?.[1] || 0) + Number(/errors=(\d+)/.exec(f[1])?.[1] || 0) : 0; const skipped = f ? Number(/skipped=(\d+)/.exec(f[1])?.[1] || 0) : 0; return {passed: Number(m[1]) - bad - skipped, failed: bad, skipped}; }
  // playwright: "  5 passed (3.2s)" and "  1 failed"
  const pw = num(/^\s+(\d+) passed \(/m);
  if (pw !== null) return {passed: pw, failed: num(/^\s+(\d+) failed$/m) || 0, skipped: num(/^\s+(\d+) skipped$/m) || 0};
  // go: count "--- PASS" / "--- FAIL" (only with -v); otherwise unknown
  const goPass = (t.match(/^\s*--- PASS/gm) || []).length, goFail = (t.match(/^\s*--- FAIL/gm) || []).length;
  if (goPass || goFail) return {passed: goPass, failed: goFail, skipped: (t.match(/^\s*--- SKIP/gm) || []).length};
  return null;
}

// Folder a command's test step ran in: the last `cd <dir>` before the test command, resolved from the record's folder.
function commandFolder(command, cwd) {
  const at = TEST_COMMAND.exec(command)?.index ?? command.length;
  const before = command.slice(0, at);
  let dir = cwd || os.homedir(), m;
  const re = /(?:^|[;&|(]\s*|\n\s*)cd\s+("([^"]+)"|'([^']+)'|([^\s;&|)]+))/g;
  while ((m = re.exec(before))) {
    let target = m[2] || m[3] || m[4] || '';
    if (/[$`]/.test(target)) continue; // variables: can't resolve
    if (target === '~' || target.startsWith('~/')) target = path.join(os.homedir(), target.slice(1));
    dir = path.resolve(dir, target);
  }
  return dir;
}
const textOf = content => typeof content === 'string' ? content : Array.isArray(content) ? content.map(c => typeof c === 'string' ? c : c?.type === 'text' ? c.text || '' : '').join('\n') : '';

const cache = new Map(); // file → {size, mtime, offset, pending, folders: Map(dir → lastAt), runs: [], open: Map(id → run)}
function scanTranscript(file) {
  let stat; try { stat = fs.statSync(file); } catch { return null; }
  let c = cache.get(file);
  if (c && c.size === stat.size && c.mtime === stat.mtimeMs) return c;
  if (!c || stat.size < c.offset) c = {size: 0, mtime: 0, offset: 0, pending: '', folders: new Map(), runs: [], open: new Map()};
  const fd = fs.openSync(file, 'r');
  try {
    const bytes = Buffer.alloc(stat.size - c.offset); fs.readSync(fd, bytes, 0, bytes.length, c.offset);
    const text = c.pending + bytes.toString('utf8'); const end = text.lastIndexOf('\n');
    c.pending = end < 0 ? text : text.slice(end + 1); c.offset = stat.size; c.size = stat.size; c.mtime = stat.mtimeMs;
    for (const line of (end < 0 ? '' : text.slice(0, end)).split('\n')) {
      if (!line || (line.indexOf('"cwd"') < 0 && line.indexOf('tool_') < 0)) continue;
      let r; try { r = JSON.parse(line); } catch { continue; }
      if (r.isSidechain) continue;
      const at = Date.parse(r.timestamp) || null;
      if (typeof r.cwd === 'string' && at && (r.type === 'assistant' || r.type === 'user')) { if ((c.folders.get(r.cwd) || 0) < at) c.folders.set(r.cwd, at); }
      const content = r.message?.content; if (!Array.isArray(content)) continue;
      for (const item of content) {
        if (item?.type === 'tool_use' && item.name === 'Bash' && typeof item.input?.command === 'string' && TEST_COMMAND.test(item.input.command)) {
          const command = item.input.command;
          c.open.set(item.id, {at, folder: commandFolder(command, r.cwd), command: command.split('\n')[0].slice(0, 300)});
        } else if (item?.type === 'tool_result' && c.open.has(item.tool_use_id)) {
          const run = c.open.get(item.tool_use_id); c.open.delete(item.tool_use_id);
          const counts = testCounts(textOf(item.content));
          if (!counts) continue; // e.g. a grep that only mentions "npm test", or output piped away
          c.runs.push({...run, ...counts, ok: counts.failed === 0 && !item.is_error});
          if (run.folder && run.at && (c.folders.get(run.folder) || 0) < run.at) c.folders.set(run.folder, run.at);
        }
      }
    }
  } finally { fs.closeSync(fd); }
  if (c.runs.length > 2000) c.runs = c.runs.slice(-2000);
  cache.set(file, c);
  return c;
}

module.exports = {scanTranscript, testCounts, commandFolder, TEST_COMMAND};
