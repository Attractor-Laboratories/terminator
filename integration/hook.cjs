// Send lifecycle, model/effort, and the latest submitted prompt to this app instance.
const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { if (input.length < 4 * 1024 * 1024) input += chunk; });
process.stdin.on('end', () => {
  try {
    const event = JSON.parse(input);
    if (!process.env.TS_SOCKET || !process.env.TS_TERMINAL) return;
    // Remind Claude of this terminal's goal on every prompt, as hidden context (not part of the prompt text).
    if (event.hook_event_name === 'UserPromptSubmit' && !process.argv.includes('--statusline') && /^[a-f0-9-]{36}$/.test(process.env.TS_TERMINAL)) {
      let reminder = '';
      try { reminder = fs.readFileSync(path.join(path.dirname(process.env.TS_SOCKET), 'goals', process.env.TS_TERMINAL + '.txt'), 'utf8'); } catch {}
      if (reminder.trim()) process.stdout.write(JSON.stringify({hookSpecificOutput: {hookEventName: 'UserPromptSubmit', additionalContext: reminder}}));
    }
    const socket = net.createConnection(process.env.TS_SOCKET);
    socket.setTimeout(800, () => socket.destroy());
    socket.on('error', () => {});
    socket.on('connect', () => socket.end(JSON.stringify({
      id: process.env.TS_TERMINAL, token: process.env.TS_TOKEN,
      event: process.argv.includes('--statusline') ? 'StatusLine' : event.hook_event_name,
      ...(process.argv.includes('--statusline') ? {contextPercent:event.context_window?.used_percentage,rateLimits:event.rate_limits,model:event.model?.id || event.model?.display_name || null,effort:event.effort?.level || null}:{}), notification: event.notification_type,
      cwd:event.cwd, transcript:event.transcript_path, session: event.session_id, agent: event.agent_id,
      ...(event.tool_name ? {tool: String(event.tool_name).slice(0, 100)} : {}),
      ...(typeof event.last_assistant_message === 'string' ? {lastMessage: event.last_assistant_message.slice(-2000)} : {}),
      ...(event.hook_event_name==='UserPromptSubmit' ? {prompt:event.prompt}:{}),
    }) + '\n'));
  } catch {}
});
