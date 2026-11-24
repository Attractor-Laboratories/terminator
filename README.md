# Terminator

A macOS terminal workspace with a left sidebar, a fixed terminal grid, and a terminal view occupying the right quarter of the window.

## Open

Open `/Applications/Terminator.app`, or build it using the development instructions below.

- **+ Terminal** creates a shell in the folder you choose.
- Drag a terminal title to move or swap it within the grid. Drag shared dividers to resize neighboring sections together.
- Select a terminal under **View** to move it into the right-hand panel. Use **↙** to return it to the canvas.
- Double-click a title, or use **⋯**, to change its title and color.
- **2 × 4** changes the grid’s column and row counts. Edit a terminal’s Columns and Rows to span multiple cells. The grid stays inside the visible window.
- **Claude**, or `claude` in a terminal, launches your installed Claude Code with session-local status hooks.

**⌘T** creates a terminal. **⌘1–9** zooms in on the matching Priority terminal (press it again to zoom back out). **⌘⇧Enter** returns View to the canvas.

## Workspaces and headers

Use the workspace selector to create, rename, and switch workspaces. Each workspace keeps its own terminals and grid layout. Its processes continue while another workspace is visible.

The active Claude model and effort appear below the terminal title, supplied by Claude’s [status line data](https://code.claude.com/docs/en/statusline). The latest submitted prompt is pinned below the header; use its chevron to expand or collapse it. The latest prompt and session references are stored locally for recovery.

The terminal selected in View stays visible as a grayed-out live copy on the canvas. Terminal colors use a matching light background. The ◐ toggle switches every terminal between colored backgrounds with monochrome text and plain backgrounds where output keeps its original ANSI colors; title boxes keep their terminal color in both modes. ‹ / › in a terminal's prompt bar scroll its text to the output right after the previous or next prompt; **Latest** returns to the newest output.

**⌘+ / ⌘−** change the text size of the focused terminal (in the right panel: the right panel’s size). **⌘0** resets it. **Claude** launches `claude --dangerously-skip-permissions`; **Codex** uses `--dangerously-bypass-approvals-and-sandbox`. Minimizing the window includes the canvas and View.

## Status

Shell commands show Running, Done, and Error using zsh preexec/precmd hooks. The elapsed timer measures the most recent command. Claude turns use UserPromptSubmit, Stop, StopFailure, and permission/tool hooks to show Running, Done, Error, and Needs attention. Elapsed time includes time waiting for permission. Completion means Claude finished its turn; inspect its response for the outcome of the work.

Claude must be launched through the `claude` function provided inside these terminals for per-turn tracking. Calling its absolute executable path bypasses the function. The integration uses Claude's documented [hooks](https://code.claude.com/docs/en/hooks) and [session settings](https://code.claude.com/docs/en/cli-reference). Global Claude and shell configuration files remain on their existing paths; the app loads the user's zsh startup configuration and supplies its own integration directory to each child shell.

Terminal titles, colors, starting folders, and grid positions persist between launches. Quitting ends the shells; reopening starts shells in their saved folders and resumes available recorded agent chats. Closed terminals are saved under **History**, including their recent output and session reference. The quit confirmation appears when work is running or needs attention.

## Development

Requires Node.js and Apple's command-line developer tools on macOS.

```sh
npm install
node node_modules/electron/install.js
npm run prepare-pty
npm run build
npm start
```

```sh
npm test
npm run package
```

The build uses Electron, xterm.js, and node-pty. The renderer is sandboxed and uses a narrow preload API. Claude lifecycle messages use an instance-local Unix socket with a per-terminal token. Hook messages contain lifecycle metadata, model/effort, and the latest submitted prompt for its pinned header. Closed-terminal history includes recent terminal output; agent transcript files remain in their provider directories. The app has no network listener.

## Verification

Grid bounds, multi-cell placement, overlap prevention, and full-grid behavior have automated checks. Workspace creation/switching, the grayed-out live terminal, pinned prompts, and model/effort headers were exercised in an isolated QA window.


Real zsh input, command start/completion, nonzero exit codes, local hook delivery, and status timing have automated tests. The hook test uses simulated Claude lifecycle payloads. A live paid Claude turn has not been run as part of verification.

### Resume Claude
Use ↻ in a terminal header to resume its recorded Claude chat directly with `claude --resume <session-id>`. The chat ID and original folder are saved per terminal across restarts. Terminals without a recorded chat show recent local Claude history; select a prompt/folder or enter a session ID from Claude `/status`. Recent history is limited to the last 4 MB / 100 chats. Claude launches and resumes use --dangerously-skip-permissions. Exit a running process before resuming. Chats already active in another terminal in this app are guarded against duplicate reopening.

The middle section and the right panel have separate text sizes, each with **− / +** in its top-right corner (double-click the number to reset). Zooming one never changes the other. ⌘+ / ⌘− while typing in the right panel changes the right panel’s size; on a terminal in the middle section it nudges just that terminal relative to the middle-section size. ⌘0 resets. Sizes persist across restarts.

Claude and Codex launch from each terminal header. Codex uses --dangerously-bypass-approvals-and-sandbox and --no-alt-screen. App-local shell functions apply these flags to manually typed launches too. Codex currently uses shell process status and duration; per-turn Claude metadata remains Claude-specific.

On reopen, each terminal automatically resumes its last recorded Claude or Codex session in its saved directory and grid position. Session references and latest prompts are stored locally in the existing app data directory with atomic writes. Up to 50 session references are retained per terminal. Codex attribution uses the transcript opened by that terminal’s own process; completion notifications provide a second exact-ID signal. Ordinary shell commands are never replayed.

Double-click an empty grid cell to create a terminal, or drag **+ Terminal** into it. New terminals use an unused color. Click a terminal header to open it in View; click its header in View to return it. Double-click a divider to remove its left column or upper row when the terminals still fit.

Use the moon/sun button beside History to switch between light and dark mode. The choice persists across launches; terminal accent colors stay the same.

Add a goal with **+** beside Goals (or `/goal …` in the prompt bar). Each goal shows the date it was set and gets its own Claude terminal. Drag a goal onto any terminal (canvas, View or sidebar row) to attach it there too; drag it onto a terminal it is already attached to to detach it. The colored dots next to the date show the attached terminals; click a dot to open that terminal in View. Every prompt in that terminal carries a hidden reminder of the goal, added through Claude Code's `UserPromptSubmit` hook. The reminder is not part of the prompt text, so it does not appear in the prompt bar or prompt history.

In **Prompts**, each prompt is tinted with its terminal’s color; the chips above the list filter it to one or more terminals (**All** clears the filter). The ‹ / › prompt navigator shows whenever a terminal has prompts; a prompt that is no longer in the scrollback still appears in the bar (in italics), but the view cannot jump to it.

**Subgoals.** Each goal can hold subgoals. Add one with **+ Subgoal**, or let Claude add them: the hidden goal reminder lists the goal's subgoals (with ids) and tells Claude to run `integration/goal.cjs add <goal id> "<subgoal>"` / `done <subgoal id>` as the conversation reveals subtasks or finishes them. Subgoals added by Claude carry a ✦. A subgoal inherits every terminal of its goal (possibly none) and can be dragged onto other terminals to attach it there too; those terminals are reminded of the goal with that subgoal marked. Only terminals working on a goal can change its subgoals.

**Preview build.** `npm run install:preview` builds `Terminator Preview.app` and installs it in /Applications once you have quit it (it never quits or reopens the app) (`npm run package:preview` only builds it). The preview has a violet icon and bundle id `local.terminalsteroid.preview`. It keeps its own permanent data in `~/Library/Application Support/terminalsteroid-preview`, so it runs alongside the real Terminator without sharing workspaces or sessions.

## Saving conversations

- Terminals never inherit Claude Code's session markers, so every Claude conversation is saved and can be resumed.
- Terminator also keeps its own copy of each conversation in its data folder (`transcripts/`), refreshed after every reply. If Claude's file is missing when a terminal is restored, the copy is put back first.
- A terminal header shows **⚠ not saved** if Claude reports a conversation it is not saving.

## Moving terminals and changing the grid

- Move a terminal to another workspace by dragging it (from the left panel or by its header) onto a workspace tab, or choose a workspace in its settings (right-click it in the left panel).
- **Columns −/+** and **Rows −/+** above the canvas change the grid; **⊞** opens layout presets with a preview of where each terminal lands.
- Any grid change that would move or resize terminals asks first and names them.

## Links and subgoals

- Hover a link in the left panel and click **×** to remove it; it stays hidden for that terminal. Right-click a link to rename it.
- The goal and subgoal dialogs list the workspace's terminals: click one to attach or detach it (a subgoal always keeps its goal's terminals).

