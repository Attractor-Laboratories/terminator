const test=require('node:test'),assert=require('node:assert/strict');const {cleanPrompt,isSystemPrompt,lastRealPrompt}=require('../src/prompt-text.cjs');
test('background-task notifications and system reminders are not prompts',()=>{
 const note='<task-notification>\n<task-id>b5gzyltlu</task-id>\n<tool-use-id>toolu_01DP5EWgJKhbz72PdM2JrhfA</tool-use-id>\n<status>completed</status>\n<summary>Background command finished</summary>\n</task-notification>';
 assert.equal(isSystemPrompt(note),true);assert.equal(isSystemPrompt('<system-reminder>x</system-reminder>\n'),true);assert.equal(isSystemPrompt('fix the map'),false);
 assert.equal(cleanPrompt(note+'\nnow make it blue'),'now make it blue');
});
test('pasted-content markup is removed, its text kept',()=>{assert.equal(cleanPrompt('<pasted_content id="3aea">\nhello world\n</pasted_content id="3aea">\nok?'),'hello world\nok?');});
test('the latest real prompt skips system ones',()=>{assert.equal(lastRealPrompt(['make a map','<task-notification><task-id>x</task-id></task-notification>'],'<task-notification>y</task-notification>'),'make a map');assert.equal(lastRealPrompt([],''),null);});
