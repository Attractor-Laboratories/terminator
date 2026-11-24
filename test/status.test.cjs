const { test } = require('node:test');
const assert = require('node:assert/strict');
const { transition } = require('../src/status.cjs');
test('a Claude turn runs, waits for approval, resumes and finishes with stable duration', () => {
  let s = transition({}, 'UserPromptSubmit', 1000);
  s = transition(s, 'PermissionRequest', 2000);
  assert.equal(s.status, 'attention');
  s = transition(s, 'PostToolUse', 3000);
  assert.equal(s.startedAt, 1000);
  s = transition(s, 'Stop', 6000);
  assert.equal(s.status, 'done');
  assert.equal(s.endedAt - s.startedAt, 5000);
  s = transition(s, 'UserPromptSubmit', 9000);
  assert.equal(s.startedAt, 9000);
  assert.equal(s.endedAt, null);
});
test('initial prompt is ready; failed turns and closed processes are explicit', () => {
  assert.equal(transition({}, 'done', 1000).status, 'ready');
  assert.equal(transition({}, 'StopFailure', 1000).status, 'error');
  assert.equal(transition({}, 'closed', 1000).status, 'closed');
});

test('completion stays unread until visited and a new run clears it',()=>{
 const running=transition({status:'ready'},'running',100);
 const done=transition(running,'Stop',200);
 assert.equal(done.unreadDone,true);
 assert.equal(transition({...done,unreadDone:false},'Stop',201).unreadDone,false);
 assert.equal(transition(done,'running',300).unreadDone,false);
 assert.equal(transition({status:'starting'},'done',100).unreadDone,undefined);
});
