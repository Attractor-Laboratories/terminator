const crypto=require('node:crypto');
function archiveTerminal(s,position,now=Date.now()){
 const {id,title,color,cwd,workspaceId,resumeSession,resumeCwd,lastSession,sessionHistory,latestPrompt,links,buffer}=s;
 const valid=position&&['col','row','colSpan','rowSpan'].every(k=>Number.isInteger(position[k]))&&position.col>=0&&position.row>=0&&position.colSpan>0&&position.rowSpan>0;
 return {archiveId:crypto.randomUUID(),closedAt:now,id,title,color,cwd,workspaceId,resumeSession,resumeCwd,lastSession,sessionHistory,latestPrompt,links,buffer,position:valid?{...position}:null};
}
module.exports={archiveTerminal};
