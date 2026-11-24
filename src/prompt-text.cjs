// Prompts that Claude Code submits on its own (background-task notifications, system reminders, slash-command
// wrappers) are not your prompts: they never become a terminal's latest prompt or enter the prompt history.
// Other markup (e.g. <pasted_content …> around pasted text) is removed and its text kept.
const SYSTEM_BLOCK = /<(task-notification|system-reminder|local-command-stdout|local-command-stderr|local-command-caveat|command-name|command-message|command-args|bash-input|bash-stdout|bash-stderr|user-memory-input)\b[^>]*>[\s\S]*?<\/\1(?:\s[^>]*)?>/gi;
const WRAPPER_TAG = /<\/?(pasted_content|pasted-content|attachment)\b[^>]*>\n?/gi;
function cleanPrompt(text) {
  if (typeof text !== 'string') return '';
  return text.replace(SYSTEM_BLOCK, '').replace(WRAPPER_TAG, '').replace(/\n{3,}/g, '\n\n').trim();
}
const isSystemPrompt = text => typeof text === 'string' && text.trim() !== '' && cleanPrompt(text) === '';
// The newest real prompt among candidates (newest last), cleaned.
function lastRealPrompt(...candidates) {
  for (const t of candidates.flat().reverse()) { const c = cleanPrompt(t); if (c) return c; }
  return null;
}
module.exports = {cleanPrompt, isSystemPrompt, lastRealPrompt};
