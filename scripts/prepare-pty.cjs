const fs = require('node:fs');
const path = require('node:path');
const helper = path.join(path.dirname(require.resolve('node-pty/package.json')), 'prebuilds', process.platform + '-' + process.arch, 'spawn-helper');
if (fs.existsSync(helper)) fs.chmodSync(helper, 0o755);
