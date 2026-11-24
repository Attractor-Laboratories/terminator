const test=require('node:test'),assert=require('node:assert/strict');
const {githubSlug,parseWorktrees,parseTrack,checksState,locate}=require('../src/git-overview.cjs');
test('GitHub slugs come from https and ssh remotes',()=>{assert.equal(githubSlug('https://github.com/octo-org/example-app.git'),'octo-org/example-app');assert.equal(githubSlug('git@github.com:octo-org/other-app'),'octo-org/other-app');assert.equal(githubSlug('https://gitlab.com/a/b.git'),null);});
test('worktrees, tracking and checks are read from git and gh output',()=>{
 assert.deepEqual(parseWorktrees('worktree /r/main\nHEAD abc\nbranch refs/heads/main\n\nworktree /r/fix\nHEAD def\nbranch refs/heads/fix/x\n\nworktree /r/old\nHEAD 123\ndetached\n\nworktree /gone\nHEAD 9\nbranch refs/heads/g\nprunable gitdir file points to non-existent location\n').map(w=>[w.path,w.branch]),[['/r/main','main'],['/r/fix','fix/x'],['/r/old',null]]);
 assert.deepEqual(parseTrack('[ahead 2, behind 1]'),{gone:false,ahead:2,behind:1});assert.deepEqual(parseTrack('[gone]'),{gone:true,ahead:0,behind:0});
 assert.equal(checksState([{conclusion:'SUCCESS',status:'COMPLETED'},{conclusion:'FAILURE',status:'COMPLETED'}]),'fail');assert.equal(checksState([{status:'IN_PROGRESS'}]),'pending');assert.equal(checksState([{state:'SUCCESS'}]),'pass');assert.equal(checksState([]),null);});
test('a terminal folder maps to the deepest worktree containing it',()=>{const data={repos:[{key:'k',worktrees:[{path:'/a/SATIE',branch:'main'},{path:'/a/SATIE/nested',branch:'x'}]}]};assert.deepEqual(locate(data,'/a/SATIE/src'),{repo:'k',worktree:'/a/SATIE',branch:'main'});assert.equal(locate(data,'/a/SATIE/nested/z').branch,'x');assert.equal(locate(data,'/a/SATIE-local'),null);});
test('test runs: commands, folders and pass/fail counts are read from runner output',()=>{const {testCounts,commandFolder,TEST_COMMAND}=require('../src/test-runs.cjs');
 assert.deepEqual(testCounts('ℹ tests 75\nℹ pass 74\nℹ fail 1\n'),{passed:74,failed:1,skipped:0});
 assert.deepEqual(testCounts('===== 5 passed, 1 failed, 2 skipped in 0.12s ====='),{passed:5,failed:1,skipped:2});
 assert.deepEqual(testCounts(' Tests  1 failed | 11 passed (12)'),{passed:11,failed:1,skipped:0});
 assert.deepEqual(testCounts('Tests:       2 failed, 10 passed, 12 total'),{passed:10,failed:2,skipped:0});
 assert.deepEqual(testCounts('test result: ok. 12 passed; 0 failed; 1 ignored'),{passed:12,failed:0,skipped:1});
 assert.equal(testCounts('ALL PASS'),null);
 assert.ok(TEST_COMMAND.test('cd x && npm test 2>&1 | tail'));assert.ok(!TEST_COMMAND.test('grep -n latest file'));
 assert.equal(commandFolder('cd ~/Local/a && npm test',''),require('os').homedir()+'/Local/a');assert.equal(commandFolder('cd sub; pytest -q','/repo'),'/repo/sub');assert.equal(commandFolder('npm test','/repo'),'/repo');});
test('tests written counts added and removed test definitions in test files',()=>{const {countTestDiff}=require('../src/git-overview.cjs');
 assert.deepEqual(countTestDiff("+++ b/test/a.test.js\n+test('one',()=>{})\n+  it(\"two\",()=>{})\n-test('old',()=>{})\n+++ b/tests/test_x.py\n+def test_three():\n+const x=test;\n"),{added:3,removed:1,files:2});});
