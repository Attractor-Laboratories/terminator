const {stripVTControlCharacters}=require('node:util');
// claude.ai artifact ids are 22 letters/digits (public ones are UUIDs). Text glued to the end on screen
// ("…/artifact/1d4wH1f6yTeDfKRDbyXbWuice-landsca") is cut off; a shorter id is a wrapped or truncated link and is dropped.
function artifactId(raw){const uuid=raw.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);if(uuid)return uuid[0];const m=raw.match(/^[A-Za-z0-9]{22}/);return m?m[0]:null;}
function supportedLink(value){try{const u=new URL(value);if(!['http:','https:'].includes(u.protocol)||u.username||u.password)return null;const local=['localhost','127.0.0.1','[::1]'].includes(u.hostname);if(u.protocol!=='https:'&&!local)return null;const site=u.hostname.endsWith('.chatgpt.site');const artifact=u.hostname==='claude.ai'&&/^\/(?:public\/)?artifacts?\/[a-zA-Z0-9-]+\/?$/.test(u.pathname);if(artifact){const id=artifactId(u.pathname.replace(/\/+$/,'').split('/').at(-1));if(!id)return null;u.pathname=u.pathname.replace(/[^/]+\/?$/,id);}if(!site&&!artifact&&!local)return null;u.search='';u.hash='';if(u.pathname!=='/')u.pathname=u.pathname.replace(/\/+$/,'');return {url:u.href,label:local?u.host+(u.pathname==='/'?'':u.pathname):site?u.hostname.replace(/\.chatgpt\.site$/,''): 'Claude · '+u.pathname.split('/').filter(Boolean).at(-1).slice(0,8)};}catch{return null;}}
// Local files a browser can show (images, PDFs, pages, media) mentioned in the chat, e.g. "[Image: source: /Users/…/plot.png]".
const path=require('node:path'),os=require('node:os'),{pathToFileURL}=require('node:url');
const FILE_TYPES=/\.(?:png|jpe?g|gif|webp|svg|bmp|tiff?|heic|avif|pdf|html?|mp4|mov|m4v|webm|wav|mp3|m4a|aac|flac|ogg)$/i;
const FILE_PATTERN=/(?<![\w:/.~%@+-])(?:file:\/\/)?(?:~\/|\.{1,2}\/|\/)?(?:[\w.@%+-]+\/)*[\w.@%+-]+\.(?:png|jpe?g|gif|webp|svg|bmp|tiff?|heic|avif|pdf|html?|mp4|mov|m4v|webm|wav|mp3|m4a|aac|flac|ogg)(?![\w/-])/gi;
function fileLink(raw,cwd){let p=raw;
 if(p.startsWith('file://')){try{p=decodeURIComponent(new URL(p).pathname);}catch{return null;}}
 if(p.startsWith('~/'))p=path.join(os.homedir(),p.slice(2));
 else if(!p.startsWith('/')){if(!cwd||!p.includes('/'))return null;p=path.resolve(cwd,p);}
 p=path.normalize(p);if(!FILE_TYPES.test(p))return null;
 return {url:pathToFileURL(p).href,label:path.basename(p),path:p,file:true};}
function extractLinks(output,{cwd=null,files=false}={}){const plain=stripVTControlCharacters(output),found=[];
 for(const m of plain.matchAll(/https?:\/\/[^\s<>"'`\x00-\x1f]+/g)){const value=m[0].replace(/[),.;:!?*_~}]+$/,'').replace(/\](?=[^\[]*$)/g,(bracket,offset,whole)=>whole.includes('://[')&&offset===whole.indexOf(']')?bracket:'');const link=supportedLink(value);if(link)found.push([m.index,link]);}
 if(files)for(const m of plain.matchAll(FILE_PATTERN)){const link=fileLink(m[0],cwd);if(link)found.push([m.index,link]);}
 const links=new Map();for(const [,link] of found.sort((a,b)=>a[0]-b[0])){const key=linkKey(link);if(!links.has(key))links.set(key,link);}return [...links.values()];}
module.exports={extractLinks,supportedLink,fileLink,artifactId};

function linkKey(link){if(link.file)return 'file:'+link.path;const u=new URL(link.url);return u.hostname==='claude.ai'?'claude-artifact:'+u.pathname.split('/').at(-1):u.href;}
module.exports.linkKey=linkKey;
