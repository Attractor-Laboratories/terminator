const {sourceLinks}=require('./src/link-sources.cjs');
const {extractLinks,supportedLink,linkKey}=require('./src/terminal-links.cjs');
const { app, BrowserWindow, ipcMain, dialog, Menu, shell, Tray, nativeImage, Notification, session } = require('electron');
const {createMenuBar} = require('./src/menu-bar.cjs');
let menuBar, menuBarOrder = {}, menuBarSelected = null;
const pty = require('node-pty');
const fs = require('node:fs');
const {execFile} = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const crypto = require('node:crypto');
const {validId,resumeCommand,recentChats}=require('./src/resume.cjs');
const {restoreCommand,forkCommand,remember,codexRecord,claudeTranscript}=require('./src/recovery.cjs');
// The chat a fork copies: the one running in the terminal, else the last one there. A Claude chat needs its transcript.
// The open terminal that holds a chat now (running it, or the chat it would resume).
function chatTerminal(provider,id){for(const s of sessions.values()){if(provider==='claude'&&(s.claudeSession===id||s.resumeSession===id)||provider==='codex'&&s.codexSession===id||s.lastSession?.provider===provider&&s.lastSession.id===id)return s;}return null;}
// Chat search runs in a worker: it reads every Claude and Codex chat once, then only what changed.
let chatWorker=null,chatAsks=0;const chatWaiting=new Map();
function startChatSearch(){if(chatWorker)return chatWorker;const {Worker}=require('node:worker_threads');chatWorker=new Worker(path.join(__dirname,'src','chat-search-worker.cjs'),{workerData:{claudeHome,codexHome:process.env.CODEX_HOME||path.join(os.homedir(),'.codex'),cacheFile:path.join(app.getPath('userData'),'chat-index.json')}});
 chatWorker.on('message',m=>{const done=chatWaiting.get(m.id);if(done){chatWaiting.delete(m.id);done(m);}});
 chatWorker.on('error',e=>console.error('chat search',e));chatWorker.on('exit',()=>{chatWorker=null;for(const done of chatWaiting.values())done({results:[],failed:true});chatWaiting.clear();});chatWorker.unref();return chatWorker;}
function chatSearch(query){const worker=startChatSearch(),id=++chatAsks;return new Promise(resolve=>{chatWaiting.set(id,resolve);worker.postMessage({id,query});});}
function forkRecord(s){const live=s.provider==='claude'&&s.claudeSession?{provider:'claude',id:s.claudeSession,cwd:s.resumeCwd||s.cwd}:s.provider==='codex'&&s.codexSession?{provider:'codex',id:s.codexSession,cwd:s.cwd}:null;const r=live||s.lastSession;if(!r||!forkCommand(r))return null;if(r.provider==='claude'&&!claudeTranscript(r,claudeHome))return null;return r;}
const {palette,validColor,unusedColor}=require('./src/colors.cjs');
const {archiveTerminal}=require('./src/history.cjs');
const {writeState,readState}=require('./src/session-store.cjs');
let outputDirty=false,stateLoaded=false;
const {claudeWindows,readCodex,cachedClaude,readClaude}=require('./src/usage.cjs');
let usageState={claude:{windows:[],updatedAt:null},codex:{windows:[],updatedAt:null}},usagePending=null;
function publishUsage(){send('usage',usageState);}
function receiveClaudeUsage(data){const windows=claudeWindows(data);if(!windows.length)return;usageState.claude={windows,updatedAt:Date.now()};publishUsage();}
async function refreshUsage(){
 const cached=cachedClaude();if(cached&&cached.updatedAt>(usageState.claude.updatedAt||0))usageState.claude=cached;
 if(!usagePending){usagePending=Promise.allSettled([['codex',readCodex],['claude',readClaude]].map(async([provider,read])=>{try{const windows=await read();usageState[provider]={windows,updatedAt:Date.now(),error:windows.length?null:'Limits unavailable'};}catch(e){usageState[provider]={...usageState[provider],error:e.message};}publishUsage();})).finally(()=>{usagePending=null;});}
 await usagePending;return usageState;
}
ipcMain.handle('usage-read',refreshUsage);
let usageTimer;
const {choose}=require('./src/router.cjs');
const {trackInput,clearInput}=require('./src/terminal-input.cjs');
const {createModes,trackModes,clearModes,mouseModes}=require('./src/terminal-modes.cjs');
const {cleanPrompt,isSystemPrompt,lastRealPrompt}=require('./src/prompt-text.cjs');
const {createGitOverview,locate:gitLocate}=require('./src/git-overview.cjs');const {scanTranscript}=require('./src/test-runs.cjs');const gitOverview=createGitOverview();
const {readRuntime,identity,waitingReason,claudeNotification,codexDisplayMetadata}=require('./src/agent-runtime.cjs');
const {goalTerminals,subgoals,addSubgoal,updateSubgoal,goalsForTerminal,terminalsWithGoals,goalReminder}=require('./src/goals.cjs');
const {collectPrompts}=require('./src/prompts.cjs');
let promptLog=[];
function logPrompt(s,text,provider,sessionId){const routed=routerJobs.find(j=>j.status==='sending'&&j.terminalId===s.id&&j.prompt.trim()===text.trim());const existing=routed&&promptLog.find(p=>p.routeId===routed.id);const entry={text,timestamp:Date.now(),terminalId:s.id,title:s.title,workspaceId:s.workspaceId,provider,sessionId};if(existing)Object.assign(existing,entry);else promptLog.push(entry);}
let routerJobs=[];
function routerPublish(){if(stateLoaded)save();send('router',routerJobs);}
const { transition } = require('./src/status.cjs');
// Preview build (Terminator Preview.app, marked by a PREVIEW file) keeps its own permanent data next to the real app.
const previewBuild=!!process.env.TS_PREVIEW||fs.existsSync(path.join(__dirname,'PREVIEW'));
app.setPath('userData', path.join(app.getPath('appData'),previewBuild?'terminalsteroid-preview':'terminalsteroid'));
app.setName(previewBuild?'Terminator Preview':'Terminator');
if (process.env.TS_TEST) app.setPath('userData', process.env.TS_USER_DATA || fs.mkdtempSync(path.join(os.tmpdir(),'terminalsteroid-test-')));
const primaryInstance=app.requestSingleInstanceLock();
if(!primaryInstance)app.quit();
let win, server, runtime, settingsFile, quitting = false, restoring=false;
const sessions = new Map();
const claudeHome=process.env.CLAUDE_CONFIG_DIR||path.join(os.homedir(),'.claude');
const defaultCwd = os.homedir();
const colors = palette;
const legacyColors = ['#a89bfa', '#75c5ba', '#e3af73', '#7faee8', '#dc91af', '#b7c77b'];
let workspaces = [{id:'default',title:'Workspace 1'}], activeWorkspaceId='default',closedTerminals=[];
// Names you gave to a terminal's links (right-click a link in the sidebar), keyed by the link's stable key.
function linkNamesFrom(value){const names={};if(value&&typeof value==='object')for(const [k,v] of Object.entries(value))if(typeof k==='string'&&typeof v==='string'&&v.trim())names[k.slice(0,500)]=v.trim().slice(0,80);return names;}
// Terminator keeps its own copy of every Claude conversation (userData/transcripts), refreshed after each reply,
// and puts it back if Claude's own file is gone when the terminal is restored.
// Every closed terminal's chats are also kept as text in userData/archive (see src/archive.cjs); deleting from History keeps them.
const {archiveChat}=require('./src/archive.cjs');
function chatArchiveRoot(){return path.join(app.getPath('userData'),'archive');}
function archiveRecordChat(record){if(!record||record.chatArchive&&fs.existsSync(record.chatArchive))return record;try{const dir=archiveChat(record,{root:chatArchiveRoot(),claudeHome,codexHome:process.env.CODEX_HOME||path.join(os.homedir(),'.codex'),backupDir:transcriptBackupDir()});if(dir)record.chatArchive=dir;}catch(error){console.error('chat archive failed',error);}return record;}
// The app's menu bar has a Workspaces menu listing every open workspace (⌃⌘1…9 switch); rebuilt when workspaces change.
let appMenuKey=null;
function buildAppMenu(){const open=workspaces.filter(w=>!w.archived&&!w.hidden),key=JSON.stringify([activeWorkspaceId,open.map(w=>[w.id,w.title,[...sessions.values()].filter(s=>s.workspaceId===w.id).length])]);if(key===appMenuKey)return;appMenuKey=key;
 const activate=id=>{if(!win||win.isDestroyed())return;if(win.isMinimized())win.restore();win.show();win.focus();send('menu-bar-open',{kind:'workspace',workspaceId:id});};
 const items=open.map((w,i)=>({label:`${w.title}  (${[...sessions.values()].filter(s=>s.workspaceId===w.id).length})`,type:'radio',checked:w.id===activeWorkspaceId,accelerator:i<9?`Ctrl+Cmd+${i+1}`:undefined,click:()=>activate(w.id)}));
 Menu.setApplicationMenu(Menu.buildFromTemplate([{label:'Terminator',submenu:[{role:'about'},{type:'separator'},{role:'quit'}]},{label:'Edit',submenu:[{role:'undo'},{role:'redo'},{type:'separator'},{role:'cut'},{role:'copy'},{role:'paste'},{role:'selectAll'}]},{label:'View',submenu:[{role:'togglefullscreen'},{role:'toggleDevTools'}]},{label:'Workspaces',submenu:items.length?items:[{label:'No workspaces',enabled:false}]}]));}
