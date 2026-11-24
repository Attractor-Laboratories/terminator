const {spawn}=require('node:child_process');
const path=require('node:path');
const os=require('node:os');
function windowLabel(minutes){if(minutes===1440)return 'Daily';if(!Number.isFinite(minutes))return 'Current window';if(minutes===10080)return 'Weekly';if(minutes>=40320&&minutes<=44640)return 'Monthly';if(minutes%1440===0)return `${minutes/1440} days`;if(minutes%60===0)return `${minutes/60} hours`;return `${minutes} min`;}
function row(label,used,resets){if(typeof used!=='number'||!Number.isFinite(used))return null;return {label,remaining:Math.max(0,Math.min(100,100-used)),resetsAt:typeof resets==='number'?resets:null};}
function resetTime(value){if(typeof value==='number')return value;const n=Date.parse(value);return Number.isFinite(n)?n/1000:null;}
function claudeWindows(data){
 const windows=[];if(!data)return windows;
 const labels={five_hour:'5 hours',one_day:'Daily',daily:'Daily',seven_day:'Weekly',weekly:'Weekly',thirty_day:'Monthly',monthly:'Monthly'};
 for(const [key,w] of Object.entries(data)){
  if(!w||typeof w!=='object'||key==='extra_usage')continue;
  let label=labels[key];
  if(!label&&key.startsWith('seven_day_'))label='Weekly · '+key.slice(10).replaceAll('_',' ');
  if(key==='spend_limit')label=({daily:'Daily',weekly:'Weekly',monthly:'Monthly'})[w.period]||'Spend limit';
  if(!label)continue;
  const value=row(label,w.used_percentage??w.utilization,resetTime(w.resets_at));if(value)windows.push(value);
 }
 const extra=data.extra_usage;if(extra?.is_enabled){for(const [key,label] of [['daily','Daily'],['weekly','Weekly'],['monthly','Monthly']]){const w=key==='monthly'?extra:extra[key];if(!w)continue;const value=row(`${label} · Extra usage`,w.used_percentage??w.utilization,resetTime(w.resets_at));if(value)windows.push(value);}}
 return windows;
}
function codexWindows(data){
 const buckets=data?.rateLimitsByLimitId&&Object.keys(data.rateLimitsByLimitId).length?Object.entries(data.rateLimitsByLimitId):[['codex',data?.rateLimits]],windows=[];
 for(const [id,bucket] of buckets){for(const key of ['primary','secondary']){const w=bucket?.[key];if(!w)continue;const label=windowLabel(w.windowDurationMins)+(id==='codex'?'':` · ${bucket.limitName||id}`);const value=row(label,w.usedPercent,w.resetsAt);if(value)windows.push(value);}}
 return windows;
}
function readCodex(){return new Promise((resolve,reject)=>{
 const env={...process.env,PATH:[path.join(os.homedir(),'.local/bin'),'/opt/homebrew/bin','/usr/local/bin',process.env.PATH].filter(Boolean).join(':')};delete env.ELECTRON_RUN_AS_NODE;
 const child=spawn('codex',['app-server'],{env,stdio:['pipe','pipe','ignore']});let buffer='',done=false;
 const finish=(error,result)=>{if(done)return;done=true;clearTimeout(timer);child.stdin.end();child.kill();error?reject(error):resolve(result);};
 const timer=setTimeout(()=>finish(new Error('Usage check timed out')),15000);
 const send=v=>child.stdin.write(JSON.stringify(v)+'\n');
 child.on('error',()=>finish(new Error('Codex unavailable')));child.on('exit',()=>{if(!done)finish(new Error('Codex unavailable'));});child.stdin.on('error',()=>{});
 child.stdout.on('data',chunk=>{buffer+=chunk;if(buffer.length>2e6)return finish(new Error('Invalid usage response'));let i;while((i=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,i);buffer=buffer.slice(i+1);try{const m=JSON.parse(line);if(m.id===1){if(m.error)return finish(new Error('Codex unavailable'));send({method:'initialized',params:{}});send({method:'account/rateLimits/read',id:2});}if(m.id===2){if(m.error)return finish(new Error('Sign in to Codex to view limits'));finish(null,codexWindows(m.result));}}catch{}}});
 send({method:'initialize',id:1,params:{clientInfo:{name:'terminator',title:'Terminator',version:'0.1.0'}}});
});}
module.exports={claudeWindows,codexWindows,readCodex,windowLabel};
function cachedClaude(file=path.join(os.homedir(),'.claude.json')){
 try{const cache=JSON.parse(require('node:fs').readFileSync(file,'utf8')).cachedUsageUtilization;if(!cache||typeof cache.fetchedAtMs!=='number')return null;
 const windows=claudeWindows(cache.utilization);
 return windows.length?{windows,updatedAt:cache.fetchedAtMs}:null;
 }catch{return null;}
}
module.exports.cachedClaude=cachedClaude;
let claudeRetryAt=0;
async function readClaude(){
 if(Date.now()<claudeRetryAt){const minutes=Math.ceil((claudeRetryAt-Date.now())/60000);throw new Error(`Claude limits paused by the server — try again in ${minutes} min`);}
 const fs=require('node:fs'),{execFile}=require('node:child_process');let credentials;
 if(process.platform==='darwin'){
  const raw=await new Promise((resolve,reject)=>execFile('/usr/bin/security',['find-generic-password','-s','Claude Code-credentials','-w'],{timeout:10000,maxBuffer:1024*1024},(error,stdout)=>error?reject(new Error('Sign in to Claude Code to view limits')):resolve(stdout)));
  try{credentials=JSON.parse(raw);}catch{throw new Error('Claude credentials unavailable');}
 }else{try{credentials=JSON.parse(fs.readFileSync(path.join(process.env.CLAUDE_CONFIG_DIR||path.join(os.homedir(),'.claude'),'.credentials.json'),'utf8'));}catch{throw new Error('Sign in to Claude Code to view limits');}}
 const token=credentials?.claudeAiOauth?.accessToken;if(!token)throw new Error('Sign in to Claude Code to view limits');
 let response;try{response=await fetch('https://api.anthropic.com/api/oauth/usage',{headers:{Authorization:`Bearer ${token}`,'anthropic-beta':'oauth-2025-04-20'},signal:AbortSignal.timeout(12000),redirect:'error'});}catch{throw new Error('Claude usage unavailable');}
 if(response.status===429){const retry=response.headers.get('retry-after');const seconds=Number(retry);claudeRetryAt=Date.now()+Math.max(60000,Number.isFinite(seconds)?seconds*1000:(Date.parse(retry)||Date.now()+60000)-Date.now());throw new Error('Claude refresh rate-limited');}
 if(response.status===401||response.status===403)throw new Error('Sign in to Claude Code to refresh limits');
 if(!response.ok)throw new Error('Claude usage unavailable');
 const windows=claudeWindows(await response.json());if(!windows.length)throw new Error('Claude limits unavailable');return windows;
}
module.exports.readClaude=readClaude;
