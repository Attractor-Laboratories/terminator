const fs=require('node:fs');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const run=promisify(execFile);
const path=require('node:path');
const {validId,resumeCommand}=require('./resume.cjs');
const quote=value=>"'"+value.replace(/'/g,"'\\''")+"'";
function restoreCommand(record){
 if(!record||!validId(record.id)||!['claude','codex'].includes(record.provider))return null;
 if(record.provider==='claude')return resumeCommand(record.id,record.cwd);
 return `${record.cwd?`cd -- ${quote(record.cwd)} && `:''}codex --dangerously-bypass-approvals-and-sandbox --no-alt-screen resume ${quote(record.id)}\r`;
}
// Fork: a new session that starts as a copy of this chat; the original goes on unchanged.
function forkCommand(record){
 if(!record||!validId(record.id)||!['claude','codex'].includes(record.provider))return null;
 const cd=record.cwd?`cd -- ${quote(record.cwd)} && `:'';
 return record.provider==='claude'?`${cd}claude --dangerously-skip-permissions --resume ${quote(record.id)} --fork-session\r`:`${cd}codex --dangerously-bypass-approvals-and-sandbox --no-alt-screen fork ${quote(record.id)}\r`;
}
function remember(s,record){
 if(!validId(record.id)||!['claude','codex'].includes(record.provider))return false;
 const previous=s.lastSession;
 s.lastSession={...record,cwd:record.cwd||s.cwd};
 s.sessionHistory=[s.lastSession,...(s.sessionHistory||[]).filter(r=>r.id!==record.id||r.provider!==record.provider)].slice(0,50);
 return JSON.stringify(previous)!==JSON.stringify(s.lastSession);
}
function descendants(rows,pid){const found=new Set([pid]);let changed=true;while(changed){changed=false;for(const row of rows)if(found.has(row.ppid)&&!found.has(row.pid)){found.add(row.pid);changed=true;}}return [...found];}
async function codexRecord(pid){
 const {stdout}=await run('/bin/ps',['-axo','pid=,ppid=,comm='],{timeout:2000,maxBuffer:4*1024*1024});
 const rows=stdout.split('\n').map(line=>{const m=line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/);return m?{pid:Number(m[1]),ppid:Number(m[2]),command:m[3]}:null;}).filter(Boolean);
 const children=new Set(descendants(rows,pid));const codex=rows.filter(r=>children.has(r.pid)&&/(?:^|\/)codex(?:$|[- ])/.test(r.command));
 for(const process of codex){
  let output;try{output=(await run('/usr/sbin/lsof',['-n','-P','-p',String(process.pid),'-Fn'],{timeout:2000,maxBuffer:4*1024*1024})).stdout;}catch{continue;}
  const candidates=[];const lines=output.split('\n'),cwdIndex=lines.indexOf('fcwd'),liveCwd=cwdIndex>=0&&lines[cwdIndex+1]?.startsWith('n')?lines[cwdIndex+1].slice(1):undefined;
  for(const line of output.split('\n')){if(!/^n.*\/rollout-[^/]+\.jsonl$/.test(line))continue;let fd;try{fd=fs.openSync(line.slice(1),'r');const b=Buffer.alloc(65536),length=fs.readSync(fd,b,0,b.length,0);const meta=JSON.parse(b.toString('utf8',0,length).split('\n')[0]);const p=meta.payload;if(meta.type==='session_meta'&&validId(p?.id)&&p.source==='cli')candidates.push({provider:'codex',id:p.id,cwd:p.cwd,...codexContext(fd),runtime:require('./agent-runtime.cjs').readRuntime(line.slice(1),'codex')});}catch{}finally{if(fd!==undefined)fs.closeSync(fd);}}
  if(!candidates.length){
   const locks=lines.map(line=>line.match(/^n(.*)\/thread-writer-locks\/([a-f0-9-]+)\.lock$/)).filter(m=>m&&validId(m[2]));
   if(locks.length===1){const [,base,id]=locks[0];let row;
    const databases=lines.filter(line=>/^n.*\/state_\d+\.sqlite$/.test(line)).map(line=>line.slice(1));
    for(const database of [...new Set(databases)])try{const result=await run('/usr/bin/sqlite3',['-readonly','-json',database,`SELECT id,rollout_path,cwd,model,reasoning_effort,updated_at_ms FROM threads WHERE id='${id}' LIMIT 1`],{timeout:2000,maxBuffer:65536});row=JSON.parse(result.stdout||'[]')[0];if(row)break;}catch{}
    const runtime=row?.rollout_path?require('./agent-runtime.cjs').readRuntime(row.rollout_path,'codex'):null;
    candidates.push({provider:'codex',id,cwd:row?.cwd||liveCwd,persisted:!!row,runtime:{...runtime,...(row?.model?{model:row.model,effort:row.reasoning_effort,metadataAt:row.updated_at_ms||0}:{})}});
   }
  }
  const unique=[...new Map(candidates.map(c=>[c.id,c])).values()];if(unique.length===1){const record=unique[0];if(!record.runtime||!Object.keys(record.runtime).length)delete record.runtime;return record;}
 }
 return null;
}
module.exports={forkCommand,restoreCommand,remember,descendants,codexRecord};
function claudeTranscript(record,base){
 if(!record||!validId(record.id))return null;
 const path=require('node:path');
 if(record.transcript&&path.basename(record.transcript)===record.id+'.jsonl'&&fs.existsSync(record.transcript))return record.transcript;
 try{for(const entry of fs.readdirSync(path.join(base,'projects'),{withFileTypes:true})){if(!entry.isDirectory())continue;const file=path.join(base,'projects',entry.name,record.id+'.jsonl');if(fs.existsSync(file))return file;}}catch{}
 return null;
}
module.exports.claudeTranscript=claudeTranscript;

function codexContext(fd){
 const size=fs.fstatSync(fd).size,b=Buffer.alloc(Math.min(size,262144));fs.readSync(fd,b,0,b.length,size-b.length);
 for(const line of b.toString('utf8').split('\n').reverse()){
  try{const r=JSON.parse(line),info=r.type==='event_msg'&&r.payload?.type==='token_count'&&r.payload.info;
   if(!info)continue;const used=info.last_token_usage?.total_tokens,limit=info.model_context_window;
   if(Number.isFinite(used)&&Number.isFinite(limit)&&limit>0)return {contextPercent:Math.max(0,Math.min(100,used/limit*100))};
  }catch{}
 }
 return {};
}
module.exports.codexContext=codexContext;
