const {test}=require('node:test');
const assert=require('node:assert/strict');
const {menuTemplate,createMenuBar}=require('../src/menu-bar.cjs');
const workspace={id:'w',goals:[{id:'g',text:'Finish\nthe work',progress:40}]};
const sessions=[{id:'a',workspaceId:'w',title:'First',model:'private-model',links:[{url:'https://example.com'}]}, {id:'b',workspaceId:'w',title:'Second'}, {id:'c',workspaceId:'other',title:'Other'}];
test('menu follows sidebar order, filters stale entries, and opens the correct record',()=>{
 const actions=[];
 const menu=menuTemplate({workspace,sessions,order:{priority:['b','b','stale','c'],rest:['b','a']},selected:'b'},a=>actions.push(a));
 assert.deepEqual(menu.filter(i=>i.label).map(i=>i.label),['Goals','Finish the work · 40%','Priority','1. Second','Rest','First']);
 assert.equal(menu.find(i=>i.label==='1. Second').checked,true);
 menu[1].click();menu.find(i=>i.label==='1. Second').click();
 assert.deepEqual(actions,[{kind:'goal',id:'g',workspaceId:'w'},{kind:'terminal',id:'b',workspaceId:'w'}]);
 assert.doesNotMatch(JSON.stringify(menu),/private-model|example.com/);
});
test('empty workspace retains all three sections',()=>{
 assert.deepEqual(menuTemplate({sessions:[]},()=>{}).filter(i=>i.label).map(i=>i.label),['Goals','—','Priority','—','Rest','—']);
});
test('each tray click reads fresh content and uses a template icon',()=>{
 let latest={workspace,sessions},lastMenu,template=false,bitmap;
 class Tray {on(name,fn){this[name]=fn;}setToolTip(value){this.tooltip=value;}popUpContextMenu(menu){lastMenu=menu;}}
 const tray=createMenuBar({Tray,Menu:{buildFromTemplate:m=>m},nativeImage:{createFromBitmap:(data,options)=>{bitmap={data,options};return {setTemplateImage:v=>template=v};}}},()=>latest,()=>{});
 tray.click();assert.ok(lastMenu.some(i=>i.label==='First'));
 latest={workspace:{id:'w',goals:[]},sessions:[]};tray['right-click']();
 assert.ok(!lastMenu.some(i=>i.label==='First'));assert.equal(template,true);
 assert.equal(bitmap.options.scaleFactor,2);assert.equal(bitmap.data.length,36*36*4);assert.ok(bitmap.data.some(v=>v===255));
});

test('menu lists every open workspace with its own terminals and switches on click',()=>{
 const actions=[];const workspaces=[{id:'w1',title:'Research'},{id:'w2',title:'Satie',goals:[{id:'g',text:'Ship',progress:40}]},{id:'w3',title:'Old',archived:true}];
 const sessions=[{id:'a',title:'Alpha',workspaceId:'w1'},{id:'b',title:'Beta',workspaceId:'w2'},{id:'c',title:'Gamma',workspaceId:'w2'}];
 const menu=menuTemplate({workspace:workspaces[0],sessions,order:{},selected:'a',workspaces,orders:{w2:{priority:['c']}}},a=>actions.push(a));
 const labels=menu.map(i=>i.label);assert.equal(labels[0],'Workspaces');assert.ok(labels.includes('✓ Research  (1)'));assert.ok(labels.some(l=>/^\s+Satie  \(2\)$/.test(l||'')));assert.ok(!labels.some(l=>/Old/.test(l||'')));
 const satie=menu.find(i=>/Satie/.test(i.label||''));satie.submenu[0].click();assert.deepEqual(actions.at(-1),{kind:'workspace',workspaceId:'w2'});
 const sub=satie.submenu.map(i=>i.label);assert.ok(sub.includes('1. Gamma')&&sub.includes('Beta')&&sub.some(l=>/Ship · 40%/.test(l||'')));
 satie.submenu.find(i=>i.label==='Beta').click();assert.deepEqual(actions.at(-1),{kind:'terminal',id:'b',workspaceId:'w2'});
 // the current workspace's terminals stay directly in the menu too
 assert.ok(labels.includes('Alpha'));
});
