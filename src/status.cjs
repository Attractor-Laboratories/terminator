function transition(state, event, now = Date.now()) {
  const next = { ...state };
  switch (event) {
    case 'starting':next.status='starting';next.startedAt=null;next.endedAt=null;break;
    case 'running': case 'UserPromptSubmit':
      next.status = 'running'; next.startedAt = now; next.endedAt = null; break;
    case 'PreToolUse': case 'PostToolUse':
      next.status = 'running'; next.startedAt ??= now; next.endedAt = null; break;
    case 'PermissionRequest': case 'attention': next.status = 'attention'; break;
    case 'Stop': case 'done':
      next.status = next.startedAt ? 'done' : 'ready';
      if (next.startedAt) next.endedAt = now;
      break;
    case 'StopFailure': case 'error': next.status = 'error'; next.endedAt = now; break;
    case 'SessionStart': next.status = 'ready'; next.startedAt = null; next.endedAt = null; break;
    case 'closed': next.status = 'closed'; next.endedAt = now; break;
  }
  if(next.status==='running')next.unreadDone=false;
  else if(next.status==='done'&&state.status!=='done')next.unreadDone=true;
  return next;
}
module.exports = { transition };
