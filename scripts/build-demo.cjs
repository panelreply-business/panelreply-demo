'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const filename = path.join(root, 'index.html');
const original = fs.readFileSync(filename, 'utf8');
const script = '\n' + ['src/intake.js', 'src/demo.js']
  .map(file => fs.readFileSync(path.join(root, file), 'utf8').trim()).join('\n\n') + '\n';
if (/<\/script/i.test(script)) throw new Error('Source must not contain an HTML script closing tag');
if ((original.match(/<script>/g) || []).length !== 1) throw new Error('Expected one generated inline script');
const style = original.match(/<style>([\s\S]*?)<\/style>/);
if (!style) throw new Error('Missing inline stylesheet');
const hash = value => crypto.createHash('sha256').update(value).digest('base64');
const generated = original.replace(/<script>[\s\S]*?<\/script>/, () => '<script>' + script + '</script>')
  .replace(/script-src 'sha256-[^']+'/g, "script-src 'sha256-" + hash(script) + "'")
  .replace(/style-src 'sha256-[^']+'/g, "style-src 'sha256-" + hash(style[1]) + "'");
if (process.argv.includes('--check')) {
  if (generated !== original) {
    process.stderr.write('index.html is out of date. Run node scripts/build-demo.cjs.\n');
    process.exitCode = 1;
  } else process.stdout.write('Generated demo and CSP hashes match source.\n');
} else {
  fs.writeFileSync(filename, generated);
  process.stdout.write('Built index.html with matching CSP hashes.\n');
}
