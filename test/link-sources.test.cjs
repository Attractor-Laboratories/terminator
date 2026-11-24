const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');const {sourceLinks}=require('../src/link-sources.cjs');
test('source links use exact message text and deduplicate artifact aliases',()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'links-')),file=path.join(dir,'session.jsonl');try{fs.writeFileSync(file,JSON.stringify({type:'assistant',message:{content:[{type:'text',text:'https://claude.ai/artifact/completeidZZZZZZZZZZZZ https://claude.ai/public/artifacts/completeidZZZZZZZZZZZZ/ http://localhost:3000/'}]}})+'\n'+JSON.stringify({type:'progress',data:'https://claude.ai/artifact/corruptZZZZZZZZZZZZZZZ'}));const links=sourceLinks(file);assert.equal(links.length,2);assert.ok(links.some(l=>l.url.includes('completeidZZZZZZZZZZZZ')));assert.ok(!links.some(l=>l.url.includes('corruptZZZZZZZZZZZZZZZ')));}finally{fs.rmSync(dir,{recursive:true});}});
test('only links visible in the chat are listed, in order of first appearance',()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'links-')),file=path.join(dir,'session.jsonl');try{const rows=[
 {type:'assistant',message:{content:[{type:'text',text:'First https://claude.ai/artifact/secondoneZZZZZZZZZZZZZ'},{type:'tool_use',input:{type_url:'https://claude.ai/artifact/toolinputZZZZZZZZZZZZZ'}}]}},
 {type:'user',message:{content:[{type:'tool_result',content:'type_url: https://claude.ai/artifact/catalogentryZZZZZZZZZZ'}]},toolUseResult:{url:'https://claude.ai/artifact/toolresultZZZZZZZZZZZZ'}},
 {type:'user',isMeta:true,message:{content:'https://claude.ai/artifact/metanoteZZZZZZZZZZZZZZ'}},
 {type:'user',message:{content:'see https://foo.chatgpt.site and https://claude.ai/artifact/secondoneZZZZZZZZZZZZZ again'}},
 {type:'response_item',payload:{type:'function_call_output',output:'https://claude.ai/artifact/codextoolZZZZZZZZZZZZZ'}},
 {type:'event_msg',payload:{type:'agent_message',message:'Done: https://claude.ai/artifact/codexreplyZZZZZZZZZZZZ'}},
];fs.writeFileSync(file,rows.map(r=>JSON.stringify(r)).join('\n'));assert.deepEqual(sourceLinks(file).map(l=>l.url),['https://claude.ai/artifact/secondoneZZZZZZZZZZZZZ','https://foo.chatgpt.site/','https://claude.ai/artifact/codexreplyZZZZZZZZZZZZ']);}finally{fs.rmSync(dir,{recursive:true});}});

test('pasted image sources become file links',()=>{const fs=require('node:fs'),os=require('node:os'),path=require('node:path');const {sourceLinks}=require('../src/link-sources.cjs');const dir=fs.mkdtempSync(path.join(os.tmpdir(),'links-'));const file=path.join(dir,'s.jsonl');
 fs.writeFileSync(file,[{type:'user',message:{content:[{type:'text',text:'[Image #1]'},{type:'image'}]}},{type:'api-request-blob',message:{content:[{type:'text',text:'[Image #1]'},{type:'text',text:'[Image: source: /Users/me/plot.png]'},{type:'text',text:'system stuff /Users/me/secret.png'}]}}].map(r=>JSON.stringify(r)).join('\n'));
 assert.deepEqual(sourceLinks(file).map(l=>l.path),['/Users/me/plot.png']);});
test('artifacts Claude published or opened count, listings and catalogs do not; bold links survive',()=>{const fs=require('node:fs'),os=require('node:os'),path=require('node:path');const {sourceLinks}=require('../src/link-sources.cjs');const dir=fs.mkdtempSync(path.join(os.tmpdir(),'links-'));const file=path.join(dir,'s.jsonl');
 const rows=[
  {type:'assistant',message:{content:[{type:'tool_use',id:'t1',name:'Artifact',input:{action:'list'}}]}},
  {type:'user',message:{content:[{type:'tool_result',tool_use_id:'t1',content:'https://claude.ai/artifact/listed1ZZZZZZZZZZZZZZZ'}]}},
  {type:'assistant',message:{content:[{type:'tool_use',id:'t2',name:'Artifact',input:{file_path:'/tmp/page.html'}}]}},
  {type:'user',message:{content:[{type:'tool_result',tool_use_id:'t2',content:[{type:'text',text:'Published /tmp/page.html at https://claude.ai/artifact/published1ZZZZZZZZZZZZ\nSee type https://claude.ai/artifact/typecatalogZZZZZZZZZZZ'}]}]}},
  {type:'assistant',message:{content:[{type:'text',text:'Here it is: **https://claude.ai/artifact/bold1ZZZZZZZZZZZZZZZZZ**.'},{type:'tool_use',id:'t3',name:'Artifact',input:{action:'open',url:'https://claude.ai/artifact/opened1ZZZZZZZZZZZZZZZ'}}]}},
  {type:'assistant',message:{content:[{type:'tool_use',id:'t4',name:'Artifact',input:{type_url:'https://claude.ai/artifact/type1ZZZZZZZZZZZZZZZZZ',title:'Deck'}}]}},
  {type:'user',message:{content:[{type:'tool_result',tool_use_id:'t4',content:'Type https://claude.ai/artifact/type1ZZZZZZZZZZZZZZZZZ created https://claude.ai/artifact/newdeck1ZZZZZZZZZZZZZZ'}]}},
 ];fs.writeFileSync(file,rows.map(r=>JSON.stringify(r)).join('\n'));
 assert.deepEqual(sourceLinks(file).map(l=>l.url),['https://claude.ai/artifact/published1ZZZZZZZZZZZZ','https://claude.ai/artifact/bold1ZZZZZZZZZZZZZZZZZ','https://claude.ai/artifact/opened1ZZZZZZZZZZZZZZZ','https://claude.ai/artifact/newdeck1ZZZZZZZZZZZZZZ']);});
