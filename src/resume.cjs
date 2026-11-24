const fs=require('node:fs');
const validId=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const quote=value=>"'"+value.replace(/'/g,"'\\''")+"'";
function resumeCommand(id,cwd){if(!validId(id))throw new Error('Choose a Claude chat or enter its session ID.');return `${cwd?`cd -- ${quote(cwd)} && `:''}claude --dangerously-skip-permissions --resume ${quote(id)}\r`;}
function recentChats(file){
 let fd;try{fd=fs.openSync(file,'r');const size=fs.fstatSync(fd).size,start=Math.max(0,size-4*1024*1024),buffer=Buffer.alloc(size-start);fs.readSync(fd,buffer,0,buffer.length,start);const lines=buffer.toString('utf8').split('\n');if(start)lines.shift();const chats=new Map();for(const line of lines){try{const e=JSON.parse(line);if(validId(e.sessionId)&&typeof e.project==='string')chats.set(e.sessionId,{id:e.sessionId,cwd:e.project,prompt:typeof e.display==='string'?e.display.slice(0,200):'',timestamp:Number(e.timestamp)||0});}catch{}}return [...chats.values()].sort((a,b)=>b.timestamp-a.timestamp).slice(0,100);}catch{return [];}finally{if(fd!==undefined)fs.closeSync(fd);}
}
module.exports={validId,resumeCommand,recentChats};
