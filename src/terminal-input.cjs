// Terminal query replies and focus reports do not modify an input draft.
function isTerminalReport(data){
 return typeof data==='string'&&data.length>0&&data.replace(/\x1b\[<[\d;]*[Mm]|\x1b\[M[\s\S]{3}|\x1b\[[?>=]?[\d;:]*[Rcnty]|\x1b\[[IO]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g,'')==='';
}
module.exports={isTerminalReport};
// Track the editable draft, rather than treating every key as permanent input.
function trackInput(s,data,now=Date.now()){
 data=data.replace(/\x1b\[<[\d;]*[Mm]|\x1b\[M[\s\S]{3}/g,'');
 if(!data||isTerminalReport(data))return;
 if(data==='\x1b'||data==='\x1b\x1b'){if(data==='\x1b\x1b'||now-(s.lastEscapeAt||0)<1000){s.lastEscapeAt=0;s.inputDraft='';s.inputCursor=0;s.inputUnknown=false;s.manualInput=false;}else s.lastEscapeAt=now;return;}
 let text=s.inputDraft||'',cursor=s.inputCursor??text.length;
 for(let i=0;i<data.length;i++){
  const c=data[i];
  if(c==='\x1b'){const sequence=data.slice(i).match(/^\x1b\[[0-9;?]*[A-Za-z~]/);if(sequence){const code=sequence[0];if(code==='\x1b[A'||code==='\x1b[B')s.inputUnknown=true;if(code==='\x1b[3~')text=text.slice(0,cursor)+text.slice(cursor+1);if(code==='\x1b[H')cursor=0;if(code==='\x1b[F')cursor=text.length;if(code==='\x1b[D')cursor=Math.max(0,cursor-1);if(code==='\x1b[C')cursor=Math.min(text.length,cursor+1);if(code==='\x1b[200~')s.inputPasting=true;if(code==='\x1b[201~')s.inputPasting=false;i+=code.length-1;}continue;}
  if((c==='\r'||c==='\n')&&!s.inputPasting){text='';cursor=0;s.inputUnknown=false;s.inputPendingUntil=now+1500;continue;}
  if(c==='\x03'||c==='\x15'){text='';cursor=0;s.inputUnknown=false;continue;}
  if(c==='\x01'){cursor=0;continue;}if(c==='\x05'){cursor=text.length;continue;}
  if(c==='\x7f'||c==='\b'){if(cursor){text=text.slice(0,cursor-1)+text.slice(cursor);cursor--;}continue;}
  if(c==='\x17'){const before=text.slice(0,cursor),trimmed=before.replace(/\s*\S+\s*$/,'');text=trimmed+text.slice(cursor);cursor=trimmed.length;continue;}
  if(c==='\x0b'){text=text.slice(0,cursor);continue;}
  if(c>=' '||s.inputPasting&&(c==='\n'||c==='\r')){text=text.slice(0,cursor)+c+text.slice(cursor);cursor++;}
 }
 s.inputDraft=text;s.inputCursor=cursor;s.manualInput=!!text||!!s.inputUnknown;
}
function clearInput(s){s.inputDraft='';s.inputCursor=0;s.inputUnknown=false;s.manualInput=false;s.inputPendingUntil=0;}
module.exports.trackInput=trackInput;module.exports.clearInput=clearInput;
