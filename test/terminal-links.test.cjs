const test=require('node:test'),assert=require('node:assert/strict');const {extractLinks,supportedLink}=require('../src/terminal-links.cjs');
test('extracts exact supported hosts and deduplicates colored URLs',()=>{const links=extractLinks('\x1b[32mhttps://demo.user.chatgpt.site/\x1b[0m https://demo.user.chatgpt.site/ https://claude.ai/public/artifacts/abc123ZZZZZZZZZZZZZZZZ');assert.equal(links.length,2);assert.equal(links[0].label,'demo.user');});
test('rejects unrelated and deceptive domains and strips URL secrets',()=>{for(const u of ['https://chatgpt.site.evil.com/','https://claude.ai.evil.com/artifacts/abc','https://claude.ai/chat/abc','https://user:password@demo.chatgpt.site/'])assert.equal(supportedLink(u),null);assert.equal(supportedLink('https://demo.chatgpt.site/?token=secret').url,'https://demo.chatgpt.site/');});
test('extracts localhost IPv4 and IPv6 links without accepting lookalike hosts',()=>{const links=extractLinks('http://localhost:3000/app http://127.0.0.1:8080/ https://[::1]:8443/test http://[::1]');assert.equal(links.length,4);assert.equal(links[0].label,'localhost:3000/app');for(const url of ['http://localhost.evil.com','http://127.0.0.1.evil.com','http://example.com'])assert.equal(supportedLink(url),null);});
test('deduplicates artifact aliases and trailing slashes',()=>{assert.equal(extractLinks('https://claude.ai/artifact/abcZZZZZZZZZZZZZZZZZZZ https://claude.ai/public/artifacts/abcZZZZZZZZZZZZZZZZZZZ/').length,1);assert.equal(extractLinks('http://localhost:3000/app http://localhost:3000/app/').length,1);});
test('local files a browser can show are extracted in order of appearance',()=>{const {extractLinks}=require('../src/terminal-links.cjs');const os=require('node:os');
 const text='See https://claude.ai/artifact/abc12345ZZZZZZZZZZZZZZ then [Image: source: /Users/me/exp/output/wer-heatmap.png] and `output/report.pdf`, ~/Desktop/clip.mp4, file:///tmp/a%20b.html. Not: notes.md, image.png (no folder), https://x.com/pic.png, run.py, /etc/hosts';
 const links=extractLinks(text,{cwd:'/Users/me/exp',files:true});
 assert.deepEqual(links.map(l=>l.file?l.path:l.url),['https://claude.ai/artifact/abc12345ZZZZZZZZZZZZZZ','/Users/me/exp/output/wer-heatmap.png','/Users/me/exp/output/report.pdf',os.homedir()+'/Desktop/clip.mp4','/tmp/a b.html']);
 assert.equal(links[1].label,'wer-heatmap.png');assert.equal(links[1].url,'file:///Users/me/exp/output/wer-heatmap.png');
 assert.deepEqual(extractLinks(text).map(l=>l.url),['https://claude.ai/artifact/abc12345ZZZZZZZZZZZZZZ'],'files only when asked');
 assert.equal(extractLinks('output/x.png',{files:true}).length,0,'relative paths need a folder to resolve against');});

test('artifact ids glued to following text are cut to the 22-character id; truncated ids are dropped', () => {
  const {extractLinks} = require('../src/terminal-links.cjs');
  const links = extractLinks('see https://claude.ai/artifact/1d4wH1f6yTeDfKRDbyXbWuice-landsca and https://claude.ai/artifact/1canHRestored and https://claude.ai/public/artifacts/0b6f1c1e-1234-4abc-8def-0123456789ab');
  assert.deepEqual(links.map(l => l.url), ['https://claude.ai/artifact/1d4wH1f6yTeDfKRDbyXbWu', 'https://claude.ai/public/artifacts/0b6f1c1e-1234-4abc-8def-0123456789ab']);
});
