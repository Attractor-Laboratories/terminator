export function overlaps(a,b){return a.col<b.col+b.colSpan&&a.col+a.colSpan>b.col&&a.row<b.row+b.rowSpan&&a.row+a.rowSpan>b.row;}
export function fits(rect,grid,occupied){return rect.col>=0&&rect.row>=0&&rect.col+rect.colSpan<=grid.cols&&rect.row+rect.rowSpan<=grid.rows&&!occupied.some(other=>overlaps(rect,other));}
export function placement(grid,occupied,colSpan=1,rowSpan=1,preferred){if(preferred&&fits({...preferred,colSpan,rowSpan},grid,occupied))return {...preferred,colSpan,rowSpan};for(let row=0;row<=grid.rows-rowSpan;row++)for(let col=0;col<=grid.cols-colSpan;col++){const rect={col,row,colSpan,rowSpan};if(fits(rect,grid,occupied))return rect;}return null;}
export function removeTrack(grid,rects,axis,index){
 const count=axis==='col'?'cols':'rows',span=axis==='col'?'colSpan':'rowSpan',weights=axis==='col'?'colWeights':'rowWeights';
 if(!['col','row'].includes(axis)||grid[count]<=1||index<0||index>=grid[count])return null;
 const next={...grid,[count]:grid[count]-1,[weights]:(grid[weights]||Array(grid[count]).fill(1)).filter((_,i)=>i!==index)};
 const result=Array(rects.length),occupied=[],pending=[];
 rects.forEach((rect,i)=>{const p={...rect};if(p[axis]>index)p[axis]--;else if(p[axis]<=index&&p[axis]+p[span]>index){if(p[span]===1){pending.push(i);return;}p[span]--;}result[i]=p;occupied.push(p);});
 for(const i of pending){const p=placement(next,occupied,rects[i].colSpan,rects[i].rowSpan);if(!p)return null;result[i]=p;occupied.push(p);}
 return {grid:next,positions:result};
}

export function dropRect(metrics,x,y,size={colSpan:1,rowSpan:1},threshold=12){
 function axis(tracks,value,span){
  if(!tracks.length||value<tracks[0].start||value>tracks.at(-1).start+tracks.at(-1).length)return null;
  for(let i=0;i<tracks.length-1;i++){const boundary=(tracks[i].start+tracks[i].length+tracks[i+1].start)/2;if(Math.abs(value-boundary)<=Math.min(threshold,tracks[i].length/4,tracks[i+1].length/4))return {index:i,span:2,snap:true};}
  const index=tracks.findIndex(t=>value<t.start+t.length);return {index:index<0?tracks.length-1:index,span,snap:false};
 }
 const col=axis(metrics.cols,x,size.colSpan),row=axis(metrics.rows,y,size.rowSpan);if(!col||!row)return null;
 const snap=col.snap||row.snap;return {col:col.index,row:row.index,colSpan:snap?(col.snap?2:1):col.span,rowSpan:snap?(row.snap?2:1):row.span};
}
