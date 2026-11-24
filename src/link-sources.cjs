const fs=require('node:fs');const {extractLinks,linkKey}=require('./terminal-links.cjs');const cache=new Map();
// Only text a person sees in the conversation counts: typed prompts and assistant replies.
// Tool calls and tool results (e.g. artifact type catalogs) are not part of the visible chat.
function visibleText(r){
 if(r.isMeta||r.isSidechain||r.isCompactSummary)return [];
 // Images pasted into Claude Code: the user sees [Image #1]; the request record carries "[Image: source: /path]".
 if(r.type==='api-request-blob'){const c=r.message?.content;return Array.isArray(c)?c.filter(b=>b?.type==='text'&&typeof b.text==='string'&&/^\[Image: source: [^\]]+\]$/.test(b.text.trim())).map(b=>b.text):[];}
 if(r.type==='user'||r.type==='assistant'){const c=r.message?.content;if(typeof c==='string')return [c];return Array.isArray(c)?c.filter(b=>b?.type==='text'&&typeof b.text==='string').map(b=>b.text):[];}
 const p=r.payload;if(!p)return [];
 if(r.type==='response_item'&&p.type==='message'&&Array.isArray(p.content))return p.content.filter(b=>['input_text','output_text'].includes(b?.type)&&typeof b.text==='string').map(b=>b.text);
 if(r.type==='event_msg'&&['user_message','agent_message'].includes(p.type)&&typeof p.message==='string')return [p.message];
 return [];
}
// cwd resolves relative file paths (e.g. output/plot.png) against the conversation's folder.
// Artifacts Claude published or opened for you. Their link is often only in the Artifact tool's result
// ("Published <file> at https://claude.ai/artifact/…"), not repeated in the reply. Listings, reads and type catalogs are left out.
// index.html / page.html say nothing: use their folder's name instead.
function fileTitle(file){const path=require('node:path'),generic=/^(index|page|main|app|artifact|site|dist|build|public|out|output|www|html|scratchpad|tmp)$/i;let name=path.basename(file).replace(/\.[^.]+$/,''),dir=path.dirname(file);while(generic.test(name)&&dir!==path.dirname(dir)){name=path.basename(dir);dir=path.dirname(dir);}return name;}
function artifactToolLinks(r,uses){
 const c=r.message?.content;if(!Array.isArray(c))return [];const found=[];
 for(const b of c){
  if(r.type==='assistant'&&b?.type==='tool_use'&&b.name==='Artifact'){uses.set(b.id,b.input||{});const a=b.input?.action;if(a==='open'&&typeof b.input.url==='string')found.push(b.input.url);}
  if(r.type==='user'&&b?.type==='tool_result'&&uses.has(b.tool_use_id)){const input=uses.get(b.tool_use_id);if(!(input.action===undefined||input.action==='publish')||input.asset)continue;
   const text=typeof b.content==='string'?b.content:Array.isArray(b.content)?b.content.map(x=>x?.text||'').join('\n'):'';
   const published=text.match(/Published\b[^\n]*?\bat (https:\/\/claude\.ai\/\S+)/);const url=published?.[1]||(text.match(/https:\/\/claude\.ai\/\S*artifacts?\/[\w-]+/g)||[]).find(u=>u!==input.type_url);
   const name=typeof input.title==='string'&&input.title.trim()?input.title.trim():typeof input.file_path==='string'?fileTitle(input.file_path):null;if(url)found.push(name?{url,name}:url);}
 }
 return found;
}
// Incremental: a transcript only grows, so after the first full read only the newly appended lines are parsed.
function sourceLinks(file,cwd=null){try{const stat=fs.statSync(file),cacheKey=file+'\0'+(cwd||'');let state=cache.get(cacheKey);
 if(state&&state.size===stat.size&&state.mtime===stat.mtimeMs)return state.result;
 if(!state||stat.size<state.offset){state={offset:0,size:0,mtime:0,links:new Map(),uses:new Map(),result:[]};}
 const length=stat.size-state.offset;if(length>0){const fd=fs.openSync(file,'r');const buffer=Buffer.alloc(length);try{fs.readSync(fd,buffer,0,length,state.offset);}finally{fs.closeSync(fd);}
  const text=buffer.toString('utf8'),last=text.lastIndexOf('\n');let complete=last<0?'':text.slice(0,last+1);const tail=text.slice(last+1);if(tail.trim()){try{JSON.parse(tail);complete=text;}catch{}}state.offset+=Buffer.byteLength(complete);
  for(const line of complete.split('\n')){if(!line)continue;let r;try{r=JSON.parse(line);}catch{continue;}if(r.isSidechain)continue;for(const item of [...visibleText(r),...artifactToolLinks(r,state.uses)]){const t=typeof item==='string'?item:item.url;for(const link of extractLinks(t,{cwd,files:true})){const key=linkKey(link);const named=typeof item==='object'&&item.name?{...link,label:item.name}:link;if(!state.links.has(key))state.links.set(key,named);else if(named!==link&&state.links.get(key).label!==named.label&&/^Claude · /.test(state.links.get(key).label))state.links.set(key,named);}}}}
 state.size=stat.size;state.mtime=stat.mtimeMs;state.result=[...state.links.values()];cache.set(cacheKey,state);return state.result;}catch{return null;}}
module.exports={sourceLinks,visibleText};
