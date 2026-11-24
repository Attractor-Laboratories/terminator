const fs=require('node:fs');
const readline=require('node:readline');
const {cleanPrompt,isSystemPrompt}=require('./prompt-text.cjs');
async function collectPrompts(records,log,files){
 const owners=new Map();for(const t of records)for(const ref of [t.lastSession,...(t.sessionHistory||[])])if(ref?.id)owners.set(ref.provider+':'+ref.id,t);
 const result=log.filter(p=>!isSystemPrompt(p.text)).map(p=>({...p,text:cleanPrompt(p.text)}));
 for(const [provider,file] of Object.entries(files)){
  if(!fs.existsSync(file))continue;
  const lines=readline.createInterface({input:fs.createReadStream(file),crlfDelay:Infinity});
  for await(const line of lines){try{const v=JSON.parse(line);const sessionId=provider==='claude'?v.sessionId:v.session_id;const owner=owners.get(provider+':'+sessionId);if(!owner)continue;let text=provider==='claude'?v.display:v.text;if(typeof text!=='string'||!text.trim()||isSystemPrompt(text))continue;
  if(provider==='claude'&&v.pastedContents)for(const [id,paste] of Object.entries(v.pastedContents)){if(paste.type==='text'&&typeof paste.content==='string')text=text.replace(`[Pasted text #${id}]`,paste.content);}
  text=cleanPrompt(text);if(!text)continue;const timestamp=provider==='claude'?v.timestamp:v.ts*1000;
  if(!result.some(r=>r.text===text&&r.sessionId===sessionId&&Math.abs(r.timestamp-timestamp)<10000))result.push({text,timestamp,sessionId,terminalId:owner.id,title:owner.title,workspaceId:owner.workspaceId,provider});
  }catch{}}
 }
 for(const t of records){const latest=cleanPrompt(t.latestPrompt||'');if(latest&&!result.some(r=>r.terminalId===t.id&&r.text===latest))result.push({text:latest,timestamp:null,terminalId:t.id,title:t.title,workspaceId:t.workspaceId,provider:t.lastSession?.provider});}
 // Each prompt carries its terminal's color (live terminals come first in records, so their current color wins).
 const colors=new Map();for(const t of records)if(t?.id&&typeof t.color==='string'&&!colors.has(t.id))colors.set(t.id,t.color);
 return result.map(r=>r.terminalId&&colors.has(r.terminalId)?{...r,color:colors.get(r.terminalId)}:r).sort((a,b)=>(b.timestamp||0)-(a.timestamp||0));
}
module.exports={collectPrompts};
