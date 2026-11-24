function sidebarLinkKey(link){try{const u=new URL(link.url);u.search='';u.hash='';u.pathname=u.pathname.replace(/\/+$/,'')||'/';return u.hostname==='claude.ai'?'claude-artifact:'+u.pathname.split('/').at(-1):u.href;}catch{return link.url;}}
import {promptLine} from './prompt-location.mjs';
// Hooks another feature can fill in to show goals that live elsewhere; left empty, goals are Terminator's own.
const goalHooks={};
import {unusedColor} from './colors.cjs';
import {restoreSequence} from './terminal-modes.cjs';
import { fits, placement, removeTrack, dropRect } from './grid.mjs';
import { Terminal } from '@xterm/xterm';
import { SerializeAddon } from '@xterm/addon-serialize';
import { FitAddon } from '@xterm/addon-fit';
import './style.css';
const api=window.terminalApp;
const $=selector=>document.querySelector(selector);
const sessions=new Map(), views=new Map();
let defaultCwd='',colors=[],selected=null,editing=null,chosenColor='',z=1,focused=null,noticeTimer;
let positions={};try{positions=JSON.parse(localStorage.getItem('grid-positions')||'{}');}catch{}
let workspaces=[],activeWorkspaceId='default',workspaceEditing=false;
const selectedByWorkspace={};
let grids={};try{grids=JSON.parse(localStorage.getItem('workspace-grids')||'{}');}catch{}
// Text size. The middle section (canvas) and the right panel (View) each have their own size:
// - canvasFontSize: base size of every terminal in the middle section (− / + above the canvas);
// - fontOffsets: per-terminal adjustment on top of that base (⌘+ / ⌘− on a focused canvas terminal);
// - viewFontSize: size of whatever terminal is open in the right panel (− / + in the panel, or ⌘+ / ⌘− while typing there).
const clampSize=n=>Math.max(8,Math.min(32,Math.round(n)));
function readNumber(key,fallback){try{const n=Number(localStorage.getItem(key));return localStorage.getItem(key)!==null&&Number.isFinite(n)&&n>=8&&n<=32?n:fallback;}catch{return fallback;}}
function store(key,value){try{localStorage.setItem(key,typeof value==='string'?value:JSON.stringify(value));}catch{}}
let canvasFontSize=readNumber('canvas-font-size',readNumber('terminal-font-size',12));
let viewFontSize=readNumber('view-font-size',canvasFontSize);
let fontOffsets={};try{const saved=JSON.parse(localStorage.getItem('terminal-font-offsets')||'null');if(saved&&typeof saved==='object'){for(const [id,n] of Object.entries(saved))if(Number.isFinite(n)&&n)fontOffsets[id]=n;}else{const legacy=JSON.parse(localStorage.getItem('terminal-font-sizes')||'{}');for(const [id,n] of Object.entries(legacy))if(Number.isFinite(n)&&n!==canvasFontSize)fontOffsets[id]=n-canvasFontSize;store('terminal-font-offsets',fontOffsets);}}catch{}
function canvasSizeFor(id){return clampSize(canvasFontSize+(fontOffsets[id]||0));}
function sizeFor(id){return id===selected?viewFontSize:canvasSizeFor(id);}
function applyFontSize(v){const termSize=sizeFor(v.id),mirrorSize=canvasSizeFor(v.id);if(v.term.options.fontSize!==termSize)keepViewport(v,()=>{v.term.options.fontSize=termSize;});if(v.mirror&&v.mirror.options.fontSize!==mirrorSize)v.mirror.options.fontSize=mirrorSize;renderZoomControls();}
function setCanvasFontSize(size){canvasFontSize=clampSize(size);store('canvas-font-size',String(canvasFontSize));views.forEach(applyFontSize);renderZoomControls();}
function setViewFontSize(size){viewFontSize=clampSize(size);store('view-font-size',String(viewFontSize));const v=views.get(selected);if(v)applyFontSize(v);renderZoomControls();}
function setTerminalOffset(id,size){if(size===null)delete fontOffsets[id];else{const offset=clampSize(size)-canvasFontSize;if(offset)fontOffsets[id]=offset;else delete fontOffsets[id];}store('terminal-font-offsets',fontOffsets);const v=views.get(id);if(v)applyFontSize(v);}
function renderZoomControls(){const box=$('#view-zoom');if(box){box.hidden=!selected||!views.has(selected);$('#view-zoom-size').textContent=String(viewFontSize);}const canvas=$('#canvas-zoom-size');if(canvas)canvas.textContent=String(canvasFontSize);}
const renderViewZoom=renderZoomControls;
$('#view-zoom-out').onclick=()=>setViewFontSize(viewFontSize-1);$('#view-zoom-in').onclick=()=>setViewFontSize(viewFontSize+1);$('#view-zoom-size').ondblclick=()=>setViewFontSize(canvasFontSize);
$('#canvas-zoom-out').onclick=()=>setCanvasFontSize(canvasFontSize-1);$('#canvas-zoom-in').onclick=()=>setCanvasFontSize(canvasFontSize+1);$('#canvas-zoom-size').ondblclick=()=>setCanvasFontSize(12);
// ⌘+ / ⌘− / ⌘0: typing in the right panel → View size; otherwise the focused canvas terminal's own size.
function zoomShortcut(code){const inView=!!document.activeElement?.closest?.('#inspector');const active=document.activeElement?.closest?.('.pane')?.dataset.terminalId;
 if(inView||(!active&&!focused&&selected)){setViewFontSize(code==='Digit0'?canvasFontSize:viewFontSize+(['Minus','NumpadSubtract'].includes(code)?-1:1));return;}
 const id=[active,focused].find(id=>id&&views.has(id));if(!id)return;
 setTerminalOffset(id,code==='Digit0'?null:canvasSizeFor(id)+(['Minus','NumpadSubtract'].includes(code)?-1:1));}
renderZoomControls();
const currentSessions=()=>[...sessions.values()].filter(s=>s.workspaceId===activeWorkspaceId);
let coloredBackground=localStorage.getItem('terminal-background')!=='off';
let darkMode=localStorage.getItem('appearance')==='dark';
document.documentElement.dataset.theme=darkMode?'dark':'light';
function accent(hex){if(!darkMode)return hex;const warm=[210,180,156];return '#'+[1,3,5].map((p,i)=>Math.round(parseInt(hex.slice(p,p+2),16)*.58+warm[i]*.42).toString(16).padStart(2,'0')).join('');}
function tint(hex,white=.88){if(darkMode)return '#000000';const base=255;return '#'+[1,3,5].map(i=>Math.round(parseInt(hex.slice(i,i+2),16)*(1-white)+base*white).toString(16).padStart(2,'0')).join('');}
function sessionColor(s){return s.color;}
function sessionSurface(s,header=false){if(!coloredBackground&&!header)return darkMode?'#000000':'#ffffff';if(darkMode){const c=accent(s.color);return '#'+[1,3,5].map(i=>Math.round(parseInt(c.slice(i,i+2),16)*(header?.32:.17)).toString(16).padStart(2,'0')).join('');}return tint(s.color,header?.78:.88);}
const ansiNames=['black','red','green','yellow','blue','magenta','cyan','white','brightBlack','brightRed','brightGreen','brightYellow','brightBlue','brightMagenta','brightCyan','brightWhite'];
const ansiPalettes={light:['#30343b','#b63d47','#337449','#916214','#315fb0','#8651a4','#237785','#70757c','#7d828a','#c94f59','#3f8a58','#a87418','#3d6fc4','#9a5fba','#2a8b9b','#90959d'],dark:['#55585f','#e5737b','#7fc48f','#e0b25c','#79a6ea','#c597e0','#6fc3cf','#d5d7db','#8a8e96','#f08e95','#98d7a6','#ecc77c','#97bcf2','#d4aeea','#8dd3dd','#f2f3f5']};
function sessionTheme(s){const ink=darkMode?'#eeeeee':'#242424';const theme={background:'#00000000',foreground:ink,cursor:ink,cursorAccent:darkMode?'#000000':'#ffffff',selectionBackground:darkMode?'#ffffff33':'#00000022'};ansiNames.forEach((name,i)=>theme[name]=ansiPalettes[darkMode?'dark':'light'][i]);return theme;}
function mirrorTheme(){return {background:darkMode?'#29292e':'#f0f0f2',foreground:darkMode?'#a4a4ad':'#86868d',cursor:darkMode?'#b7b7c0':'#aaaab1'};}
function syncAppearance(){document.documentElement.dataset.terminalBackground=coloredBackground?'on':'off';const fill=$('#background-toggle');fill.setAttribute('aria-pressed',String(coloredBackground));fill.title=coloredBackground?'Use colored text':'Use colored backgrounds';fill.setAttribute('aria-label',fill.title);document.documentElement.dataset.theme=darkMode?'dark':'light';const toggle=$('#theme-toggle');toggle.textContent=darkMode?'☀':'☾';toggle.title=darkMode?'Switch to light mode':'Switch to dark mode';toggle.setAttribute('aria-label',toggle.title);toggle.setAttribute('aria-pressed',String(darkMode));for(const s of sessions.values()){update(s);const v=views.get(s.id);if(v?.mirror)v.mirror.options.theme={...v.mirror.options.theme,...sessionTheme(s)};}}
$('#background-toggle').onclick=()=>{coloredBackground=!coloredBackground;localStorage.setItem('terminal-background',coloredBackground?'on':'off');syncAppearance();};
$('#theme-toggle').onclick=()=>{darkMode=!darkMode;localStorage.setItem('appearance',darkMode?'dark':'light');syncAppearance();};
syncAppearance();
function modelLabel(s){const model=s.model?.replace(/^claude-(opus|sonnet|haiku)-(\d+)-(\d+)(?:-.*)?$/,(_,family,major,minor)=>family[0].toUpperCase()+family.slice(1)+' '+major+'.'+minor);return s.agent?`${model||'Model —'} · ${s.effort||'—'}`:'Model — · —';}
const labels={starting:'Starting',ready:'Ready',running:'Running',done:'Done',attention:'Needs attention',error:'Error',closed:'Closed'};
function el(tag,cls,text){const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;}
function button(text,title,fn,cls='icon'){const b=el('button',cls,text);b.title=title;b.setAttribute('aria-label',title);b.onclick=fn;return b;}
function notice(error){$('#notice').textContent=String(error?.message||error).replace(/^Error invoking remote method '[^']+': (?:Error: )?/,'');$('#notice').hidden=false;clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>$('#notice').hidden=true,6000);}
function duration(s){if(!s.startedAt)return '';const total=Math.max(0,Math.floor(((s.endedAt||Date.now())-s.startedAt)/1000));return total>=3600?`${Math.floor(total/3600)}:${String(Math.floor(total%3600/60)).padStart(2,'0')}:${String(total%60).padStart(2,'0')}`:`${Math.floor(total/60)}:${String(total%60).padStart(2,'0')}`;}
function persist(){views.forEach((v,id)=>positions[id]=v.position);localStorage.setItem('grid-positions',JSON.stringify(positions));}
function visit(id){api.visit(id).catch(notice);}
function focus(id){visit(id);focused=id;views.forEach((v,key)=>v.card.classList.toggle('focused',id===key));const v=views.get(id);if(v){v.card.style.zIndex=++z;v.term.focus();}}
let sidebarOrder={};try{sidebarOrder=JSON.parse(localStorage.getItem('sidebar-order')||'{}');}catch{}
let restCollapsed={};try{restCollapsed=JSON.parse(localStorage.getItem('rest-collapsed')||'{}');}catch{}
let sidebarDragging=false;
// Rename a link in place: Enter saves, Esc cancels, an empty name restores the default.
function renameLink(anchor,id,link){sidebarDragging=true;const input=el('input','terminal-link-rename');input.value=link.label;input.placeholder=link.defaultLabel||link.label;input.setAttribute('aria-label','Link name');anchor.replaceWith(input);input.focus();input.select();let done=false;
 const finish=save=>{if(done)return;done=true;sidebarDragging=false;if(save&&input.value.trim()!==link.label)api.renameTerminalLink(id,link.key,input.value).catch(notice);sidebar();};
 input.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();finish(true);}else if(e.key==='Escape'){e.preventDefault();finish(false);}};input.onblur=()=>finish(true);}
// Top right: how many terminals (all workspaces) are done, running, waiting for you, and open.
// Overview (⇧⌘O or the Overview button): every workspace as a column laid out like the left panel —
// goals, Priority, Rest — with live status. Click a terminal to open it; drag one onto another column to move it there.
// Links under each terminal in the left panel are hidden until you click its globe; the choice is remembered.
$('#terminals').addEventListener('pointerdown',()=>{sidebarPressed=true;});addEventListener('pointerup',()=>{if(!sidebarPressed)return;setTimeout(()=>{sidebarPressed=false;if(sidebarPending){sidebarPending=false;sidebar();}},0);},true);addEventListener('blur',()=>{if(sidebarPressed){sidebarPressed=false;if(sidebarPending){sidebarPending=false;sidebar();}}});
const linksOpen=new Set((()=>{try{return JSON.parse(localStorage.getItem('linksOpen')||'[]');}catch{return [];}})());
const OVERVIEW_STATUS={running:'running',attention:'needs you',done:'done',ready:'ready',error:'error',starting:'starting',closed:'closed'};
let overviewFrame=0;
function overviewOpen(){return !$('#overview').hidden;}
function toggleOverview(force){const open=force??!overviewOpen();if(open&&gitOpen())toggleGit(false);$('#overview').hidden=!open;document.body.classList.toggle('overview-open',open);$('#overview-button').setAttribute('aria-pressed',String(open));if(open)renderOverview();}
function scheduleOverview(){if(!overviewOpen()||overviewFrame)return;overviewFrame=requestAnimationFrame(()=>{overviewFrame=0;renderOverview();});}
function overviewOrder(workspaceId){const mine=[...sessions.values()].filter(s=>s.workspaceId===workspaceId),ids=new Set(mine.map(s=>s.id)),saved=sidebarOrder[workspaceId]||{};
 const priority=(saved.priority||[]).filter(id=>ids.has(id));const rest=[...(saved.rest||[]).filter(id=>ids.has(id)&&!priority.includes(id)),...mine.map(s=>s.id).filter(id=>!priority.includes(id)&&!(saved.rest||[]).includes(id))];return {priority,rest};}
function overviewRow(s,number){const r=button('',`Open ${s.title}`,()=>{toggleOverview(false);(activeWorkspaceId!==s.workspaceId?switchWorkspace(s.workspaceId):Promise.resolve()).then(()=>openView(s.id)).catch(notice);},'overview-row'+(s.unreadDone&&s.status!=='running'?' unread':'')+(s.status==='attention'?' attention':''));
 r.style.setProperty('--color',accent(sessionColor(s)));r.style.setProperty('--done-background',darkMode?'color-mix(in srgb,'+accent(s.color)+' 42%,#000)':tint(s.color,.65));r.draggable=true;r.dataset.terminalId=s.id;
 r.addEventListener('dragstart',e=>{e.dataTransfer.setData('application/x-overview-terminal',s.id);e.dataTransfer.effectAllowed='move';r.classList.add('is-dragging');});r.addEventListener('dragend',()=>{r.classList.remove('is-dragging');document.querySelectorAll('.overview-column.drop').forEach(n=>n.classList.remove('drop'));});
 r.append(number?el('span','overview-num',String(number)):el('span','overview-dot'));const body=el('span','overview-body'),title=el('span','overview-title');title.append(el('strong','',s.title),...(s.question?[Object.assign(el('span','question-badge','?'),{title:'Waiting for your answer'})]:[]),el('span','overview-status '+s.status,OVERVIEW_STATUS[s.status]||s.status));body.append(title);
 const model=modelLabel(s);if(s.agent&&model)body.append(el('span','overview-model',model+(s.remoteControl?' · 📱':'')));if(s.latestPrompt)body.append(el('span','overview-prompt',s.latestPrompt.replace(/\s+/g,' ')));r.append(body);return r;}
function renderOverview(){const box=$('#overview-columns');const sx=box.scrollLeft,sy=box.scrollTop;box.replaceChildren();
 const list=workspaces.filter(w=>!w.archived&&!w.hidden);box.style.gridTemplateColumns=`72px repeat(${list.length},272px)`;
 // Rows: header, Goals, Priority, Rest — the same row in every column, so sections line up across workspaces.
 const ROWS=['head','goals','priority','rest'],LABELS={goals:'Goals',priority:'Priority',rest:'Rest'};
 ROWS.forEach((row,i)=>{const label=el('div','overview-rowlabel'+(row==='head'?' is-head':''),LABELS[row]||'');label.style.gridRow=String(i+1);label.style.gridColumn='1';box.append(label);});
 list.forEach((w,c)=>{const mine=[...sessions.values()].filter(s=>s.workspaceId===w.id),count=f=>mine.filter(f).length,{priority,rest}=overviewOrder(w.id),byId=new Map(mine.map(s=>[s.id,s]));
  const cell=(row,cls='')=>{const n=el('div',`overview-cell is-${row}${w.id===activeWorkspaceId?' active':''}${cls}`);n.style.gridColumn=String(c+2);n.style.gridRow=String(ROWS.indexOf(row)+1);n.dataset.workspace=w.id;n.dataset.row=row;box.append(n);return n;};
  const head=cell('head'),go=button('',`Go to ${w.title}`,()=>{toggleOverview(false);if(activeWorkspaceId!==w.id)switchWorkspace(w.id).catch(notice);},'overview-head');go.append(el('strong','',w.title));
  const stats=el('span','overview-stats');const stat=(n,label,cls)=>{const e=el('span','overview-stat '+cls);e.append(el('i','status-icon '+cls),document.createTextNode(`${n} ${label}`));return e;};
  stats.append(stat(count(s=>s.status==='done'),'done','is-done'),stat(count(s=>s.status==='running'),'running','is-running'),...(count(s=>s.status==='attention')?[stat(count(s=>s.status==='attention'),'waiting','is-waiting')]:[]),stat(mine.length,'open','is-open'));go.append(stats);head.append(go);
  const goalsCell=cell('goals');const goals=(w.goals||[]).filter(g=>typeof g.text==='string');if(!goals.length)goalsCell.append(el('div','overview-empty','—'));
  for(const g of goals){const item=el('div','overview-goal');item.append(el('span','overview-goal-text',g.text));const subs=g.subgoals||[],meta=el('span','overview-goal-meta'),bar=el('span','overview-bar'),fill=el('i');fill.style.width=(g.progress||0)+'%';bar.append(fill);meta.append(bar,document.createTextNode(`${g.progress||0}%${subs.length?` · ${subs.filter(x=>x.done).length}/${subs.length}`:''}`));item.append(meta);
   if(subs.length){const ul=el('ul','overview-subgoals');for(const sub of subs){const li=el('li','overview-subgoal'+(sub.done?' is-done':''));li.append(el('span','overview-subgoal-mark',sub.done?'✓':'○'),el('span','overview-subgoal-text',sub.text));const extra=(sub.terminalIds||[]).map(id=>sessions.get(id)).filter(Boolean);for(const t of extra){const d=el('i','overview-subgoal-dot');d.style.setProperty('--color',accent(sessionColor(t)));d.title=t.title;li.append(d);}if(sub.source==='agent')li.title='Added by Claude';ul.append(li);}item.append(ul);}
   goalsCell.append(item);}
  const pri=cell('priority');if(!priority.length)pri.append(el('div','overview-empty','—'));priority.forEach((id,i)=>pri.append(overviewRow(byId.get(id),i+1)));
  const rst=cell('rest',' is-last');if(!rest.length)rst.append(el('div','overview-empty',mine.length?'—':'No terminals'));rest.forEach(id=>rst.append(overviewRow(byId.get(id))));
  // Drop a terminal on a column's Priority or Rest row: it moves to that workspace and into that section.
  for(const target of [pri,rst,head,goalsCell]){target.addEventListener('dragover',e=>{if(!e.dataTransfer.types.includes('application/x-overview-terminal'))return;e.preventDefault();e.dataTransfer.dropEffect='move';box.querySelectorAll('.overview-cell.drop').forEach(n=>n.classList.remove('drop'));(target===head||target===goalsCell?rst:target).classList.add('drop');});
   target.addEventListener('drop',e=>{const id=e.dataTransfer.getData('application/x-overview-terminal');box.querySelectorAll('.overview-cell.drop').forEach(n=>n.classList.remove('drop'));if(!sessions.has(id))return;e.preventDefault();overviewPlace(id,w.id,target===pri?'priority':'rest').catch(notice);});}
 });
 box.scrollLeft=sx;box.scrollTop=sy;}
async function overviewPlace(id,workspaceId,section){if(sessions.get(id).workspaceId!==workspaceId)await moveTerminal(id,workspaceId);const order=sidebarOrder[workspaceId]||={priority:[],rest:[]};order.priority=(order.priority||[]).filter(x=>x!==id);order.rest=(order.rest||[]).filter(x=>x!==id);(section==='priority'?order.priority:order.rest).push(id);localStorage.setItem('sidebar-order',JSON.stringify(sidebarOrder));sidebar();renderOverview();}
$('#overview-button').onclick=()=>toggleOverview();
// Git view: every repo your terminals work in, its branches/worktrees, how they stand against main and GitHub, and PRs.
// Data comes from git and gh in the main process (no AI). Refreshes every 2 min while open; fetches at most every 5 min.
let gitData=null,gitLoading=false,gitTimer=0,gitError='';const gitExpanded=new Set();
function gitOpen(){return !$('#git-view').hidden;}
function toggleGit(force){const open=force??!gitOpen();if(open&&overviewOpen())toggleOverview(false);$('#git-view').hidden=!open;document.body.classList.toggle('overview-open',open||overviewOpen());$('#git-button').setAttribute('aria-pressed',String(open));clearInterval(gitTimer);gitTimer=0;
 if(open){if(!gitData)api.gitOverview({cached:true}).then(d=>{if(d&&!gitData){gitData=d;renderGit();}}).catch(()=>{});renderGit();loadGit({fetch:true});gitTimer=setInterval(()=>loadGit({fetch:true}),120000);}}
