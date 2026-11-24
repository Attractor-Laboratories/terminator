const test=require('node:test'),assert=require('node:assert/strict');
const buffer=lines=>({length:lines.length,getLine:i=>lines[i]&&{isWrapped:!!lines[i][1],translateToString:trim=>trim?lines[i][0].trimEnd():lines[i][0]}});
test('finds wrapped and repeated prompts at their original lines',async()=>{const {promptLine}=await import('../src/prompt-location.mjs');const b=buffer([['hello world'],['output'],['hello '],['world',true]]);assert.equal(promptLine(b,'hello world'),2);assert.equal(promptLine(b,'hello world',1),0);assert.equal(promptLine(b,'missing'),null);});

test('navigation can start immediately after the prompt',async()=>{const {promptLine}=await import('../src/prompt-location.mjs');assert.equal(promptLine(buffer([['hello '],['world',true],['answer']]),'hello world',0,true),2);});

test('preserves word spaces at a real trimmed soft wrap',async()=>{const {promptLine}=await import('../src/prompt-location.mjs');const b=buffer([['hello '],['world',true],['answer   ']]);assert.equal(promptLine(b,'hello world'),0);assert.equal(promptLine(b,'hello world',0,true),2);assert.equal(promptLine(b,'hello world',1),null);});
test('matches Claude prompt text across indentation and inserted wrap spaces',async()=>{const {promptLine}=await import('../src/prompt-location.mjs');assert.equal(promptLine(buffer([['❯ Fix the termi   '],['   nal view',true],['answer']]),'Fix the terminal view'),0);});
test('short prompts never match inside words or longer lines',async()=>{const {promptLine}=await import('../src/prompt-location.mjs');const b=buffer([['❯ hi'],['which website should we edit?'],['history'],['❯ website edits']]);assert.equal(promptLine(b,'hi'),0);assert.equal(promptLine(b,'hi',0,true),1);assert.equal(promptLine(b,'website'),null);});
