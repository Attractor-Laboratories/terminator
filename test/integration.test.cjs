const {test}=require('node:test');
const assert=require('node:assert/strict');
const net=require('node:net'), fs=require('node:fs'), os=require('node:os'), path=require('node:path');
const {spawn}=require('node:child_process');
const pty=require('node-pty');
test('Claude hook forwards lifecycle metadata over its local socket',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ts-hook-'));
 const socketPath=path.join(dir,'events.sock');
 const messages=[];
 const server=net.createServer(socket=>{let body='';socket.on('data',d=>body+=d);socket.on('end',()=>messages.push(JSON.parse(body)));});
 await new Promise(r=>server.listen(socketPath,r));
 try{
  for(const event of ['UserPromptSubmit','PermissionRequest','Stop']){
   const child=spawn(process.execPath,[path.resolve('integration/hook.cjs')],{env:{...process.env,TS_SOCKET:socketPath,TS_TERMINAL:'test-id',TS_TOKEN:'test-token'}});
   child.stdin.end(JSON.stringify({hook_event_name:event,session_id:'test-session',prompt:'private text'}));
   assert.equal(await new Promise(r=>child.on('exit',r)),0);
  }
  assert.deepEqual(messages.map(m=>m.event),['UserPromptSubmit','PermissionRequest','Stop']);
  assert.equal(messages[0].prompt,'private text');assert.equal(messages[1].prompt,undefined);
  assert.ok(messages.every(m=>m.id==='test-id'&&m.token==='test-token'));
 }finally{server.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('real zsh reports start, completion, and command exit code',{timeout:45000},async()=>{
 const shell=pty.spawn('/bin/zsh',['-l'],{cols:80,rows:24,cwd:'/private/tmp',env:{...process.env,ZDOTDIR:path.resolve('integration'),TS_INTEGRATION:path.resolve('integration'),TS_ORIGINAL_ZDOTDIR:'',TS_TOKEN:'integration-test'}});
 let output='';shell.onData(d=>output+=d);
 const until=async predicate=>{const end=Date.now()+35000;while(!predicate()){if(Date.now()>end)throw new Error('Shell lifecycle timed out');await new Promise(r=>setTimeout(r,50));}};
 try{
  await until(()=>output.includes(';done;0\x07'));output='';
  shell.write("printf 'INTEGRATION_OK\\n'; sleep 0.2; (exit 7)\r");
  await until(()=>output.includes(';done;7\x07'));
  assert.ok(output.includes(';running\x07'));assert.match(output,/INTEGRATION_OK/);
 }finally{shell.kill();}
});

test('status line reports actual model and effort without forwarding private fields',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ts-model-'));
 const socketPath=path.join(dir,'events.sock');let received;
 const server=net.createServer(socket=>{let body='';socket.on('data',d=>body+=d);socket.on('end',()=>received=JSON.parse(body));});
 await new Promise(r=>server.listen(socketPath,r));
 try{
  const child=spawn(process.execPath,[path.resolve('integration/hook.cjs'),'--statusline'],{env:{...process.env,TS_SOCKET:socketPath,TS_TERMINAL:'test-id',TS_TOKEN:'test-token'}});
  child.stdin.end(JSON.stringify({session_id:'test-session',model:{id:'claude-test-model',display_name:'Test model'},effort:{level:'high'},transcript_path:'/private/example',cost:{total_cost_usd:123}}));
  assert.equal(await new Promise(r=>child.on('exit',r)),0);
  assert.equal(received.event,'StatusLine');assert.equal(received.model,'claude-test-model');assert.equal(received.effort,'high');
  assert.equal(received.cost,undefined);assert.equal(received.transcript,'/private/example');
 }finally{server.close();fs.rmSync(dir,{recursive:true,force:true});}
});
