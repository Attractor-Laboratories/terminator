const {test}=require('node:test'),assert=require('node:assert/strict');const {palette,unusedColor}=require('../src/colors.cjs');
test('new terminals skip occupied colors and reuse freed colors',()=>{assert.equal(unusedColor([palette[0],palette[2]],palette[0]),palette[1]);assert.equal(unusedColor([palette[1]]),palette[0]);});
test('additional colors remain unique after the full palette is used',()=>{const used=[...palette];for(let i=0;i<150;i++){const next=unusedColor(used);assert.match(next,/^#[0-9a-f]{6}$/);assert.equal(used.includes(next),false);used.push(next);}});