## Chat archive

- Closing a terminal keeps it in **History**, where it can be restored with its conversation.
- Closing also writes the text of all its Claude/Codex chats to `~/Library/Application Support/terminalsteroid/archive/<date> <title> (<id>)/chat.md`, with copies of the original session files in `sessions/`.
- **Delete** in History removes the terminal from History only; its chat archive stays. **Chat** opens a terminal's archived chat; **Chat archive** opens the folder.
- Terminals closed before this feature existed are archived automatically at startup.

## Menu bar

- The Terminator icon in the macOS menu bar lists every workspace (with its number of terminals). Each has a submenu with its goals and terminals; click one to jump there. The current workspace's goals and terminals are also listed directly.
- The app's own menu bar has a **Workspaces** menu: ⌃⌘1…9 switch workspaces.
- Drag a workspace tab onto another to reorder the tabs. Drop a terminal on **+** to create a new workspace for it.
- In the Grid dialog, drag terminals in the preview onto other cells (dropping on another terminal swaps them); Apply asks before anything moves.
- Every link in a terminal is clickable: plain URLs and file paths, and the hyperlinks programs mark explicitly (Claude Code marks every URL and file it prints).

## Status and notifications

- Top right: how many terminals (all workspaces) are **done**, **running**, **waiting** for you (shown only when any are) and **open**. Hover a count to see which terminals.
- Notifications (when Terminator isn't the front window) name the terminal and say why: **Done**, **Asked you a question** (the reply ends in a question, or Claude opened a question dialog) or **Needs your permission**. They never show the prompt or reply. Click one to open that terminal.

## Phone access

- The phone button at the bottom of the left panel turns on Claude Code's **Remote Control** for every Claude chat in Terminator: read and reply from the Claude app on your phone (Code tab) or at claude.ai/code. Each chat is named after its terminal.
- Turning it on also connects idle open chats (by sending `/remote-control`); busy chats connect when next started or resumed. A connected terminal shows 📱 in its header.
- Turning it off stops new chats from connecting; connected chats stay connected until they end.

## Terminator on your iPhone

- Phone button (bottom of the left panel) → **Terminator on your iPhone**. Terminator then serves a phone version of itself: workspaces, done/running/open counts, goals, Priority and Rest, and each terminal full screen with live output, a reply box and keys (esc, tab, arrows, ⏎, ^C, 1–3, ⇧tab). "Resume chat" / "New Claude chat" appear when Claude isn't running.
- It is reachable only through **Tailscale** (and on the Mac itself), never on the Wi-Fi network. Install Tailscale on the Mac and the iPhone with the same account, scan the code in the Phone dialog, then Safari → Share → **Add to Home Screen**.
- Every request needs the pairing code from the QR. **New pairing code** disconnects phones paired before.
- While you view a terminal on the phone, it is resized to the phone's width; the Mac gets its size back when you leave it.
- Port 47821 (Terminator Preview: 47822).
- Under each workspace name: a mark per terminal that is running (a pulsing dot) or done (a dot; ringed while you haven't opened it, dimmed after), in that terminal's color. Hover for the names.
- The phone page uses a secure https://<mac>.<tailnet>.ts.net address that Terminator sets up with `tailscale serve` (tailnet only). The first time, approve HTTPS for your tailnet via the button in the Phone dialog.

## Overview

- **Overview** (before the first workspace tab, or ⇧⌘O; Esc closes): every workspace as a column; Goals, Priority and Rest are rows, aligned across workspaces. Each column shows counts, goals with progress and their subgoals (✓ done, ○ open, plus the color of any extra terminal a subgoal is attached to), and terminals with live status, model and latest prompt.
- Click a terminal to open it; click a column header to go to that workspace; drag a terminal onto another column's Priority or Rest row to move it there.
- Status icons (done, running, waiting, open) use the logo pink and differ by shape: filled, pulsing, haloed, hollow.

## Drafts

- Every terminal has a small **+** in its bottom-right corner (also when it's open in the right panel). Click it and write a prompt in the bottom bar; ⏎ saves it (Esc cancels).
- The draft then sits as a chip in that terminal's corner, over the terminal without resizing it. Click the chip to edit it in the bottom bar again; **➤** sends it into the terminal's Claude or Codex input; **×** deletes it. A terminal can hold several drafts; they're saved with the terminal.
- Sending needs Claude or Codex running there and nothing half-typed in its input; otherwise the draft is kept and you're told why.

- Running clocks in the left panel are pink and flicker softly.
- **?** marks a terminal whose AI is waiting for your answer — its reply ends in a question, it opened a question dialog, or it asks permission — in the left panel, under the workspace tab, in the terminal header and in the Overview. It disappears when you reply.

## Performance notes

- Screen output is saved every 10 s while terminals print (other changes save immediately, and everything saves on quit). The previous state file becomes the backup by a rename instead of a re-read and copy.
- Links are looked up at most every 4 s per terminal while it prints, and Claude conversation files are read incrementally (only what was appended).
- Claude's own background-task notifications (`<task-notification>…`) never count as prompts; pasted-text markup is removed from prompts.

## Spaces

- **Spaces** (next to Prompts) lists every workspace. **Hide** takes a workspace out of the tab bar, the overview and the Workspaces menu; its terminals keep running. **Show** brings it back; clicking a workspace's name opens it (and shows it again).
- At least one workspace stays visible; hiding the current one switches to the next visible one.
- Archived workspaces (right-click a tab) are listed under **Archived**, with **Restore**.


