const fs=require('node:fs');
const {StringDecoder}=require('node:string_decoder');
const {isSystemPrompt}=require('./prompt-text.cjs');
const cache=new Map();
function parseRecords(text,provider,state={}){
 const next={...state};
 for(const line of text.split('\n')){let r;try{r=JSON.parse(line);}catch{continue;}const p=r.payload||{},at=Date.parse(r.timestamp);if(!Number.isFinite(at))continue;
  if(provider==='codex'){
   const settings=r.type==='turn_context'?p:p.type==='thread_settings_applied'?p.thread_settings:null;
   if(settings){next.metadataAt=at;if(typeof settings.model==='string')next.model=settings.model;if(typeof(settings.effort||settings.reasoning_effort)==='string')next.effort=settings.effort||settings.reasoning_effort;}
   if(r.type!=='event_msg')continue;
   if(p.type==='task_started'){next.turnStartedAt=at;next.activity={status:'running',at};}
   if(['task_complete','turn_aborted'].includes(p.type))next.activity={status:'done',at};
   if(p.type==='user_message'&&typeof p.message==='string')next.prompt={text:p.message,at};
   const info=p.type==='token_count'&&p.info,used=info?.last_token_usage?.total_tokens,limit=info?.model_context_window;
   if(Number.isFinite(used)&&Number.isFinite(limit)&&limit>0)next.contextPercent=Math.max(0,Math.min(100,used/limit*100));
  }else{
   if(r.isSidechain)continue;
   // A user record starts work only when it is a real prompt or a tool result. Esc writes "[Request interrupted by user…]"
   // and ends the turn without a Stop hook; `!` commands, slash-command output, compaction summaries and background-task
   // notices are bookkeeping (a task notice that does start a turn is followed by assistant records, which count).
   if(r.type==='user'&&!r.isMeta){const content=r.message?.content;const text=typeof content==='string'?content:Array.isArray(content)&&!content.some(c=>c.type==='tool_result')?content.filter(c=>c.type==='text').map(c=>c.text).join('\n'):null;
    if(text!==null&&/^\[Request interrupted by user/.test(text.trim())){next.activity={status:'done',at};continue;}
    if(r.isCompactSummary||(text!==null&&isSystemPrompt(text)))continue;
    if(text&&(typeof content==='string'||content.some(c=>c.type==='text'))){next.prompt={text,at};next.turnStartedAt=at;}next.activity={status:'running',at};}
   if(r.type==='assistant')next.activity={status:'running',at};
   if(r.type==='system'&&r.subtype==='turn_duration')next.activity={status:'done',at};
  }
 }
 return next;
}
function readRuntime(file,provider){
 try{const stat=fs.statSync(file);let prior=cache.get(file);if(prior&&prior.ino===stat.ino&&prior.size===stat.size&&prior.mtime===stat.mtimeMs)return prior.state;
 const continuing=prior&&prior.ino===stat.ino&&stat.size>=prior.size;const start=continuing?prior.size:Math.max(0,stat.size-4*1024*1024);const decoder=continuing?prior.decoder:new StringDecoder('utf8');const fd=fs.openSync(file,'r');let text;try{const bytes=Buffer.alloc(stat.size-start);fs.readSync(fd,bytes,0,bytes.length,start);text=decoder.write(bytes);}finally{fs.closeSync(fd);}
 text=(continuing?prior.pending:'')+text;if(!continuing&&start>0)text=text.slice(text.indexOf('\n')+1);const end=text.lastIndexOf('\n');const complete=end<0?'':text.slice(0,end),pending=end<0?text:text.slice(end+1);const state=parseRecords(complete,provider,continuing?prior.state:{});cache.set(file,{ino:stat.ino,size:stat.size,mtime:stat.mtimeMs,pending,state,decoder});return state;
 }catch{return null;}
}
function identity(s){return s?.agent?(s.provider==='codex'?s.codexSession:s.claudeSession):null;}
function claudeNotification(type){return type==='idle_prompt'?'Stop':['permission_prompt','elicitation_dialog'].includes(type)?'attention':null;}
function waitingReason(s,job,now=Date.now()){
 const name=s.provider==='codex'?'Codex':'Claude';
 if(s.manualInput)return 'Finish or clear the draft in this terminal.';
 if(s.routerSending)return 'Sending the previous message…';
 if(now<(s.inputPendingUntil||0))return 'Waiting for prompt submission…';
 if(!job.steer&&s.status==='running')return `Waiting for ${name} to finish.`;
 if(s.status==='attention')return `${name} is waiting for your response.`;
 if(!['ready','done'].includes(s.status)&&!job.steer)return `Waiting for ${name} to become ready.`;
 if((!['ready','done'].includes(s.status)&&!s.pasteReady)||now<(s.agentReadyAt||0)||now<(job.notBefore||0))return `Waiting for ${name} input…`;
 return null;
}
module.exports={claudeNotification,parseRecords,readRuntime,identity,waitingReason};

function codexDisplayMetadata(output){
 const plain=require('node:util').stripVTControlCharacters(output);let result=null;
 // Only Codex's own explicit model-change and startup banner labels.
 for(const match of plain.matchAll(/(?:^|[\r\n])\s*(?:[•●]\s*)?Model changed to ([a-zA-Z0-9_.:-]+)(?:\s+(minimal|low|medium|high|xhigh|max|none))?(?=\s|$)/g))result={model:match[1],effort:match[2]||null};
 if(!result)for(const match of plain.matchAll(/(?:^|[\r\n])\s*[│┃]\s*model:\s*([a-zA-Z0-9_.:-]+)(?:\s+(minimal|low|medium|high|xhigh|max|none))?[^\r\n]*\/model to change/g))result={model:match[1],effort:match[2]||null};
 return result;
}
module.exports.codexDisplayMetadata=codexDisplayMetadata;
