const fs=require('node:fs');
// Writes the new state next to the old one, keeps the previous file as .bak (a rename, not a copy), then swaps the new one in.
// The previous file was written by this function, so it is not re-read and re-parsed on every save.
function writeState(file,state){
 const temp=file+'.tmp';const fd=fs.openSync(temp,'w',0o600);
 try{fs.writeFileSync(fd,JSON.stringify(state));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 if(fs.existsSync(file))fs.renameSync(file,file+'.bak');
 fs.renameSync(temp,file);
}
function readState(file){for(const candidate of [file,file+'.bak']){try{const data=JSON.parse(fs.readFileSync(candidate,'utf8'));if(!Array.isArray(data.terminals))continue;return data;}catch{}}throw new Error('No saved session');}
module.exports={writeState,readState};
