const fs = require('node:fs');
fs.mkdirSync('dist',{recursive:true});
require('esbuild').buildSync({entryPoints:['src/renderer.js'],bundle:true,outfile:'dist/renderer.js',loader:{'.css':'css'},minify:false,sourcemap:true});
fs.copyFileSync('src/index.html','dist/index.html');
// Phone version (served by src/phone-server.cjs).
require('esbuild').buildSync({entryPoints:['src/mobile/mobile.js'],bundle:true,outfile:'dist/mobile.js',minify:true,target:['safari16']});
require('esbuild').buildSync({entryPoints:['src/mobile/mobile.css'],bundle:true,outfile:'dist/mobile.css',minify:true});
fs.copyFileSync('src/mobile/mobile.html','dist/mobile.html');
fs.copyFileSync('assets/Terminator.png','dist/icon.png');
fs.writeFileSync('dist/manifest.webmanifest',JSON.stringify({name:'Terminator',short_name:'Terminator',start_url:'./',scope:'./',display:'standalone',background_color:'#fafafa',theme_color:'#fafafa',icons:[{src:'icon.png',sizes:'1024x1024',type:'image/png',purpose:'any'}]}));