function transcriptBackupDir(){return path.join(app.getPath('userData'),'transcripts');}
function backupTranscript(id,file){if(!validId(id))return;const dir=transcriptBackupDir(),dst=path.join(dir,id+'.jsonl');fs.promises.mkdir(dir,{recursive:true}).then(()=>fs.promises.copyFile(file,dst+'.tmp')).then(()=>fs.promises.rename(dst+'.tmp',dst)).catch(()=>{});}
function restoreTranscriptBackup(record){if(!record||record.provider!=='claude'||!validId(record.id)||claudeTranscript(record,claudeHome))return;const src=path.join(transcriptBackupDir(),record.id+'.jsonl');if(!fs.existsSync(src))return;const cwd=typeof record.cwd==='string'?record.cwd:os.homedir();const dst=path.join(claudeHome,'projects',cwd.replace(/[^A-Za-z0-9]/g,'-'),record.id+'.jsonl');try{fs.mkdirSync(path.dirname(dst),{recursive:true});fs.copyFileSync(src,dst,fs.constants.COPYFILE_EXCL);record.transcript=dst;}catch{}}
function visibleLinks(s,links){const hidden=new Set(s.hiddenLinks||[]);return links.filter(l=>!hidden.has(linkKey(l)));}
function namedLinks(s){return (s.links||[]).map(l=>{const name=s.linkNames?.[linkKey(l)];return name?{...l,label:name,defaultLabel:l.label,key:linkKey(l)}:{...l,key:linkKey(l)};});}
const publicSession = s => ({ id:s.id, phoneSize:s.phoneSize||null, mouseModes:s.modes?mouseModes(s.modes):[], links:namedLinks(s), title:s.title, color:s.color, cwd:s.cwd, status:s.status, contextPercent:Number.isFinite(s.contextPercent)?s.contextPercent:null, unreadDone:!!s.unreadDone, startedAt:s.startedAt, endedAt:s.endedAt, createdAt:s.createdAt, agent:s.agent, provider:s.provider||null, exitCode:s.exitCode, workspaceId:s.workspaceId, model:s.model, effort:s.effort, latestPrompt:lastRealPrompt(s.promptHistory||[],s.latestPrompt), resumeSession:s.resumeSession, lastSession:s.lastSession, sessionHistory:s.sessionHistory, forkable:!!forkRecord(s), resumeAvailable:s.resumeAvailable, notSaving:!!s.notSaving, remoteControl:!!s.remoteControl, drafts:s.drafts||[], question:!!s.question });
function send(channel, data) { if (win && !win.isDestroyed()) win.webContents.send(channel, data); if(phoneServer&&(channel==='session'||channel==='workspaces'))phoneServer.broadcast(channel,channel==='workspaces'?phoneWorkspaces():data); }
function updateBadge(){if(app.dock)app.dock.setBadge(String([...sessions.values()].filter(s=>s.unreadDone).length||''));}
// macOS notification when a Claude/Codex turn finishes while Terminator is in the background. Title: the terminal's name only (never the prompt).
const openNotifications=new Set();
// Notifications name the terminal and say why, never the prompt or reply text:
// "Done", "Asked you a question" (reply ends in a question or uses the question dialog), "Needs your permission".
function lastAssistantText(file){try{const fd=fs.openSync(file,'r'),size=fs.fstatSync(fd).size,b=Buffer.alloc(Math.min(size,524288));fs.readSync(fd,b,0,b.length,size-b.length);fs.closeSync(fd);
 for(const line of b.toString('utf8').split('\n').reverse()){let r;try{r=JSON.parse(line);}catch{continue;}if(r.type==='user'&&!r.isMeta&&typeof r.message?.content==='string')return '';if(r.type!=='assistant'||r.isSidechain||!Array.isArray(r.message?.content))continue;const text=r.message.content.filter(c=>c.type==='text').map(c=>c.text).join('\n').trim();if(text)return text;}}catch{}return '';}