function loadGit(options={}){if(gitLoading)return;gitLoading=true;gitError='';renderGit();api.gitOverview(options).then(d=>{gitData=d;}).catch(e=>{gitError=String(e?.message||e).replace(/^Error invoking remote method '[^']+': (Error: )?/,'');}).finally(()=>{gitLoading=false;if(gitOpen())renderGit();});}
function ago(t){if(!t)return '';const m=Math.round((Date.now()-t)/60000);return m<1?'just now':m<60?`${m} min ago`:m<1440?`${Math.round(m/60)} h ago`:`${Math.round(m/1440)} d ago`;}
function shortPath(p){return String(p||'').replace(/^\/Users\/[^/]+/,'~');}
function gitPill(text,kind,title){const p=el('span','git-pill'+(kind?' '+kind:''),text);if(title)p.title=title;return p;}
function gitLink(text,url,cls='git-link'){const a=el('a',cls,text);a.href=url;a.onclick=e=>{e.preventDefault();api.openGithub(url).catch(notice);};return a;}
function gitTerminalChips(ids){const box=el('span','git-terminals');for(const id of ids){const s=sessions.get(id);if(!s)continue;const c=button('',`Open ${s.title}`,()=>{toggleGit(false);(activeWorkspaceId!==s.workspaceId?switchWorkspace(s.workspaceId):Promise.resolve()).then(()=>openView(s.id)).catch(notice);},'git-terminal'+(s.status==='running'?' running':''));c.style.setProperty('--color',accent(sessionColor(s)));c.append(el('i'),el('span','',s.title));box.append(c);}return box;}
function gitPrCell(pr,merged){const cell=el('div','git-cell git-pr');
 if(pr){const top=el('div','git-pr-top');top.append(gitLink(`#${pr.number}`,pr.url,'git-link git-pr-num'),gitPill(pr.draft?'draft':'open',pr.draft?'muted':'blue'));
  if(pr.checks)top.append(gitPill({pass:'✓ checks',fail:'✗ checks',pending:'● checks'}[pr.checks],{pass:'green',fail:'red',pending:'amber'}[pr.checks],{pass:'All checks passed',fail:'A check failed',pending:'Checks are running'}[pr.checks]));
  if(pr.review==='APPROVED')top.append(gitPill('approved','green'));else if(pr.review==='CHANGES_REQUESTED')top.append(gitPill('changes requested','red'));else if(pr.review==='REVIEW_REQUIRED')top.append(gitPill('needs review','muted'));
  if(pr.conflicts)top.append(gitPill('conflicts','red','This PR has merge conflicts with its base branch'));
  cell.append(top);const t=el('span','git-sub',pr.title);t.title=pr.title;cell.append(t);}
 else if(merged){cell.append(gitLink(`#${merged.number}`,merged.url,'git-link git-pr-num muted'),gitPill('merged','purple',`Merged ${ago(merged.mergedAt)} — this branch is finished`));}
 else cell.append(el('span','git-none','no PR'));return cell;}
function gitBranchRow(repo,b,terminalIds){const row=el('div','git-row'+(terminalIds.length?' has-terminal':''));
 const name=el('div','git-cell git-branch');const nm=el('strong','',b.name);nm.title=b.name;name.append(nm);if(b.isDefault)name.append(gitPill('default','muted'));const sub=el('span','git-sub',b.pr?.title||b.subject||'');sub.title=(b.pr?.title||b.subject||'')+(b.date?`\nLast commit ${ago(b.date)}`:'');name.append(sub);if(b.date)name.append(el('span','git-when',ago(b.date)));
 const where=el('div','git-cell git-where');if(b.worktree){const f=el('span','git-folder',shortPath(b.worktree).split('/').pop());f.title=shortPath(b.worktree);where.append(f);}else where.append(el('span','git-none','not checked out'));if(terminalIds.length)where.append(gitTerminalChips(terminalIds));
 const main=el('div','git-cell git-main');if(b.isDefault){main.append(b.toPull?gitPill(`↓${b.toPull} to pull`,'amber','GitHub has newer commits on this branch'):gitPill('up to date','green'));}
 else if(repo.defaultBranch){main.append(b.behind?gitPill(`↓${b.behind} behind`,b.behind>20?'red':'amber',`${repo.defaultBranch} has ${b.behind} commit${b.behind===1?'':'s'} this branch doesn't — merge ${repo.defaultBranch} in`):gitPill('up to date','green',`Has everything in ${repo.defaultBranch}`));if(b.ahead)main.append(el('span','git-ahead',`↑${b.ahead} ahead`));}
 const remote=el('div','git-cell git-remote');if(b.gone)remote.append(gitPill('deleted on GitHub','muted','The branch it tracked was deleted on GitHub (often after merging)'));else if(!b.upstream)remote.append(gitPill(b.ahead||b.isDefault?'not pushed':'local only','amber','This branch is not on GitHub'));else{if(b.toPush)remote.append(gitPill(`↑${b.toPush} to push`,'amber'));if(b.toPull&&!b.isDefault)remote.append(gitPill(`↓${b.toPull} to pull`,'amber'));if(!b.toPush&&!b.toPull)remote.append(gitPill('pushed','green'));}
 const changes=el('div','git-cell git-changes');changes.append(b.dirty==null?el('span','git-none',b.worktree?'…':'—'):b.dirty?gitPill(`${b.dirty} uncommitted`,'amber'):el('span','git-none','clean'));
 const tests=el('div','git-cell git-tests');const runs=gitData?.branchRuns?.[repo.key+'\0'+b.name];const add=(text,cls,tip)=>{const p=gitPill(text,cls,tip);tests.append(p);};testBadges(add,b.tests,runs?.last,runs?.count||0);if(!tests.childElementCount)tests.append(el('span','git-none',b.tests?'none':'—'));
 row.append(name,where,main,remote,gitPrCell(b.pr,b.merged),tests,changes);return row;}
function renderGit(){const body=$('#git-body');if(!body)return;const sy=body.scrollTop;body.replaceChildren();
 const head=el('div','git-top');const title=el('div','git-title');title.append(el('strong','','Git & GitHub'),el('span','git-meta',gitLoading?(gitData?'Updating…':'Reading your repositories…'):gitData?`Updated ${ago(gitData.updatedAt)}`:''));head.append(title);
 const refresh=button(gitLoading?'Updating…':'Fetch & refresh','Fetch from GitHub and refresh now',()=>loadGit({fetch:true,force:true}),'git-refresh');refresh.disabled=gitLoading;head.append(refresh);body.append(head);
 if(gitError)body.append(el('p','git-error',gitError));if(gitData&&!gitData.gh)body.append(el('p','git-error','Install the GitHub CLI (gh) to see pull requests.'));
 if(!gitData){body.append(el('p','git-empty',gitLoading?'Looking at the folders your terminals use…':'No data yet.'));body.scrollTop=sy;return;}
 const where=gitData.terminals||{},termsIn=(repo,wt)=>Object.entries(where).filter(([id,w])=>w.repo===repo.key&&(wt===undefined||w.worktree===wt)&&sessions.has(id)).map(([id])=>id);
 const repos=[...gitData.repos].map(r=>({r,t:termsIn(r).length,prs:r.branches.filter(b=>b.pr).length})),main=repos.filter(x=>x.t||x.prs),other=repos.filter(x=>!x.t&&!x.prs);
 const card=({r})=>{const c=el('section','git-repo');const h=el('div','git-repo-head');const nm=r.url?gitLink(r.name,r.url,'git-link git-repo-name'):el('strong','git-repo-name',r.name);h.append(nm);
  const ts=termsIn(r);if(ts.length)h.append(gitTerminalChips(ts));
  const stats=el('span','git-stats');const open=r.branches.filter(b=>b.pr).length+r.otherPrs.length,behind=r.branches.filter(b=>!b.isDefault&&b.worktree&&b.behind).length,dirty=r.branches.filter(b=>b.dirty).length;
  stats.append(el('span','',`${r.branches.length} branch${r.branches.length===1?'':'es'}`),el('span','',`${r.worktrees.length} folder${r.worktrees.length===1?'':'s'}`),el('span','',`${open} open PR${open===1?'':'s'}`));if(behind)stats.append(el('span','warn',`${behind} behind ${r.defaultBranch}`));if(dirty)stats.append(el('span','warn',`${dirty} with uncommitted changes`));stats.append(el('span','',r.fetchedAt?`fetched ${ago(r.fetchedAt)}`:'not fetched'));h.append(stats);c.append(h);
  for(const msg of [r.error,r.fetchError&&`Fetch failed: ${r.fetchError}`,r.ghError])if(msg)c.append(el('p','git-error',msg));
  const rank=b=>(termsIn(r,b.worktree||'\0').length?0:b.pr?1:b.worktree?2:3);const primary=r.branches.filter(b=>b.worktree||b.pr).sort((a,b)=>rank(a)-rank(b)||(b.date||0)-(a.date||0)),rest=r.branches.filter(b=>!b.worktree&&!b.pr).sort((a,b)=>(b.date||0)-(a.date||0));
  const table=el('div','git-table');const th=el('div','git-row git-row-head');for(const t of ['Branch · feature','Folder · terminals',`vs ${r.defaultBranch||'main'}`,'GitHub','Pull request','Tests','Local changes'])th.append(el('div','git-cell',t));table.append(th);
  for(const b of primary)table.append(gitBranchRow(r,b,b.worktree?termsIn(r,b.worktree):[]));
  for(const d of r.detached||[]){const row=el('div','git-row');const n=el('div','git-cell git-branch');n.append(el('strong','',`detached at ${d.head}`));row.append(n);const w=el('div','git-cell git-where');const f=el('span','git-folder',shortPath(d.path).split('/').pop());f.title=shortPath(d.path);w.append(f);const ids=termsIn(r,d.path);if(ids.length)w.append(gitTerminalChips(ids));row.append(w,el('div','git-cell'),el('div','git-cell'),el('div','git-cell'),el('div','git-cell'),el('div','git-cell git-changes'));if(d.dirty)row.lastChild.append(gitPill(`${d.dirty} uncommitted`,'amber'));table.append(row);}
  if(rest.length){const open=gitExpanded.has(r.key);if(open)for(const b of rest)table.append(gitBranchRow(r,b,[]));const more=button(open?'Hide other branches':`Show ${rest.length} other branch${rest.length===1?'':'es'} (not checked out, no open PR)`,'',()=>{if(gitExpanded.has(r.key))gitExpanded.delete(r.key);else gitExpanded.add(r.key);renderGit();},'git-more');table.append(more);}
  c.append(table);
  if(r.otherPrs.length){const box=el('div','git-others');box.append(el('div','git-section','Open pull requests from branches not on this Mac'));for(const p of r.otherPrs){const line=el('div','git-other');line.append(gitLink(`#${p.number}`,p.url,'git-link git-pr-num'),el('span','git-other-title',p.title),el('span','git-sub',`${p.branch}${p.author?' · '+p.author:''} · ${ago(p.updatedAt)}`));if(p.draft)line.append(gitPill('draft','muted'));if(p.checks)line.append(gitPill({pass:'✓',fail:'✗',pending:'●'}[p.checks],{pass:'green',fail:'red',pending:'amber'}[p.checks],'Checks'));if(p.review==='APPROVED')line.append(gitPill('approved','green'));if(p.conflicts)line.append(gitPill('conflicts','red'));box.append(line);}c.append(box);}
  return c;};
 if(!repos.length)body.append(el('p','git-empty','None of your terminals are in a git repository.'));
 for(const x of main)body.append(card(x));
 if(other.length){const key='\0other',open=gitExpanded.has(key);body.append(button(open?'Hide repositories without terminals':`${other.length} more repositor${other.length===1?'y':'ies'} nearby, without terminals or open PRs: ${other.map(x=>x.r.name.split('/').pop()).join(', ')}`,'',()=>{if(gitExpanded.has(key))gitExpanded.delete(key);else gitExpanded.add(key);renderGit();},'git-more git-more-repos'));if(open)for(const x of other)body.append(card(x));}
 body.scrollTop=sy;}
$('#git-button').onclick=()=>toggleGit();
// Home: close Overview / Git and any expanded terminal, back to this workspace's grid.
function goHome(){if(overviewOpen())toggleOverview(false);if(gitOpen())toggleGit(false);exitExpanded();$('#canvas-scroll')?.scrollTo?.({top:0});}

document.addEventListener('keydown',e=>{if(e.metaKey&&e.shiftKey&&!e.altKey&&!e.ctrlKey&&e.code==='KeyH'&&!document.querySelector('dialog[open]')){e.preventDefault();e.stopPropagation();goHome();}},true);

// Left panel: the GitHub repos and branches this workspace's terminals are in, with how each branch stands.
let gitSide=null;
api.onGitOverview(data=>{gitSide=data;if(gitOpen()&&data&&data.scope!=='terminals'){gitData=data;renderGit();}renderGitSide();});
// Per terminal in this workspace: the features (branches) it worked on — from the folders Claude was in — newest first,
// with the branch's state, the tests written on it and the tests this terminal last ran there. Click to open the Git view.
const GIT_SIDE_MAX=4;
function testBadges(add,tests,runs,count){
 if(tests&&(tests.added||tests.removed))add(`+${tests.added} test${tests.added===1?'':'s'}`,'muted',`${tests.added} test${tests.added===1?'':'s'} added${tests.removed?`, ${tests.removed} removed`:''} on this branch since it left main (${tests.files} test file${tests.files===1?'':'s'})`);
 const last=runs?.[runs.length-1];if(!last)return;const when=last.at?ago(last.at):'';
 const detail=runs.slice(-5).reverse().map(r=>`${r.at?new Date(r.at).toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):'?'} — ${r.passed} passed, ${r.failed} failed${r.skipped?`, ${r.skipped} skipped`:''} · ${r.command}`).join('\n');
 add(last.failed?`✗ ${last.failed} failed`:`✓ ${last.passed} passed`,last.failed?'red':'green',`Last test run ${when}: ${last.passed} passed, ${last.failed} failed${last.skipped?`, ${last.skipped} skipped`:''}${count>1?` (${count} runs)`:''}\n${detail}`);}
function gitStateBadges(add,repo,b){if(!b)return;
 if(!b.isDefault&&b.behind)add(`↓${b.behind}`,b.behind>20?'red':'amber',`${b.behind} commit${b.behind===1?'':'s'} behind ${repo.defaultBranch} — merge ${repo.defaultBranch} in`);else if(b.isDefault&&b.toPull)add(`↓${b.toPull}`,'amber',`${b.toPull} new on GitHub to pull`);
 if(!b.upstream&&!b.gone&&(b.ahead||!b.isDefault))add('local','amber','Not pushed to GitHub');else if(b.toPush)add(`↑${b.toPush}`,'amber',`${b.toPush} commit${b.toPush===1?'':'s'} to push`);
 const pr=b.pr;if(pr)add(`#${pr.number}`,pr.checks==='fail'||pr.conflicts||pr.review==='CHANGES_REQUESTED'?'red':pr.review==='APPROVED'?'green':'blue',`PR #${pr.number}${pr.draft?' (draft)':''}: ${pr.title}${pr.checks?` · checks ${pr.checks==='pass'?'passed':pr.checks==='fail'?'failed':'running'}`:''}${pr.review==='APPROVED'?' · approved':pr.review==='CHANGES_REQUESTED'?' · changes requested':''}${pr.conflicts?' · has conflicts':''}`);
 else if(b.merged)add(`#${b.merged.number} merged`,'purple',`PR #${b.merged.number} merged — this branch is finished`);
 if(b.dirty)add(`±${b.dirty}`,'muted',`${b.dirty} uncommitted change${b.dirty===1?'':'s'}`);}
function renderGitSide(){const box=$('#git-side');if(!box)return;const work=gitSide?.terminalFeatures||{},where=gitSide?.terminals||{};
 const terms=[...sessions.values()].filter(s=>s.workspaceId===activeWorkspaceId&&s.status!=='closed'&&(work[s.id]?.length||where[s.id]?.branch));
 const key=JSON.stringify([gitSide?.updatedAt,activeWorkspaceId,terms.map(s=>s.id+s.color+s.title)]);if(box.dataset.key===key)return;box.dataset.key=key;
 box.hidden=!terms.length;box.replaceChildren();if(!terms.length)return;
 // Header: click "Features" to hide or show the list (remembered); "Git view ›" opens the full view.
 let hidden=false;try{hidden=localStorage.getItem('features-hidden')==='true';}catch{}
 const head=el('div','git-side-head');const toggle=button('',hidden?'Show features':'Hide features',()=>{try{localStorage.setItem('features-hidden',String(!hidden));}catch{}box.dataset.key='';renderGitSide();},'git-side-toggle');toggle.setAttribute('aria-expanded',String(!hidden));toggle.append(el('span','git-side-chevron',hidden?'›':'⌄'),el('span','','Features'));if(hidden)toggle.append(el('span','git-side-count',String(terms.length)));
 head.append(toggle,button('Git view ›','Open the Git view (⇧⌘G)',()=>toggleGit(true),'git-side-open'));box.append(head);box.classList.toggle('is-hidden',hidden);if(hidden)return;
 for(const s of terms){const block=el('div','git-side-repo');const t=button('',`Open ${s.title}`,()=>openView(s.id),'git-side-name git-side-terminal');t.style.setProperty('--color',accent(sessionColor(s)));t.append(el('i'),el('span','',s.title));block.append(t);
  const list=[...(work[s.id]||[])];const here=where[s.id];if(here?.branch&&!list.some(f=>f.repo===here.repo&&f.branch===here.branch))list.unshift({repo:here.repo,branch:here.branch,worktree:here.worktree,lastAt:Date.now(),runs:[],runCount:0});
  for(const f of list.slice(0,GIT_SIDE_MAX)){const repo=gitSide.repos.find(r=>r.key===f.repo);if(!repo)continue;const b=repo.branches.find(x=>x.name===f.branch)||null;
   const title=b?.pr?.title||b?.merged?.title||b?.subject||f.branch;const line=button('','',()=>toggleGit(true),'git-side-line'+(b?.merged&&!b.pr?' is-done':''));
   line.append(el('span','git-side-feature',title));const badges=el('span','git-side-badges'),tips=[title,`Branch ${f.branch} · ${repo.name}`+(f.worktree?` · ${shortPath(f.worktree)}`:''),`Worked on ${ago(f.lastAt)}`];
   badges.append(el('span','git-side-branch',`${f.branch} · ${repo.name.split('/').pop()}`));const add=(text,cls,tip)=>{badges.append(el('span','git-side-badge '+cls,text));tips.push(tip);};
   gitStateBadges(add,repo,b);testBadges(add,b?.tests,f.runs,f.runCount);line.append(badges);line.title=tips.join('\n');block.append(line);}
  if(list.length>GIT_SIDE_MAX)block.append(button(`+${list.length-GIT_SIDE_MAX} more`,'Show all in the Git view',()=>toggleGit(true),'git-side-more'));
  box.append(block);}}

document.addEventListener('keydown',e=>{if(e.key==='Escape'&&gitOpen()&&!document.querySelector('dialog[open]')){e.preventDefault();toggleGit(false);return;}if(e.metaKey&&e.shiftKey&&!e.altKey&&!e.ctrlKey&&e.code==='KeyG'&&!document.querySelector('dialog[open]')){e.preventDefault();e.stopPropagation();toggleGit();}},true);

document.addEventListener('keydown',e=>{if(e.key==='Escape'&&overviewOpen()&&!document.querySelector('dialog[open]')){e.preventDefault();toggleOverview(false);return;}if(e.metaKey&&e.shiftKey&&!e.altKey&&!e.ctrlKey&&e.code==='KeyO'&&!document.querySelector('dialog[open]')){e.preventDefault();e.stopPropagation();toggleOverview();}},true);
// Under each workspace name: one mark per terminal that asks you something, is running (flickering) or finished and you haven't opened it yet (solid), in that terminal's color.
function renderTabDots(){for(const tab of document.querySelectorAll('#workspace-tabs .workspace-tab')){
 const mine=[...sessions.values()].filter(s=>s.workspaceId===tab.dataset.workspace&&(s.question||s.status==='running'||(s.status==='done'&&s.unreadDone)));let box=tab.querySelector('.tab-dots');
 if(!mine.length){box?.remove();tab.classList.remove('has-marks');continue;}if(!box){box=el('span','tab-dots');tab.append(box);}tab.classList.add('has-marks');
 const order=[...mine.filter(s=>s.question),...mine.filter(s=>!s.question&&s.status==='running'),...mine.filter(s=>!s.question&&s.status==='done')];
 const key=order.map(s=>s.id+s.status+(s.unreadDone?1:0)+(s.question?'q':'')+s.color).join();if(box.dataset.key===key)continue;box.dataset.key=key;
 box.replaceChildren(...order.slice(0,10).map(s=>{const d=s.question?el('i','tab-dot is-question','?'):el('i','tab-dot'+(s.status==='running'?' is-running':' is-new'));d.style.setProperty('--color',accent(sessionColor(s)));return d;}),...(order.length>10?[el('span','tab-dot-more','+'+(order.length-10))]:[]));
 const running=order.filter(s=>s.status==='running'),done=order.filter(s=>s.status==='done'),asking=order.filter(s=>s.question);box.title=[asking.length?`Waiting for your answer: ${asking.map(s=>s.title).join(', ')}`:'',running.length?`Running: ${running.map(s=>s.title).join(', ')}`:'',done.length?`Done: ${done.map(s=>s.title).join(', ')}`:''].filter(Boolean).join('\n');
 tab.setAttribute('aria-label',`${tab.dataset.title||''}: ${running.length} running, ${done.length} done`);}}
function renderStatusCounts(){renderTabDots();scheduleOverview();renderGitSide();const box=$('#status-counts');if(!box)return;const all=[...sessions.values()],count=f=>all.filter(f).length;
 const done=count(s=>s.status==='done'),running=count(s=>s.status==='running'),waiting=count(s=>s.status==='attention'),open=all.length;
 const item=(n,label,cls,title)=>{const e=el('span','status-count '+cls);e.append(el('i','status-icon '+cls),el('b','',String(n)),document.createTextNode(' '+label));e.title=title;return e;};
 box.replaceChildren(item(done,'done','is-done','Finished — '+all.filter(s=>s.status==='done').map(s=>s.title).join(', ')),item(running,'running','is-running','Working — '+all.filter(s=>s.status==='running').map(s=>s.title).join(', ')),...(waiting?[item(waiting,'waiting','is-waiting','Waiting for you — '+all.filter(s=>s.status==='attention').map(s=>s.title).join(', '))]:[]),item(open,'open','is-open',`${open} open terminal${open===1?'':'s'} in ${workspaces.filter(w=>!w.archived).length} workspace${workspaces.filter(w=>!w.archived).length===1?'':'s'}`));}
// Phone access switch (left panel, bottom): Remote Control for every Claude chat, so you can read and reply from the Claude app.
async function renderPhone(state){const b=$('#phone-toggle');if(!b)return;state??=await api.phoneGet().catch(()=>null);if(!state)return;b.setAttribute('aria-pressed',String(state.enabled));b.classList.toggle('is-on',state.enabled);api.phoneWebGet().then(w=>b.classList.toggle('web-on',w.enabled)).catch(()=>{});b.title=state.enabled?'Phone: Terminator on your iPhone and Claude Remote Control':'Phone: use Terminator from your iPhone';}
async function enableRemoteControl(){const open=[...sessions.values()].filter(s=>s.agent&&s.provider==='claude'&&!s.remoteControl);
 if(!await confirmAction('Connect Claude chats to the Claude app?','Every Claude chat in Terminator will also run Remote Control: open the Claude app (Code) or claude.ai/code to read and reply. Each chat is named after its terminal.'+(open.length?` Idle open chats (${open.length}) get connected now; busy ones when you next start or resume them.`:''),[],'Turn on'))return false;
 const result=await api.phoneSet(true,{connectRunning:true});await renderPhone(result);notice(result.connected?`Connecting ${result.connected} chat${result.connected===1?'':'s'} to the Claude app…`:'New and resumed Claude chats connect to the Claude app.');return true;}
function renderPhoneWeb(info){$('#phone-web-enabled').checked=info.enabled;$('#phone-web-body').hidden=!info.enabled;const qr=$('#phone-web-qr'),steps=$('#phone-web-steps');if(info.qr)qr.src=info.qr;$('#phone-web-copy').disabled=!info.url;
 const h=info.https||{};$('#phone-web-approve').hidden=!(info.enabled&&h.state==='needs-approval');
 $('#phone-web-status').textContent=!info.enabled?'':!info.tailscale?'Waiting for Tailscale on this Mac — it isn’t running yet.':h.state==='ready'?`Ready at ${h.url.replace(/\/$/,'')} (secure, Tailscale only).`:h.state==='needs-approval'?'One step left: allow secure (HTTPS) addresses for your Tailscale network. Click the button, approve in the browser, then come back.':h.state==='error'?`Secure address not ready: ${h.detail||'Tailscale refused.'}`:`Ready at ${info.addresses[0]} (Tailscale, not secure: iPhones set to HTTPS-only can't open it).`;
 qr.hidden=!info.qr||h.state==='needs-approval';
 steps.replaceChildren(...(info.tailscale?['On your iPhone, open the Tailscale app and sign in with the same account (VPN on).','Scan this code with the iPhone camera and open the link in Safari.','In Safari tap Share → Add to Home Screen. Open Terminator from there.']:['Install Tailscale on this Mac (tailscale.com/download or the Mac App Store), open it and sign in.','Install Tailscale on your iPhone and sign in with the same account.','Come back here: a code to scan appears.']).map(t=>el('li','',t)));
 $('#phone-toggle').classList.toggle('web-on',info.enabled);}
async function openPhoneDialog(){const [web,rc]=await Promise.all([api.phoneWebGet(),api.phoneGet()]);renderPhoneWeb(web);$('#phone-rc-enabled').checked=rc.enabled;$('#phone-dialog').showModal();clearInterval(window.__phonePoll);window.__phonePoll=setInterval(async()=>{if(!$('#phone-dialog').open){clearInterval(window.__phonePoll);return;}renderPhoneWeb(await api.phoneWebGet());},5000);}
$('#phone-toggle').onclick=()=>openPhoneDialog().catch(notice);
$('#phone-close').onclick=()=>$('#phone-dialog').close();
$('#phone-web-enabled').onchange=async e=>{try{renderPhoneWeb(await api.phoneWebSet(e.target.checked));}catch(error){notice(error);e.target.checked=!e.target.checked;}};
$('#phone-web-reset').onclick=async()=>{if(!await confirmAction('Make a new pairing code?','Phones paired with the old code stop working until you scan the new one.',[],'New code'))return;renderPhoneWeb(await api.phoneWebReset());};
$('#phone-web-approve').onclick=async()=>{await api.phoneWebOpenApproval();notice('Approve in the browser, then come back here: the code appears by itself.');};
$('#phone-web-copy').onclick=async()=>{const info=await api.phoneWebGet();if(info.url){await navigator.clipboard.writeText(info.url);notice('Link copied. It contains your pairing code: only open it on your own devices.');}};
$('#phone-rc-enabled').onchange=async e=>{try{if(e.target.checked){if(!await enableRemoteControl())e.target.checked=false;}else{await renderPhone(await api.phoneSet(false));notice('New Claude chats no longer connect to the Claude app.');}}catch(error){notice(error);}};
renderPhone();
let sidebarPressed=false,sidebarPending=false;
function sidebar(){renderStatusCounts();
 if(sidebarDragging)return;if(sidebarPressed){sidebarPending=true;return;}
 const seenLinks=new Set();const nav=$('#terminals');nav.replaceChildren();
 const goals=el('section','terminal-group goals-group');goals.setAttribute('aria-label','Goals');const goalsLabel=el('div','section-label goals-label');goalsLabel.append(el('span','','Goals'),button('+','New goal',newGoal,'icon goal-add'));goals.append(goalsLabel);
 for(const goal of workspaces.find(w=>w.id===activeWorkspaceId)?.goals||[]){const row=el('div','workspace-goal');row.append(button(goal.text,'Edit goal',()=>editGoal(goal),'goal-text'),...(goalHooks.actions?.(goal)||[]),button('×','Remove goal',()=>updateGoalRecord(activeWorkspaceId,goal.id,null).catch(notice),'icon goal-remove'));const item=el('div','goal-item');item.draggable=true;item.title='Drag onto a terminal to attach it, or onto an attached terminal to detach it';item.addEventListener('dragstart',e=>{e.dataTransfer.setData(goalDragType,goal.id);e.dataTransfer.effectAllowed='link';draggingGoal=goal;});item.addEventListener('dragend',()=>{draggingGoal=null;clearGoalDrop();});const meta=el('div','goal-meta');meta.append(goalDate(goal),goalDots(goal));const subs=goal.subgoals||[];if(subs.length)meta.append(el('span','goal-count',`${subs.filter(x=>x.done).length}/${subs.length}`));item.append(row,meta,goalProgressBar(activeWorkspaceId,goal),subgoalList(goal));goalHooks.decorate?.(item,goal);goals.append(item);}
 nav.append(goals);
 const all=currentSessions(),byId=new Map(all.map(s=>[s.id,s]));
 const saved=sidebarOrder[activeWorkspaceId]||{priority:[],rest:[]};
 const priority=(saved.priority||[]).filter(id=>byId.has(id));
 const rest=[...(saved.rest||[]).filter(id=>byId.has(id)&&!priority.includes(id)),...all.map(s=>s.id).filter(id=>!priority.includes(id)&&!(saved.rest||[]).includes(id))];
 api.menuBarState({workspaceId:activeWorkspaceId,priority,rest,selected}).catch(notice);
 for(const group of ['priority','rest']){
 const section=el('section','terminal-group');section.setAttribute('aria-label',group==='priority'?'Priority':'Rest');
 const list=el('div','terminal-group-list');
 if(group==='rest'){const collapsed=!!restCollapsed[activeWorkspaceId],toggle=button((collapsed?'›':'⌄')+' Rest','Toggle Rest',()=>{restCollapsed[activeWorkspaceId]=!restCollapsed[activeWorkspaceId];localStorage.setItem('rest-collapsed',JSON.stringify(restCollapsed));sidebar();},'section-label rest-toggle');toggle.setAttribute('aria-expanded',String(!collapsed));toggle.setAttribute('aria-controls','rest-terminals');list.id='rest-terminals';list.hidden=collapsed;section.append(toggle);}else section.append(el('div','section-label','Priority'));
 section.append(list);nav.append(section);
 const ids=group==='priority'?priority:rest;
 ids.forEach((id,index)=>{const s=byId.get(id);
const b=button('',`View ${s.title}`,()=>openView(s.id),'terminal-link');b.classList.toggle('active',s.id===selected);b.classList.toggle('terminal-done',!!s.unreadDone&&s.status!=='running');b.style.setProperty('--done-background',darkMode?'color-mix(in srgb,'+accent(s.color)+' 42%,#000)':tint(s.color,.65));b.style.setProperty('--color',accent(sessionColor(s)));b.classList.toggle('is-priority',group==='priority');b.append(group==='priority'?Object.assign(el('span','priority-number',String(index+1)),{title:index<9?`⌘${index+1} to zoom in`:''}):el('span','color-dot'));const info=el('div');const name=el('span','terminal-name');name.append(el('span','terminal-title-text',s.title));if(s.question){const q=el('span','question-badge','?');q.title=s.status==='attention'?'Waiting for your answer or permission':'Asked you a question';name.append(q);}info.append(name);const model=el('div','terminal-model'),label=el('span','terminal-model-label',modelLabel(s));label.title=modelLabel(s);model.append(label);if(s.status==='running'){const elapsed=el('span','elapsed',duration(s));elapsed.dataset.timer=s.id;model.append(elapsed);}info.append(model);label.after(contextBubble(s));b.append(info);b.addEventListener('dblclick',()=>edit(s.id));b.addEventListener('contextmenu',event=>{event.preventDefault();event.stopPropagation();edit(s.id);});b.dataset.goalTarget=s.id;b.draggable=true;b.addEventListener('dragstart',e=>{e.dataTransfer.setData('text/terminal-id',s.id);e.dataTransfer.effectAllowed='move';sidebarDragging=true;});
 b.dataset.sidebarId=id;
 b.addEventListener('dragend',()=>{sidebarDragging=false;sidebar();});list.append(b);if(s.links?.length){const links=el('div','terminal-links');for(const link of s.links){const key=sidebarLinkKey(link);if(seenLinks.has(key))continue;seenLinks.add(key);const a=el('a','terminal-site-link'+(link.file?' is-file':''),link.label);a.href=link.url;a.title=(link.file?`${link.path}\nOpens in Safari`:link.url)+'\nRight-click to rename';a.onclick=e=>{e.preventDefault();api.openTerminalLink(s.id,link.url).catch(notice);};a.oncontextmenu=e=>{e.preventDefault();e.stopPropagation();renameLink(a,s.id,link);};const row=el('div','terminal-link-row'),remove=el('button','terminal-link-remove','×');remove.type='button';remove.title='Remove this link from the list';remove.setAttribute('aria-label','Remove link '+link.label);remove.onclick=e=>{e.preventDefault();e.stopPropagation();api.removeTerminalLink(s.id,link.key).catch(notice);};row.append(a,remove);links.append(row);}if(links.childElementCount){const open=linksOpen.has(s.id),n=links.childElementCount,globe=el('span','terminal-globe'+(open?' open':''));globe.setAttribute('role','button');globe.tabIndex=0;globe.setAttribute('aria-expanded',String(open));globe.title=`${open?'Hide':'Show'} ${n} link${n===1?'':'s'}`;globe.setAttribute('aria-label',globe.title);globe.innerHTML='<svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.2"/><ellipse cx="8" cy="8" rx="2.7" ry="6.2" fill="none" stroke="currentColor" stroke-width="1.1"/><path d="M2 8h12M3 4.8h10M3 11.2h10" fill="none" stroke="currentColor" stroke-width="1"/></svg>';globe.append(el('span','terminal-globe-count',String(n)));const flip=e=>{e.preventDefault();e.stopPropagation();const now=!linksOpen.has(s.id);if(now)linksOpen.add(s.id);else linksOpen.delete(s.id);try{localStorage.setItem('linksOpen',JSON.stringify([...linksOpen]));}catch{}links.hidden=!now;globe.classList.toggle('open',now);globe.setAttribute('aria-expanded',String(now));globe.title=`${now?'Hide':'Show'} ${n} link${n===1?'':'s'}`;globe.setAttribute('aria-label',globe.title);};globe.onclick=flip;globe.onkeydown=e=>{if(e.key==='Enter'||e.key===' ')flip(e);};globe.ondblclick=e=>e.stopPropagation();{const m=b.querySelector('.terminal-model');if(m)m.insertBefore(globe,m.querySelector('.elapsed'));else b.append(globe);}links.hidden=!open;list.append(links);}}
 });
 section.addEventListener('dragover',event=>{if(!event.dataTransfer.types.includes('text/terminal-id'))return;event.preventDefault();event.dataTransfer.dropEffect='move';nav.querySelectorAll('.drop-before,.drop-after,.drop-group').forEach(n=>n.classList.remove('drop-before','drop-after','drop-group'));const row=event.target.closest('.terminal-link');if(row){const before=event.clientY<row.getBoundingClientRect().top+row.offsetHeight/2;row.classList.add(before?'drop-before':'drop-after');}else section.classList.add('drop-group');});
 section.addEventListener('drop',event=>{const id=event.dataTransfer.getData('text/terminal-id');if(!byId.has(id))return;event.preventDefault();event.stopPropagation();const next={priority:priority.filter(x=>x!==id),rest:rest.filter(x=>x!==id)};const row=event.target.closest('.terminal-link');let at=next[group].length;if(row&&row.dataset.sidebarId!==id){at=next[group].indexOf(row.dataset.sidebarId);if(event.clientY>=row.getBoundingClientRect().top+row.offsetHeight/2)at++;}else if(row){at=ids.indexOf(id);}next[group].splice(Math.max(0,at),0,id);sidebarOrder[activeWorkspaceId]=next;localStorage.setItem('sidebar-order',JSON.stringify(sidebarOrder));sidebarDragging=false;sidebar();});
 }
}


function scrollTerminal(term,line){const b=term.buffer.active;line=Math.max(0,Math.min(b.baseY,Math.round(line)));for(let i=0;i<4&&b.viewportY!==line;i++)term.scrollLines(line-b.viewportY);if(line<b.baseY&&b.viewportY===line){term.scrollLines(1);term.scrollLines(-1);}}
// Where each prompt was sent: marked in the scrollback the moment it arrives, so navigating jumps to that exact prompt instead of
// searching the text again (a search can land on a quote or repeat of it). Prompts from before Terminator started fall back to the search.
const compactPrompt=t=>String(t||'').replace(/[\s\u200b-\u200d\ufeff]+/g,'');
// Long or pasted prompts are shown shortened by Claude/Codex: then the newest recent line that starts with the prompt's beginning.
function promptHead(b,text){const head=compactPrompt(text).slice(0,24);if(head.length<4)return null;for(let i=b.length-1;i>=Math.max(0,b.length-400);i--){const t=b.getLine(i)?.translateToString(true).trim()||'',c=compactPrompt(t.replace(/^[❯›>]\s*/,''));if(/^[❯›>]/.test(t)&&c.startsWith(head.slice(0,Math.min(head.length,c.length)))&&c.length>=Math.min(12,head.length))return i;}return null;}
function markPrompt(v,text,at=Date.now(),tries=0){if(!text||views.get(v.id)!==v)return;const b=v.term.buffer.active,line=promptLine(b,text,0)??(tries>=2?promptHead(b,text):null);
 if(line===null||line<b.length-400){if(tries<6)setTimeout(()=>markPrompt(v,text,at,tries+1),500);return;}
 v.promptMarks=(v.promptMarks||[]).filter(m=>!m.marker.isDisposed&&m.marker.line!==line).slice(-200);
 const marker=v.term.registerMarker(line-(b.baseY+b.cursorY));if(marker)v.promptMarks.push({key:compactPrompt(text),at,marker});}
function markedLine(v,prompt,occurrence=0){const key=compactPrompt(prompt.text),marks=(v.promptMarks||[]).filter(m=>m.key===key&&!m.marker.isDisposed&&m.marker.line>=0);if(!marks.length)return null;
 if(prompt.timestamp){const near=marks.map(m=>({m,d:Math.abs(m.at-prompt.timestamp)})).filter(x=>x.d<120000).sort((a,b)=>a.d-b.d)[0];return near?near.m.marker.line:null;}
 return marks[marks.length-1-occurrence]?.marker.line??null;}
// Line where a prompt starts in this terminal (or its View copy, which holds the same lines when it is the same length).
function promptStart(v,prompt,occurrence=0,term=v.term){const marked=markedLine(v,prompt,occurrence);if(marked!==null&&(term===v.term||term.buffer.active.length===v.term.buffer.active.length))return marked;return promptLine(term.buffer.active,prompt.text,occurrence);}
function cursorLine(v,term=v.term){const cursor=promptCursors.get(v.id);return cursor?promptStart(v,cursor,cursor.occurrence||0,term):null;}
function keepViewport(v,move){const b=v.term.buffer.active,bottom=b.viewportY>=b.baseY,top=b.viewportY;move();fit(v);v.anchor={bottom,top,until:Date.now()+1500};restoreViewport(v);requestAnimationFrame(()=>restoreViewport(v));}
function restoreViewport(v){const a=v.anchor;if(!a||a.until<Date.now()){v.anchor=null;return;}const line=cursorLine(v);if(line!==null)scrollTerminal(v.term,line);else if(a.bottom)v.term.scrollToBottom();else scrollTerminal(v.term,a.top);}
// While a phone watches a terminal, the terminal has the phone's size: the Mac shows it at that size too, or Claude's
// narrow drawing would land on the wide screen and leave the old text beside it.
function fit(v){if(!v.host.isConnected||v.host.clientWidth<20||v.host.clientHeight<20)return;const phone=sessions.get(v.id)?.phoneSize;v.pane.classList.toggle('phone-sized',!!phone);if(phone){if(v.term.cols!==phone.cols||v.term.rows!==phone.rows)v.term.resize(phone.cols,phone.rows);return;}try{const atBottom=v.term.buffer.active.viewportY>=v.term.buffer.active.baseY;v.fit.fit();if(atBottom)v.term.scrollToBottom();if(v.term.cols!==v.cols||v.term.rows!==v.rows){v.cols=v.term.cols;v.rows=v.term.rows;api.resize(v.id,v.cols,v.rows).catch(notice);}}catch{}}
// Full-screen programs (Claude Code, vim…) turn on mouse reporting; if they exit without turning it off, or an old screen
// is replayed, every mouse move would be typed into the shell as "…;35;36M". Back at the shell prompt it is switched off.
// While the program still runs (Claude after /clear, or a replayed terminal) the modes it uses (s.mouseModes, followed by
// the app) are kept, so clicks and the wheel keep reaching it.
function resetMouse(term,modes=[]){term?.write(restoreSequence(modes));}
function update(s){queueMicrotask(renderStatusCounts);{const prev=sessions.get(s.id),v0=views.get(s.id);if(v0&&'agent' in s&&!s.agent&&['ready','done','error'].includes(s.status)&&(prev?.agent||prev?.status==='running')&&!s.mouseModes?.length)resetMouse(v0.term);}const previous=sessions.get(s.id);if(previous&&'question' in s&&!!previous.question!==!!s.question)queueMicrotask(sidebar);if(previous&&'latestPrompt' in s&&previous.latestPrompt!==s.latestPrompt){invalidateNavigationHistory();schedulePromptNavigation(s.id);if(s.latestPrompt){const pv=views.get(s.id);if(pv)setTimeout(()=>markPrompt(pv,s.latestPrompt),300);}}const phoneChanged='phoneSize' in s&&JSON.stringify(previous?.phoneSize||null)!==JSON.stringify(s.phoneSize);sessions.set(s.id,{...sessions.get(s.id),...s});const v=views.get(s.id);if(!v)return;if(phoneChanged)fit(v);v.title.textContent=s.title;v.folder.textContent=shortPath(s.cwd);v.folder.title=s.cwd;v.card.style.setProperty('--color',accent(sessionColor(s)));v.pane.style.setProperty('--color',accent(sessionColor(s)));v.pane.style.setProperty('--text-color',coloredBackground?(darkMode?'#eee':'#242424'):accent(s.color));v.pane.style.setProperty('--surface',sessionSurface(s));v.pane.style.setProperty('--header',sessionSurface(s,true));v.term.options.theme={...v.term.options.theme,...sessionTheme(s)};if(v.mirror)v.mirror.options.theme={...v.mirror.options.theme,...sessionTheme(s)};renderDrafts(v);{let q=v.title.parentElement?.querySelector('.question-badge');if(s.question&&!q){q=el('span','question-badge','?');q.title='Waiting for your answer';v.title.after(q);}else if(!s.question)q?.remove();}v.meta.textContent=modelLabel(s)+(s.remoteControl?' · 📱':'')+(s.phoneSize?' · shown at your phone’s size':'');if(s.notSaving){v.meta.textContent+=(v.meta.textContent?' · ':'')+'⚠ not saved';v.meta.title='Claude Code is not saving this conversation, so it cannot be resumed. Start Claude again from Terminator to fix this.';}else v.meta.title='';v.meta.classList.toggle('not-saving',!!s.notSaving);renderPromptBar(v);if(v.ghost){v.ghost.style.setProperty('--color',accent(sessionColor(s)));v.ghost.style.setProperty('--text-color',coloredBackground?(darkMode?'#eee':'#242424'):accent(s.color));v.ghost.style.setProperty('--surface',sessionSurface(s));v.ghost.style.setProperty('--header',sessionSurface(s,true));v.ghost.querySelector('.pane-title').textContent=s.title;v.ghost.querySelector('.model-meta').textContent=modelLabel(s);v.ghost.querySelector('.folder-meta').textContent=s.cwd;v.ghost.querySelector('.folder-meta').title=s.cwd;}v.status.replaceChildren(el('span',`status-dot ${s.status}`));v.status.title=`${labels[s.status]}${s.agent?' · '+(s.provider==='codex'?'Codex':'Claude'):''}`;const elapsed=el('span','elapsed',duration(s));elapsed.dataset.timer=s.id;v.status.append(elapsed);v.agentButton.hidden=s.agent||!['ready','done','error'].includes(s.status);v.fastAgentButton.hidden=v.agentButton.hidden;v.resumeButton.hidden=v.agentButton.hidden;if('forkable' in s)v.forkButton.hidden=!s.forkable;v.term.options.disableStdin=s.status==='closed';if(v.ghost){const state=v.ghost.querySelector('.pane-state');state.replaceChildren(...[...v.status.childNodes].map(n=>n.cloneNode(true)));state.title=v.status.title;const source=v.header.querySelectorAll('button'),copies=v.ghost.querySelectorAll('.pane-header button');copies.forEach((b,i)=>{if(source[i])b.hidden=source[i].hidden;});}sidebar();}
function mount(s){
 sessions.set(s.id,s);
 const config=gridFor(s.workspaceId);
 const occupied=[...views.values()].filter(v=>sessions.get(v.id).workspaceId===s.workspaceId).map(v=>v.position);
 const saved=positions[s.id];
 let position=placement(config,occupied,saved?.colSpan||1,saved?.rowSpan||1,saved);
 if(!position){config.rows+=1;config.rowWeights=Array(config.rows).fill(1);position=placement(config,occupied);}
 const card=el('section','canvas-card');card.dataset.id=s.id;card.style.zIndex=++z;
 const pane=el('div','pane'),header=el('div','pane-header'),title=el('span','pane-title',s.title),status=el('span','pane-state');title.title='Double-click to edit title and color';title.ondblclick=()=>edit(s.id);
 const actions=el('div','pane-actions');const expandButton=button('⛶','Expand terminal',()=>toggleExpanded(s.id));const viewButton=button('↗','Open in View',()=>selected===s.id?returnView():openView(s.id));const historyButton=button('','Prompt history: all prompts in this terminal',()=>openPromptHistory(s.id),'icon history-button');historyButton.innerHTML='<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M2.6 8a5.4 5.4 0 1 0 1.6-3.8" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M2.3 2.6v2.6h2.6" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/><path d="M8 5.2V8l2 1.4" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>';const forkButton=button('','Fork: continue a copy of this chat in a new terminal; this one goes on unchanged',()=>forkTerminal(s.id),'icon fork-button');forkButton.innerHTML='<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><circle cx="4.5" cy="3.5" r="1.6" fill="none" stroke="currentColor" stroke-width="1.3"/><circle cx="4.5" cy="12.5" r="1.6" fill="none" stroke="currentColor" stroke-width="1.3"/><circle cx="11.5" cy="5.5" r="1.6" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M4.5 5.1v5.8M11.5 7.1c0 2.4-2 3-4.5 3.4L4.5 11" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>';forkButton.hidden=!s.forkable;actions.append(forkButton,historyButton,viewButton,expandButton,button('⋯','Edit terminal',()=>edit(s.id)),button('×','Close terminal',()=>close(s.id)));
 const agentButton=button('Claude','claude --dangerously-skip-permissions',()=>api.claude(s.id).catch(notice),'claude-button');const fastAgentButton=button('Codex','codex --dangerously-bypass-approvals-and-sandbox',()=>api.codex(s.id).catch(notice),'claude-button');const resumeButton=button('↻','Resume last agent session',()=>resume(s.id),'claude-button');actions.prepend(agentButton,fastAgentButton,resumeButton);const meta=el('span','model-meta',modelLabel(s)),heading=el('div','pane-heading');const folder=el('span','folder-meta',String(s.cwd||'').replace(/^\/Users\/[^/]+/,'~'));folder.title=s.cwd;heading.append(title,folder,meta);header.append(heading,status,actions);const prompt=el('div','latest-prompt'),promptText=el('div','prompt-text');const promptSummary=button('›','Expand latest prompt',()=>{const expanded=prompt.classList.toggle('expanded');promptSummary.setAttribute('aria-expanded',String(expanded));promptSummary.title=expanded?'Collapse latest prompt':'Expand latest prompt';},'prompt-toggle');promptSummary.setAttribute('aria-expanded','false');const promptNav=el('div','prompt-navigation');promptNav.hidden=true;const latest=button('Latest','Go to latest prompt',()=>goLatest(s.id),'latest-button');latest.hidden=true;promptNav.append(latest);for(const [step,symbol,label] of [[-1,'‹','Previous prompt'],[1,'›','Next prompt']]){const nav=button(symbol,label,()=>navigatePrompt(s.id,step).catch(notice));nav.dataset.promptStep=step;promptNav.append(nav);}prompt.append(promptSummary,promptText,promptNav);prompt.hidden=true;const host=el('div','terminal-host');pane.append(header,prompt,host);
 card.append(pane);$('#canvas').append(card);pane.dataset.terminalId=s.id;
 const term=new Terminal({allowTransparency:true,fontFamily:'"SF Mono", Menlo, Monaco, monospace',fontSize:canvasSizeFor(s.id),lineHeight:1.3,cursorBlink:true,cursorStyle:'bar',scrollback:10000,allowProposedApi:false,linkHandler:hyperlinkHandler(s.id),theme:{background:'#ffffff',foreground:'#24272c',cursor:'#34343b',selectionBackground:'#dce4f2',black:'#30343b',red:'#b63d47',green:'#337449',yellow:'#916214',blue:'#315fb0',magenta:'#8651a4',cyan:'#237785',white:'#70757c',brightBlack:'#7d828a',brightRed:'#b63d47',brightGreen:'#337449',brightYellow:'#916214',brightBlue:'#315fb0',brightMagenta:'#8651a4',brightCyan:'#237785',brightWhite:'#90959d'}}),fitAddon=new FitAddon();term.loadAddon(fitAddon);const serialize=new SerializeAddon();term.loadAddon(serialize);term.open(host);
 const v={id:s.id,forkButton,expandButton,viewButton,card,pane,header,title,folder,meta,prompt,promptText,serialize,status,host,agentButton,fastAgentButton,resumeButton,term,fit:fitAddon,position};views.set(s.id,v);queueMicrotask(()=>renderDrafts(v));
 host.addEventListener('focusin',()=>{focused=s.id;});pane.addEventListener('pointerdown',()=>visit(s.id));
 // While the saved screen is replayed, xterm answers old queries in it (cursor position, colours…). Those answers must not reach the shell.
 term.onData(data=>{if(v.replaying&&data.startsWith('\x1b'))return;const cur=sessions.get(s.id);if(cur&&!cur.agent&&cur.status!=='running'&&!cur.mouseModes?.length&&/^(\x1b\[<\d+;\d+;\d+[mM]|\x1b\[M[\s\S]{3})+$/.test(data)){resetMouse(term);return;}api.input(s.id,data).catch(notice);});term.attachCustomKeyEventHandler(e=>{if(e.metaKey&&(['Equal','Minus','NumpadAdd','NumpadSubtract','Digit0'].includes(e.code)||e.code==='KeyT'||e.shiftKey&&e.code==='Enter'||/^Digit[1-9]$/.test(e.code)))return false;return true;});
 dropFiles(v);registerTerminalLinks(term,s.id);term.onWriteParsed(()=>{if(v.anchor)restoreViewport(v);schedulePromptNavigation(s.id);scheduleLinks(v);});
 if(s.buffer){v.replaying=true;term.write(s.buffer,()=>{v.replaying=false;resetMouse(term,sessions.get(s.id)?.mouseModes||s.mouseModes);});}else if(earlyOutput.has(s.id)){term.write(earlyOutput.get(s.id));earlyOutput.delete(s.id);}const observer=new ResizeObserver(()=>fit(v));observer.observe(host);observer.observe(card);v.observer=observer;
 card.hidden=s.workspaceId!==activeWorkspaceId;
 card.addEventListener('pointerdown',()=>{focused=s.id;views.forEach((v,k)=>v.card.classList.toggle('focused',k===s.id));card.style.zIndex=++z;});
 v.startDrag=event=>{
   if(event.button!==0||event.target.closest('button')||!card.contains(event.currentTarget))return;
   event.preventDefault();const startX=event.clientX,startY=event.clientY;let dragging=false,target=null;
   let tab=null;const move=e=>{if(Math.hypot(e.clientX-startX,e.clientY-startY)<5&&!dragging)return;dragging=true;card.classList.add('dragging');const at=document.elementFromPoint(e.clientX,e.clientY),plus=at?.closest('#new-workspace');$('#new-workspace').classList.toggle('terminal-drop',!!plus);if(plus){document.querySelectorAll('.workspace-tab.terminal-drop').forEach(n=>n.classList.remove('terminal-drop'));tab=plus;showDrop(null);target=null;return;}const over=at?.closest('.workspace-tab');document.querySelectorAll('.workspace-tab.terminal-drop').forEach(n=>n!==over&&n.classList.remove('terminal-drop'));tab=over&&over.dataset.workspace!==sessions.get(s.id)?.workspaceId?over:null;tab?.classList.add('terminal-drop');if(tab){showDrop(null);target=null;return;}target=dropAt(e.clientX,e.clientY);const occupied=currentSessions().filter(s=>s.id!==v.id).map(s=>views.get(s.id).position);showDrop(target&&fits(target,gridFor(activeWorkspaceId),occupied)?target:null,target||v.position);};
   const up=()=>{window.removeEventListener('mousemove',move);window.removeEventListener('mouseup',up);card.classList.remove('dragging');$('#drop-target')?.remove();if(tab){tab.classList.remove('terminal-drop');if(tab.id==='new-workspace')newWorkspaceFor(s.id);else moveTerminal(s.id,tab.dataset.workspace).catch(notice);}else if(dragging&&target)moveTile(v,target);else if(!dragging){v.ignoreHeaderClick=true;if(selected===s.id)returnView();else openView(s.id);setTimeout(()=>v.ignoreHeaderClick=false,0);}};
   window.addEventListener('mousemove',move);window.addEventListener('mouseup',up);
 };header.addEventListener('mousedown',v.startDrag);header.addEventListener('click',event=>{if(!v.ignoreHeaderClick&&!event.target.closest('button')&&header.closest('#view-body'))returnView();});

 update(s);applyGrid();requestAnimationFrame(()=>fit(v));persist();
}
let expandedTerminal=null,expandedParent=null;
function exitExpanded(){if(!expandedTerminal)return;const v=views.get(expandedTerminal),parent=expandedParent;keepViewport(v,()=>parent.append(v.pane));v.expandButton.textContent='⛶';v.expandButton.title='Expand terminal';v.expandButton.setAttribute('aria-label','Expand terminal');v.expandButton.setAttribute('aria-pressed','false');$('#expanded-terminal').remove();expandedTerminal=null;expandedParent=null;requestAnimationFrame(()=>{fit(v);v.term.focus();});}
// ⌘1–9 zooms (expands) the Nth Priority terminal; the same shortcut again zooms back out.
function priorityIds(){const live=new Set(currentSessions().map(s=>s.id));return (sidebarOrder[activeWorkspaceId]?.priority||[]).filter(id=>live.has(id)&&views.has(id));}
function zoomPriority(n){const id=priorityIds()[n-1];if(!id)return;if(selected===id)returnView();toggleExpanded(id);if(expandedTerminal===id)focus(id);}
function toggleExpanded(id){if(expandedTerminal===id){exitExpanded();return;}exitExpanded();const v=views.get(id);if(!v)return;expandedTerminal=id;expandedParent=v.pane.parentElement;const stage=el('section','expanded-terminal');stage.id='expanded-terminal';stage.setAttribute('aria-label','Expanded terminal');keepViewport(v,()=>{stage.append(v.pane);document.body.append(stage);});v.expandButton.textContent='⊡';v.expandButton.title='Restore terminal size';v.expandButton.setAttribute('aria-label','Restore terminal size');v.expandButton.setAttribute('aria-pressed','true');focused=id;requestAnimationFrame(()=>{fit(v);v.term.focus();});}
function returnView(){exitExpanded();if(!selected)return;const v=views.get(selected);v.pane.style.visibility='';v.viewButton.textContent='↗';v.viewButton.title='Open in View';v.viewButton.setAttribute('aria-label','Open in View');clearTimeout(v.mirrorTimer);v.mirrorObserver?.disconnect();v.mirrorObserver=null;v.mirror?.dispose();v.mirror=null;v.ghost?.remove();v.ghost=null;v.card.classList.remove('in-view');keepViewport(v,()=>v.card.append(v.pane));selected=null;$('#view-body').replaceChildren(emptyView());applyFontSize(v);renderViewZoom();sidebar();requestAnimationFrame(()=>fit(v));}
function emptyView(){return el('div','view-empty');}
function openView(id,markRead=true){if(markRead)visit(id);exitExpanded();if(selected===id){views.get(id).term.focus();return;}returnView();const v=views.get(id);if(!v)return;selected=id;focused=id;makeMirror(v);applyFontSize(v);v.pane.style.visibility='hidden';keepViewport(v,()=>$('#view-body').replaceChildren(v.pane));v.viewButton.textContent='↙';v.viewButton.title='Return to canvas';v.viewButton.setAttribute('aria-label','Return to canvas');sidebar();renderViewZoom();renderRouter(latestRouterJobs);requestAnimationFrame(()=>{v.pane.style.visibility='';v.term.focus();});}
function syncMirrorHeader(v){
 const header=v.header.cloneNode(true);
 const originals=[...v.header.querySelectorAll('button')];
 const viewIndex=originals.indexOf(v.viewButton),clonedButtons=header.querySelectorAll('button');if(viewIndex>=0){clonedButtons[viewIndex].textContent='↗';clonedButtons[viewIndex].title='Return to canvas';clonedButtons[viewIndex].setAttribute('aria-label','Return to canvas');}
 header.querySelectorAll('button').forEach((button,index)=>button.onclick=()=>originals[index].click());
 header.querySelector('.pane-title').ondblclick=()=>edit(v.id);
 header.addEventListener('click',event=>{if(!event.target.closest('button'))returnView();});
 v.ghost.querySelector('.pane-header')?.remove();v.ghost.prepend(header);
}
function makeMirror(v){
 const s=sessions.get(v.id),ghost=el('div','pane ghost-pane');
 ghost.style.setProperty('--color',accent(sessionColor(s)));ghost.style.setProperty('--text-color',coloredBackground?(darkMode?'#eee':'#242424'):accent(s.color));ghost.style.setProperty('--surface',sessionSurface(s));ghost.style.setProperty('--header',sessionSurface(s,true));
 const prompt=v.prompt.cloneNode(true);prompt.querySelector('button').onclick=()=>prompt.classList.toggle('expanded');prompt.querySelector('.latest-button').onclick=()=>goLatest(v.id);prompt.querySelectorAll('[data-prompt-step]').forEach(button=>button.onclick=()=>navigatePrompt(v.id,Number(button.dataset.promptStep)).catch(notice));const host=el('div','terminal-host');ghost.append(prompt,promptGrip(v),host);v.card.append(ghost);ghost.addEventListener('pointerdown',()=>visit(v.id));v.ghost=ghost;syncMirrorHeader(v);
 queueMicrotask(()=>renderDrafts(v));const viewport=v.term.buffer.active.viewportY,snapshot=v.serialize.serialize();
 v.mirror=new Terminal({...v.term.options,cols:v.term.cols,rows:v.term.rows,disableStdin:true,cursorBlink:false});v.mirror.open(host);const mirror=v.mirror;mirror.write(snapshot,()=>{if(v.mirror===mirror)mirror.scrollToLine(viewport);});
}
// Workspace tabs: drag a tab onto another to reorder; drop a terminal on a tab to move it there, or on + to make a new workspace for it.
const workspaceDragType='application/x-terminator-workspace';let pendingTerminalMove=null;
function clearWorkspaceDrop(){document.querySelectorAll('.workspace-tab.drop-before,.workspace-tab.drop-after,#new-workspace.terminal-drop').forEach(n=>n.classList.remove('drop-before','drop-after','terminal-drop'));}
async function reorderWorkspace(sourceId,targetId,after){if(!sourceId||sourceId===targetId)return;const ids=workspaces.filter(w=>!w.archived).map(w=>w.id).filter(id=>id!==sourceId);const at=ids.indexOf(targetId);if(at<0)return;ids.splice(after?at+1:at,0,sourceId);workspaces=await api.reorderWorkspaces(ids);workspaceMenu();}
function startTabDrag(event,tab,id){if(event.button!==0)return;const x0=event.clientX;let dragging=false,target=null,after=false;
 const move=e=>{if(!dragging&&Math.abs(e.clientX-x0)<5)return;dragging=true;tab.classList.add('is-dragging');document.body.classList.add('reordering-tabs');clearWorkspaceDrop();const over=document.elementFromPoint(e.clientX,Math.max(4,e.clientY))?.closest('.workspace-tab')||[...document.querySelectorAll('.workspace-tab')].find(t=>{const r=t.getBoundingClientRect();return e.clientX>=r.left&&e.clientX<=r.right;});
  target=over&&over!==tab?over:null;if(target){const r=target.getBoundingClientRect();after=e.clientX>=r.left+r.width/2;target.classList.add(after?'drop-after':'drop-before');}};
 const up=()=>{window.removeEventListener('mousemove',move,true);window.removeEventListener('mouseup',up,true);tab.classList.remove('is-dragging');document.body.classList.remove('reordering-tabs');clearWorkspaceDrop();if(!dragging)return;tab.suppressClick=true;setTimeout(()=>tab.suppressClick=false,0);if(target)reorderWorkspace(id,target.dataset.workspace,after).catch(notice);};
 window.addEventListener('mousemove',move,true);window.addEventListener('mouseup',up,true);}
// Sidebar terminals use HTML drag-and-drop; over the title bar macOS may not deliver drop events, so dragend checks where it ended.
let terminalDropHandled=false;
document.addEventListener('dragstart',e=>{if(e.dataTransfer?.types.includes('text/terminal-id'))terminalDropHandled=false;},true);
document.addEventListener('drag',e=>{if(!e.target?.dataset?.sidebarId||(!e.clientX&&!e.clientY))return;const at=document.elementFromPoint(e.clientX,e.clientY),t=at?.closest('.workspace-tab,#new-workspace');document.querySelectorAll('.workspace-tab.terminal-drop,#new-workspace.terminal-drop').forEach(n=>n!==t&&n.classList.remove('terminal-drop'));if(t&&t.dataset.workspace!==sessions.get(e.target.dataset.sidebarId)?.workspaceId)t.classList.add('terminal-drop');},true);
document.addEventListener('dragend',e=>{const id=e.target?.dataset?.sidebarId;document.querySelectorAll('.terminal-drop').forEach(n=>n.classList.remove('terminal-drop'));if(!id||terminalDropHandled||!sessions.has(id)||(!e.clientX&&!e.clientY))return;const t=document.elementFromPoint(e.clientX,e.clientY)?.closest('.workspace-tab,#new-workspace');if(!t)return;if(t.id==='new-workspace')newWorkspaceFor(id);else if(t.dataset.workspace!==sessions.get(id).workspaceId)moveTerminal(id,t.dataset.workspace).catch(notice);},true);
function newWorkspaceFor(id){pendingTerminalMove=id;editWorkspace();$('#workspace-name').value=sessions.get(id)?.title||'';$('#workspace-name').select();}
{const plus=$('#new-workspace');plus.addEventListener('dragover',e=>{if(!e.dataTransfer.types.includes('text/terminal-id'))return;e.preventDefault();e.dataTransfer.dropEffect='move';plus.classList.add('terminal-drop');});plus.addEventListener('dragleave',()=>plus.classList.remove('terminal-drop'));plus.addEventListener('drop',e=>{plus.classList.remove('terminal-drop');const id=e.dataTransfer.getData('text/terminal-id');if(!sessions.has(id))return;e.preventDefault();terminalDropHandled=true;newWorkspaceFor(id);});}
function workspaceMenu(){
 const tabs=$('#workspace-tabs');for(const tab of [...tabs.children])if(!workspaces.some(w=>w.id===tab.dataset.workspace&&!w.archived&&!w.hidden))tab.remove();
 for(const w of workspaces.filter(w=>!w.archived&&!w.hidden)){let tab=[...tabs.children].find(t=>t.dataset.workspace===w.id);if(!tab){tab=button(w.title,'Double-click to rename · drag to reorder',()=>{if(tab.suppressClick){tab.suppressClick=false;return;}if(overviewOpen())toggleOverview(false);if(gitOpen())toggleGit(false);if(activeWorkspaceId!==w.id)switchWorkspace(w.id).catch(notice);},'workspace-tab');tab.dataset.workspace=w.id;tab.addEventListener('dragover',e=>{if(e.dataTransfer.types.includes(workspaceDragType)){e.preventDefault();e.dataTransfer.dropEffect='move';clearWorkspaceDrop();const r=tab.getBoundingClientRect();tab.classList.add(e.clientX<r.left+r.width/2?'drop-before':'drop-after');return;}if(!e.dataTransfer.types.includes('text/terminal-id'))return;e.preventDefault();e.dataTransfer.dropEffect='move';tab.classList.add('terminal-drop');});tab.addEventListener('dragleave',()=>tab.classList.remove('terminal-drop'));tab.addEventListener('drop',e=>{if(e.dataTransfer.types.includes(workspaceDragType)){e.preventDefault();const source=e.dataTransfer.getData(workspaceDragType),r=tab.getBoundingClientRect();clearWorkspaceDrop();reorderWorkspace(source,w.id,e.clientX>=r.left+r.width/2).catch(notice);return;}tab.classList.remove('terminal-drop');const id=e.dataTransfer.getData('text/terminal-id');if(!sessions.has(id))return;e.preventDefault();e.stopPropagation();terminalDropHandled=true;moveTerminal(id,w.id).catch(notice);});tab.ondblclick=()=>editWorkspace(w.id);tab.oncontextmenu=e=>{e.preventDefault();archiveWorkspace(w.id).catch(notice);};tab.addEventListener('mousedown',e=>startTabDrag(e,tab,w.id));tabs.append(tab);}tabs.append(tab);if(tab.dataset.title!==w.title||!tab.firstChild){tab.querySelector('.tab-dots')?.remove();tab.textContent=w.title;tab.dataset.title=w.title;}tab.setAttribute('aria-label',w.title);tab.classList.toggle('active',w.id===activeWorkspaceId);tab.setAttribute('aria-pressed',String(w.id===activeWorkspaceId));}renderTabDots();
}
function editWorkspace(id=null){workspaceEditing=id;$('#workspace-dialog-title').textContent=id?'Rename workspace':'New workspace';$('#workspace-name').value=id?workspaces.find(w=>w.id===id).title:'';$('#workspace-editor').showModal();$('#workspace-name').focus();$('#workspace-name').select();}
$('#new-workspace').onclick=()=>editWorkspace();
async function switchWorkspace(id){selectedByWorkspace[activeWorkspaceId]=selected;returnView();activeWorkspaceId=await api.switchWorkspace(id);views.forEach((v,key)=>v.card.hidden=sessions.get(key).workspaceId!==id);workspaceMenu();sidebar();renderGitSide();applyGrid();if(selectedByWorkspace[id]&&views.has(selectedByWorkspace[id]))openView(selectedByWorkspace[id],false);requestAnimationFrame(()=>views.forEach(fit));}
$('#workspace-form').onsubmit=async event=>{event.preventDefault();try{const title=$('#workspace-name').value;if(workspaceEditing){const w=await api.renameWorkspace(workspaceEditing,title);workspaces=workspaces.map(old=>old.id===w.id?w:old);workspaceMenu();}else{const moving=pendingTerminalMove;pendingTerminalMove=null;const w=await api.createWorkspace(title);workspaces.push(w);if(moving&&sessions.has(moving))await moveTerminal(moving,w.id);await switchWorkspace(w.id);}$('#workspace-editor').close();}catch(e){notice(e);}};
$('#workspace-cancel').onclick=()=>{pendingTerminalMove=null;$('#workspace-editor').close();};

async function close(id){try{if(!await api.close(id,views.get(id)?.position))return;if(fontOffsets[id]){delete fontOffsets[id];store('terminal-font-offsets',fontOffsets);}if(expandedTerminal===id)exitExpanded();if(selected===id)returnView();const v=views.get(id);v.observer.disconnect();v.mirror?.dispose();v.term.dispose();v.card.remove();views.delete(id);sessions.delete(id);sidebar();persist();applyGrid();}catch(e){notice(e);}}
function edit(id=null){editing=id;const s=sessions.get(id);$('#dialog-title').textContent=s?'Edit terminal':'New terminal';$('#save').textContent=s?'Save':'Create terminal';$('#name').value=s?.title||`Terminal ${sessions.size+1}`;$('#cwd').value=s?.cwd||defaultCwd;$('#folder-label').hidden=!!s;$('#cwd').required=!s;chosenColor=s?.color||(currentSessions().length?unusedColor([...sessions.values()].map(t=>t.color)):'#ff3ca6');$('#colors').replaceChildren();[...new Set([...colors,chosenColor])].forEach((color,i)=>{const b=button('',`Color ${['purple','teal','amber','blue','rose','green','red','cyan','yellow','indigo','coral','magenta','emerald','lime'][i]||color}`,()=>{chosenColor=color;$('#colors').querySelectorAll('button').forEach(n=>n.classList.toggle('selected',n===b));},'');b.type='button';b.disabled=!s&&!(currentSessions().length===0&&color==='#ff3ca6')&&[...sessions.values()].some(t=>t.color.toLowerCase()===color.toLowerCase());b.style.setProperty('--color',accent(color));b.classList.toggle('selected',color===chosenColor);$('#colors').append(b);});const ws=$('#terminal-workspace');ws.replaceChildren(...workspaces.filter(w=>!w.archived).map(w=>Object.assign(el('option','',w.title),{value:w.id,selected:w.id===s?.workspaceId})));$('#workspace-label').hidden=!s||workspaces.filter(w=>!w.archived).length<2;$('#col-span').value=s?views.get(id).position.colSpan:1;$('#row-span').value=s?views.get(id).position.rowSpan:1;$('#col-span').max=gridFor(activeWorkspaceId).cols;$('#row-span').max=gridFor(activeWorkspaceId).rows;$('#form-error').textContent='';$('#editor').showModal();$('#name').focus();$('#name').select();}
$('#terminal-form').onsubmit=async event=>{event.preventDefault();$('#save').disabled=true;try{const rect=findPlacement(editing,Number($('#col-span').value),Number($('#row-span').value));if(!rect)throw new Error('Choose a smaller span or increase the grid size.');if(editing){views.get(editing).position=rect;await api.edit(editing,{title:$('#name').value,color:chosenColor});applyGrid();persist();const target=$('#terminal-workspace').value;if(!$('#workspace-label').hidden&&target&&target!==sessions.get(editing)?.workspaceId)await moveTerminal(editing,target);}else{const s=await api.create({workspaceId:activeWorkspaceId,title:$('#name').value,cwd:$('#cwd').value,color:chosenColor});positions[s.id]=rect;mount(s);focus(s.id);}$('#editor').close();}catch(e){$('#form-error').textContent=e.message;}finally{$('#save').disabled=false;}};
$('#new-terminal').onclick=()=>edit();document.querySelectorAll('.cancel').forEach(b=>b.onclick=()=>$('#editor').close());$('#browse').onclick=async()=>{const folder=await api.folder();if(folder)$('#cwd').value=folder;};
// Move a terminal to another workspace (drag it onto a workspace tab, or pick one in its settings). It keeps its size when it fits.
async function moveTerminal(id,workspaceId){const s=sessions.get(id),v=views.get(id);if(!s||!v||s.workspaceId===workspaceId)return;
 const occupied=[...views.values()].filter(o=>o.id!==id&&sessions.get(o.id)?.workspaceId===workspaceId).map(o=>o.position),grid=gridFor(workspaceId);
 const rect=placement(grid,occupied,Math.min(v.position.colSpan,grid.cols),Math.min(v.position.rowSpan,grid.rows))||placement(grid,occupied,1,1);
 if(!rect)throw Error(`“${workspaces.find(w=>w.id===workspaceId)?.title||'That workspace'}” is full. Make space there or enlarge its grid first.`);
 if(selected===id)returnView();const moved=await api.moveTerminal(id,workspaceId);v.position=rect;update(moved);persist();applyGrid();sidebar();notice(`Moved “${s.title}” to ${workspaces.find(w=>w.id===workspaceId)?.title||'the workspace'}.`);}
function gridFor(id){const g=grids[id]||={cols:2,rows:4,colWeights:[1,1],rowWeights:[1,1,1,1]};if(g.colWeights?.length!==g.cols)g.colWeights=Array(g.cols).fill(1);if(g.rowWeights?.length!==g.rows)g.rowWeights=Array(g.rows).fill(1);return g;}
function findPlacement(id,colSpan,rowSpan){const occupied=currentSessions().filter(s=>s.id!==id).map(s=>views.get(s.id)?.position).filter(Boolean);return placement(gridFor(activeWorkspaceId),occupied,colSpan,rowSpan,views.get(id)?.position);}
function axisMetrics(size,weights){const gap=8,available=size-gap*(weights.length-1),total=weights.reduce((a,b)=>a+b,0);let offset=0;return weights.map(weight=>{const length=available*weight/total,result={start:offset,length};offset+=length+gap;return result;});}
function metrics(){const canvas=$('#canvas'),g=gridFor(activeWorkspaceId);return {cols:axisMetrics(canvas.clientWidth,g.colWeights),rows:axisMetrics(canvas.clientHeight,g.rowWeights)};}
function cellAt(x,y){const rect=$('#canvas').getBoundingClientRect();if(x<rect.left||x>rect.right||y<rect.top||y>rect.bottom)return null;const m=metrics();return {col:Math.max(0,m.cols.findIndex(c=>x-rect.left<c.start+c.length+8)),row:Math.max(0,m.rows.findIndex(r=>y-rect.top<r.start+r.length+8))};}
function dropAt(x,y,size={colSpan:1,rowSpan:1}){const rect=$('#canvas').getBoundingClientRect();return dropRect(metrics(),x-rect.left,y-rect.top,size);}
function showDrop(target,size){let node=$('#drop-target');if(!target){node?.remove();return;}if(!node){node=el('div','drop-target');node.id='drop-target';$('#canvas').append(node);}const m=metrics(),right=m.cols[Math.min(m.cols.length-1,target.col+size.colSpan-1)],bottom=m.rows[Math.min(m.rows.length-1,target.row+size.rowSpan-1)];Object.assign(node.style,{left:m.cols[target.col].start+'px',top:m.rows[target.row].start+'px',width:right.start+right.length-m.cols[target.col].start+'px',height:bottom.start+bottom.length-m.rows[target.row].start+'px'});}
function moveTile(v,target){const g=gridFor(activeWorkspaceId),next={...v.position,...target},others=currentSessions().filter(s=>s.id!==v.id).map(s=>views.get(s.id));if(fits(next,g,others.map(o=>o.position)))v.position=next;else{const other=others.find(o=>o.position.col===target.col&&o.position.row===target.row),rest=others.filter(o=>o!==other).map(o=>o.position);const swapped=other?{...other.position,col:v.position.col,row:v.position.row}:null;if(other&&fits(next,g,rest)&&fits(swapped,g,[...rest,next])){other.position=swapped;v.position=next;}else{notice('That space is occupied.');return;}}persist();applyGrid();}
function applyGrid(){const g=gridFor(activeWorkspaceId),canvas=$('#canvas');canvas.style.gridTemplateColumns=g.colWeights.map(w=>`minmax(0,${w}fr)`).join(' ');canvas.style.gridTemplateRows=g.rowWeights.map(w=>`minmax(0,${w}fr)`).join(' ');views.forEach(v=>{v.card.hidden=sessions.get(v.id).workspaceId!==activeWorkspaceId;v.card.style.gridColumn=`${v.position.col+1} / span ${v.position.colSpan}`;v.card.style.gridRow=`${v.position.row+1} / span ${v.position.rowSpan}`;});$('#grid-button').textContent=`${g.cols} × ${g.rows}`;if($('#grid-quick-cols'))renderGridQuick();localStorage.setItem('workspace-grids',JSON.stringify(grids));requestAnimationFrame(drawDividers);}
function drawDividers(){document.querySelectorAll('.grid-divider,.grid-cell-guide').forEach(n=>n.remove());const canvas=$('#canvas'),g=gridFor(activeWorkspaceId),m=metrics(),tiles=currentSessions().map(s=>views.get(s.id)?.position).filter(Boolean);
 for(const row of m.rows)for(const col of m.cols){const guide=el('div','grid-cell-guide');guide.setAttribute('aria-hidden','true');Object.assign(guide.style,{left:col.start+'px',top:row.start+'px',width:col.length+'px',height:row.length+'px'});canvas.append(guide);}
 function divider(axis,index,cross){const vertical=axis==='col',a=vertical?m.cols:m.rows,b=vertical?m.rows:m.cols,node=el('div',`grid-divider ${vertical?'vertical':'horizontal'}`);node.title=vertical?'Drag to resize · Double-click to remove the column on the left':'Drag to resize · Double-click to remove the row above';node.ondblclick=e=>{e.preventDefault();removeGridTrack(axis,index);};node.setAttribute('role','separator');node.setAttribute('aria-orientation',vertical?'vertical':'horizontal');Object.assign(node.style,vertical?{left:a[index].start+a[index].length+'px',top:b[cross].start+'px',height:b[cross].length+'px'}:{top:a[index].start+a[index].length+'px',left:b[cross].start+'px',width:b[cross].length+'px'});node.onmousedown=e=>{if(e.button!==0)return;e.preventDefault();let moved=false;const weights=vertical?g.colWeights:g.rowWeights,start=vertical?e.clientX:e.clientY,total=weights.reduce((a,b)=>a+b,0),available=(vertical?canvas.clientWidth:canvas.clientHeight)-8*(weights.length-1),left=weights[index],right=weights[index+1],min=Math.min(left+right,(vertical?100:60)*total/available)/3;const move=event=>{const distance=(vertical?event.clientX:event.clientY)-start;if(!moved&&Math.abs(distance)<3)return;moved=true;const delta=distance*total/available;weights[index]=Math.max(min,Math.min(left+right-min,left+delta));weights[index+1]=left+right-weights[index];canvas.style[vertical?'gridTemplateColumns':'gridTemplateRows']=weights.map(w=>`minmax(0,${w}fr)`).join(' ');requestAnimationFrame(drawDividers);};const up=()=>{window.removeEventListener('mousemove',move);window.removeEventListener('mouseup',up);if(moved)applyGrid();};window.addEventListener('mousemove',move);window.addEventListener('mouseup',up);};canvas.append(node);}
 for(let c=0;c<g.cols-1;c++)for(let r=0;r<g.rows;r++)if(!tiles.some(t=>t.col<=c&&t.col+t.colSpan>c+1&&t.row<=r&&t.row+t.rowSpan>r))divider('col',c,r);
 for(let r=0;r<g.rows-1;r++)for(let c=0;c<g.cols;c++)if(!tiles.some(t=>t.row<=r&&t.row+t.rowSpan>r+1&&t.col<=c&&t.col+t.colSpan>c))divider('row',r,c);
}
new ResizeObserver(()=>requestAnimationFrame(drawDividers)).observe($('#canvas'));
// Grid changes: quick +/− for columns and rows above the canvas, presets with a live preview in the Grid dialog.
// Whenever a change would move terminals, it asks first and names them.
function confirmAction(title,message,items=[],ok='OK'){return new Promise(resolve=>{const d=$('#confirm-dialog');$('#confirm-title').textContent=title;$('#confirm-message').textContent=message;$('#confirm-list').replaceChildren(...items.map(t=>el('li','',t)));$('#confirm-list').hidden=!items.length;$('#confirm-ok').textContent=ok;d.onclose=()=>resolve(d.returnValue==='ok');d.returnValue='cancel';d.showModal();$('#confirm-ok').focus();});}
function samePosition(a,b){return a.col===b.col&&a.row===b.row&&a.colSpan===b.colSpan&&a.rowSpan===b.rowSpan;}
function resizedGrid(g,cols,rows){const keep=(w,n)=>Array.from({length:n},(_,i)=>w?.[i]??1);return {cols,rows,colWeights:keep(g.colWeights,cols),rowWeights:keep(g.rowWeights,rows)};}
function layoutFor(g){const next=[];for(const s of currentSessions()){const v=views.get(s.id),p=placement(g,next,Math.min(v.position.colSpan,g.cols),Math.min(v.position.rowSpan,g.rows),v.position)||placement(g,next,1,1);if(!p)return null;next.push(p);}return next;}
async function commitGrid(g,next,what){const list=currentSessions(),moved=list.filter((s,i)=>!samePosition(views.get(s.id).position,next[i]));
 if(moved.length&&!await confirmAction(what,`${moved.length===1?'This terminal':`These ${moved.length} terminals`} will move or change size:`,moved.map(s=>s.title),'Change grid'))return false;
 grids[activeWorkspaceId]=g;list.forEach((s,i)=>views.get(s.id).position=next[i]);persist();applyGrid();renderGridQuick();return true;}
async function changeGrid(cols,rows){const g=resizedGrid(gridFor(activeWorkspaceId),cols,rows),next=layoutFor(g);if(!next)throw Error(`A ${cols} × ${rows} grid has too few cells for the terminals here. Close or shrink some first.`);return commitGrid(g,next,`Change the grid to ${cols} × ${rows}?`);}
function renderGridQuick(){const g=gridFor(activeWorkspaceId);$('#grid-quick-cols').textContent=g.cols;$('#grid-quick-rows').textContent=g.rows;$('#grid-col-remove').disabled=g.cols<=1;$('#grid-row-remove').disabled=g.rows<=1;$('#grid-col-add').disabled=g.cols>=8;$('#grid-row-add').disabled=g.rows>=16;}
$('#grid-col-add').onclick=()=>{const g=gridFor(activeWorkspaceId);changeGrid(g.cols+1,g.rows).catch(notice);};
$('#grid-row-add').onclick=()=>{const g=gridFor(activeWorkspaceId);changeGrid(g.cols,g.rows+1).catch(notice);};
$('#grid-col-remove').onclick=()=>removeGridTrack('col',gridFor(activeWorkspaceId).cols-1);
$('#grid-row-remove').onclick=()=>removeGridTrack('row',gridFor(activeWorkspaceId).rows-1);
const gridPresets=[[1,1],[2,1],[1,2],[2,2],[3,2],[2,3],[3,3],[4,2],[4,3],[4,4]];
// The preview is also an editor: drag a terminal onto a cell to place it there (it swaps with a terminal already there).
// Nothing changes until Apply; if terminals move, you're asked to confirm.
let gridDraft=new Map(),gridDraftNext=null;
function draftLayout(g){const next=[];for(const s of currentSessions()){const v=views.get(s.id),want=gridDraft.get(s.id)||v.position,p=placement(g,next,Math.min(want.colSpan,g.cols),Math.min(want.rowSpan,g.rows),want)||placement(g,next,1,1);if(!p)return null;next.push(p);}return next;}
function previewCell(event,g){const box=$('#grid-preview'),r=box.getBoundingClientRect(),pad=6;const col=Math.floor((event.clientX-r.left-pad)/((r.width-2*pad)/g.cols)),row=Math.floor((event.clientY-r.top-pad)/((r.height-2*pad)/g.rows));return col>=0&&row>=0&&col<g.cols&&row<g.rows?{col,row}:null;}
function dropInPreview(id,cell){const cols=Number($('#grid-cols').value),rows=Number($('#grid-rows').value),g=resizedGrid(gridFor(activeWorkspaceId),cols,rows),list=currentSessions(),next=gridDraftNext;if(!next)return;
 const i=list.findIndex(s=>s.id===id);if(i<0)return;const mine=next[i],rect={...mine,col:Math.min(cell.col,g.cols-mine.colSpan),row:Math.min(cell.row,g.rows-mine.rowSpan)};const others=next.filter((_,k)=>k!==i);
 if(fits(rect,g,others)){gridDraft.set(id,rect);}else{const j=next.findIndex((p,k)=>k!==i&&cell.col>=p.col&&cell.col<p.col+p.colSpan&&cell.row>=p.row&&cell.row<p.row+p.rowSpan);const other=j>=0?next[j]:null;
  const swapped=other&&{...other,col:Math.min(mine.col,g.cols-other.colSpan),row:Math.min(mine.row,g.rows-other.rowSpan)},moved=other&&{...mine,col:Math.min(other.col,g.cols-mine.colSpan),row:Math.min(other.row,g.rows-mine.rowSpan)},rest=next.filter((_,k)=>k!==i&&k!==j);
  if(other&&fits(moved,g,rest)&&fits(swapped,g,[...rest,moved])){gridDraft.set(id,moved);gridDraft.set(list[j].id,swapped);}else{$('#grid-preview-note').textContent='No room there for that terminal.';return;}}
 renderGridPreview();}
function renderGridPreview(){const cols=Number($('#grid-cols').value),rows=Number($('#grid-rows').value),box=$('#grid-preview'),note=$('#grid-preview-note');box.replaceChildren();gridDraftNext=null;
 $('#grid-presets').querySelectorAll('button').forEach(b=>b.classList.toggle('selected',b.dataset.cols==cols&&b.dataset.rows==rows));
 if(!(cols>=1&&cols<=8&&rows>=1&&rows<=16)){note.textContent='';return;}
 const g=resizedGrid(gridFor(activeWorkspaceId),cols,rows),next=draftLayout(g);box.style.gridTemplateColumns=`repeat(${cols},1fr)`;box.style.gridTemplateRows=`repeat(${rows},1fr)`;
 for(let i=0;i<cols*rows;i++){const cell=el('div','grid-preview-cell');cell.style.gridColumn=`${i%cols+1}`;cell.style.gridRow=`${Math.floor(i/cols)+1}`;box.append(cell);}
 if(!next){note.textContent='Too few cells for the terminals here.';note.classList.add('error');return;}note.classList.remove('error');gridDraftNext=next;
 const list=currentSessions();let moved=0;list.forEach((s,i)=>{const p=next[i],tile=el('div','grid-preview-tile',s.title);const changed=!samePosition(views.get(s.id).position,p);if(changed)moved++;tile.classList.toggle('is-moved',changed);tile.style.gridColumn=`${p.col+1} / span ${p.colSpan}`;tile.style.gridRow=`${p.row+1} / span ${p.rowSpan}`;tile.style.setProperty('--color',accent(sessionColor(s)));tile.draggable=true;tile.title='Drag onto another cell';tile.dataset.terminalId=s.id;tile.addEventListener('dragstart',e=>{e.dataTransfer.setData('application/x-grid-tile',s.id);e.dataTransfer.effectAllowed='move';tile.classList.add('is-dragging');});tile.addEventListener('dragend',()=>tile.classList.remove('is-dragging'));box.append(tile);});
 note.textContent=moved?`${moved} terminal${moved===1?'':'s'} will move (outlined). Drag terminals to place them; you'll be asked to confirm.`:list.length?'Drag terminals onto cells to place them.':'';}
{const box=$('#grid-preview');let hover=null;const g=()=>resizedGrid(gridFor(activeWorkspaceId),Number($('#grid-cols').value),Number($('#grid-rows').value));
 box.addEventListener('dragover',e=>{if(!e.dataTransfer.types.includes('application/x-grid-tile'))return;e.preventDefault();e.dataTransfer.dropEffect='move';const cell=previewCell(e,g());const cols=g().cols;const index=cell?cell.row*cols+cell.col:-1;if(hover!==index){box.querySelectorAll('.grid-preview-cell.is-target').forEach(n=>n.classList.remove('is-target'));if(cell)box.querySelectorAll('.grid-preview-cell')[index]?.classList.add('is-target');hover=index;}});
 box.addEventListener('dragleave',e=>{if(!box.contains(e.relatedTarget)){box.querySelectorAll('.grid-preview-cell.is-target').forEach(n=>n.classList.remove('is-target'));hover=null;}});
 box.addEventListener('drop',e=>{const id=e.dataTransfer.getData('application/x-grid-tile');if(!id)return;e.preventDefault();hover=null;const cell=previewCell(e,g());if(cell)dropInPreview(id,cell);});}
function openGridEditor(){const g=gridFor(activeWorkspaceId);gridDraft=new Map();$('#grid-cols').value=g.cols;$('#grid-rows').value=g.rows;$('#grid-error').textContent='';
 const presets=$('#grid-presets');presets.replaceChildren(...gridPresets.map(([c,r])=>{const b=button('',`${c} columns × ${r} rows`,()=>{$('#grid-cols').value=c;$('#grid-rows').value=r;renderGridPreview();},'grid-preset');b.type='button';b.dataset.cols=c;b.dataset.rows=r;const icon=el('span','grid-preset-icon');icon.style.gridTemplateColumns=`repeat(${c},1fr)`;icon.style.gridTemplateRows=`repeat(${r},1fr)`;for(let i=0;i<c*r;i++)icon.append(el('i'));b.append(icon,el('span','',`${c}×${r}`));return b;}));
 renderGridPreview();$('#grid-editor').showModal();}
for(const id of ['#grid-cols','#grid-rows'])$(id).addEventListener('input',renderGridPreview);
$('#grid-button').onclick=openGridEditor;$('#grid-more').onclick=openGridEditor;$('#grid-cancel').onclick=()=>$('#grid-editor').close();$('#grid-close').onclick=()=>$('#grid-editor').close();
$('#grid-form').onsubmit=async event=>{event.preventDefault();try{const cols=Number($('#grid-cols').value),rows=Number($('#grid-rows').value);renderGridPreview();if(!gridDraftNext)throw Error(`A ${cols} × ${rows} grid has too few cells for the terminals here. Close or shrink some first.`);if(await commitGrid(resizedGrid(gridFor(activeWorkspaceId),cols,rows),gridDraftNext,`Change the grid to ${cols} × ${rows}?`))$('#grid-editor').close();}catch(error){$('#grid-error').textContent=error.message;}};
$('#view-body').ondragover=e=>{e.preventDefault();e.dataTransfer.dropEffect='move';};$('#view-body').ondrop=e=>{e.preventDefault();const id=e.dataTransfer.getData('text/terminal-id');if(views.has(id))openView(id);};
document.addEventListener('keydown',event=>{if(!event.metaKey||$('#editor').open||$('#workspace-editor').open||$('#grid-editor').open||$('#resume-editor').open||$('#history-editor').open||$('#prompts-editor').open)return;if(['Equal','Minus','NumpadAdd','NumpadSubtract','Digit0'].includes(event.code)){event.preventDefault();zoomShortcut(event.code);}else if(event.code==='KeyT'){event.preventDefault();edit();}else if(event.shiftKey&&event.code==='Enter'){event.preventDefault();returnView();}else if(/^Digit[1-9]$/.test(event.code)){event.preventDefault();zoomPriority(Number(event.code.slice(-1)));}});
const earlyOutput=new Map();api.onOutput(({id,data})=>{const v=views.get(id);if(v){v.term.write(data);}else earlyOutput.set(id,(earlyOutput.get(id)||'')+data);});api.onSession(s=>{if(sessions.has(s.id))update(s);});
(async()=>{try{const initial=await api.init();defaultCwd=initial.defaultCwd||defaultCwd;colors=initial.colors;workspaces=initial.workspaces;activeWorkspaceId=initial.activeWorkspaceId;workspaceMenu();initial.sessions.forEach(s=>{mount(s);earlyOutput.delete(s.id);});sidebar();applyGrid();}catch(e){notice(e);}})();
// Claude shows "esc to interrupt" (and a "Verb…" spinner) while it works. When a running Claude terminal shows neither
// for three checks in a row, tell the main process — it ends turns that finished without a Stop hook (e.g. after Esc).
const screenIdleChecks=new Map();
function claudeWorkingOnScreen(term){const b=term.buffer.active;let text='';for(let i=b.baseY;i<b.baseY+term.rows;i++)text+=(b.getLine(i)?.translateToString(true)||'')+'\n';return /esc to interrupt|ctrl\+o to toggle|detailed transcript/i.test(text)||/^\s*[·✢✳✶✻✽*]\s*\S[^\n]*…/m.test(text);}
setInterval(()=>{for(const [id,v] of views){const s=sessions.get(id);if(!s||s.status!=='running'||!s.agent||s.provider!=='claude'||v.replaying){screenIdleChecks.delete(id);continue;}const n=claudeWorkingOnScreen(v.term)?0:(screenIdleChecks.get(id)||0)+1;screenIdleChecks.set(id,n);if(n>=3){screenIdleChecks.delete(id);api.screenIdle(id).catch(()=>{});}}},3000);
setInterval(()=>{document.querySelectorAll('[data-timer]').forEach(n=>{const s=sessions.get(n.dataset.timer);if(s)n.textContent=duration(s);});},1000);

let resuming=null;
async function resume(id){try{const s=sessions.get(id);if(s.resumeAvailable!==false&&(s.lastSession||s.resumeSession)){await api.resumeClaude(id);focus(id);return;}resuming=id;const chats=await api.claudeHistory();$('#resume-chats').replaceChildren();for(const chat of chats){const row=button('',`Resume ${chat.prompt||chat.id}`,async()=>{try{await api.resumeClaude(id,chat.id);$('#resume-editor').close();focus(id);}catch(e){$('#resume-error').textContent=e.message;}},'resume-chat');row.append(el('strong','',chat.prompt||chat.id),el('small','',`${chat.cwd} · ${new Date(chat.timestamp).toLocaleDateString()}`));$('#resume-chats').append(row);}$('#resume-id').value='';$('#resume-error').textContent=chats.length?'':'Enter the session ID shown by /status in Claude.';$('#resume-editor').showModal();}catch(e){notice(e);}}
$('#resume-cancel').onclick=()=>$('#resume-editor').close();
$('#resume-form').onsubmit=async e=>{e.preventDefault();try{await api.resumeClaude(resuming,$('#resume-id').value.trim());$('#resume-editor').close();focus(resuming);}catch(error){$('#resume-error').textContent=error.message;}};

const newTerminalButton=$('#new-terminal');
newTerminalButton.draggable=true;
newTerminalButton.addEventListener('dragstart',event=>{event.dataTransfer.setData('application/x-terminalsteroid-new','new');event.dataTransfer.effectAllowed='copy';});
newTerminalButton.addEventListener('dragend',()=>$('#drop-target')?.remove());
const canvasDrop=$('#canvas');
canvasDrop.addEventListener('dragover',event=>{if(!event.dataTransfer.types.includes('application/x-terminalsteroid-new'))return;event.preventDefault();const target=dropAt(event.clientX,event.clientY);const occupied=currentSessions().map(s=>views.get(s.id).position);const valid=target&&fits(target,gridFor(activeWorkspaceId),occupied);event.dataTransfer.dropEffect=valid?'copy':'none';showDrop(valid?target:null,target);});
canvasDrop.addEventListener('dragleave',event=>{if(!canvasDrop.contains(event.relatedTarget))$('#drop-target')?.remove();});
let creatingCell=false;
async function createAtCell(cell){if(!cell||creatingCell)return;const rect={colSpan:1,rowSpan:1,...cell},workspaceId=activeWorkspaceId;if(!fits(rect,gridFor(workspaceId),currentSessions().map(s=>views.get(s.id).position)))return;creatingCell=true;try{const s=await api.create({workspaceId,cwd:defaultCwd,title:`Terminal ${sessions.size+1}`});positions[s.id]=rect;mount(s);if(activeWorkspaceId===workspaceId)focus(s.id);}catch(error){notice(error);}finally{creatingCell=false;}}
canvasDrop.addEventListener('drop',async event=>{if(event.dataTransfer.getData('application/x-terminalsteroid-new')!=='new')return;event.preventDefault();$('#drop-target')?.remove();await createAtCell(dropAt(event.clientX,event.clientY));});
canvasDrop.addEventListener('dblclick',event=>{if(event.target.closest('.canvas-card,.grid-divider')||event.button!==0)return;event.preventDefault();createAtCell(cellAt(event.clientX,event.clientY));});

function removeGridTrack(axis,index){const list=currentSessions(),result=removeTrack(gridFor(activeWorkspaceId),list.map(s=>views.get(s.id).position),axis,index);if(!result){notice('The terminals need more space. Move or shrink a terminal first.');return;}commitGrid(result.grid,result.positions,`Remove ${axis==='col'?'column':'row'} ${index+1}?`).catch(notice);}

$('#history-button').onclick=async()=>{try{const records=await api.terminalHistory();const list=$('#history-list');list.replaceChildren();$('#history-error').textContent=records.length||workspaces.some(w=>w.archived)?'':'No saved history yet.';for(const w of workspaces.filter(w=>w.archived)){const row=button('',`Restore workspace ${w.title}`,async()=>{try{const result=await api.restoreWorkspace(w.id);workspaces=result.workspaces;for(const session of result.sessions)mount(session);await switchWorkspace(w.id);$('#history-editor').close();}catch(e){$('#history-error').textContent=e.message;}},'resume-chat');row.append(el('strong','',w.title),el('small','','Workspace'));list.append(row);}for(const record of records){const row=button('',`Restore ${record.title}`,async()=>{row.disabled=true;try{const workspaceId=workspaces.some(w=>w.id===record.workspaceId)?record.workspaceId:activeWorkspaceId;const g=gridFor(workspaceId),occupied=[...views.values()].filter(v=>sessions.get(v.id).workspaceId===workspaceId).map(v=>v.position);const saved=record.position||positions[record.id];const rect=placement(g,occupied,saved?.colSpan||1,saved?.rowSpan||1,saved);if(!rect)throw new Error('Make space in this workspace before restoring the terminal.');const restored=await api.restoreTerminal(record.archiveId);positions[restored.id]=rect;mount(restored);if(activeWorkspaceId!==restored.workspaceId)await switchWorkspace(restored.workspaceId);focus(restored.id);$('#history-editor').close();}catch(error){$('#history-error').textContent=error.message;row.disabled=false;}},'resume-chat');const name=el('strong','',record.title);name.style.color=accent(record.color);row.append(name,el('small','',`${workspaces.find(w=>w.id===record.workspaceId)?.title||'Workspace'} · ${new Date(record.closedAt).toLocaleString()}`));if(record.latestPrompt)row.append(el('small','history-prompt',record.latestPrompt));const entry=el('div','history-entry'),actions=el('div','history-actions');const chat=button('Chat','Open the archived chat text',()=>api.openChatArchive(record.archiveId).catch(e=>$('#history-error').textContent=e.message),'history-action');const remove=button('Delete','Delete from History (the chat text stays in the archive)',async()=>{try{if(await api.deleteHistory(record.archiveId))entry.remove();}catch(e){$('#history-error').textContent=e.message;}},'history-action history-delete');chat.type=remove.type='button';actions.append(chat,remove);entry.append(row,actions);list.append(entry);}$('#history-editor').showModal();}catch(error){notice(error);}};
$('#history-close').onclick=()=>$('#history-editor').close();
// Spaces: every workspace, to hide or show it (hidden ones keep their terminals running), or restore an archived one.
async function setWorkspaceHidden(id,hidden){const r=await api.hideWorkspace(id,hidden);workspaces=r.workspaces;if(r.activeWorkspaceId!==activeWorkspaceId)await switchWorkspace(r.activeWorkspaceId);else{workspaceMenu();scheduleOverview();}}
function renderSpaces(){const list=$('#spaces-list');list.replaceChildren();const all=[...sessions.values()];
 const row=(w,actions,meta)=>{const r=el('div','space-row'+(w.hidden?' is-hidden':'')+(w.id===activeWorkspaceId?' is-active':''));const name=button('',w.archived?w.title:`Open ${w.title}`,w.archived?null:async()=>{try{if(w.hidden)await setWorkspaceHidden(w.id,false);if(activeWorkspaceId!==w.id)await switchWorkspace(w.id);$('#spaces-dialog').close();}catch(e){$('#spaces-error').textContent=ipcMessage(e);}},'space-name');name.disabled=!!w.archived;name.append(el('strong','',w.title),el('small','',meta));r.append(name,...actions);return r;};
 for(const w of workspaces.filter(w=>!w.archived)){const mine=all.filter(s=>s.workspaceId===w.id),running=mine.filter(s=>s.status==='running').length;
  const meta=[`${mine.length} terminal${mine.length===1?'':'s'}`,running?`${running} running`:'',w.id===activeWorkspaceId?'current':'',w.hidden?'hidden':''].filter(Boolean).join(' · ');
  const toggle=button(w.hidden?'Show':'Hide',w.hidden?`Show ${w.title} in the tab bar`:`Hide ${w.title} from the tab bar (its terminals keep running)`,async()=>{toggle.disabled=true;$('#spaces-error').textContent='';try{await setWorkspaceHidden(w.id,!w.hidden);}catch(e){$('#spaces-error').textContent=ipcMessage(e);}renderSpaces();},'space-toggle');
  list.append(row(w,[toggle],meta));}
 const archived=workspaces.filter(w=>w.archived);if(archived.length){list.append(el('div','space-section','Archived'));
  for(const w of archived){const restore=button('Restore',`Restore ${w.title} with its terminals`,async()=>{restore.disabled=true;try{const result=await api.restoreWorkspace(w.id);workspaces=result.workspaces;for(const session of result.sessions)mount(session);await switchWorkspace(w.id);$('#spaces-dialog').close();}catch(e){$('#spaces-error').textContent=ipcMessage(e);restore.disabled=false;}},'space-toggle');
   list.append(row(w,[restore],`${(w.archivedTerminals||[]).length} terminal${(w.archivedTerminals||[]).length===1?'':'s'} · archived${w.archivedAt?' '+new Date(w.archivedAt).toLocaleDateString(undefined,{month:'short',day:'numeric'}):''}`));}}}
$('#spaces-button').onclick=()=>{$('#spaces-error').textContent='';renderSpaces();$('#spaces-dialog').showModal();};
$('#spaces-close').onclick=()=>$('#spaces-dialog').close();
$('#history-archive').onclick=()=>api.openChatArchive(null).catch(e=>$('#history-error').textContent=e.message);

let usageRefreshing=false,lastUsage=null;
async function refreshUsageNow(){if(usageRefreshing)return;usageRefreshing=true;if(lastUsage)renderUsage(lastUsage);try{renderUsage(await api.usage());}catch(error){notice(error);}finally{usageRefreshing=false;if(lastUsage)renderUsage(lastUsage);}}
function renderUsage(data){
 lastUsage=data;const panel=$('#usage');panel.replaceChildren();
 const head=el('div','section-label usage-label');const refresh=button('↻',usageRefreshing?'Refreshing…':'Refresh usage',refreshUsageNow,'icon usage-refresh'+(usageRefreshing?' is-spinning':''));refresh.disabled=usageRefreshing;
 // Compact: one line per provider ("Claude 5h 85% · w 89%") with its reset times underneath. Click "Usage" to switch.
 let compact=false;try{compact=localStorage.getItem('usage-compact')==='true';}catch{}
 const toggle=button('Usage',compact?'Show full usage':'Show compact usage',()=>{try{localStorage.setItem('usage-compact',String(!compact));}catch{}renderUsage(lastUsage);},'usage-toggle');toggle.setAttribute('aria-pressed',String(compact));
 head.append(toggle,refresh);panel.append(head);panel.classList.toggle('is-compact',compact);
 if(compact){const short={'5 hours':'5h',Daily:'d',Weekly:'w',Monthly:'m'};const resetText=t=>{const d=new Date(t*1000),today=new Date().toDateString()===d.toDateString();return today?d.toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'}):d.toLocaleDateString(undefined,{weekday:'short'})+' '+d.toLocaleTimeString(undefined,{hour:'numeric'});};
  for(const [key,name] of [['claude','Claude'],['codex','Codex']]){const state=data[key]||{},row=el('div','usage-compact');row.append(el('strong','',name));const wins=(state.windows||[]).filter(w=>!(w.resetsAt&&w.resetsAt*1000<=Date.now()));
   if(!wins.length)row.append(el('span','usage-compact-none',state.windows?.length?'refresh needed':'—'));
   for(const w of wins){const v=el('span','usage-compact-value'+(w.remaining<=10?' low':w.remaining<=30?' mid':''));v.append(el('span','usage-compact-label',short[w.label]||w.label),document.createTextNode(` ${Math.round(w.remaining)}%`));v.title=`${name} ${w.label}: ${Math.round(w.remaining)}% left${w.resetsAt?` · resets ${new Date(w.resetsAt*1000).toLocaleString(undefined,{weekday:'short',hour:'numeric',minute:'2-digit'})}`:''}`;row.append(v);}
   panel.append(row);const resets=wins.filter(w=>w.resetsAt).map(w=>`${short[w.label]||w.label} ${resetText(w.resetsAt)}`);if(resets.length)panel.append(el('div','usage-compact-reset','resets '+resets.join(' · ')));}
  return;}
 for(const [key,name] of [['codex','Codex'],['claude','Claude']]){
  const state=data[key]||{},group=el('details','usage-provider'),heading=el('summary','usage-heading',name);group.open=localStorage.getItem('usage-collapsed-'+key)!=='true';group.addEventListener('toggle',()=>localStorage.setItem('usage-collapsed-'+key,String(!group.open)));group.append(heading);
  // Collapsed: the heading still shows the numbers, compactly ("5h 84%  w 88%").
  {const short={'5 hours':'5h',Daily:'d',Weekly:'w',Monthly:'m'},mini=el('span','usage-heading-compact');for(const w of (state.windows||[]).filter(w=>!(w.resetsAt&&w.resetsAt*1000<=Date.now()))){const v=el('span','usage-compact-value'+(w.remaining<=10?' low':w.remaining<=30?' mid':''));v.append(el('span','usage-compact-label',short[w.label]||w.label),document.createTextNode(` ${Math.round(w.remaining)}%`));mini.append(v);}if(mini.childElementCount)heading.append(mini);}
  if(!state.windows?.length){const empty=el('div','usage-empty',state.error||(key==='claude'?'Waiting for Claude':'Checking…'));empty.title=key==='claude'?'Limits update when Claude reports usage in a Terminator session.':'';group.append(empty);}
  for(const window of state.windows||[]){
   const expired=window.resetsAt&&window.resetsAt*1000<=Date.now(),line=el('div','usage-line');
   line.append(el('span','',window.label),el('span','',expired?'Refresh needed':`${Math.round(window.remaining)}% left`));
   const bar=el('div','usage-track'),fill=el('div','usage-fill');fill.style.width=`${expired?0:window.remaining}%`;bar.append(fill);if(!expired)bar.setAttribute('role','meter');bar.setAttribute('aria-label',`${name} ${window.label} remaining`);bar.setAttribute('aria-valuemin','0');bar.setAttribute('aria-valuemax','100');if(!expired)bar.setAttribute('aria-valuenow',String(window.remaining));group.append(line,bar);
   if(window.resetsAt){const date=new Date(window.resetsAt*1000);group.append(el('div','usage-reset',`Resets ${date.toLocaleString(undefined,{weekday:'short',hour:'numeric',minute:'2-digit'})}`));}
  }
  const missing=['Daily','Weekly','Monthly'].filter(label=>!(state.windows||[]).some(w=>w.label===label));if(missing.length)group.append(el('div','usage-empty usage-missing',`${missing.join(', ')}: not reported`));
  if(state.error&&state.windows?.length)group.append(el('div','usage-empty',state.error));
  if(state.updatedAt){group.title=`Updated ${new Date(state.updatedAt).toLocaleString()}`;if(Date.now()-state.updatedAt>300000)group.append(el('div','usage-empty',`Updated ${new Date(state.updatedAt).toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}`));}
  panel.append(group);
 }
}
let latestUsage={};api.onUsage(data=>{latestUsage=data;renderUsage(data);});
async function refreshUsage(){try{latestUsage=await api.usage();renderUsage(latestUsage);}catch{}}
renderUsage(latestUsage);refreshUsage();

let sidebarWidth=Number(localStorage.getItem("sidebar-width"))||180;
let viewWidth;try{viewWidth=Number(localStorage.getItem('view-width'))||null;}catch{}
function setViewWidth(width,save=false){const max=Math.max(280,innerWidth-sidebarWidth-240);viewWidth=Math.max(280,Math.min(max,width));document.body.style.setProperty('--view-width',`${viewWidth}px`);document.body.style.setProperty('--view-size',`${viewWidth}px`);const divider=$('#view-resizer');divider.setAttribute('aria-valuemin','280');divider.setAttribute('aria-valuemax',String(max));divider.setAttribute('aria-valuenow',String(Math.round(viewWidth)));if(save)localStorage.setItem('view-width',String(viewWidth));}
setViewWidth(viewWidth||innerWidth*.25);
window.addEventListener('resize',()=>setViewWidth(viewWidth));
$('#view-resizer').onpointerdown=event=>{if(event.button!==0)return;event.preventDefault();const divider=event.currentTarget;divider.setPointerCapture(event.pointerId);document.body.classList.add('resizing-view');const move=e=>setViewWidth(innerWidth-e.clientX);const end=()=>{divider.removeEventListener('pointermove',move);divider.removeEventListener('pointerup',end);divider.removeEventListener('pointercancel',end);document.body.classList.remove('resizing-view');setViewWidth(viewWidth,true);};divider.addEventListener('pointermove',move);divider.addEventListener('pointerup',end);divider.addEventListener('pointercancel',end);};
$('#view-resizer').onkeydown=event=>{if(!['ArrowLeft','ArrowRight'].includes(event.key))return;event.preventDefault();setViewWidth(viewWidth+(event.key==='ArrowLeft'?20:-20),true);};

function setSidebarWidth(width,save=false){const max=Math.max(150,Math.min(480,innerWidth-viewWidth-240));sidebarWidth=Math.max(150,Math.min(max,width));document.body.style.setProperty('--sidebar-width',`${sidebarWidth}px`);const divider=$('#sidebar-resizer');divider.setAttribute('aria-valuemin','150');divider.setAttribute('aria-valuemax',String(max));divider.setAttribute('aria-valuenow',String(Math.round(sidebarWidth)));if(save)localStorage.setItem('sidebar-width',String(sidebarWidth));}
setSidebarWidth(sidebarWidth);
window.addEventListener('resize',()=>{setSidebarWidth(sidebarWidth);setViewWidth(viewWidth);});
$('#sidebar-resizer').onpointerdown=event=>{if(event.button!==0)return;event.preventDefault();const divider=event.currentTarget;divider.setPointerCapture(event.pointerId);document.body.classList.add('resizing-view');const move=e=>setSidebarWidth(e.clientX);const end=()=>{divider.removeEventListener('pointermove',move);divider.removeEventListener('pointerup',end);divider.removeEventListener('pointercancel',end);document.body.classList.remove('resizing-view');setSidebarWidth(sidebarWidth,true);};divider.addEventListener('pointermove',move);divider.addEventListener('pointerup',end);divider.addEventListener('pointercancel',end);};
$('#sidebar-resizer').onkeydown=event=>{if(!['ArrowLeft','ArrowRight'].includes(event.key))return;event.preventDefault();setSidebarWidth(sidebarWidth+(event.key==='ArrowRight'?20:-20),true);};

const creatingRouterTerminals=new Set();
async function createRouterTerminal(job){if(creatingRouterTerminals.has(job.id))return;creatingRouterTerminals.add(job.id);try{const occupied=[...views.values()].filter(v=>sessions.get(v.id).workspaceId===job.workspaceId).map(v=>v.position);const rect=placement(gridFor(job.workspaceId),occupied);if(!rect){await api.routerCreateError(job.id,'Grid is full. Make room for a new terminal, then resend.');return;}const s=await api.routerCreate(job.id);positions[s.id]=rect;mount(s);}catch(e){await api.routerCreateError(job.id,e.message);notice(e);}finally{creatingRouterTerminals.delete(job.id);}}
let latestRouterJobs=[],queueEditing=null;
function queueRow(job,index=1){const row=el('div','router-job'),details=el('div','router-job-details');row.title=[job.prompt,job.status==='error'?job.reason:job.waiting||job.status].filter(Boolean).join('\n');details.append(el('div','router-job-prompt',`${index}. ${job.prompt}`));row.append(details);const controls=el('div','queue-controls');if(job.status==='queued'){controls.append(button('Steer','Interrupt and send now',()=>api.steerRoute(job.id).catch(notice),''),button('Edit','Edit queued message',()=>editQueueMessage(job.id).catch(notice),''));}if(['routing','needs-terminal','starting','queued','error'].includes(job.status))controls.append(button('Cancel','Cancel message',()=>api.cancelRoute(job.id).catch(notice),''));row.append(controls);return row;}
function renderRouter(jobs){latestRouterJobs=jobs;for(const job of jobs)if(job.status==='needs-terminal')createRouterTerminal(job);const list=$('#router-jobs');list.replaceChildren();document.querySelectorAll('.terminal-queue').forEach(n=>n.remove());const queued=jobs.filter(j=>j.status!=='sent');$('#queue-panel').hidden=false;document.body.classList.add('has-queue');if(!queued.length)list.append(el('div','queue-placeholder','No queued messages'));queued.forEach((job,index)=>{const row=queueRow(job,index+1);const target=sessions.get(job.terminalId);if(target)row.title=target.title+'\n'+row.title;list.append(row);});}

api.onRouter(renderRouter);api.routerState().then(renderRouter);
$('#router-form').onsubmit=async e=>{e.preventDefault();const input=$('#router-input');const text=input.value;if(!text.trim())return;if(queueEditing){try{await api.saveQueueEdit(queueEditing.id,text);finishQueueEditing();}catch(error){notice(error);}return;}if(draftEditing){try{await api.saveDraft(draftEditing.terminalId,{id:draftEditing.draftId,text});finishDraft();}catch(error){notice(error);}return;}const goalCommand=text.match(/^\s*\/goal(?:\s+([\s\S]*))?$/i);if(goalCommand){try{const workspace=await api.createGoal(activeWorkspaceId,goalCommand[1]||'');workspaces=workspaces.map(w=>w.id===workspace.id?workspace:w);input.value='';sizeRouterInput();sidebar();}catch(error){notice(error);}return;}input.value='';sizeRouterInput();try{await api.route(text);}catch(error){input.value=text;sizeRouterInput();notice(error);}};
$('#router-input').onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();$('#router-form').requestSubmit();}};

let allPrompts=[];
// Terminal filter chips: none selected shows every prompt; selecting chips narrows the list to those terminals.
let promptTerminalFilter=new Set();
function renderPromptTerminalFilter(){const box=$('#prompts-terminals');box.replaceChildren();const terminals=new Map();for(const p of allPrompts){if(!p.terminalId)continue;const t=terminals.get(p.terminalId)||{id:p.terminalId,title:sessions.get(p.terminalId)?.title||p.title||'Terminal',color:sessions.get(p.terminalId)?.color||p.color,count:0};t.count++;terminals.set(p.terminalId,t);}
 for(const id of [...promptTerminalFilter])if(!terminals.has(id))promptTerminalFilter.delete(id);
 if(terminals.size<2&&!promptTerminalFilter.size){box.hidden=true;return;}box.hidden=false;
 const all=button('All','Show prompts from every terminal',()=>{promptTerminalFilter.clear();renderPrompts();},'prompt-filter');all.setAttribute('aria-pressed',String(!promptTerminalFilter.size));box.append(all);
 for(const t of terminals.values()){const chip=button('',`Only show prompts from ${t.title}`,()=>{promptTerminalFilter.has(t.id)?promptTerminalFilter.delete(t.id):promptTerminalFilter.add(t.id);renderPrompts();},'prompt-filter');chip.setAttribute('aria-pressed',String(promptTerminalFilter.has(t.id)));if(/^#[0-9a-f]{6}$/i.test(t.color||''))chip.style.setProperty('--color',accent(t.color));chip.append(el('span','color-dot'),el('span','prompt-filter-title',t.title),el('span','prompt-filter-count',String(t.count)));box.append(chip);}
}
function renderPrompts(){renderPromptTerminalFilter();const query=$('#prompts-search').value.toLowerCase();const list=$('#prompts-list');list.replaceChildren();const today=new Date().toDateString();const filtered=allPrompts.filter(p=>(!promptTerminalFilter.size||promptTerminalFilter.has(p.terminalId))&&(!$('#prompts-today').checked||new Date(p.timestamp).toDateString()===today)&&[p.text,p.title,p.provider].join(' ').toLowerCase().includes(query));$('#prompts-count').textContent=String(filtered.length);for(const p of filtered){const row=el('article','prompt-record');const color=sessions.get(p.terminalId)?.color||p.color;if(/^#[0-9a-f]{6}$/i.test(color||'')){row.classList.add('has-terminal-color');row.style.setProperty('--color',accent(color));}if(p.terminalId){row.tabIndex=0;row.setAttribute('role','button');row.title='Open terminal at this prompt';row.onclick=()=>goToPrompt(p).catch(notice);row.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();goToPrompt(p).catch(notice);}};}const heading=el('div','prompt-record-heading');const name=workspaces.find(w=>w.id===p.workspaceId)?.title;for(const [i,value] of [name,p.title,p.provider,p.timestamp?new Date(p.timestamp).toLocaleString():null].entries()){if(!value)continue;const line=el('div','',value);if(i===1&&row.classList.contains('has-terminal-color')){line.className='prompt-record-terminal';line.prepend(el('span','color-dot'));}heading.append(line);}row.append(el('div','prompt-record-text',p.text),heading);list.append(row);}if(!filtered.length)list.append(el('p','',query?'No matching prompts.':'No saved prompts yet.'));}
async function openPromptHistory(id){promptTerminalFilter=new Set([id]);$('#prompts-search').value='';$('#prompts-today').checked=false;$('#prompts-editor').showModal();$('#prompts-list').textContent='Loading…';try{allPrompts=await api.prompts();renderPrompts();}catch(e){$('#prompts-list').textContent=e.message;}}
$('#prompts-button').onclick=async()=>{promptTerminalFilter.clear();$('#prompts-editor').showModal();$('#prompts-list').textContent='Loading…';try{allPrompts=await api.prompts();renderPrompts();}catch(e){$('#prompts-list').textContent=e.message;}};
$('#prompts-search').oninput=renderPrompts;
$('#prompts-today').onchange=renderPrompts;
$('#prompts-close').onclick=()=>$('#prompts-editor').close();

function sizeRouterInput(){const input=$('#router-input');input.style.height='auto';input.style.height=Math.max(36,Math.min(input.scrollHeight,innerHeight*.3))+'px';}
$('#router-input').addEventListener('input',sizeRouterInput);
new ResizeObserver(()=>{document.body.style.setProperty('--router-height',$('#router').getBoundingClientRect().height+'px');}).observe($('#router'));
let routerInputWidth=0;new ResizeObserver(entries=>{const width=entries[0].contentRect.width;if(width!==routerInputWidth){routerInputWidth=width;sizeRouterInput();}}).observe($('#router-input'));
window.addEventListener('resize',sizeRouterInput);sizeRouterInput();

const promptDivider=el('div');promptDivider.id='prompt-resizer';promptDivider.tabIndex=0;promptDivider.setAttribute('role','separator');promptDivider.setAttribute('aria-label','Resize prompt bar');promptDivider.setAttribute('aria-orientation','horizontal');promptDivider.title='Drag to resize prompt bar · Double-click for automatic height';$('#router').prepend(promptDivider);
let manualPromptHeight=Number(localStorage.getItem('prompt-bar-height'))||0;
function setPromptHeight(value){manualPromptHeight=value?Math.max(64,Math.min(innerHeight*.6,value)):0;$('#router').classList.toggle('manual-height',!!manualPromptHeight);$('#router').style.height=manualPromptHeight?manualPromptHeight+'px':'';promptDivider.setAttribute('aria-valuenow',String(Math.round(manualPromptHeight||$('#router').clientHeight)));if(manualPromptHeight)localStorage.setItem('prompt-bar-height',String(manualPromptHeight));else localStorage.removeItem('prompt-bar-height');}
promptDivider.onpointerdown=e=>{if(e.button!==0)return;e.preventDefault();promptDivider.setPointerCapture(e.pointerId);const move=e=>setPromptHeight(innerHeight-e.clientY);const end=()=>{promptDivider.removeEventListener('pointermove',move);promptDivider.removeEventListener('pointerup',end);promptDivider.removeEventListener('pointercancel',end);};promptDivider.addEventListener('pointermove',move);promptDivider.addEventListener('pointerup',end);promptDivider.addEventListener('pointercancel',end);};
promptDivider.ondblclick=()=>{setPromptHeight(0);sizeRouterInput();};promptDivider.onkeydown=e=>{if(e.key==='ArrowUp'||e.key==='ArrowDown'){e.preventDefault();setPromptHeight($('#router').clientHeight+(e.key==='ArrowUp'?20:-20));}};
window.addEventListener('resize',()=>setPromptHeight(manualPromptHeight));setPromptHeight(manualPromptHeight);

document.addEventListener('contextmenu',async event=>{
 const target=event.target.closest('[data-terminal-id],.canvas-card');let position;
 if(target){const id=target.dataset.terminalId||target.dataset.id,v=views.get(id),session=sessions.get(id);if(!v||session.workspaceId!==activeWorkspaceId)return;position=v.position;}
 else{if(!event.target.closest('#canvas'))return;const cell=cellAt(event.clientX,event.clientY);if(!cell)return;position={...cell,rowSpan:1,colSpan:1};}
 event.preventDefault();event.stopPropagation();const workspaceId=activeWorkspaceId,g=gridFor(workspaceId),items=[];
 if(!target&&fits(position,g,currentSessions().map(s=>views.get(s.id).position)))items.push({action:'create'});
 for(const axis of ['row','col'])for(let index=position[axis];index<position[axis]+position[axis+'Span'];index++)items.push({axis,index,enabled:g[axis==='col'?'cols':'rows']>1});
 try{const chosen=await api.gridMenu(items);if(chosen&&workspaceId===activeWorkspaceId){if(chosen.action==='create')await createAtCell(position);else await deleteGridTrack(chosen.axis,chosen.index);}}catch(e){notice(e);}
},true);

async function deleteGridTrack(axis,index){
 const workspaceId=activeWorkspaceId,list=currentSessions(),affected=list.filter(s=>{const p=views.get(s.id).position;return p[axis]<=index&&p[axis]+p[axis+'Span']>index;});
 const ids=await api.closeTrack(affected.map(s=>({id:s.id,position:views.get(s.id).position})));
 if(ids.length!==affected.length)return;
 for(const id of ids){if(expandedTerminal===id)exitExpanded();if(selected===id)returnView();const v=views.get(id);v.observer.disconnect();v.mirror?.dispose();v.term.dispose();v.card.remove();views.delete(id);sessions.delete(id);}
 const remaining=[...sessions.values()].filter(s=>s.workspaceId===workspaceId),result=removeTrack(gridFor(workspaceId),remaining.map(s=>views.get(s.id).position),axis,index);
 if(result){grids[workspaceId]=result.grid;remaining.forEach((s,i)=>views.get(s.id).position=result.positions[i]);}
 persist();applyGrid();sidebar();
}

async function goToPrompt(prompt){
 let session=sessions.get(prompt.terminalId);
 if(!session){const records=await api.terminalHistory(),record=records.find(r=>r.id===prompt.terminalId);if(!record)throw Error('This terminal is no longer available.');const workspaceId=workspaces.some(w=>w.id===record.workspaceId)?record.workspaceId:activeWorkspaceId;const occupied=[...views.values()].filter(v=>sessions.get(v.id).workspaceId===workspaceId).map(v=>v.position),saved=record.position||positions[record.id],rect=placement(gridFor(workspaceId),occupied,saved?.colSpan||1,saved?.rowSpan||1,saved);if(!rect)throw Error('Make space in this workspace before restoring the terminal.');session=await api.restoreTerminal(record.archiveId);positions[session.id]=rect;mount(session);}
 $('#prompts-editor').close();if(activeWorkspaceId!==session.workspaceId)await switchWorkspace(session.workspaceId);openView(session.id);
 await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
 const v=views.get(session.id);await new Promise(resolve=>v.term.write('',resolve));
 const newer=allPrompts.slice(0,allPrompts.indexOf(prompt)).filter(p=>p.terminalId===prompt.terminalId&&p.text===prompt.text).length;
 const line=promptStart(v,prompt,newer);
 if(line===null){notice('This prompt is no longer in the terminal scrollback.');return;}
 promptCursors.set(session.id,{...prompt,occurrence:newer});renderPromptBar(v);schedulePromptNavigation(session.id);scrollTerminal(v.term,line);if(v.mirror){const m=promptStart(v,prompt,newer,v.mirror);if(m!==null)scrollTerminal(v.mirror,m);}v.term.focus();
}

async function editQueueMessage(id){
 if(queueEditing)throw Error('Finish editing the current queued message first.');const text=await api.beginQueueEdit(id),input=$('#router-input');queueEditing={id,draft:input.value};localStorage.setItem('queue-edit-draft',input.value);input.value=text;const banner=el('div','queue-edit-banner');banner.id='queue-edit-banner';banner.append(el('span','','Edit queued message'),button('Cancel','Cancel editing',async()=>{try{await api.saveQueueEdit(id,null);finishQueueEditing();}catch(e){notice(e);}},''));$('#router-form').before(banner);const submit=$('#router-form button');submit.textContent='Save';submit.setAttribute('aria-label','Save queued message');sizeRouterInput();input.focus();
}
// Drafts per terminal: + in the terminal's bottom-right corner writes one in the bottom bar; it then sits as a chip
// inside the terminal (over its corner, without resizing it). Click a chip to edit it; ➤ sends it into Claude/Codex.
let draftEditing=null;
function renderDrafts(v){const s=sessions.get(v.id);if(!s)return;const drafts=s.drafts||[];const key=JSON.stringify(drafts.map(d=>[d.id,d.text]))+(draftEditing?.terminalId===v.id?draftEditing.draftId||'new':'');
 for(const container of [v.pane,v.ghost].filter(Boolean)){let dock=container.querySelector(':scope > .draft-dock');if(!dock){dock=el('div','draft-dock');container.append(dock);}if(dock.dataset.key===key)continue;dock.dataset.key=key;dock.replaceChildren();
  const list=el('div','draft-list');for(const d of drafts){const chip=el('div','draft-chip'+(draftEditing?.draftId===d.id?' is-editing':''));const text=button(d.text.replace(/\s+/g,' ').slice(0,80),'Edit this draft in the bottom bar',()=>startDraft(v.id,d),'draft-text');text.title=d.text.slice(0,600)+'\n\nClick to edit';
   const sendBtn=button('➤','Send this draft to the terminal',async()=>{sendBtn.disabled=true;try{await api.sendDraft(v.id,d.id);if(draftEditing?.draftId===d.id)finishDraft();notice(`Sent to ${s.title}.`);}catch(e){notice(e);}finally{sendBtn.disabled=false;}},'draft-send');
   const del=button('×','Delete this draft',async()=>{try{await api.removeDraft(v.id,d.id);if(draftEditing?.draftId===d.id)finishDraft();}catch(e){notice(e);}},'draft-delete');chip.append(text,sendBtn,del);list.append(chip);}
  const plus=button('+','Write a prompt to send later',()=>startDraft(v.id,null),'draft-add'+(draftEditing?.terminalId===v.id&&!draftEditing.draftId?' is-editing':''));dock.append(list,plus);}}
function startDraft(terminalId,draft){if(queueEditing){notice('Finish editing the queued message first.');return;}const input=$('#router-input');if(draftEditing)finishDraft(false);const s=sessions.get(terminalId);
 draftEditing={terminalId,draftId:draft?.id||null,previous:input.value};input.value=draft?.text||'';$('#draft-banner')?.remove();const banner=el('div','queue-edit-banner draft-banner');banner.id='draft-banner';banner.style.setProperty('--color',accent(sessionColor(s)));
 banner.append(el('span','',`${draft?'Edit draft':'New draft'} for ${s?.title||'terminal'} — kept in the terminal until you send it (⏎ saves, Esc cancels)`),button('Cancel','Cancel the draft',()=>finishDraft(),''));$('#router-form').before(banner);
 const submit=$('#router-form button');submit.textContent='Save';submit.setAttribute('aria-label','Save draft');sizeRouterInput();input.focus();const v=views.get(terminalId);if(v)renderDrafts(v);}
function finishDraft(restore=true){if(!draftEditing)return;const id=draftEditing.terminalId,input=$('#router-input');if(restore)input.value=draftEditing.previous;draftEditing=null;$('#draft-banner')?.remove();const submit=$('#router-form button');submit.textContent='↑';submit.setAttribute('aria-label','Send message');sizeRouterInput();const v=views.get(id);if(v)renderDrafts(v);}
$('#router-input').addEventListener('keydown',e=>{if(e.key==='Escape'&&draftEditing){e.preventDefault();finishDraft();}});
function finishQueueEditing(){const input=$('#router-input');input.value=queueEditing.draft;queueEditing=null;localStorage.removeItem('queue-edit-draft');$('#queue-edit-banner')?.remove();const submit=$('#router-form button');submit.textContent='↑';submit.setAttribute('aria-label','Send message');sizeRouterInput();}
const preservedQueueDraft=localStorage.getItem('queue-edit-draft');if(preservedQueueDraft!==null){$('#router-input').value=preservedQueueDraft;localStorage.removeItem('queue-edit-draft');sizeRouterInput();}

async function archiveWorkspace(id){
 const result=await api.archiveWorkspace(id,Object.fromEntries([...views].map(([id,v])=>[id,v.position])));if(!result)return;
 for(const id of result.removed){if(expandedTerminal===id)exitExpanded();if(selected===id)returnView();const v=views.get(id);v.observer.disconnect();v.mirror?.dispose();v.term.dispose();v.card.remove();views.delete(id);sessions.delete(id);}
 workspaces=result.workspaces;await switchWorkspace(result.activeWorkspaceId);persist();
}

const promptCursors=new Map(),promptNavigationTimers=new Map();
let navigationHistory=[],navigationHistoryAt=0,navigationHistoryRequest=null,navigationHistoryVersion=0;
function invalidateNavigationHistory(){navigationHistoryVersion++;navigationHistoryAt=0;}
async function availablePrompts(v){
 if(Date.now()-navigationHistoryAt>5000){
  if(navigationHistoryRequest?.version!==navigationHistoryVersion){const version=navigationHistoryVersion,request=api.prompts().then(items=>{navigationHistory=items;if(version===navigationHistoryVersion)navigationHistoryAt=Date.now();}).finally(()=>{if(navigationHistoryRequest===request)navigationHistoryRequest=null;});request.version=version;navigationHistoryRequest=request;}
  await navigationHistoryRequest;
 }
 const occurrences=new Map(),entries=[];
 for(const prompt of navigationHistory.filter(p=>p.terminalId===v.id)){
  const occurrence=occurrences.get(prompt.text)||0;occurrences.set(prompt.text,occurrence+1);
  const line=promptStart(v,prompt,occurrence);
  // Prompts that Claude/Codex redrew out of the scrollback stay navigable: the bar shows them, the view just can't jump there.
  if(line!==null?entries.some(e=>e.line===line):entries.some(e=>e.prompt.text===prompt.text&&Math.abs((e.prompt.timestamp||0)-(prompt.timestamp||0))<10000))continue;
  entries.push({prompt,line,occurrence});
 }
 return entries.sort((a,b)=>a.line!==null&&b.line!==null?b.line-a.line:(b.prompt.timestamp??Infinity)-(a.prompt.timestamp??Infinity));
}
function renderPromptBar(v){
 const text=promptCursors.get(v.id)?.text||sessions.get(v.id)?.latestPrompt||'';
 for(const pane of [v.pane,v.ghost].filter(Boolean)){
  const bar=pane.querySelector('.latest-prompt');bar.hidden=!text;bar.querySelector('.prompt-text').textContent=text;const entry=(v.promptEntries||[]).find(e=>e.prompt.timestamp===promptCursors.get(v.id)?.timestamp&&e.prompt.text===promptCursors.get(v.id)?.text);bar.classList.toggle('prompt-offscreen',!!entry&&entry.line===null);bar.title=entry&&entry.line===null?'This prompt is no longer in the terminal scrollback':'';
 }
}
function displayPromptNavigation(v,entries){
 v.promptEntries=entries;if(v.ghost)queueMicrotask(()=>renderPromptDrawer(v));
 for(const pane of [v.pane,v.ghost].filter(Boolean)){
  const nav=pane.querySelector('.prompt-navigation');if(!nav)continue;nav.hidden=!entries.length&&!promptCursors.has(v.id);
  const current=promptCursors.get(v.id),index=Math.max(0,entries.findIndex(e=>e.prompt.timestamp===current?.timestamp&&e.prompt.text===current?.text));
  const latest=nav.querySelector('.latest-button');latest.hidden=!current;nav.closest('.latest-prompt').classList.toggle('browsing-prompts',!!current);for(const button of nav.querySelectorAll('[data-prompt-step]'))button.disabled=Number(button.dataset.promptStep)<0?(current?index>=entries.length-1:firstStep(v,entries)>=entries.length):!current;
 }
}
function schedulePromptNavigation(id){
 clearTimeout(promptNavigationTimers.get(id));promptNavigationTimers.set(id,setTimeout(async()=>{
  promptNavigationTimers.delete(id);const v=views.get(id);if(!v)return;
  try{displayPromptNavigation(v,await availablePrompts(v));}catch{}
 },500));
}
setInterval(()=>{for(const id of views.keys())schedulePromptNavigation(id);},10000);
function firstStep(v,entries){return entries[0]?.prompt.text===sessions.get(v.id)?.latestPrompt?1:0;}
async function navigatePrompt(id,step){
 const v=views.get(id);if(!v)return;invalidateNavigationHistory();const entries=await availablePrompts(v);displayPromptNavigation(v,entries);if(!entries.length)return;
 const current=promptCursors.get(id),found=current?entries.findIndex(e=>e.prompt.timestamp===current.timestamp&&e.prompt.text===current.text):-1;
 const index=found<0?(step<0?firstStep(v,entries):-1):found-step;
 if(index<0){goLatest(id);return;}
 const entry=entries[Math.min(entries.length-1,index)];
 showPromptEntry(v,entry);displayPromptNavigation(v,entries);
}
function showPromptEntry(v,entry){promptCursors.set(v.id,{...entry.prompt,occurrence:entry.occurrence});v.anchor=null;renderPromptBar(v);v.term.clearSelection();if(entry.line!==null)scrollTerminal(v.term,entry.line);
 if(v.mirror){const line=promptStart(v,entry.prompt,entry.occurrence,v.mirror);if(line!==null)scrollTerminal(v.mirror,line);}}
// Right panel: drag the grip under the prompt box down to also list the earlier prompts (newest first); click one to jump to it.
let promptDrawerHeight=(()=>{try{return Number(localStorage.getItem('prompt-drawer'))||0;}catch{return 0;}})();
function renderPromptDrawer(v){const bar=v.ghost?.querySelector('.latest-prompt');if(!bar)return;const open=promptDrawerHeight>0;bar.classList.toggle('drawer-open',open);bar.style.height=open?promptDrawerHeight+'px':'';let list=bar.querySelector('.prompt-history');
 if(!open){list?.remove();return;}if(!list){list=el('div','prompt-history');bar.append(list);}const current=promptCursors.get(v.id),latest=sessions.get(v.id)?.latestPrompt;list.replaceChildren();
for(const entry of v.promptEntries||[]){if(!current&&entry.prompt.text===latest&&entry===v.promptEntries[0])continue;const item=button('',entry.line===null?'No longer in the terminal scrollback':'Jump to this prompt',()=>{showPromptEntry(v,entry);displayPromptNavigation(v,v.promptEntries||[]);},'prompt-history-item');
  item.classList.toggle('active',!!current&&entry.prompt.timestamp===current.timestamp&&entry.prompt.text===current.text);item.classList.toggle('offscreen',entry.line===null);item.append(el('span','prompt-history-text',entry.prompt.text.replace(/\s+/g,' ').trim()));if(entry.prompt.timestamp)item.append(el('span','prompt-history-time',ago(entry.prompt.timestamp)));list.append(item);}
 if(!list.childElementCount)list.append(el('div','prompt-history-empty','No earlier prompts in this terminal.'));}
function promptGrip(v){const grip=el('div','prompt-grip');grip.title='Drag down to show earlier prompts';grip.setAttribute('role','separator');grip.setAttribute('aria-orientation','horizontal');
 grip.addEventListener('pointerdown',e=>{e.preventDefault();e.stopPropagation();const bar=v.ghost?.querySelector('.latest-prompt');if(!bar)return;const start=e.clientY,base=bar.getBoundingClientRect().height,limit=()=>Math.max(120,(v.ghost.getBoundingClientRect().height||600)*.7);grip.setPointerCapture(e.pointerId);grip.classList.add('dragging');
  const move=ev=>{const h=Math.min(limit(),base+ev.clientY-start);promptDrawerHeight=h<70?0:Math.round(h);renderPromptDrawer(v);};const up=()=>{grip.classList.remove('dragging');grip.removeEventListener('pointermove',move);try{localStorage.setItem('prompt-drawer',String(promptDrawerHeight));}catch{}schedulePromptNavigation(v.id);};grip.addEventListener('pointermove',move);grip.addEventListener('pointerup',up,{once:true});grip.addEventListener('pointercancel',up,{once:true});});
 grip.addEventListener('dblclick',()=>{promptDrawerHeight=promptDrawerHeight?0:260;try{localStorage.setItem('prompt-drawer',String(promptDrawerHeight));}catch{}renderPromptDrawer(v);});return grip;}

function contextBubble(s){
 const value=Number.isFinite(s.contextPercent)?Math.max(0,Math.min(100,s.contextPercent)):null;
 const bubble=el('span','context-bubble');bubble.classList.toggle('unknown',value===null);bubble.style.setProperty('--context-fill',`${value||0}%`);
 const label=value===null?'Context usage unavailable':`${Math.round(value)}% context used`;bubble.title=label;bubble.setAttribute('aria-label',label);bubble.setAttribute('role','img');return bubble;
}
let goalEditing=null;
api.onWorkspaces(next=>{if(Array.isArray(next)){workspaces=next;sidebar();}});
api.onMenuBarOpen(async action=>{
 try{
  if(action.workspaceId!==activeWorkspaceId)await switchWorkspace(action.workspaceId);
  if(action.kind==='terminal'&&views.has(action.id))openView(action.id);
  if(action.kind==='goal'){
   const goal=workspaces.find(w=>w.id===activeWorkspaceId)?.goals?.find(g=>g.id===action.id);
   if(goal)editGoal(goal);
  }
 }catch(error){notice(error);}
});
// Subgoals: added by you (+ Subgoal) or by Claude while you talk. Each inherits its goal's terminals; drag it onto a terminal to attach it there too.
function applyWorkspace(workspace){workspaces=workspaces.map(w=>w.id===workspace.id?workspace:w);sidebar();}
function subgoalList(goal){const list=el('div','subgoal-list');
 for(const sub of goal.subgoals||[]){const row=el('div','subgoal'+(sub.done?' is-done':''));row.draggable=true;row.title='Drag onto a terminal to attach this subgoal there too';
  row.addEventListener('dragstart',e=>{e.stopPropagation();e.dataTransfer.setData(goalDragType,goal.id+'/'+sub.id);e.dataTransfer.effectAllowed='link';draggingGoal={...goal,sub};});row.addEventListener('dragend',()=>{draggingGoal=null;clearGoalDrop();});
  const check=el('input');check.type='checkbox';check.checked=!!sub.done;check.setAttribute('aria-label',`Done: ${sub.text}`);check.onchange=()=>api.updateSubgoal(activeWorkspaceId,goal.id,sub.id,{done:check.checked}).then(applyWorkspace).catch(error=>{check.checked=!check.checked;notice(error);});
  const text=button(sub.text,'Edit subgoal',()=>editSubgoal(goal,sub),'subgoal-text');if(sub.source==='agent')text.append(el('span','subgoal-source','✦'));
  row.append(check,text,goalDots(goal,(sub.terminalIds||[]).filter(id=>!goalTerminalIds(goal).includes(id))),button('×','Remove subgoal',()=>api.updateSubgoal(activeWorkspaceId,goal.id,sub.id,{remove:true}).then(applyWorkspace).catch(notice),'icon subgoal-remove'));list.append(row);}
 list.append(button('+ Subgoal','Add a subgoal',()=>newSubgoal(goal),'subgoal-add'));return list;}
// One dialog for creating/editing goals and subgoals; the fields shown depend on the mode.
const goalModes={
 'new-goal':{heading:'New goal',label:'Goal',placeholder:'What should be true when this is done?',submit:'Create goal',extras:true},
 'edit-goal':{heading:'Edit goal',label:'Goal',placeholder:'What should be true when this is done?',submit:'Save'},
 'new-subgoal':{heading:'New subgoal',label:'Subgoal',placeholder:'A concrete next step — one per line to add several',submit:'Add subgoal'},
 'edit-subgoal':{heading:'Edit subgoal',label:'Subgoal',placeholder:'A concrete next step',submit:'Save'},
};
function openGoalEditor(state,mode,text,context=''){const m=goalModes[mode];goalEditing={...state,mode};$('#goal-heading').textContent=m.heading;$('#goal-label').textContent=m.label;const input=$('#goal-text');input.placeholder=m.placeholder;input.value=text;input.rows=mode.endsWith('subgoal')?2:3;
 $('#goal-context').hidden=!context;$('#goal-context').textContent=context;$('#goal-subgoals-field').hidden=!m.extras;$('#goal-terminal-field').hidden=!m.extras;if(m.extras){$('#goal-subgoals').value='';$('#goal-terminal').checked=true;}
 renderGoalTerminalPicker(mode);$('#goal-submit').textContent=m.submit;$('#goal-error').textContent='';$('#goal-editor').showModal();input.focus();input.setSelectionRange(input.value.length,input.value.length);}
// Terminal picker in the goal dialog: attach the goal or subgoal to terminals without dragging.
// A subgoal always has its goal's terminals (shown checked and locked); its own extra terminals can be toggled.
let goalPicked=new Set(),goalInherited=new Set();
function renderGoalTerminalPicker(mode){const field=$('#goal-terminals-field'),box=$('#goal-terminals');box.replaceChildren();goalPicked=new Set();goalInherited=new Set();
 if(mode==='new-goal'){field.hidden=true;return;}
 const goal=workspaces.find(w=>w.id===goalEditing.workspaceId)?.goals?.find(g=>g.id===goalEditing.id);const terminals=[...sessions.values()].filter(t=>t.workspaceId===goalEditing.workspaceId);
 if(!goal||!terminals.length){field.hidden=true;return;}
 if(mode==='edit-goal')goalPicked=new Set(goalTerminalIds(goal));else{goalInherited=new Set(goalTerminalIds(goal));const sub=(goal.subgoals||[]).find(x=>x.id===goalEditing.subgoal);goalPicked=new Set(sub?.terminalIds||[]);}
 $('#goal-terminals-hint').textContent=mode==='edit-goal'?'this goal is reminded in these terminals':goalInherited.size?'locked ones come from the goal':'this subgoal is reminded in these terminals';
 goalEditing.pickedBefore=new Set(goalPicked);
 for(const t of terminals){const inherited=goalInherited.has(t.id),chip=button(t.title,inherited?'Inherited from the goal':'Attach or detach',()=>{if(inherited)return;goalPicked.has(t.id)?goalPicked.delete(t.id):goalPicked.add(t.id);chip.classList.toggle('is-on',goalPicked.has(t.id));chip.setAttribute('aria-pressed',goalPicked.has(t.id));},'goal-terminal-chip'+(inherited?' is-inherited is-on':goalPicked.has(t.id)?' is-on':''));chip.type='button';chip.style.setProperty('--color',accent(sessionColor(t)));chip.setAttribute('aria-pressed',inherited||goalPicked.has(t.id));if(inherited)chip.disabled=true;box.append(chip);}
 field.hidden=false;}
function goalTerminalChanges(){const before=goalEditing.pickedBefore||new Set();return [...new Set([...before,...goalPicked])].filter(id=>before.has(id)!==goalPicked.has(id));}
async function applyGoalTerminals(workspaceId,goalId,subIds){let workspace=null;for(const id of goalTerminalChanges()){if(!subIds)workspace=await api.toggleGoalTerminal(workspaceId,goalId,id);else for(const sub of subIds)workspace=await api.updateSubgoal(workspaceId,goalId,sub,{toggleTerminal:id});}if(workspace)applyWorkspace(workspace);}
function goalSummary(goal){const subs=goal.subgoals||[];return [goal.createdAt?'Set '+formatGoalDate(goal.createdAt):'',subs.length?`${subs.filter(s=>s.done).length}/${subs.length} subgoals done`:''].filter(Boolean).join(' · ');}
function newGoal(){if(goalHooks.newGoal?.())return;openGoalEditor({workspaceId:activeWorkspaceId,id:null},'new-goal','');}
function editGoal(goal){openGoalEditor({workspaceId:activeWorkspaceId,id:goal.id},'edit-goal',goal.text,goalSummary(goal));}
function newSubgoal(goal){openGoalEditor({workspaceId:activeWorkspaceId,id:goal.id,subgoal:'new'},'new-subgoal','','Part of: '+goal.text);}
function editSubgoal(goal,sub){openGoalEditor({workspaceId:activeWorkspaceId,id:goal.id,subgoal:sub.id},'edit-subgoal',sub.text,'Part of: '+goal.text);}
$('#goal-close').onclick=()=>$('#goal-editor').close();
for(const id of ['#goal-text','#goal-subgoals'])$(id).addEventListener('keydown',e=>{if(e.key==='Enter'&&(e.metaKey||e.ctrlKey)){e.preventDefault();$('#goal-form').requestSubmit();}});
async function updateGoalRecord(workspaceId,id,text){const workspace=await api.updateGoal(workspaceId,id,text);workspaces=workspaces.map(w=>w.id===workspace.id?workspace:w);sidebar();}
$('#goal-cancel').onclick=()=>$('#goal-editor').close();
$('#goal-form').onsubmit=async event=>{event.preventDefault();try{if(goalEditing.subgoal==='new'){const lines=$('#goal-text').value.split('\n').map(l=>l.trim()).filter(Boolean);if(!lines.length)throw Error('Write a subgoal.');let workspace;for(const line of lines)workspace=await api.createSubgoal(goalEditing.workspaceId,goalEditing.id,line);applyWorkspace(workspace);const norm=t=>t.replace(/\s+/g,' ').trim().toLowerCase();const created=(workspace.goals.find(g=>g.id===goalEditing.id)?.subgoals||[]).filter(x=>lines.some(l=>norm(l)===norm(x.text))).map(x=>x.id);await applyGoalTerminals(goalEditing.workspaceId,goalEditing.id,created);}else if(goalEditing.subgoal){applyWorkspace(await api.updateSubgoal(goalEditing.workspaceId,goalEditing.id,goalEditing.subgoal,{text:$('#goal-text').value}));await applyGoalTerminals(goalEditing.workspaceId,goalEditing.id,[goalEditing.subgoal]);}else if(!goalEditing.id){const workspace=await api.createGoal(goalEditing.workspaceId,$('#goal-text').value,{terminal:$('#goal-terminal').checked,subgoals:$('#goal-subgoals').value.split('\n').map(l=>l.trim()).filter(Boolean)});workspaces=workspaces.map(w=>w.id===workspace.id?workspace:w);sidebar();}else{await updateGoalRecord(goalEditing.workspaceId,goalEditing.id,$('#goal-text').value);await applyGoalTerminals(goalEditing.workspaceId,goalEditing.id,null);}$('#goal-editor').close();}catch(error){$('#goal-error').textContent=error.message;}};

function goLatest(id){const v=views.get(id);if(!v)return;promptCursors.delete(id);v.anchor=null;renderPromptBar(v);v.term.clearSelection();v.term.scrollToBottom();v.mirror?.scrollToBottom();displayPromptNavigation(v,v.promptEntries||[]);schedulePromptNavigation(id);}

// Click a path or URL in the terminal text to open it: web links in the browser, viewable files in Safari, other files in their app, folders in Finder.
const PATH_IN_TEXT=/(?:https?:\/\/[^\s<>"'`]+)|(?:file:\/\/)?(?:~|\.{1,2})?(?:\/[\w.@%+~-]+)+\/?(?::\d+(?::\d+)?)?|(?:[\w.@%+-]+\/)+[\w.@%+-]+(?::\d+(?::\d+)?)?|[\w@%+-][\w.@%+-]*\.[A-Za-z][\w]{0,7}(?::\d+(?::\d+)?)?/g;
const pathCache=new Map();
async function resolveCandidates(id,list){const key=c=>id+'\0'+c,now=Date.now(),todo=list.filter(c=>!(pathCache.get(key(c))?.until>now));
 if(todo.length){const found=await api.resolvePaths(id,todo).catch(()=>[]);const byRaw=new Map(found.map(f=>[f.raw,f]));for(const c of todo)pathCache.set(key(c),{until:now+(byRaw.has(c)?30000:4000),value:byRaw.get(c)||null});if(pathCache.size>5000)pathCache.clear();}
 return new Map(list.map(c=>[c,pathCache.get(key(c))?.value||null]));}
// A logical line can wrap over several rows: join them and map each character back to its cell.
function logicalLine(term,row){const b=term.buffer.active;let start=row;while(start>0&&b.getLine(start)?.isWrapped)start--;let end=row;while(b.getLine(end+1)?.isWrapped)end++;
 let text='';for(let r=start;r<=end;r++)text+=b.getLine(r)?.translateToString(r===end)||'';return {start,end,text,cols:term.cols};}
function lineMatches(line){return [...line.text.matchAll(PATH_IN_TEXT)].map(m=>({raw:m[0].replace(/[),.;:!?*_~'"\]}>]+$/,''),index:m.index})).filter(m=>m.raw.length>1&&!/^\d+(\.\d+)*$/.test(m.raw));}
const cellOf=(line,index)=>({x:index%line.cols+1,y:line.start+Math.floor(index/line.cols)+1});
async function resolveMatches(id,matches){const files=matches.filter(m=>!/^https?:/.test(m.raw));const resolved=await resolveCandidates(id,[...new Set(files.map(m=>m.raw))]);
 return matches.map(m=>({...m,web:/^https?:/.test(m.raw),hit:/^https?:/.test(m.raw)?null:resolved.get(m.raw)})).filter(m=>m.web||m.hit);}
// Links the program marks explicitly (OSC 8 hyperlinks, e.g. every URL and file Claude Code prints): open on click.
function hyperlinkHandler(id){return {allowNonHttpProtocols:true,activate:(event,uri)=>{const term=views.get(id)?.term;if(term&&Date.now()-(term.metaOpenedAt||0)<800)return;let u;try{u=new URL(uri);}catch{return;}
 if(u.protocol==='http:'||u.protocol==='https:')api.openUrl(id,u.href).catch(notice);else if(u.protocol==='file:')api.openPath(id,decodeURIComponent(u.pathname)).catch(notice);}};}
function openMatch(id,m){(m.web?api.openUrl(id,m.raw):api.openPath(id,m.hit.path)).catch(notice);}
// Drop files on a terminal and their paths are typed, quoted for the shell, as a paste: Claude attaches dropped images,
// as in Apple Terminal. An image dragged from a web page has no file yet: it is saved first. Dropped text is pasted.
function shellPath(p){return p.replace(/[^A-Za-z0-9_\-.,:\/@+%=]/g,c=>'\\'+c);}
function dropFiles(v){const wanted=e=>e.dataTransfer.types.includes('Files')||e.dataTransfer.types.includes('text/plain')&&!e.dataTransfer.types.some(t=>t.startsWith('application/')||t==='text/terminal-id');
 v.pane.addEventListener('dragover',e=>{if(!wanted(e))return;e.preventDefault();e.stopPropagation();e.dataTransfer.dropEffect='copy';v.pane.classList.add('file-drop');});
 v.pane.addEventListener('dragleave',e=>{if(!v.pane.contains(e.relatedTarget))v.pane.classList.remove('file-drop');});
 v.pane.addEventListener('drop',async e=>{if(!wanted(e))return;e.preventDefault();e.stopPropagation();v.pane.classList.remove('file-drop');if(sessions.get(v.id)?.status==='closed')return;
  const files=[...e.dataTransfer.files],text=files.length?'':e.dataTransfer.getData('text/plain');
  try{const paths=[];for(const file of files){let p=api.pathForFile(file);if(!p)p=await api.saveDroppedFile(file.name,new Uint8Array(await file.arrayBuffer()));paths.push(shellPath(p));}
   const data=paths.length?paths.join(' ')+' ':text;if(data){v.term.focus();v.term.paste(data);}}catch(error){notice(error);}});}
// Fork a chat: a new terminal in the same workspace and folder continues a copy of it.
async function forkTerminal(id){try{const s=await api.forkTerminal(id);mount(s);if(activeWorkspaceId!==s.workspaceId)await switchWorkspace(s.workspaceId);focus(s.id);}catch(e){notice(e);}}
function registerTerminalLinks(term,id){
 term.registerLinkProvider({provideLinks(y,callback){const line=logicalLine(term,y-1),matches=lineMatches(line);if(!matches.length){callback(undefined);return;}
  resolveMatches(id,matches).then(found=>{const links=found.map(m=>({range:{start:cellOf(line,m.index),end:cellOf(line,m.index+m.raw.length-1)},text:m.raw,decorations:{underline:true,pointerCursor:true},activate:()=>{if(Date.now()-(term.metaOpenedAt||0)>800)openMatch(id,m);}}));callback(links.length?links:undefined);});}});
 // ⌘-click always opens, also while an app (e.g. Claude Code) captures the mouse.
 term.element?.addEventListener('mousedown',event=>{if(!event.metaKey||event.button!==0)return;const screen=term.element.querySelector('.xterm-screen');if(!screen)return;const r=screen.getBoundingClientRect();
  const col=Math.floor((event.clientX-r.left)/(r.width/term.cols)),row=Math.floor((event.clientY-r.top)/(r.height/term.rows))+term.buffer.active.viewportY;if(col<0||col>=term.cols||row<0)return;
  const line=logicalLine(term,row),at=(row-line.start)*line.cols+col,m=lineMatches(line).find(m=>at>=m.index&&at<m.index+m.raw.length);if(!m)return;
  event.preventDefault();event.stopPropagation();term.metaOpenedAt=Date.now();resolveMatches(id,[m]).then(found=>{if(found[0])openMatch(id,found[0]);});},true);}
function scheduleLinks(v){if(v.linkTimer)return;v.linkTimer=setTimeout(()=>{v.linkTimer=null;if(!views.has(v.id))return;let text='';const buffer=v.term.buffer.active;for(let i=0;i<buffer.length;i++){const line=buffer.getLine(i);if(line)text+=line.translateToString(!buffer.getLine(i+1)?.isWrapped)+(buffer.getLine(i+1)?.isWrapped?'':'\n');}api.terminalLinks(v.id,text.slice(-2000000)).catch(()=>{});},4000);}

// Goals ↔ terminals: drag a goal onto a terminal (canvas, View or sidebar) to attach it; dropping on an attached terminal detaches it.
const goalDragType='application/x-terminator-goal';let draggingGoal=null;
function goalTerminalIds(goal){return [...new Set([...(goal.terminalIds||[]),...(goal.terminalId?[goal.terminalId]:[])])];}
function goalDots(goal,ids=goalTerminalIds(goal)){const dots=el('span','goal-dots');for(const id of ids){const s=sessions.get(id);if(!s)continue;const dot=button('',`${s.title} — click to view`,()=>openView(id),'goal-dot');dot.style.setProperty('--color',accent(sessionColor(s)));dots.append(dot);}return dots;}
function goalDropTarget(event){const node=event.target.closest?.('.pane[data-terminal-id],[data-goal-target]');const id=node?.dataset.terminalId||node?.dataset.goalTarget;return id&&sessions.has(id)?{node,id}:null;}
function clearGoalDrop(){document.querySelectorAll('.goal-drop,.goal-drop-detach').forEach(n=>n.classList.remove('goal-drop','goal-drop-detach'));}
document.addEventListener('dragover',event=>{if(!event.dataTransfer.types.includes(goalDragType))return;const target=goalDropTarget(event);clearGoalDrop();if(!target)return;event.preventDefault();event.stopPropagation();event.dataTransfer.dropEffect='link';const attached=draggingGoal&&(draggingGoal.sub?[...goalTerminalIds(draggingGoal),...(draggingGoal.sub.terminalIds||[])]:goalTerminalIds(draggingGoal)).includes(target.id);target.node.classList.add(attached?'goal-drop-detach':'goal-drop');},true);
document.addEventListener('drop',async event=>{if(!event.dataTransfer.types.includes(goalDragType))return;const target=goalDropTarget(event),id=event.dataTransfer.getData(goalDragType);clearGoalDrop();draggingGoal=null;if(!target||!id)return;event.preventDefault();event.stopPropagation();try{const [goalId,subId]=id.split('/');if(subId){const goal=workspaces.find(w=>w.id===activeWorkspaceId)?.goals?.find(g=>g.id===goalId);if(goal&&goalTerminalIds(goal).includes(target.id)){notice('This subgoal already inherits that terminal from its goal.');return;}applyWorkspace(await api.updateSubgoal(activeWorkspaceId,goalId,subId,{toggleTerminal:target.id}));}else applyWorkspace(await api.toggleGoalTerminal(activeWorkspaceId,goalId,target.id));}catch(error){notice(error);}},true);
function formatGoalDate(time){const d=new Date(time),now=new Date();return d.toLocaleDateString(undefined,{day:'numeric',month:'short',...(d.getFullYear()!==now.getFullYear()?{year:'numeric'}:{})});}
function goalDate(goal){const hooked=goalHooks.date?.(goal);if(hooked)return hooked;const text=goal.createdAt?formatGoalDate(goal.createdAt)+(goal.removedAt?' – '+formatGoalDate(goal.removedAt):''):'No date';const d=el('div','goal-date',text);if(goal.createdAt)d.title=new Date(goal.createdAt).toLocaleString();return d;}
function goalProgressBar(workspaceId,goal){const hooked=goalHooks.progress?.(workspaceId,goal);if(hooked)return hooked;const row=el('div','goal-progress'),slider=el('input'),value=el('span','',`${goal.progress||0}%`);// The goal card is draggable (to attach it to terminals); switch that off while the slider is being used so the slider can move.
slider.draggable=false;slider.addEventListener('pointerdown',()=>{const card=slider.closest('[draggable=true]');if(!card)return;card.draggable=false;const restore=()=>{card.draggable=true;window.removeEventListener('pointerup',restore);window.removeEventListener('pointercancel',restore);};window.addEventListener('pointerup',restore);window.addEventListener('pointercancel',restore);});slider.addEventListener('dragstart',e=>e.preventDefault());slider.type='range';slider.min='0';slider.max='100';slider.value=goal.progress||0;slider.setAttribute('aria-label',`Progress: ${goal.text}`);slider.style.setProperty('--fill',`${goal.progress||0}%`);slider.oninput=()=>{value.textContent=slider.value+'%';slider.style.setProperty('--fill',slider.value+'%');};slider.onchange=async()=>{try{const w=await api.goalProgress(workspaceId,goal.id,Number(slider.value));workspaces=workspaces.map(old=>old.id===w.id?w:old);}catch(error){notice(error);slider.value=goal.progress||0;value.textContent=slider.value+'%';}};row.append(slider,value);return row;}
$('#goals-history-button').onclick=()=>{const list=$('#goals-history-list');list.replaceChildren();for(const w of workspaces)for(const goal of w.goalHistory||[]){const item=el('div','goal-history-item');item.append(el('div','',goal.text),goalDate(goal),goalProgressBar(w.id,goal));list.append(item);}if(!list.childElementCount)list.append(el('div','','No previous goals.'));$('#goals-history').showModal();};
$('#goals-history-close').onclick=()=>$('#goals-history').close();
// Chat search (title bar, ⌘K): every Claude and Codex chat on this Mac, by its title and the words in it. Opening a
// result goes to the terminal that holds the chat, or resumes it in a new terminal in its folder.
{const input=$('#chat-search-input'),box=$('#chat-search-results');let timer=0,asked=0,results=[],active=0,again=0;
 const when=t=>{if(!t)return '';const d=new Date(t),now=new Date();return d.toDateString()===now.toDateString()?d.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}):d.toLocaleDateString([],{day:'numeric',month:'short',...(d.getFullYear()===now.getFullYear()?{}:{year:'numeric'})});};
 const folder=p=>(p||'').replace(/^\/Users\/[^/]+/,'~');
 const show=on=>{box.hidden=!on;input.setAttribute('aria-expanded',String(on));};
 const mark=i=>{active=i;[...box.querySelectorAll('.chat-result')].forEach((b,j)=>{b.classList.toggle('active',j===i);b.setAttribute('aria-selected',String(j===i));if(j===i)b.scrollIntoView({block:'nearest'});});};
 function render(r,query){results=r.results||[];box.replaceChildren();
  results.forEach((x,i)=>{const b=el('button','chat-result');b.type='button';b.setAttribute('role','option');b.title=x.terminalId?`Go to the terminal “${x.terminalTitle}”`:`Resume this ${x.provider==='codex'?'Codex':'Claude'} chat in a new terminal`;
   const head=el('div','chat-result-head');head.append(el('span','chat-result-title',x.title),el('span','chat-result-date',when(x.updated)));
   const meta=el('div','chat-result-meta');meta.append(el('span','chat-result-tag'+(x.provider==='codex'?' is-codex':''),x.provider==='codex'?'Codex':'Claude'));if(x.terminalId)meta.append(el('span','chat-result-tag is-open','Open · '+x.terminalTitle));meta.append(el('span','chat-result-folder',folder(x.cwd)));
   b.append(head,meta);if(x.snippet){const sn=el('div','chat-result-snippet');sn.append(el('b','',x.snippet.role+': '),document.createTextNode(x.snippet.before),el('mark','',x.snippet.match),document.createTextNode(x.snippet.after));b.append(sn);}
   b.onmousedown=e=>e.preventDefault();b.onclick=()=>open(x);b.onmouseenter=()=>mark(i);box.append(b);});
  const note=r.indexing?`Reading chats… ${r.indexing.done} of ${r.indexing.total}`:!results.length?`No chat has “${query}”.`:'';if(note)box.append(el('div','chat-search-note',note));
  mark(0);show(true);clearTimeout(again);if(r.indexing)again=setTimeout(search,1500);}
 async function search(){const q=input.value.trim(),n=++asked;if(q.length<2){show(false);results=[];return;}
  try{const r=await api.searchChats(q);if(n===asked&&input.value.trim()===q)render(r,q);}catch(e){notice(e);}}
 async function open(x){if(!x)return;show(false);input.blur();
  try{const r=await api.openChat(x.provider,x.id,activeWorkspaceId,x.cwd,x.title);if(r.session)mount(r.session);const id=r.focus||r.session.id,s=sessions.get(id);if(s&&activeWorkspaceId!==s.workspaceId)await switchWorkspace(s.workspaceId);focus(id);}catch(e){notice(e);}}
 input.addEventListener('input',()=>{clearTimeout(timer);timer=setTimeout(search,140);});
 input.addEventListener('focus',()=>{if(input.value.trim().length>=2)search();});
 input.addEventListener('blur',()=>setTimeout(()=>{if(document.activeElement!==input)show(false);},100));
 input.addEventListener('keydown',e=>{if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();if(results.length)mark((active+(e.key==='ArrowDown'?1:-1)+results.length)%results.length);}
  else if(e.key==='Enter'){e.preventDefault();open(results[active]);}
  else if(e.key==='Escape'){e.preventDefault();e.stopPropagation();if(input.value){input.value='';show(false);}else input.blur();}});
 document.addEventListener('keydown',e=>{if(e.metaKey&&!e.shiftKey&&!e.altKey&&!e.ctrlKey&&e.code==='KeyK'&&!document.querySelector('dialog[open]')){e.preventDefault();e.stopPropagation();input.focus();input.select();}},true);}
