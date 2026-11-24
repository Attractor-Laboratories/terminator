// Lets the agent in a Terminator terminal add or complete subgoals of the goals that terminal works on.
//   goal.cjs add <goal id> "<subgoal>"
//   goal.cjs done <subgoal id>
//   goal.cjs undone <subgoal id>
const net = require('node:net');
const [action, target, ...rest] = process.argv.slice(2);
const text = rest.join(' ').trim();
const usage = 'Usage: goal.cjs add <goal id> "<subgoal>" | done <subgoal id> | undone <subgoal id>';
if (!process.env.TS_SOCKET || !process.env.TS_TERMINAL || !process.env.TS_TOKEN) { console.error('Not running inside a Terminator terminal.'); process.exit(1); }
if (!['add', 'done', 'undone'].includes(action) || !target || (action === 'add' && !text)) { console.error(usage); process.exit(2); }
const socket = net.createConnection(process.env.TS_SOCKET);
socket.setTimeout(2000, () => { console.error('Terminator did not respond.'); socket.destroy(); process.exit(1); });
socket.on('error', error => { console.error('Could not reach Terminator: ' + error.message); process.exit(1); });
socket.on('connect', () => socket.end(JSON.stringify({id: process.env.TS_TERMINAL, token: process.env.TS_TOKEN, event: 'Goal', action, target, text}) + '\n', () => {
  console.log(action === 'add' ? `Subgoal sent to Terminator: ${text}` : `Subgoal ${target} marked ${action === 'done' ? 'done' : 'not done'}.`);
}));
