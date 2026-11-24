export function promptLine(buffer,text,occurrence=0,after=false){
 const compact=value=>value.replace(/[\s\u200b-\u200d\ufeff]+/g,'');const needle=compact(text);if(!needle)return null;
 let content='';const map=[],columns=[],values=[];
 for(let i=0;i<buffer.length;i++){const line=buffer.getLine(i);const value=line?line.translateToString(!buffer.getLine(i+1)?.isWrapped):'';values[i]=value;for(let j=0;j<value.length;j++){if(!compact(value[j]))continue;content+=value[j];map.push(i);columns.push(j);}}
 const matches=[];let end=content.length;
 while(end>=0){const index=content.lastIndexOf(needle,end);if(index<0)break;const last=index+needle.length-1,startLine=map[index],endLine=map[last];const prefix=values[startLine].slice(0,columns[index]).trim(),suffix=values[endLine].slice(columns[last]+1).trim();if((!prefix||/^[❯›>]$/.test(prefix))&&!suffix)matches.push({start:startLine,end:endLine,marked:!!prefix});end=index-1;}
 const marked=matches.filter(m=>m.marked),match=(marked.length?marked:matches)[occurrence];return match?(after?match.end+1:match.start):null;
}
