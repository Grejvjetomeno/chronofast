// Report what actually ships, raw and gzipped, so the README's size claim stays honest.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { gzipSync, brotliCompressSync } from 'node:zlib';

if (!existsSync('lib')) { console.error('lib/ not built - run `npm run build` first'); process.exit(1); }

const files = readdirSync('lib').filter((f) => f.endsWith('.js'));
if (!files.length) { console.error('no .js in lib/'); process.exit(1); }

let raw = 0, gz = 0, br = 0;
const rows = [];
for (const f of files.sort()) {
  const buf = readFileSync(`lib/${f}`);
  const g = gzipSync(buf, { level: 9 }).length;
  const b = brotliCompressSync(buf).length;
  raw += buf.length; gz += g; br += b;
  rows.push([f, buf.length, g, b]);
}
const kb = (n) => (n / 1024).toFixed(2) + ' kB';
const pad = (s, n) => String(s).padStart(n);

console.log('\n  file                 raw        gzip      brotli');
console.log('  ' + '-'.repeat(48));
for (const [f, r, g, b] of rows) {
  console.log(`  ${f.padEnd(14)} ${pad(kb(r), 9)} ${pad(kb(g), 11)} ${pad(kb(b), 11)}`);
}
console.log('  ' + '-'.repeat(48));
console.log(`  ${'TOTAL'.padEnd(14)} ${pad(kb(raw), 9)} ${pad(kb(gz), 11)} ${pad(kb(br), 11)}`);
console.log('\n  Note: unminified. A bundler minifying this will land well below the gzip figure.\n');