function asksQuestion(text){const last=String(text||'').trim().split('\n').map(l=>l.trim()).filter(Boolean).pop()||'';return /\?\s*[*_`)\]"'”’]*$/.test(last);}
function notifyDone(s,body='Done'){try{if(!Notification.isSupported()||(win&&!win.isDestroyed()&&win.isFocused()))return;const n=new Notification({title:s.title||'Terminal',body,silent:false});openNotifications.add(n);
  const forget=()=>openNotifications.delete(n);n.on('close',forget);n.on('click',()=>{forget();if(win&&!win.isDestroyed()){if(win.isMinimized())win.restore();win.show();win.focus();send('menu-bar-open',{kind:'terminal',id:s.id,workspaceId:s.workspaceId});}});n.show();}catch{}}
// "?" marker (s.question): the AI is waiting on an answer (its reply ends in a question, its question dialog, or a permission prompt) until you reply.
// A Stop without a question clears it; the idle reminder Claude sends a minute later ('idle') keeps whatever the Stop decided.
function update(s, event, why=null) { const before=s.unreadDone,wasAttention=s.status==='attention';Object.assign(s, transition(s, event));if(why==='question'||s.status==='attention')s.question=true;else if(['UserPromptSubmit','running','PreToolUse','PostToolUse','done','SessionStart','StopFailure','closed'].includes(event)||(event==='Stop'&&why!=='idle'))s.question=false;if(event==='Stop'&&!before&&s.unreadDone)notifyDone(s,why==='question'?'Asked you a question':'Done');if(s.status==='attention'&&!wasAttention)notifyDone(s,why==='question'?'Asked you a question':'Needs your permission');updateBadge();if(before!==s.unreadDone)save();send('session', publicSession(s));if(['ready','done'].includes(s.status))setTimeout(flushRouter,0); }
function save() {
  if(restoring||!stateLoaded)return;
  const terminals = [...sessions.values()].map(({id,title,color,cwd,workspaceId,resumeSession,resumeCwd,lastSession,sessionHistory,latestPrompt,promptHistory,links,linkNames,hiddenLinks,drafts,unreadDone,buffer}) => ({id,title,color,cwd,workspaceId,resumeSession,resumeCwd,lastSession,sessionHistory,latestPrompt,promptHistory,links,linkNames,hiddenLinks,drafts,unreadDone,buffer}));
  const file=path.join(app.getPath('userData'),'workspaces.json');writeState(file,{workspaces,activeWorkspaceId,terminals,closedTerminals,routerJobs,promptLog});outputDirty=false;syncGoalReminders();syncPhone();if(win)try{buildAppMenu();}catch{}
}
const SAFARI_TYPES=/\.(?:png|jpe?g|gif|webp|svg|bmp|tiff?|heic|avif|pdf|html?|mp4|mov|m4v|webm|wav|mp3|m4a|aac|flac|ogg)$/i;
// Local file links: only files that still exist; equal file names get their folder added to the label.
function existingFile(p){try{return fs.statSync(p).isFile();}catch{return false;}}
function uniqueLabels(links){const counts=new Map();for(const l of links)if(l.file)counts.set(l.label,(counts.get(l.label)||0)+1);return links.map(l=>l.file&&counts.get(l.label)>1?{...l,label:path.basename(path.dirname(l.path))+'/'+l.label}:l);}
// Goal reminders: the Claude UserPromptSubmit hook adds these as hidden context to every prompt in a goal's terminals.
const goalReminderCache=new Map();
// Phone access: when on, every interactive Claude started in a terminal also runs Remote Control (claude.ai/code and the Claude app),
// named after the terminal. The switch is a flag file the shell wrapper checks; names are refreshed on every save.
// Terminator on your phone (web app via Tailscale): see src/phone-server.cjs. Settings: userData/phone-web.json {enabled, token}.
const {createPhoneServer}=require('./src/phone-server.cjs');let phoneServer=null;
function phoneWebFile(){return path.join(app.getPath('userData'),'phone-web.json');}
function phoneWeb(){let v={};try{v=JSON.parse(fs.readFileSync(phoneWebFile(),'utf8'));}catch{}if(typeof v.token!=='string'||v.token.length<32){v.token=crypto.randomBytes(24).toString('base64url');fs.writeFileSync(phoneWebFile(),JSON.stringify(v),{mode:0o600});}return v;}
function setPhoneWeb(patch){const v={...phoneWeb(),...patch};fs.writeFileSync(phoneWebFile(),JSON.stringify(v),{mode:0o600});return v;}
function phoneWorkspaces(){return workspaces.filter(w=>!w.archived).map(({archivedTerminals,...w})=>w);}
function phoneState(){return {workspaces:phoneWorkspaces(),activeWorkspaceId,order:menuBarOrder,sessions:[...sessions.values()].map(s=>({...publicSession(s),cols:s.pty?.cols,rows:s.pty?.rows}))};}
async function phoneSend(s,text){if(typeof text!=='string'||!text.length||text.length>100000)throw Error('Nothing to send.');trackInput(s,text);s.pty.write(s.pasteReady&&s.agent?`\x1b[200~${text}\x1b[201~`:text);await new Promise(r=>setTimeout(r,350));s.pty.write('\r');}
function startPhoneServer(){if(phoneServer)return phoneServer;phoneServer=createPhoneServer({distDir:path.join(__dirname,'dist'),port:Number(process.env.TS_PHONE_PORT)||(previewBuild?47822:47821),api:{
  token:()=>phoneWeb().token,state:phoneState,
  // The raw history with the width it was written at (the Mac's), so the phone can replay it at that width and then re-wrap it to its own.
  buffer:id=>{const s=sessions.get(id);if(!s)throw Error('Terminal unavailable.');const size=s.phoneSize?s.desktopSize:{cols:s.pty.cols,rows:s.pty.rows};return {data:s.buffer.slice(-600000),modes:mouseModes(s.modes),cols:size?.cols||null,rows:size?.rows||null};},
  input:(id,data)=>{const s=sessions.get(id);if(!s||s.status==='closed'||typeof data!=='string'||data.length>100000)throw Error('Terminal unavailable.');trackInput(s,data);s.pty.write(data);},
  send:(id,text)=>{const s=sessions.get(id);if(!s||s.status==='closed')throw Error('Terminal unavailable.');return phoneSend(s,text);},
  watch:(id,size,on)=>{const s=sessions.get(id);if(!s||s.status==='closed')return;if(on&&size&&size.cols>=20&&size.cols<=300&&size.rows>=8&&size.rows<=200){s.desktopSize??={cols:s.pty.cols,rows:s.pty.rows};s.phoneSize=size;s.pty.resize(size.cols,size.rows);send('session',publicSession(s));}else if(!on&&s.phoneSize){s.phoneSize=null;const d=s.desktopSize||{cols:100,rows:30};s.pty.resize(d.cols,d.rows);send('session',publicSession(s));}},
  action:async b=>{const s=sessions.get(b?.id);
   if(b?.kind==='read'&&s){if(s.unreadDone){s.unreadDone=false;save();updateBadge();send('session',publicSession(s));}return;}
   if(b?.kind==='claude'&&s){if(!s.agent&&['ready','done','error'].includes(s.status))s.pty.write('claude --dangerously-skip-permissions\r');return;}
   if(b?.kind==='resume'&&s){if(s.agent)throw Error('Claude is already running here.');const record=s.lastSession;if(!record)throw Error('No earlier chat in this terminal.');const command=restoreCommand(record);if(!command)throw Error('That chat can no longer be resumed.');s.pty.write(command);update(s,'running');return;}
   throw Error('Unknown action.');}}});phoneServer.start();return phoneServer;}
// Secure address: iPhones that only allow HTTPS need https://<mac>.<tailnet>.ts.net. Terminator asks Tailscale
// ("tailscale serve") to forward that address, with Tailscale's certificate, to the phone server on 127.0.0.1.
// Tailnet-only (not Funnel). Terminator uses https port 443, Terminator Preview 8443.
const phoneHttpsPort=()=>previewBuild?8443:443;let phoneHttps={state:'unknown'};
function tailscaleCli(){for(const p of ['/Applications/Tailscale.app/Contents/MacOS/Tailscale','/opt/homebrew/bin/tailscale','/usr/local/bin/tailscale'])if(fs.existsSync(p))return p;return null;}
// The Tailscale Mac app's binary only behaves as a command-line tool when TERM is set (else: "The Tailscale GUI failed to start").
function runTailscale(args,timeout=20000){const cli=tailscaleCli();if(!cli)return Promise.resolve({code:-1,out:''});return new Promise(resolve=>execFile(cli,args,{timeout,env:{...process.env,TERM:process.env.TERM||'dumb'}},(error,stdout,stderr)=>resolve({code:error?(error.code??1):0,out:String(stdout||'')+String(stderr||'')})));}
async function setupPhoneHttps(){if(!phoneServer||(process.env.TS_TEST&&!process.env.TS_PHONE_HTTPS)){phoneHttps={state:'off'};return phoneHttps;}const cli=tailscaleCli();if(!cli){phoneHttps={state:'no-tailscale'};return phoneHttps;}
 const status=await runTailscale(['status','--json']);let dns=null;try{dns=JSON.parse(status.out.slice(status.out.indexOf('{'))).Self?.DNSName?.replace(/\.$/,'')||null;}catch{}
 if(!dns){phoneHttps={state:'no-tailscale'};return phoneHttps;}
 const port=phoneHttpsPort(),r=await runTailscale(['serve','--bg','--yes',`--https=${port}`,`http://127.0.0.1:${phoneServer.PORT}`]);
 const enable=r.out.match(/https:\/\/login\.tailscale\.com\/\S+/)?.[0];
 if(/not enabled/i.test(r.out)||enable){phoneHttps={state:'needs-approval',enableUrl:enable||'https://login.tailscale.com/admin/dns',dns};return phoneHttps;}
 const check=await runTailscale(['serve','status','--json']);const ok=check.out.includes(`127.0.0.1:${phoneServer.PORT}`);
 phoneHttps=ok?{state:'ready',url:`https://${dns}${port===443?'':':'+port}/`,dns}:{state:'error',detail:r.out.trim().slice(0,300),dns};return phoneHttps;}
async function stopPhoneHttps(){if(tailscaleCli())await runTailscale(['serve',`--https=${phoneHttpsPort()}`,'off']);phoneHttps={state:'off'};}
function phoneWebInfo(){const v=phoneWeb(),addresses=phoneServer?.addresses()||[];const host=addresses[0];const secure=phoneHttps.state==='ready'?phoneHttps.url:null;
 return {enabled:!!v.enabled,running:!!phoneServer,tailscale:addresses.length>0,addresses,https:phoneHttps,url:secure?`${secure}#t=${v.token}`:host?`http://${host}:${phoneServer.PORT}/#t=${v.token}`:null};}
// Drafts: prompts written for a terminal to send later. They live with the terminal (saved with it) and are sent
// into its Claude/Codex input on request, the same way a typed prompt would be.
function cleanDrafts(list){return (Array.isArray(list)?list:[]).filter(d=>d&&typeof d.text==='string'&&d.text.trim()&&typeof d.id==='string').slice(0,30).map(d=>({id:d.id.slice(0,40),text:d.text.slice(0,50000),createdAt:Number(d.createdAt)||Date.now(),updatedAt:Number(d.updatedAt)||undefined}));}
function phoneSettingsFile(){return path.join(app.getPath('userData'),'phone.json');}
function phoneEnabled(){try{return JSON.parse(fs.readFileSync(phoneSettingsFile(),'utf8')).enabled===true;}catch{return false;}}
function syncPhone(){if(!runtime)return;const flag=path.join(runtime,'phone-on'),dir=path.join(runtime,'phone-names');try{if(phoneEnabled())fs.writeFileSync(flag,'1');else fs.rmSync(flag,{force:true});fs.mkdirSync(dir,{recursive:true});for(const s of sessions.values()){const name=String(s.title||'Terminal').replace(/[\x00-\x1f]/g,' ').slice(0,60),f=path.join(dir,s.id);let old=null;try{old=fs.readFileSync(f,'utf8');}catch{}if(old!==name)fs.writeFileSync(f,name);}}catch(error){console.error('phone sync',error);}}
function connectRunningToPhone(){let n=0;for(const s of sessions.values()){if(!s.agent||s.provider!=='claude'||!['ready','done'].includes(s.status)||s.manualInput||s.routerSending||s.remoteControl)continue;s.pty.write('/remote-control');setTimeout(()=>{if(s.agent&&!s.manualInput)s.pty.write('\r');},400);n++;}return n;}
function syncGoalReminders(){if(!runtime)return;const dir=path.join(runtime,'goals'),wanted=new Map();
  for(const id of terminalsWithGoals(workspaces))if(/^[a-f0-9-]{36}$/.test(id))wanted.set(id,goalReminder(goalsForTerminal(workspaces,id)));
  try{fs.mkdirSync(dir,{recursive:true,mode:0o700});}catch{return;}
  for(const [id,text] of wanted){if(goalReminderCache.get(id)===text)continue;try{fs.writeFileSync(path.join(dir,id+'.txt'),text,{mode:0o600});goalReminderCache.set(id,text);}catch{}}
  for(const id of [...goalReminderCache.keys()])if(!wanted.has(id)){try{fs.rmSync(path.join(dir,id+'.txt'),{force:true});}catch{}goalReminderCache.delete(id);}
}
// Subgoal changes requested by the agent inside a terminal (integration/goal.cjs). Only goals that terminal works on can change.
// Adds a goal to a workspace; with `terminal`, a Claude terminal is opened for it (through the router).
function addGoal(w,goal,terminal){
  const previous=w.goals;w.goals=[...(w.goals||[]),goal];
  if(!terminal){try{save();}catch(error){w.goals=previous;throw error;}return w;}
  const job={id:crypto.randomUUID(),goalId:goal.id,prompt:goal.text,workspaceId:w.id,status:'needs-terminal',title:'Claude',reason:''};
  goal.routeId=job.id;routerJobs.push(job);
  const entry={text:goal.text,timestamp:goal.createdAt,workspaceId:w.id,title:'Goal',provider:'claude',routeId:job.id};promptLog.push(entry);
  try{save();}catch(error){w.goals=previous;routerJobs=routerJobs.filter(j=>j!==job);promptLog=promptLog.filter(p=>p!==entry);throw error;}
  send('router',routerJobs);return w;
}
// Goal sync: another feature can mirror goals to a task board elsewhere (refresh brings its changes in, changed sends
// one out). No-ops unless such a feature sets them.
const goalSync={refresh(){},changed(){}};
function agentGoalChange(s,data){
  const entries=goalsForTerminal(workspaces,s.id);
  let goal=null;
  if(data.action==='add'){const entry=entries.find(e=>e.goal.id===data.target);if(!entry)return;addSubgoal(entry.goal,String(data.text||''),{source:'agent',terminalId:s.id});goal=entry.goal;}
  else if(data.action==='done'||data.action==='undone'){const entry=entries.find(e=>subgoals(e.goal).some(x=>x.id===data.target));if(!entry)return;updateSubgoal(entry.goal,data.target,{done:data.action==='done'});goal=entry.goal;}
  else return;
  save();send('workspaces',workspaces);goalSync.changed(goal);
}

function create(options = {}) {
  let cwd = options.cwd || defaultCwd;
  if(options.restore){try{if(!fs.statSync(cwd).isDirectory())cwd=defaultCwd;}catch{cwd=defaultCwd;}}
  if (typeof cwd !== 'string' || !fs.statSync(cwd).isDirectory()) throw new Error('Choose an existing folder.');
  const id = typeof options.id==='string' && /^[a-f0-9-]{36}$/.test(options.id) && !sessions.has(options.id) ? options.id : crypto.randomUUID(), token = crypto.randomBytes(24).toString('hex');
  const s = { id, token, links:[], linkNames:linkNamesFrom(options.linkNames), hiddenLinks:Array.isArray(options.hiddenLinks)?options.hiddenLinks.filter(k=>typeof k==='string').slice(-500):[], drafts:cleanDrafts(options.drafts), title: String(options.title || `Terminal ${sessions.size + 1}`).slice(0,80), color: options.restore&&validColor(options.color)?options.color:![...sessions.values()].some(t=>t.workspaceId===(options.workspaceId||activeWorkspaceId))?(validColor(options.color)?options.color:'#ff3ca6'):unusedColor([...sessions.values()].map(s=>s.color),legacyColors.includes(options.color)?colors[legacyColors.indexOf(options.color)]:options.color), workspaceId:workspaces.some(w=>w.id===options.workspaceId)?options.workspaceId:activeWorkspaceId, model:null, effort:null, latestPrompt:lastRealPrompt(Array.isArray(options.promptHistory)?options.promptHistory:[],options.latestPrompt||'')||null,promptHistory:Array.isArray(options.promptHistory)?options.promptHistory.filter(p=>!isSystemPrompt(p)).slice(-8):[], lastSession:options.lastSession||(validId(options.resumeSession)?{provider:'claude',id:options.resumeSession,cwd:options.resumeCwd||cwd}:null), sessionHistory:options.sessionHistory||[], resumeSession:validId(options.resumeSession)?options.resumeSession:null, resumeCwd:typeof options.resumeCwd==='string'?options.resumeCwd:cwd, cwd, unreadDone:!!options.unreadDone,status:'starting', startedAt:null, endedAt:null, createdAt:Date.now(), agent:false, buffer:'', pending:'', modes:createModes() };
  const env = { ...process.env, TERM:'xterm-256color', COLORTERM:'truecolor', ZDOTDIR:path.join(__dirname,'integration'), TS_INTEGRATION:path.join(__dirname,'integration'), TS_ORIGINAL_ZDOTDIR:process.env.ZDOTDIR || '', TS_SOCKET:path.join(runtime,'events.sock'), TS_TOKEN:token, TS_TERMINAL:id, TS_CLAUDE_SETTINGS:settingsFile,TS_PHONE_FLAG:path.join(runtime,'phone-on'),TS_PHONE_NAMES:path.join(runtime,'phone-names'), TS_NODE:process.execPath, TS_CODEX_NOTIFY:JSON.stringify(['/usr/bin/env','ELECTRON_RUN_AS_NODE=1',process.execPath,path.join(__dirname,'integration/codex-notify.cjs')]) };
  delete env.ELECTRON_RUN_AS_NODE;
  // Terminals must not inherit the environment of whatever launched Terminator (e.g. a Claude Code session:
  // CLAUDE_CODE_CHILD_SESSION turns off transcript saving and resume; Apple Terminal's markers make zsh save sessions inside the app).
  for(const key of Object.keys(env))if(/^(CLAUDECODE|CLAUDE_CODE_|CLAUDE_PID$|CLAUDE_EFFORT$|CODEX_(SANDBOX|THREAD|SESSION|MANAGED)|TERM_PROGRAM|TERM_SESSION_ID$|SHELL_SESSION_|ITERM_|__CF)/.test(key))delete env[key];
  env.TERM_PROGRAM='Terminator';env.SHELL_SESSIONS_DISABLE='1';
  s.pty = pty.spawn('/bin/zsh', ['-l'], { name:'xterm-256color', cols:100, rows:30, cwd, env });
  restoreTranscriptBackup(s.lastSession);
  s.resumeAvailable=!!s.lastSession&&(s.lastSession.provider==='codex'||!!claudeTranscript(s.lastSession,claudeHome));
  s.restorePending=options.restore===true&&s.resumeAvailable?restoreCommand(s.lastSession):null;
  if(options.restore&&!s.restorePending&&typeof options.buffer==='string')s.buffer=options.buffer.slice(-2000000);
  sessions.set(id,s);
  s.pty.onData(data => {
    // Strip only app-owned OSC records, including records split across PTY chunks.
    let input = s.pending + data; s.pending = '';
    const marker = '\x1b]777;ts;';
    let output = '';
    while (input) {
      const start = input.indexOf(marker);
      if (start < 0) {
        let tail = 0;
        for (let n=1;n<marker.length;n++) if(input.endsWith(marker.slice(0,n))) tail=n;
        const piece = tail ? input.slice(0,-tail) : input; output += piece; trackModes(s.modes,piece);
        s.pending = tail ? input.slice(-tail) : ''; break;
      }
      output += input.slice(0,start); trackModes(s.modes,input.slice(0,start));
      const end = input.indexOf('\x07',start);
      if(end < 0) { s.pending=input.slice(start); break; }
      const [key,event,code] = input.slice(start+marker.length,end).split(';');
      if(key === token) {
        if(event==='running'||event==='done')clearModes(s.modes);
        if(event==='running') { s.provider=null;s.codexActive=false;s.codexSession=null;s.codexDisplayTail='';s.codexDisplaySeen=null;s.modelObservedAt=0;s.agentReadyAt=null;s.lastLifecycleAt=Date.now();clearInput(s);s.agent=false; s.model=null; s.effort=null; s.claudeSession=null; update(s,'running'); }
        if(event==='cwd'){try{const folder=Buffer.from(code,'base64').toString('utf8');if(path.isAbsolute(folder)&&fs.statSync(folder).isDirectory()&&s.cwd!==folder){s.cwd=folder;save();send('session',publicSession(s));}}catch{}}
        if(event==='codex'||event==='claude'){s.provider=event;s.agent=true;s.codexActive=event==='codex';s.agentLaunchedAt=Date.now();s.agentReadyAt=Date.now()+1500;s.lastLifecycleAt=0;update(s,'starting');}
        if(event==='done') {s.remoteControl=false;s.codexActive=false;s.provider=null;s.codexSession=null;s.claudeSession=null;s.lastLifecycleAt=Date.now();clearInput(s);s.agent=false; s.exitCode=Number(code); update(s, Number(code) ? 'error':'done');if(s.restorePending){const command=s.restorePending;s.restorePending=null;setTimeout(()=>{s.pty.write(command);},50);} }
      }
      input=input.slice(end+1);
    }
    if(output) { s.lastOutputAt=Date.now();if(!s.remoteControl&&s.agent&&/remote-control is active|\/rc active|Remote Control active/i.test(output.replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g,''))){s.remoteControl=true;send('session',publicSession(s));}if(s.codexActive){s.codexDisplayTail=((s.codexDisplayTail||'')+output).slice(-4096);const metadata=codexDisplayMetadata(s.codexDisplayTail);if(metadata&&s.codexDisplaySeen!==JSON.stringify(metadata)){s.codexDisplaySeen=JSON.stringify(metadata);s.model=metadata.model;s.effort=metadata.effort;s.modelObservedAt=Date.now();send('session',publicSession(s));}}const modes=(s.modeTail||'')+output;for(const match of modes.matchAll(/\x1b\[\?2004([hl])/g))s.pasteReady=match[1]==='h';s.modeTail=modes.slice(-12);outputDirty=true;s.buffer=(s.buffer+output).slice(-2000000); send('output',{id,data:output});if(phoneServer)phoneServer.broadcast('output',{id,data:output},id); }
  });
  s.pty.onExit(({exitCode}) => { s.exitCode=exitCode; update(s,'closed'); });
  save(); return publicSession(s);
}
function register(name, fn) {
  ipcMain.handle(name, (event, ...args) => {
    if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) throw new Error('Invalid sender');
    return fn(...args);
  });
}
app.on('second-instance',()=>{if(win&&!win.isDestroyed()){if(win.isMinimized())win.restore();win.show();win.focus();}});
app.whenReady().then(async () => {
  setTimeout(startChatSearch,5000);
 usageTimer=setInterval(refreshUsage,60000);
  if(!primaryInstance)return;
  runtime = fs.mkdtempSync(path.join(os.tmpdir(),'terminalsteroid-'));
  fs.chmodSync(runtime,0o700);
  settingsFile = path.join(runtime,'claude.json');
  const quote = value => "'" + value.replace(/'/g,"'\\''") + "'";
  const hook = `ELECTRON_RUN_AS_NODE=1 ${quote(process.execPath)} ${quote(path.join(__dirname,'integration/hook.cjs'))}`;
  const hooks = {};
  for(const event of ['SessionStart','UserPromptSubmit','PreToolUse','PostToolUse','PermissionRequest','Stop','StopFailure','Notification','SessionEnd']) hooks[event]=[{hooks:[{type:'command',command:hook,timeout:2}]}];
  fs.writeFileSync(settingsFile,JSON.stringify({hooks,statusLine:{type:'command',command:hook+' --statusline'}}),{mode:0o600});
  server = net.createServer(socket => {
    let buffer=''; socket.setTimeout(2000,()=>socket.destroy());
    socket.on('error',()=>{});
    socket.on('data',chunk=>{ buffer+=chunk; if(buffer.length>4*1024*1024) socket.destroy(); });
    socket.on('end',()=>{
      try {
        const data=JSON.parse(buffer), s=sessions.get(data.id);
        if(!s || data.token!==s.token || data.agent) return;
        if(data.event==='Goal'){agentGoalChange(s,data);return;}
        if(data.provider==='codex'){s.provider='codex';s.codexSession=data.session;s.lastLifecycleAt=Date.now();s.agentReadyAt??=Date.now();if(!isSystemPrompt(data.prompt))acknowledgePrompt(s,data.prompt,'codex',data.session);s.resumeAvailable=true;if(remember(s,{provider:'codex',id:data.session,cwd:data.cwd})){save();}if(typeof data.prompt==='string'&&!isSystemPrompt(data.prompt)){s.latestPrompt=data.prompt;s.lastObservedPromptAt=Date.now();save();}s.agent=true;s.codexActive=true;s.startedAt??=Date.now();save();update(s,'Stop');return;}
        if(data.event!=='SessionStart' && s.claudeSession && data.session!==s.claudeSession)return;
        if(['UserPromptSubmit','Stop','StatusLine'].includes(data.event)&&validId(data.session)){const transcript=claudeTranscript({id:data.session,transcript:data.transcript},claudeHome);const notSaving=!transcript&&data.event==='Stop';if(notSaving!==!!s.notSaving&&(transcript||notSaving)){s.notSaving=notSaving;send('session',publicSession(s));}if(transcript&&data.event==='Stop')backupTranscript(data.session,transcript);if(transcript){const changed=s.resumeSession!==data.session||s.resumeCwd!==data.cwd;s.resumeSession=data.session;s.resumeAvailable=true;if(typeof data.cwd==='string')s.resumeCwd=data.cwd;if(remember(s,{provider:'claude',id:data.session,cwd:data.cwd,transcript})||changed)save();}}
        if(data.event==='SessionStart') {s.provider='claude';s.agentReadyAt=Date.now()+1500;s.lastLifecycleAt=Date.now();clearInput(s);s.claudeReadyAt=null;s.contextPercent=null;s.claudeSession=data.session;s.model=null;s.effort=null;s.latestPrompt=s.latestPrompt||recentChats(path.join(process.env.CLAUDE_CONFIG_DIR||path.join(os.homedir(),'.claude'),'history.jsonl')).find(c=>c.id===data.session)?.prompt||null;}
        if(data.event==='StatusLine') {s.provider='claude';s.agentReadyAt??=Date.now()+1500;s.claudeReadyAt??=Date.now()+1500;
          receiveClaudeUsage(data.rateLimits);s.contextPercent=Number.isFinite(data.contextPercent)?data.contextPercent:null;
          if(s.claudeSession && data.session!==s.claudeSession)return;
          s.agent=true;s.claudeSession=data.session;
          s.model=typeof data.model==='string'?data.model.slice(0,100):null;
          s.effort=typeof data.effort==='string'?data.effort.slice(0,30):null;
          send('session',publicSession(s));return;
        }
        if(s.claudeSession && data.session!==s.claudeSession) return;
        s.provider='claude';if(data.event!=='Notification'||claudeNotification(data.notification))s.lastLifecycleAt=Date.now();s.agent=data.event!=='SessionEnd';
        if(data.event==='UserPromptSubmit'&&typeof data.prompt==='string'&&!isSystemPrompt(data.prompt)){if(!s.manualInput)clearInput(s);s.lastObservedPromptAt=Date.now();acknowledgePrompt(s,data.prompt,'claude',data.session);s.latestPrompt=data.prompt;s.promptHistory=[...(s.promptHistory||[]),data.prompt].slice(-8);save();}
        if(data.event==='Notification') {
          const event=claudeNotification(data.notification);if(event)update(s,event,data.notification==='elicitation_dialog'?'question':data.notification==='idle_prompt'?'idle':null);
        } else if(data.event==='SessionEnd') {s.model=null;s.effort=null;update(s,'done');}
        else if(data.event==='PreToolUse'&&data.tool==='AskUserQuestion')update(s,'attention','question');
        else if(data.event==='Stop'){const file=claudeTranscript({id:data.session,transcript:data.transcript},claudeHome);update(s,'Stop',asksQuestion(typeof data.lastMessage==='string'?data.lastMessage:file?lastAssistantText(file):'')?'question':null);}
        else update(s,data.event);
      } catch {}
    });
  });
  await new Promise(resolve=>server.listen(path.join(runtime,'events.sock'),resolve));
  win = new BrowserWindow({width:1500,height:960,minWidth:800,minHeight:540,title:process.env.TS_TEST||previewBuild?'Terminator Preview':'Terminator',backgroundColor:'#ffffff',titleBarStyle:'hiddenInset',trafficLightPosition:{x:18,y:18},webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  win.on('minimize',()=>{for(const other of BrowserWindow.getAllWindows())if(other!==win&&!other.isMinimized())other.minimize();});
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  win.webContents.on('will-navigate', event=>event.preventDefault());
  appMenuKey=null;buildAppMenu();
  register('init',()=>({sessions:[...sessions.values()].map(s=>({...publicSession(s),buffer:s.buffer})),defaultCwd,colors,workspaces,activeWorkspaceId}));
  register('menu-bar-state',state=>{
    if(!state || state.workspaceId!==activeWorkspaceId)return;
    const valid=ids=>Array.isArray(ids)?[...new Set(ids)].filter(id=>sessions.get(id)?.workspaceId===activeWorkspaceId):[];
    menuBarOrder[activeWorkspaceId]={priority:valid(state.priority),rest:valid(state.rest)};
    menuBarSelected=sessions.get(state.selected)?.workspaceId===activeWorkspaceId?state.selected:null;
  });
  if(process.platform==='darwin')menuBar=createMenuBar({Tray,Menu,nativeImage},()=>({
    workspace:workspaces.find(w=>w.id===activeWorkspaceId),sessions:[...sessions.values()],
    order:menuBarOrder[activeWorkspaceId],selected:menuBarSelected,workspaces,orders:menuBarOrder,
  }),action=>{
    if(win.isDestroyed())return;
    if(win.isMinimized())win.restore();
    win.show();win.focus();send('menu-bar-open',action);
  });
  register('grid-menu',items=>new Promise(resolve=>{
    if(!Array.isArray(items)||items.length>24){resolve(null);return;}
    const template=items.filter(i=>['row','col'].includes(i.axis)&&Number.isInteger(i.index)&&i.index>=0&&i.index<16).map(i=>({label:`Delete ${i.axis==='col'?'column':'row'} ${i.index+1}`,enabled:!!i.enabled,click:()=>resolve({axis:i.axis,index:i.index})}));
    if(items.some(i=>i.action==='create'))template.unshift({label:'New terminal',click:()=>resolve({action:'create'})},{type:'separator'});
    Menu.buildFromTemplate(template).popup({window:win,callback:()=>resolve(null)});
  }));
  register('terminal-links',(id,text)=>{const s=sessions.get(id);if(!s||typeof text!=='string'||text.length>2000000)return;const cwd=s.lastSession?.cwd||s.cwd||null;const file=s.lastSession?.provider==='claude'?claudeTranscript(s.lastSession,claudeHome):null;const authoritative=file?sourceLinks(file,cwd):null;const screen=extractLinks(text,{cwd,files:authoritative===null}).filter(l=>authoritative===null||(!l.file&&['localhost','127.0.0.1','[::1]'].includes(new URL(l.url).hostname)));const links=uniqueLabels(visibleLinks(s,[...new Map([...(authoritative||[]),...screen].map(l=>[linkKey(l),l])).values()].filter(l=>!l.file||existingFile(l.path))));if(JSON.stringify(s.links)!==JSON.stringify(links)){s.links=links;save();send('session',publicSession(s));}});
  // Clickable paths and URLs inside the terminal text. Paths resolve against the terminal's folder; only existing files/folders count.
  register('resolve-paths',(id,candidates)=>{const s=sessions.get(id);if(!s||!Array.isArray(candidates))return [];const cwd=s.lastSession?.cwd||s.cwd||os.homedir();
    return candidates.slice(0,200).map(raw=>{if(typeof raw!=='string'||raw.length>1024)return null;let p=raw.replace(/^file:\/\//,'');try{p=decodeURIComponent(p);}catch{}p=p.replace(/:(\d+)(?::\d+)?$/,'');
      if(p.startsWith('~/'))p=path.join(os.homedir(),p.slice(2));else if(!path.isAbsolute(p))p=path.resolve(cwd,p);
      try{const st=fs.statSync(p);return {raw,path:p,isDir:st.isDirectory()};}catch{return null;}}).filter(Boolean);});
  register('open-path',(id,target)=>{if(!sessions.has(id)||typeof target!=='string'||!path.isAbsolute(target))throw Error('Unknown path.');let st;try{st=fs.statSync(target);}catch{throw Error('This file no longer exists.');}
    if(st.isFile()&&SAFARI_TYPES.test(target))return new Promise((resolve,reject)=>execFile('/usr/bin/open',['-a','Safari',target],e=>e?reject(Error('Could not open the file in Safari.')):resolve()));
    return shell.openPath(target).then(error=>{if(error)throw Error(error);});});
  register('open-url',(id,url)=>{if(!sessions.has(id))throw Error('Unknown terminal.');let u;try{u=new URL(url);}catch{throw Error('Not a link.');}if(!['http:','https:'].includes(u.protocol))throw Error('Not a web link.');return shell.openExternal(u.href);});
  register('rename-terminal-link',(id,key,name)=>{const s=sessions.get(id);if(!s||typeof key!=='string'||!(s.links||[]).some(l=>linkKey(l)===key))throw Error('Unknown terminal link.');s.linkNames={...(s.linkNames||{})};if(typeof name==='string'&&name.trim())s.linkNames[key]=name.trim().slice(0,80);else delete s.linkNames[key];save();send('session',publicSession(s));});
  register('remove-terminal-link',(id,key)=>{const s=sessions.get(id);if(!s||typeof key!=='string'||key.length>2000)throw Error('Unknown terminal link.');s.hiddenLinks=[...new Set([...(s.hiddenLinks||[]),key])].slice(-500);s.links=(s.links||[]).filter(l=>linkKey(l)!==key);save();send('session',publicSession(s));});
  register('open-terminal-link',(id,url)=>{const link=sessions.get(id)?.links?.find(l=>l.url===url);if(!link)throw Error('Unknown terminal link.');
    if(link.file){if(!existingFile(link.path))throw Error('This file no longer exists.');return new Promise((resolve,reject)=>execFile('/usr/bin/open',['-a','Safari',link.path],error=>error?reject(Error('Could not open the file in Safari.')):resolve()));}
    if(!supportedLink(url))throw Error('Unknown terminal link.');return shell.openExternal(url);});
  register('visit',id=>{const s=sessions.get(id);if(s?.unreadDone){s.unreadDone=false;save();updateBadge();send('session',publicSession(s));}});
  register('create',options=>create(options));
  register('prompts',()=>collectPrompts([...sessions.values(),...closedTerminals,...workspaces.flatMap(w=>w.archivedTerminals||[])],promptLog,{claude:path.join(claudeHome,'history.jsonl'),codex:path.join(process.env.CODEX_HOME||path.join(os.homedir(),'.codex'),'history.jsonl')}));
  register('router-state',()=>routerJobs);
  register('router-steer',id=>{const job=routerJobs.find(j=>j.id===id);if(job?.status!=='queued')throw Error('This message is no longer queued.');const s=sessions.get(job.terminalId);if(!s?.agent||identity(s)!==job.sessionId)throw Error('The destination conversation has ended.');if(s.manualInput)throw Error('Submit or clear the typed input in the destination terminal first.');s.pty.write('\x1b');job.steer=true;job.notBefore=Date.now()+1200;job.waiting='Interrupting current response…';routerPublish();});
  register('router-edit-start',id=>{const job=routerJobs.find(j=>j.id===id);if(job?.status!=='queued')throw Error('This message is already being sent or is no longer queued.');job.status='editing';routerPublish();return job.prompt;});
  register('router-edit-save',(id,prompt)=>{const job=routerJobs.find(j=>j.id===id);if(job?.status!=='editing')throw Error('This message is no longer being edited.');if(prompt!==null){if(typeof prompt!=='string'||!prompt.trim()||prompt.length>50000||/[\x00-\x08\x0b-\x1f\x7f]/.test(prompt))throw Error('Enter a message of up to 50,000 characters.');job.prompt=prompt;const entry=promptLog.find(p=>p.routeId===id);if(entry)entry.text=prompt;}job.status='queued';routerPublish();});
  register('router-cancel',id=>{routerJobs=routerJobs.filter(j=>j.id!==id||j.status==='sent');routerPublish();});
  register('router-create',id=>{
    const job=routerJobs.find(j=>j.id===id&&j.status==='needs-terminal');if(!job)throw Error('Request is no longer waiting for a terminal.');
    const session=create({workspaceId:job.workspaceId,cwd:defaultCwd,title:job.prompt.trim().split('\n')[0].slice(0,36)||'Claude'});
    const live=sessions.get(session.id);live.restorePending='claude --dangerously-skip-permissions\r';
    const goal=workspaces.find(w=>w.id===job.workspaceId)?.goals?.find(g=>g.id===job.goalId);if(goal){goal.terminalIds=[...goalTerminals(goal).filter(id=>id!==session.id),session.id];delete goal.terminalId;send('workspaces',workspaces);}
    Object.assign(job,{terminalId:session.id,title:session.title,status:'starting',startDeadline:Date.now()+90000});routerPublish();return session;
  });
  register('router-create-error',(id,message)=>{const job=routerJobs.find(j=>j.id===id&&j.status==='needs-terminal');if(job){job.status='error';job.reason=String(message).slice(0,200);routerPublish();}});
  register('router-send',async prompt=>{
    if(typeof prompt!=='string'||!prompt.trim()||prompt.length>50000||/[\x00-\x08\x0b-\x1f\x7f]/.test(prompt))throw Error('Enter a message of up to 50,000 characters.');
    const candidates=[...sessions.values()].filter(s=>s.status!=='closed');
    const job={id:crypto.randomUUID(),prompt,workspaceId:activeWorkspaceId,status:'routing',title:'Claude',reason:''};routerJobs.push(job);promptLog.push({text:prompt,timestamp:Date.now(),title:'Router',provider:'claude',routeId:job.id});routerJobs=routerJobs.filter(j=>!['sent','error'].includes(j.status)).concat(routerJobs.filter(j=>['sent','error'].includes(j.status)).slice(-10));routerPublish();
    try{const history=await collectPrompts(candidates,promptLog,{claude:path.join(claudeHome,'history.jsonl'),codex:path.join(process.env.CODEX_HOME||path.join(os.homedir(),'.codex'),'history.jsonl')});
      const result=await choose(prompt,candidates.map(s=>({id:s.id,title:s.title,workspace:workspaces.find(w=>w.id===s.workspaceId)?.title,cwd:s.cwd,status:s.status,provider:s.provider,routable:!!identity(s),recentPrompts:history.filter(p=>p.terminalId===s.id).slice(0,5).reverse().map(p=>p.text),contextPercent:s.contextPercent??null,model:s.model})));

      if(!routerJobs.includes(job))return;
      if(result.terminalId==='new'){Object.assign(job,{status:'needs-terminal',reason:result.reason});routerPublish();return;}
      const target=sessions.get(result.terminalId);if(!identity(target))throw Error('Chosen model session has ended.');
      Object.assign(job,{terminalId:target.id,sessionId:identity(target),provider:target.provider,title:target.title,reason:result.reason,status:'queued'});routerPublish();
    }catch(e){job.status='error';job.reason=e.message;routerPublish();}
  });
  register('input',(id,data)=>{if(typeof data==='string' && data.length<=1048576 && sessions.get(id)?.status!=='closed'){const s=sessions.get(id);if(s){trackInput(s,data);s.pty.write(data);}}});
  // Safety net for turns that end without a Stop hook: the renderer reports when Claude's screen has shown no
  // "esc to interrupt" footer or spinner for a while. Only trusted when no hook or transcript activity arrived for 15 s.
  register('screen-idle',id=>{const s=sessions.get(id);if(!s||s.status!=='running'||!s.agent||s.provider!=='claude'||Date.now()-(s.lastLifecycleAt||0)<15000)return false;s.lastLifecycleAt=Date.now();update(s,'Stop');return true;});
  // Git view: repos, branches, worktrees and pull requests for the folders your terminals work in (git + gh only).
  const gitFolders=()=>[...sessions.values()].flatMap(s=>[s.resumeCwd,s.lastSession?.cwd,s.cwd]).filter(f=>typeof f==='string');
  // Per terminal: the branches it worked on (folders Claude was in → worktree → branch) and the tests it ran there.
  const terminalWork=async data=>{const features={},branchRuns={};
   for(const s of sessions.values()){const files=new Set();for(const r of [s.lastSession,...(s.sessionHistory||[])])if(r?.provider==='claude'){const f=claudeTranscript(r,claudeHome);if(f)files.add(f);}
    const byBranch=new Map();
    for(const f of files){const c=scanTranscript(f);await new Promise(r=>setImmediate(r));if(!c)continue;
     const slot=(folder,at)=>{const w=gitLocate(data,folder);if(!w||!w.branch)return null;const k=w.repo+'\0'+w.branch;if(!byBranch.has(k))byBranch.set(k,{repo:w.repo,branch:w.branch,worktree:w.worktree,lastAt:0,runs:[]});const e=byBranch.get(k);if(at>e.lastAt)e.lastAt=at;return e;};
     for(const [folder,at] of c.folders)slot(folder,at);
     for(const run of c.runs){const e=slot(run.folder,run.at||0);if(e)e.runs.push(run);}}
    const list=[...byBranch.values()].sort((a,b)=>b.lastAt-a.lastAt);
    for(const e of list){e.runs.sort((a,b)=>(a.at||0)-(b.at||0));const k=e.repo+'\0'+e.branch;(branchRuns[k]||=[]).push(...e.runs.map(r=>({...r,terminal:s.id})));e.runCount=e.runs.length;e.runs=e.runs.slice(-5);}
    if(list.length)features[s.id]=list.slice(0,12);}
   for(const k of Object.keys(branchRuns)){const runs=branchRuns[k].sort((a,b)=>(a.at||0)-(b.at||0));branchRuns[k]={count:runs.length,last:runs.slice(-5)};}
   return {features,branchRuns};};
  const gitWithTerminals=async data=>{if(!data)return data;const work=await terminalWork(data).catch(()=>({features:{},branchRuns:{}}));return {...data,terminals:Object.fromEntries([...sessions.values()].map(s=>[s.id,gitLocate(data,s.resumeCwd||s.lastSession?.cwd||s.cwd)]).filter(([,where])=>where)),terminalFeatures:work.features,branchRuns:work.branchRuns};};
  const refreshGit=async options=>{const data=await gitWithTerminals(await gitOverview.collect(gitFolders(),options));send('git-overview',data);return data;};
  register('git-overview',async (options={})=>{if(options.cached)return await gitWithTerminals(gitOverview.cached());return refreshGit({fetch:!!options.fetch,force:!!options.force});});
  // Left panel "GitHub" section: refresh the repos terminals are in every 4 min (fetching at most every 5 min).
  setTimeout(()=>refreshGit({scope:'terminals'}).then(()=>refreshGit({scope:'terminals',fetch:true})).catch(()=>{}),8000).unref?.();setInterval(()=>refreshGit({scope:'terminals',fetch:true}).catch(()=>{}),240000).unref?.();
  register('open-external',url=>{let u;try{u=new URL(url);}catch{throw Error('Not a link.');}if(u.protocol!=='https:'||u.hostname!=='github.com')throw Error('Only GitHub links open from here.');return shell.openExternal(u.href);});
  register('resize',(id,cols,rows)=>{const s=sessions.get(id);if(s&&Number.isInteger(cols)&&Number.isInteger(rows)&&cols>=2&&cols<=1000&&rows>=1&&rows<=500&&s.status!=='closed'){s.desktopSize={cols,rows};if(!s.phoneSize)s.pty.resize(cols,rows);}});
  register('move-terminal',(id,workspaceId)=>{const s=sessions.get(id);if(!s)throw Error('Terminal unavailable.');if(!workspaces.some(w=>w.id===workspaceId&&!w.archived))throw Error('Workspace unavailable.');if(s.workspaceId===workspaceId)return publicSession(s);s.workspaceId=workspaceId;save();send('session',publicSession(s));return publicSession(s);});
  register('edit',(id,patch)=>{const s=sessions.get(id); if(!s) return; if(typeof patch.title==='string'&&patch.title.trim())s.title=patch.title.trim().slice(0,80); if(validColor(patch.color))s.color=patch.color;save();send('session',publicSession(s));});
  register('folder',async()=>{const result=await dialog.showOpenDialog(win,{properties:['openDirectory']});return result.canceled?null:result.filePaths[0];});
  register('close-track',async entries=>{
    if(!Array.isArray(entries)||!entries.length)return [];
    const targets=entries.map(e=>({session:sessions.get(e.id),position:e.position})).filter(e=>e.session);
    if(new Set(targets.map(e=>e.session.id)).size!==targets.length)throw Error('Invalid terminal list.');
    const {response}=await dialog.showMessageBox(win,{type:'question',buttons:['Cancel','Delete and close terminals'],defaultId:0,cancelId:0,message:`Close ${targets.length} terminal${targets.length===1?'':'s'} and delete this row or column?`,detail:targets.map(e=>e.session.title).join(', ')+' — running processes will stop. Terminals are saved in History.'});
    if(response!==1)return [];
    const previous=closedTerminals.slice();
    for(const {session,position} of targets){closedTerminals.unshift(archiveRecordChat(archiveTerminal(session,position)));sessions.delete(session.id);}
    try{save();}catch(error){closedTerminals=previous;for(const {session} of targets)sessions.set(session.id,session);throw error;}
    for(const {session} of targets)session.pty.kill();updateBadge();return targets.map(e=>e.session.id);
  });
  register('close',async (id,position)=>{const s=sessions.get(id);if(!s)return false;if(s.status!=='closed'){const {response}=await dialog.showMessageBox(win,{type:'question',buttons:['Cancel','Close terminal'],defaultId:0,cancelId:0,message:`Close ${s.title}?`,detail:'This ends the terminal and its running processes.'});if(response!==1)return false;}const record=archiveRecordChat(archiveTerminal(s,position));closedTerminals.unshift(record);sessions.delete(id);try{save();}catch(error){closedTerminals.shift();sessions.set(id,s);throw error;}s.pty.kill();updateBadge();return true;});
  register('terminal-history',()=>closedTerminals.map(({buffer,...record})=>({...record,latestPrompt:lastRealPrompt(record.promptHistory||[],record.latestPrompt||'')})));
  register('history-delete',async archiveId=>{const record=closedTerminals.find(r=>r.archiveId===archiveId);if(!record)throw Error('Already removed from History.');archiveRecordChat(record);
    const {response}=await dialog.showMessageBox(win,{type:'question',buttons:['Cancel','Delete'],defaultId:0,cancelId:0,message:`Delete “${record.title}” from History?`,detail:record.chatArchive?`It can no longer be restored as a terminal. Its chat text stays in the archive:\n${record.chatArchive}`:'It can no longer be restored as a terminal. There was no chat to archive.'});
    if(response!==1)return false;closedTerminals=closedTerminals.filter(r=>r.archiveId!==archiveId);save();return true;});
  register('open-chat-archive',archiveId=>{const record=archiveId?[...closedTerminals,...workspaces.flatMap(w=>w.archivedTerminals||[])].find(r=>r.archiveId===archiveId):null;if(record)archiveRecordChat(record);const target=record?.chatArchive?path.join(record.chatArchive,'chat.md'):chatArchiveRoot();if(!record){fs.mkdirSync(target,{recursive:true});return shell.openPath(target).then(e=>{if(e)throw Error(e);});}if(!fs.existsSync(target))throw Error('This terminal had no chat to archive.');return shell.openPath(target).then(e=>{if(e)throw Error(e);});});
  register('terminal-restore',archiveId=>{
    const record=closedTerminals.find(item=>item.archiveId===archiveId);if(!record)throw new Error('This terminal has already been restored.');
    if(sessions.has(record.id))throw new Error('This terminal is already open.');
    const restored=create({...record,restore:true});const live=sessions.get(restored.id);
    if(!live.restorePending&&record.buffer){live.buffer=record.buffer;restored.buffer=record.buffer;}
    closedTerminals=closedTerminals.filter(item=>item.archiveId!==archiveId);save();return restored;
  });
  register('claude',id=>{const s=sessions.get(id);if(s && !s.agent && ['ready','done','error'].includes(s.status))s.pty.write('claude --dangerously-skip-permissions\r');});
  register('codex',id=>{const s=sessions.get(id);if(s && !s.agent && ['ready','done','error'].includes(s.status))s.pty.write('codex --dangerously-bypass-approvals-and-sandbox --no-alt-screen\r');});
  const historyFile=()=>path.join(process.env.CLAUDE_CONFIG_DIR||path.join(os.homedir(),'.claude'),'history.jsonl');
  register('claude-history',()=>recentChats(historyFile()));
  register('claude-resume',(id,chosen)=>{
    const s=sessions.get(id);if(!s)throw new Error('Terminal unavailable.');
    if(s.agent||!['ready','done','error'].includes(s.status))throw new Error('Exit the current process before resuming a chat.');
    if(!chosen&&s.lastSession?.provider==='codex'){s.pty.write(restoreCommand(s.lastSession));update(s,'running');return;}
    const session=chosen||s.resumeSession;
    if([...sessions.values()].some(other=>other.agent&&other.claudeSession===session))throw new Error('This chat is already open in another terminal.');
    const chat=chosen?recentChats(historyFile()).find(c=>c.id===chosen):null;
    const cwd=chat?.cwd||s.resumeCwd||s.cwd;
    if(!fs.statSync(cwd).isDirectory())throw new Error('The chat folder is unavailable.');
    const command=resumeCommand(session,cwd);s.pty.write(command);update(s,'running');
  });
  register('workspace-archive',async(id,positions)=>{
    const w=workspaces.find(w=>w.id===id&&!w.archived);if(!w)return null;
    const targets=[...sessions.values()].filter(s=>s.workspaceId===id);
    const {response}=await dialog.showMessageBox(win,{type:'question',buttons:['Cancel','Delete workspace'],defaultId:0,cancelId:0,message:`Delete ${w.title}?`,detail:`Its ${targets.length} terminals will close. Restore the workspace from History.`});if(response!==1)return null;
    const previousActive=activeWorkspaceId;w.archived=true;w.archivedAt=Date.now();w.archivedTerminals=targets.map(s=>archiveRecordChat(archiveTerminal(s,positions?.[s.id])));for(const s of targets)sessions.delete(s.id);
    let fallback=workspaces.find(w=>!w.archived&&!w.hidden)||workspaces.find(w=>!w.archived),created=false;if(fallback)delete fallback.hidden;if(!fallback){fallback={id:crypto.randomUUID(),title:'Workspace'};workspaces.push(fallback);created=true;}if(activeWorkspaceId===id)activeWorkspaceId=fallback.id;
    try{save();}catch(error){delete w.archived;delete w.archivedTerminals;delete w.archivedAt;for(const s of targets)sessions.set(s.id,s);activeWorkspaceId=previousActive;if(created)workspaces=workspaces.filter(x=>x!==fallback);throw error;}
    for(const s of targets)s.pty.kill();updateBadge();return {workspaces,activeWorkspaceId,removed:targets.map(s=>s.id)};
  });
  register('workspace-restore',id=>{
    const w=workspaces.find(w=>w.id===id&&w.archived);if(!w)throw Error('Workspace is already open.');const records=w.archivedTerminals||[],created=[];restoring=true;
    try{for(const record of records)created.push(create({...record,restore:true}));w.archived=false;delete w.hidden;delete w.archivedTerminals;restoring=false;save();return {workspaces,sessions:created};}catch(error){for(const t of created){sessions.get(t.id)?.pty.kill();sessions.delete(t.id);}w.archived=true;w.archivedTerminals=records;restoring=false;throw error;}
  });
  // A file dragged onto a terminal that exists only in memory (an image dragged from a web page): saved here so its path can be typed.
  register('save-dropped-file',(name,bytes)=>{if(!(bytes instanceof Uint8Array)||!bytes.byteLength||bytes.byteLength>50*1024*1024)throw Error('Drop a file up to 50 MB.');
   const base=String(name||'').split(/[\\/]/).pop().replace(/[^A-Za-z0-9._-]+/g,'-').replace(/^[-.]+/,'').slice(-80)||'dropped';const dir=path.join(app.getPath('userData'),'dropped');fs.mkdirSync(dir,{recursive:true});
   const file=path.join(dir,`${new Date().toISOString().replace(/[:.]/g,'-')}-${base}`);fs.writeFileSync(file,bytes);return file;});
  register('terminal-fork',id=>{const s=sessions.get(id);if(!s)throw Error('Terminal unavailable.');const r=forkRecord(s);if(!r)throw Error('This terminal has no chat to fork yet.');
   const session=create({workspaceId:s.workspaceId,cwd:r.cwd||s.cwd,title:`${s.title} (fork)`.slice(0,80)});sessions.get(session.id).restorePending=forkCommand(r);return session;});
  register('chat-search',async query=>{if(typeof query!=='string'||query.length>200)return {results:[]};const r=await chatSearch(query);
   for(const x of r.results){const s=chatTerminal(x.provider,x.id);if(s){x.terminalId=s.id;x.terminalTitle=s.title;x.workspaceId=s.workspaceId;}}return r;});
  register('chat-open',(provider,id,workspaceId,cwd,title)=>{const open=chatTerminal(provider,id);if(open)return {focus:open.id,workspaceId:open.workspaceId};
   const command=restoreCommand({provider,id,cwd:typeof cwd==='string'?cwd:null});if(!command)throw Error('This chat cannot be opened.');
   const ws=workspaces.some(w=>w.id===workspaceId)?workspaceId:activeWorkspaceId;const session=create({workspaceId:ws,cwd:typeof cwd==='string'&&fs.existsSync(cwd)?cwd:os.homedir(),title:String(title||'Chat').replace(/\s+/g,' ').slice(0,60)});sessions.get(session.id).restorePending=command;return {session};});
  register('goal-progress',(workspaceId,id,value)=>{const w=workspaces.find(w=>w.id===workspaceId),g=[...(w?.goals||[]),...(w?.goalHistory||[])].find(g=>g.id===id);if(!g||!Number.isFinite(value))throw Error('Goal unavailable.');const previous=g.progress;g.progress=Math.max(0,Math.min(100,Math.round(value)));try{save();}catch(error){g.progress=previous;throw error;}return w;});
  register('goal-update',(workspaceId,id,text)=>{
    const w=workspaces.find(w=>w.id===workspaceId);if(!w)throw Error('Workspace unavailable.');
    const previous=w.goals||[],previousHistory=w.goalHistory||[],goal=previous.find(g=>g.id===id);if(!goal)throw Error('Goal unavailable.');
    if(text!==null&&(typeof text!=='string'||!text.trim()||text.length>50000))throw Error('Enter a goal.');
    if(text===null)w.goalHistory=[{...goal,removedAt:Date.now()},...previousHistory];
    w.goals=text===null?previous.filter(g=>g.id!==id):previous.map(g=>g.id===id?{...g,text:text.trim()}:g);
    try{save();}catch(error){w.goals=previous;w.goalHistory=previousHistory;throw error;}if(text!==null)goalSync.changed(w.goals.find(g=>g.id===id),{title:text.trim()});return w;
  });
  register('goal-toggle-terminal',(workspaceId,id,terminalId)=>{
    const w=workspaces.find(w=>w.id===workspaceId),goal=w?.goals?.find(g=>g.id===id);if(!goal)throw Error('Goal unavailable.');
    if(!sessions.has(terminalId))throw Error('Terminal unavailable.');
    const previous={terminalIds:goal.terminalIds,terminalId:goal.terminalId},current=goalTerminals(goal);
    goal.terminalIds=current.includes(terminalId)?current.filter(t=>t!==terminalId):[...current,terminalId];delete goal.terminalId;
    try{save();}catch(error){Object.assign(goal,previous);if(previous.terminalIds===undefined)delete goal.terminalIds;if(previous.terminalId===undefined)delete goal.terminalId;throw error;}return w;
  });
  register('subgoal-create',(workspaceId,goalId,text)=>{
    const goal=workspaces.find(w=>w.id===workspaceId)?.goals?.find(g=>g.id===goalId);if(!goal)throw Error('Goal unavailable.');
    const previous=goal.subgoals;addSubgoal(goal,text,{source:'user'});try{save();}catch(error){goal.subgoals=previous;throw error;}goalSync.changed(goal);return workspaces.find(w=>w.id===workspaceId);
  });
  register('subgoal-update',(workspaceId,goalId,id,patch)=>{
    const goal=workspaces.find(w=>w.id===workspaceId)?.goals?.find(g=>g.id===goalId);if(!goal)throw Error('Goal unavailable.');
    if(!patch||typeof patch!=='object')throw Error('Nothing to change.');if(patch.toggleTerminal&&!sessions.has(patch.toggleTerminal))throw Error('Terminal unavailable.');
    const previous=JSON.stringify(goal.subgoals||[]);updateSubgoal(goal,id,{text:patch.text,done:patch.done,remove:!!patch.remove,toggleTerminal:patch.toggleTerminal});
    try{save();}catch(error){goal.subgoals=JSON.parse(previous);throw error;}if(patch.text!==undefined||patch.done!==undefined||patch.remove)goalSync.changed(goal);return workspaces.find(w=>w.id===workspaceId);
  });
  register('goal-create',(workspaceId,text,options={})=>{
    const w=workspaces.find(w=>w.id===workspaceId&&!w.archived);
    if(!w)throw Error('Workspace unavailable.');
    if(typeof text!=='string'||!text.trim()||text.length>50000||/[\x00-\x08\x0b-\x1f\x7f]/.test(text))throw Error('Write a goal after /goal.');
    const goal={id:crypto.randomUUID(),text:text.trim(),createdAt:Date.now()};
    for(const line of Array.isArray(options?.subgoals)?options.subgoals:[])if(typeof line==='string'&&line.trim())addSubgoal(goal,line,{source:'user'});
    return addGoal(w,goal,options?.terminal!==false);
  });
  register('phone-web-open-approval',()=>{if(phoneHttps.enableUrl&&/^https:\/\/login\.tailscale\.com\//.test(phoneHttps.enableUrl))return shell.openExternal(phoneHttps.enableUrl);});
  register('phone-web-get',async({retry=false}={})=>{if(phoneServer&&(retry||phoneHttps.state==='unknown'||phoneHttps.state==='needs-approval'||phoneHttps.state==='no-tailscale'))await setupPhoneHttps();const info=phoneWebInfo();if(info.url)info.qr=await require('qrcode').toDataURL(info.url,{margin:1,width:240});return info;});
  register('phone-web-set',async enabled=>{setPhoneWeb({enabled:!!enabled});if(enabled){startPhoneServer();await setupPhoneHttps();}else if(phoneServer){await stopPhoneHttps();phoneServer.stop();phoneServer=null;for(const s of sessions.values())if(s.phoneSize){s.phoneSize=null;const d=s.desktopSize||{cols:100,rows:30};s.pty.resize(d.cols,d.rows);send('session',publicSession(s));}}const info=phoneWebInfo();if(info.url)info.qr=await require('qrcode').toDataURL(info.url,{margin:1,width:240});return info;});
  register('phone-web-reset',async()=>{setPhoneWeb({token:crypto.randomBytes(24).toString('base64url')});if(phoneServer){phoneServer.stop();phoneServer=null;startPhoneServer();}const info=phoneWebInfo();if(info.url)info.qr=await require('qrcode').toDataURL(info.url,{margin:1,width:240});return info;});
  register('drafts-save',(id,draft)=>{const s=sessions.get(id);if(!s)throw Error('Terminal unavailable.');if(!draft||typeof draft.text!=='string'||!draft.text.trim())throw Error('Write a prompt first.');const list=cleanDrafts(s.drafts);const now=Date.now();
    if(draft.id&&list.some(d=>d.id===draft.id))s.drafts=list.map(d=>d.id===draft.id?{...d,text:draft.text.slice(0,50000),updatedAt:now}:d);else{if(list.length>=30)throw Error('This terminal already has 30 drafts.');s.drafts=[...list,{id:crypto.randomUUID().slice(0,8),text:draft.text.slice(0,50000),createdAt:now}];}
    save();send('session',publicSession(s));return s.drafts;});
  register('drafts-remove',(id,draftId)=>{const s=sessions.get(id);if(!s)return [];s.drafts=cleanDrafts(s.drafts).filter(d=>d.id!==draftId);save();send('session',publicSession(s));return s.drafts;});
  register('drafts-send',async(id,draftId)=>{const s=sessions.get(id);if(!s||s.status==='closed')throw Error('Terminal unavailable.');const d=cleanDrafts(s.drafts).find(x=>x.id===draftId);if(!d)throw Error('Draft not found.');
    if(!s.agent)throw Error('Start Claude or Codex in this terminal first; the draft is kept.');if(s.manualInput)throw Error('Something is already typed in this terminal. Send or clear it first; the draft is kept.');if(s.routerSending)throw Error('A message is being delivered to this terminal. Try again in a moment.');
    await phoneSend(s,d.text);s.drafts=cleanDrafts(s.drafts).filter(x=>x.id!==draftId);save();send('session',publicSession(s));return s.drafts;});
  register('phone-get',()=>({enabled:phoneEnabled(),idle:[...sessions.values()].filter(s=>s.agent&&s.provider==='claude'&&!s.remoteControl).length}));
  register('phone-set',(enabled,{connectRunning=false}={})=>{fs.writeFileSync(phoneSettingsFile(),JSON.stringify({enabled:!!enabled}));syncPhone();const connected=enabled&&connectRunning?connectRunningToPhone():0;return {enabled:phoneEnabled(),connected};});
  register('workspace-reorder',ids=>{if(!Array.isArray(ids))throw Error('Invalid order.');const rank=new Map(ids.map((id,i)=>[id,i]));const open=workspaces.filter(w=>!w.archived).sort((a,b)=>(rank.get(a.id)??1e9)-(rank.get(b.id)??1e9));workspaces=[...open,...workspaces.filter(w=>w.archived)];save();return workspaces;});
  register('workspace-create', title=>{
    if(typeof title!=='string'||!title.trim())throw new Error('Enter a workspace name.');
    const workspace={id:crypto.randomUUID(),title:title.trim().slice(0,60)};
    workspaces.push(workspace);activeWorkspaceId=workspace.id;save();return workspace;
  });
  register('workspace-switch',id=>{if(workspaces.some(w=>w.id===id&&!w.archived)){activeWorkspaceId=id;save();}return activeWorkspaceId;});
  // Hidden workspaces leave the tab bar, overview and Workspaces menu; their terminals keep running. One stays visible.
  register('workspace-hide',(id,hidden)=>{const w=workspaces.find(w=>w.id===id&&!w.archived);if(!w)throw Error('Workspace unavailable.');
    if(hidden){if(!workspaces.some(x=>x!==w&&!x.archived&&!x.hidden))throw Error('Keep at least one workspace visible.');w.hidden=true;if(activeWorkspaceId===id)activeWorkspaceId=workspaces.find(x=>!x.archived&&!x.hidden).id;}else delete w.hidden;
    save();return {workspaces,activeWorkspaceId};});
  register('workspace-rename',(id,title)=>{const w=workspaces.find(w=>w.id===id);if(w&&typeof title==='string'&&title.trim()){w.title=title.trim().slice(0,60);save();}return w;});
  let previous=[],hasSavedState=false;
  try {
    const saved=readState(path.join(app.getPath('userData'),'workspaces.json'));
    if(Array.isArray(saved.workspaces)&&saved.workspaces.length){workspaces=saved.workspaces;activeWorkspaceId=workspaces.some(w=>w.id===saved.activeWorkspaceId)?saved.activeWorkspaceId:workspaces[0].id;}
    promptLog=Array.isArray(saved.promptLog)?saved.promptLog:[];routerJobs=Array.isArray(saved.routerJobs)?saved.routerJobs.map(j=>['queued','editing'].includes(j.status)?({...j,status:'starting',startDeadline:Date.now()+90000,expectedSessionId:j.sessionId,waiting:null}):({...j,status:['routing','needs-terminal','starting','sending'].includes(j.status)?'error':j.status,reason:['routing','needs-terminal','starting','sending'].includes(j.status)?'App restarted. Resend this message.':j.reason})):[];previous=saved.terminals;hasSavedState=true;closedTerminals=Array.isArray(saved.closedTerminals)?saved.closedTerminals:[];
  } catch {try {previous=JSON.parse(fs.readFileSync(path.join(app.getPath('userData'),'terminals.json'),'utf8'));}catch{}}
  if(!Array.isArray(previous)||(!previous.length&&!hasSavedState)) previous=[{title:'Terminal 1',cwd:defaultCwd}];
  restoring=true;
  for(const options of previous) { try{create({...options,restore:true});}catch(error){console.error('Terminal startup:',error.message);} }
  restoring=false;stateLoaded=true;
  if(!sessions.size&&!hasSavedState) create();
  save();
  // Terminals closed before the archive existed get their chat archived too, one per tick so startup stays quick.
  {const pending=[...closedTerminals,...workspaces.flatMap(w=>w.archivedTerminals||[])].filter(r=>!r.chatArchive);let changed=false;const step=()=>{const r=pending.shift();if(!r){if(changed)save();return;}archiveRecordChat(r);if(r.chatArchive)changed=true;setTimeout(step,20);};setTimeout(step,3000);}
  await win.loadFile('dist/index.html');
  try{if(phoneWeb().enabled){startPhoneServer();setupPhoneHttps().catch(()=>{});}}catch(error){console.error('phone server',error);}
  if(process.env.TS_TEST||previewBuild)win.setTitle('Terminator Preview');
  win.on('close',event=>{
    if(quitting)return;
    const active=[...sessions.values()].filter(s=>['running','attention'].includes(s.status));
    if(active.length){event.preventDefault();dialog.showMessageBox(win,{type:'question',buttons:['Keep open','Quit'],defaultId:0,cancelId:0,message:'Quit Terminator?',detail:`${active.length} terminal(s) have work running. Quitting ends their processes.`}).then(({response})=>{if(response===1){quitting=true;app.quit();}});}
  });
});
process.on('unhandledRejection',error=>{console.error(error);dialog.showErrorBox('Terminator',String(error.message||error));});
app.on('activate',()=>{if(win&&!win.isDestroyed()){if(win.isMinimized())win.restore();win.show();}});
app.on('window-all-closed',()=>app.quit());
let observing=false;
function acknowledgePrompt(s,text,provider,sessionId){
 if(typeof text!=='string')return;
 logPrompt(s,text,provider,sessionId);
 for(const job of routerJobs)if(job.status==='sending'&&job.terminalId===s.id&&job.sessionId===sessionId&&job.prompt.trim()===text.trim()){
  job.status='sent';job.waiting=null;s.routerSending=false;routerPublish();
 }
}
function reconcileRuntime(s,runtime){
 if(!runtime)return;let changed=false;
 for(const key of ['model','effort','contextPercent'])if((key==='contextPercent'||(runtime.metadataAt||0)>=(s.modelObservedAt||0))&&runtime[key]!==undefined&&s[key]!==runtime[key]){s[key]=runtime[key];changed=true;}
 const prompt=runtime.prompt;if(prompt&&!isSystemPrompt(prompt.text)&&prompt.at>(s.lastObservedPromptAt||0)&&prompt.at>=(s.agentLaunchedAt||s.createdAt)){
  s.lastObservedPromptAt=prompt.at;s.latestPrompt=prompt.text;
  if(!s.manualInput)clearInput(s);
  acknowledgePrompt(s,prompt.text,s.provider,identity(s));save();changed=true;
 }
 const activity=runtime.activity;
 if(activity&&activity.at>(s.lastLifecycleAt||0)&&activity.at>=(s.agentLaunchedAt||s.createdAt)){
  s.lastLifecycleAt=activity.at;
  if(activity.status==='running'){if(s.status!=='running'){update(s,'running');s.startedAt=runtime.turnStartedAt||activity.at;}s.endedAt=null;}
  else if(['running','attention'].includes(s.status)){s.startedAt??=runtime.turnStartedAt||activity.at;update(s,'Stop');if(s.endedAt)s.endedAt=activity.at;}
  changed=true;
 }
 if(changed)send('session',publicSession(s));
}
const recoveryTimer=setInterval(async()=>{if(observing||quitting)return;observing=true;
 try{for(const s of sessions.values()){
  try{if(s.codexActive){const record=await codexRecord(s.pty.pid);if(!record||!s.codexActive||!sessions.has(s.id))continue;
   const {runtime,contextPercent,persisted,...recordIdentity}=record;const newSession=s.codexSession!==record.id;s.provider='codex';s.codexSession=record.id;s.agent=true;s.agentReadyAt??=Date.now()+500;
   const remembered=persisted!==false&&remember(s,recordIdentity);if(remembered){s.resumeAvailable=true;save();}
   if(newSession&&s.status==='starting')update(s,'SessionStart');
   reconcileRuntime(s,{...runtime,...(contextPercent===undefined?{}:{contextPercent})});
   if(remembered||newSession)send('session',publicSession(s));
  }else if(s.agent&&s.provider==='claude'&&s.lastSession?.id===s.claudeSession){
   const file=claudeTranscript(s.lastSession,claudeHome);if(file)reconcileRuntime(s,readRuntime(file,'claude'));
  }}catch(error){console.error('Session activity check:',error.message);}
 }}finally{observing=false;}
},2000);recoveryTimer.unref();
// Terminal output alone (screen buffers) is saved every 10 s; everything else (titles, goals, prompts…) saves right away via save().
let lastOutputSave=0;const autosaveTimer=setInterval(()=>{if(outputDirty&&!restoring&&Date.now()-lastOutputSave>=10000){lastOutputSave=Date.now();try{save();}catch(error){console.error('Session save failed:',error.message);}}},1000);autosaveTimer.unref();
process.on('uncaughtExceptionMonitor',()=>{try{save();}catch{}});
for(const signal of ['SIGTERM','SIGHUP','SIGINT'])process.on(signal,()=>{try{save();}finally{quitting=true;app.quit();}});
app.on('will-quit',()=>{clearInterval(usageTimer);clearInterval(autosaveTimer);clearInterval(recoveryTimer);save();for(const s of sessions.values())s.pty.kill();server?.close();if(runtime)fs.rmSync(runtime,{recursive:true,force:true});});

function flushRouter(){
 for(const job of routerJobs){if(job.status==='starting'){const target=sessions.get(job.terminalId);if(identity(target)){if(job.expectedSessionId&&identity(target)!==job.expectedSessionId){job.status='error';job.reason='The original conversation could not be resumed.';routerPublish();continue;}job.sessionId=identity(target);job.provider=target.provider;job.status='queued';routerPublish();}else if(!target||target.status==='closed'||Date.now()>job.startDeadline){job.status='error';job.reason='Claude has not started. Check the new terminal, then resend.';routerPublish();}continue;}if(job.status!=='queued')continue;const s=sessions.get(job.terminalId);
 if(!s?.agent||identity(s)!==job.sessionId){job.status='error';job.reason='Terminal session ended.';routerPublish();continue;}
 const waiting=waitingReason(s,job);if(waiting){if(job.waiting!==waiting){job.waiting=waiting;routerPublish();}continue;}
 job.waiting=null;s.routerSending=true;job.status='sending';routerPublish();
 s.pty.write('\x1b[200~'+job.prompt+'\x1b[201~');
 setTimeout(()=>{if(s.agent&&identity(s)===job.sessionId){if(s.manualInput){job.status='error';job.reason='Input changed during delivery. Review the terminal draft.';s.routerSending=false;routerPublish();return;}s.pty.write('\r');setTimeout(()=>{if(job.status==='sending'){job.status='error';job.reason='Delivery unconfirmed. Check this terminal before retrying.';s.routerSending=false;s.manualInput=true;s.inputUnknown=true;routerPublish();}},15000);}else{job.status='error';job.reason='Terminal session ended.';s.routerSending=false;routerPublish();}},750);
 }
}
const routerTimer=setInterval(flushRouter,500);routerTimer.unref();
