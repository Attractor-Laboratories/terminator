// Git view data: which repos your terminals work in, their branches and worktrees, how each branch stands against
// main and GitHub, and the pull requests. Plain `git` and `gh` commands only — no AI involved.
const {execFile} = require('node:child_process');
const fs = require('node:fs'), path = require('node:path');

const GIT_CANDIDATES = ['/usr/bin/git', '/opt/homebrew/bin/git', '/usr/local/bin/git'];
const GH_CANDIDATES = ['/opt/homebrew/bin/gh', '/usr/local/bin/gh', '/usr/bin/gh'];
const firstExisting = list => list.find(p => { try { fs.accessSync(p, fs.constants.X_OK); return true; } catch { return false; } }) || null;

function run(bin, args, {cwd, timeout = 20000} = {}) {
  return new Promise(resolve => {
    execFile(bin, args, {cwd, timeout, maxBuffer: 16 * 1024 * 1024, env: {...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', GH_PROMPT_DISABLED: '1', NO_COLOR: '1'}},
      (error, stdout, stderr) => resolve({ok: !error, out: String(stdout || ''), err: String(stderr || (error && error.message) || '')}));
  });
}
// Run tasks with at most `limit` at a time.
async function pool(items, limit, fn) {
  const results = new Array(items.length); let next = 0;
  await Promise.all(Array.from({length: Math.min(limit, items.length)}, async () => { while (next < items.length) { const i = next++; results[i] = await fn(items[i], i); } }));
  return results;
}

// "https://github.com/owner/repo.git", "git@github.com:owner/repo" → "owner/repo"
function githubSlug(url) {
  const m = /github\.com[/:]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(String(url || '').trim());
  return m ? `${m[1]}/${m[2]}` : null;
}
// `git worktree list --porcelain` → [{path, branch|null, head, detached}]
function parseWorktrees(text) {
  const list = []; let cur = null;
  for (const line of text.split('\n')) {
    if (line.startsWith('worktree ')) { cur = {path: line.slice(9), branch: null, head: null, detached: false, prunable: false}; list.push(cur); }
    else if (!cur) continue;
    else if (line.startsWith('HEAD ')) cur.head = line.slice(5);
    else if (line.startsWith('branch ')) cur.branch = line.slice(7).replace(/^refs\/heads\//, '');
    else if (line === 'detached') cur.detached = true;
    else if (line.startsWith('prunable')) cur.prunable = true;
  }
  return list.filter(w => !w.prunable);
}
// "[ahead 2, behind 1]" / "[gone]" / "" → {ahead, behind, gone}
function parseTrack(track) {
  const t = String(track || '');
  return {gone: /gone/.test(t), ahead: Number(/ahead (\d+)/.exec(t)?.[1] || 0), behind: Number(/behind (\d+)/.exec(t)?.[1] || 0)};
}
// GitHub check runs and commit statuses → 'pass' | 'fail' | 'pending' | null
function checksState(rollup) {
  if (!Array.isArray(rollup) || !rollup.length) return null;
  let pending = false;
  for (const c of rollup) {
    const v = String(c.conclusion || c.state || '').toUpperCase(), status = String(c.status || '').toUpperCase();
    if (['FAILURE', 'ERROR', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE'].includes(v)) return 'fail';
    if (v === 'PENDING' || v === 'EXPECTED' || (status && status !== 'COMPLETED' && !v)) pending = true;
  }
  return pending ? 'pending' : 'pass';
}
function summarizePr(p) {
  return {number: p.number, title: String(p.title || ''), url: p.url, state: p.state, draft: !!p.isDraft, branch: p.headRefName, base: p.baseRefName,
    author: p.author?.login || null, review: p.reviewDecision || null, conflicts: p.mergeable === 'CONFLICTING', checks: checksState(p.statusCheckRollup),
    updatedAt: Date.parse(p.updatedAt) || null, mergedAt: Date.parse(p.mergedAt) || null};
}

// Tests written on a branch: test definitions added/removed in test files since it left main (for a checked-out
// branch this includes uncommitted edits and new untracked test files).
const TEST_PATHS = ['**/*.test.*', '**/*.spec.*', '**/test_*.py', '**/*_test.py', '**/*_test.go', '**/test/**', '**/tests/**', '**/__tests__/**', '**/e2e/**'].map(p => `:(glob)${p}`);
const TEST_DEF = /^\s*(?:(?:test|it)(?:\.(?:only|skip|todo|concurrent))?\s*\(\s*['"`]|(?:async\s+)?def\s+test_\w*\s*\(|func\s+Test\w*\s*\(|#\[test\])/;
function countTestDiff(diff) {
  let added = 0, removed = 0; const files = new Set(); let file = null;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ ')) { file = line.slice(6); continue; }
    if (line.startsWith('--- ')) continue;
    if (line[0] === '+' && TEST_DEF.test(line.slice(1))) { added++; if (file) files.add(file); }
    else if (line[0] === '-' && TEST_DEF.test(line.slice(1))) removed++;
  }
  return {added, removed, files: files.size};
}
async function testsWritten(git, cwd, mainRef, branch, worktree) {
  if (!mainRef) return null;
  const base = (await run(git, ['merge-base', mainRef, `refs/heads/${branch}`], {cwd, timeout: 10000})).out.trim();
  if (!base) return null;
  const d = worktree
    ? await run(git, ['diff', '-U0', '--no-color', base, '--', ...TEST_PATHS], {cwd: worktree, timeout: 20000})
    : await run(git, ['diff', '-U0', '--no-color', base, `refs/heads/${branch}`, '--', ...TEST_PATHS], {cwd, timeout: 20000});
  if (!d.ok) return null;
  const counts = countTestDiff(d.out);
  if (worktree) {
    const untracked = (await run(git, ['ls-files', '--others', '--exclude-standard', '--', ...TEST_PATHS], {cwd: worktree, timeout: 10000})).out.split('\n').filter(Boolean).slice(0, 200);
    for (const f of untracked) { try { const text = fs.readFileSync(path.join(worktree, f), 'utf8'); if (text.length > 2e6) continue; const n = text.split('\n').filter(l => TEST_DEF.test(l)).length; if (n) { counts.added += n; counts.files++; } } catch {} }
  }
  return counts;
}

// Folders to look in: each terminal's folder (and, when that folder is not itself in a repo, the repos directly inside
// it), plus the sibling repos next to each repo found (worktrees usually live side by side).
async function findRepos(git, folders, {siblings = true} = {}) {
  const seen = new Set(), tops = new Set(), parents = new Set();
  const isRepoDir = dir => { try { return fs.existsSync(path.join(dir, '.git')); } catch { return false; } };
  const children = dir => { try { return fs.readdirSync(dir, {withFileTypes: true}).filter(d => d.isDirectory() && !d.name.startsWith('.')).map(d => path.join(dir, d.name)).filter(isRepoDir); } catch { return []; } };
  const probe = async dir => {
    if (!dir || seen.has(dir)) return; seen.add(dir);
    const r = await run(git, ['rev-parse', '--show-toplevel'], {cwd: dir, timeout: 5000});
    if (r.ok && r.out.trim()) { const top = r.out.trim(); tops.add(top); parents.add(path.dirname(top)); }
    else if (siblings) for (const child of children(dir).slice(0, 80)) { tops.add(child); parents.add(dir); }
  };
  for (const f of folders) if (f && fs.existsSync(f)) await probe(f);
  if (siblings) for (const p of parents) for (const child of children(p).slice(0, 80)) tops.add(child);
  // Group worktrees of the same repository by their shared .git directory.
  const repos = new Map();
  await pool([...tops], 6, async top => {
    const r = await run(git, ['rev-parse', '--path-format=absolute', '--git-common-dir'], {cwd: top, timeout: 5000});
    if (!r.ok) return;
    let common = r.out.trim(); try { common = fs.realpathSync(common); } catch {}
    if (!repos.has(common)) repos.set(common, {common, dir: top});
  });
  return [...repos.values()];
}

async function defaultBranch(git, cwd) {
  const head = await run(git, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], {cwd, timeout: 5000});
  if (head.ok && head.out.trim()) return head.out.trim().replace(/^origin\//, '');
  for (const name of ['main', 'master']) { const r = await run(git, ['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${name}`], {cwd, timeout: 5000}); if (r.ok) return name; }
  for (const name of ['main', 'master']) { const r = await run(git, ['rev-parse', '--verify', '--quiet', `refs/heads/${name}`], {cwd, timeout: 5000}); if (r.ok) return name; }
  return null;
}

function createGitOverview({now = () => Date.now()} = {}) {
  const git = firstExisting(GIT_CANDIDATES) || 'git', gh = firstExisting(GH_CANDIDATES);
  const lastFetch = new Map(); // common dir → time of last `git fetch`
  let cache = null, running = null, viewer = null, viewerChecked = false;
  async function whoAmI() { if (viewerChecked || !gh) return viewer; viewerChecked = true; const r = await run(gh, ['api', 'user', '--jq', '.login'], {timeout: 15000}); viewer = r.ok ? r.out.trim() || null : null; if (!viewer) viewerChecked = false; return viewer; }

  async function repoInfo(repo, {fetch}) {
    const cwd = repo.dir;
    const remote = (await run(git, ['remote', 'get-url', 'origin'], {cwd, timeout: 5000})).out.trim();
    const slug = githubSlug(remote);
    let fetchError = null;
    if (fetch && remote) {
      const f = await run(git, ['fetch', '--prune', '--quiet', 'origin'], {cwd, timeout: 60000});
      if (f.ok) lastFetch.set(repo.common, now()); else fetchError = f.err.split('\n').find(Boolean) || 'Fetch failed.';
    }
    const main = await defaultBranch(git, cwd);
    const mainRef = main ? ((await run(git, ['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${main}`], {cwd, timeout: 5000})).ok ? `origin/${main}` : main) : null;
    const worktrees = parseWorktrees((await run(git, ['worktree', 'list', '--porcelain'], {cwd})).out);
    const refs = (await run(git, ['for-each-ref', '--format=%(refname:short)%00%(upstream:short)%00%(upstream:track)%00%(committerdate:unix)%00%(subject)%00%(authoremail:trim)', 'refs/heads'], {cwd})).out
      .split('\n').filter(Boolean).map(line => { const [name, upstream, track, date, subject, email] = line.split('\0'); return {name, upstream: upstream || null, track: parseTrack(track), date: Number(date) * 1000 || null, subject: subject || '', email: (email || '').toLowerCase()}; });
    const myEmail = (await run(git, ['config', 'user.email'], {cwd, timeout: 5000})).out.trim().toLowerCase();
    const byName = new Map(refs.map(r => [r.name, r]));
    // Pull requests (open ones plus recent merged/closed, to tell which branches are finished).
    let prs = [], ghError = null;
    if (slug && gh) {
      const r = await run(gh, ['pr', 'list', '-R', slug, '--state', 'all', '--limit', '80', '--json', 'number,title,headRefName,baseRefName,state,isDraft,reviewDecision,mergeable,statusCheckRollup,url,author,updatedAt,mergedAt'], {cwd, timeout: 30000});
      if (r.ok) { try { prs = JSON.parse(r.out).map(summarizePr); } catch { ghError = 'Could not read pull requests.'; } }
      else ghError = /auth|login/i.test(r.err) ? 'Run `gh auth login` to see pull requests.' : (r.err.split('\n').find(Boolean) || 'Could not load pull requests.');
    } else if (slug && !gh) ghError = 'Install the GitHub CLI (gh) to see pull requests.';
    const prsFor = name => prs.filter(p => p.branch === name);
    const branches = await pool(refs, 8, async ref => {
      const wt = worktrees.find(w => w.branch === ref.name) || null;
      let ahead = 0, behind = 0;
      if (mainRef && ref.name !== main) {
        const c = await run(git, ['rev-list', '--left-right', '--count', `${mainRef}...refs/heads/${ref.name}`], {cwd, timeout: 10000});
        const m = /^(\d+)\s+(\d+)/.exec(c.out.trim()); if (m) { behind = Number(m[1]); ahead = Number(m[2]); }
      } else if (ref.name === main) { behind = ref.track.behind; ahead = ref.track.ahead; }
      const own = prsFor(ref.name), open = own.find(p => p.state === 'OPEN') || null;
      const merged = open ? null : own.filter(p => p.state === 'MERGED').sort((a, b) => (b.mergedAt || 0) - (a.mergedAt || 0))[0] || null;
      // A merge commit says nothing about the feature: use the branch's latest own commit instead.
      let subject = ref.subject;
      if (/^Merge\b/.test(subject)) { const own2 = await run(git, ['log', '-1', '--no-merges', '--format=%s', `refs/heads/${ref.name}`], {cwd, timeout: 10000}); if (own2.ok && own2.out.trim()) subject = own2.out.trim(); }
      const mine = !!(myEmail && ref.email === myEmail) || own.some(p => viewer && p.author === viewer);
      return {name: ref.name, isDefault: ref.name === main, mine, worktree: wt?.path || null, upstream: ref.upstream, gone: ref.track.gone,
        toPush: ref.track.ahead, toPull: ref.track.behind, ahead, behind, date: ref.date, subject, pr: open, merged, dirty: null};
    });
    // Tests written, for branches worth showing (checked out, with an open PR, or committed to in the last 3 weeks).
    await pool(branches.filter(b => !b.isDefault && (b.worktree || b.pr || now() - (b.date || 0) < 21 * 864e5)), 4, async b => { b.tests = await testsWritten(git, cwd, mainRef, b.name, b.worktree).catch(() => null); });
    // Uncommitted changes in each worktree.
    await pool(worktrees, 4, async w => {
      const s = await run(git, ['status', '--porcelain'], {cwd: w.path, timeout: 15000});
      const count = s.ok ? s.out.split('\n').filter(Boolean).length : null;
      const b = branches.find(x => x.name === w.branch); if (b) b.dirty = count;
      w.dirty = count;
    });
    const detached = worktrees.filter(w => !w.branch).map(w => ({path: w.path, head: (w.head || '').slice(0, 7), dirty: w.dirty}));
    const otherPrs = prs.filter(p => p.state === 'OPEN' && !byName.has(p.branch));
    // Your recently merged PRs whose branch is no longer on this Mac (finished features).
    const mergedMine = prs.filter(p => p.state === 'MERGED' && viewer && p.author === viewer && !byName.has(p.branch) && now() - (p.mergedAt || 0) < 21 * 864e5);
    return {key: repo.common, name: slug || path.basename(path.dirname(repo.common)), slug, url: slug ? `https://github.com/${slug}` : null, folder: cwd,
      defaultBranch: main, fetchedAt: lastFetch.get(repo.common) || null, fetchError, ghError, worktrees: worktrees.map(w => ({path: w.path, branch: w.branch})),
      branches, detached, otherPrs, mergedMine};
  }

  // folders: terminal folders to start from. fetch: also `git fetch` repos not fetched in the last `fetchEvery` ms.
  // scope 'terminals': only the repos terminals are in (light background refresh for the left panel).
  async function collect(folders, {fetch = false, force = false, fetchEvery = 5 * 60 * 1000, scope = 'all'} = {}) {
    if (running) return running;
    running = (async () => {
      await whoAmI();
      const repos = await findRepos(git, [...new Set(folders.filter(Boolean))], {siblings: scope !== 'terminals'});
      const list = await pool(repos, 3, repo => repoInfo(repo, {fetch: fetch && (force || now() - (lastFetch.get(repo.common) || 0) > fetchEvery)}).catch(error => ({key: repo.common, name: path.basename(repo.dir), error: error.message, branches: [], worktrees: [], otherPrs: [], detached: [], mergedMine: []})));
      list.sort((a, b) => a.name.localeCompare(b.name));
      cache = {updatedAt: now(), gh: !!gh, scope, viewer, repos: list};
      return cache;
    })().finally(() => { running = null; });
    return running;
  }
  return {collect, cached: () => cache};
}

// Which repo, worktree and branch a folder is in (longest worktree path that contains it).
function locate(data, folder) {
  if (!data || !folder) return null;
  let best = null;
  for (const repo of data.repos || []) for (const w of repo.worktrees || []) {
    if ((folder === w.path || folder.startsWith(w.path + path.sep)) && (!best || w.path.length > best.worktree.length)) best = {repo: repo.key, worktree: w.path, branch: w.branch};
  }
  return best;
}

module.exports = {createGitOverview, locate, githubSlug, parseWorktrees, parseTrack, checksState, summarizePr, countTestDiff, TEST_DEF};
