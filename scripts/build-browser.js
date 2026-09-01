// Minified single-file builds for direct browser use (CDN, <script type="module">).
//
// lib/ deliberately stays UNMINIFIED: bundlers minify anyway, and shipping readable code
// keeps stack traces and tree-shaking useful. These bundles are for people who are not
// running a bundler at all.
//
// Target is ES2020, not ES2022 - the emitted syntax needs nothing newer than ES2015, and a
// lower target costs nothing here while widening the range of engines that can at least
// reach the legacy Intl fallback.
import { build } from 'esbuild';
import { readFileSync, statSync } from 'node:fs';
import { gzipSync, brotliCompressSync } from 'node:zlib';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const banner = `/*! chronofast v${pkg.version} | MIT | https://github.com/brunolau/chronofast */`;

const targets = [
  { format: 'esm', outfile: 'browser/chronofast.min.js', label: 'ESM  (import)' },
  { format: 'iife', globalName: 'chronofast', outfile: 'browser/chronofast.global.min.js', label: 'IIFE (window.chronofast)' },
];

for (const t of targets) {
  await build({
    entryPoints: ['lib/index.js'],
    bundle: true,
    minify: true,
    target: ['es2020'],
    platform: 'browser',
    legalComments: 'none',
    banner: { js: banner },
    format: t.format,
    ...(t.globalName ? { globalName: t.globalName } : {}),
    outfile: t.outfile,
  });
}

const kb = (n) => (n / 1024).toFixed(2) + ' kB';
console.log('\n  browser bundles (minified)\n');
console.log('  ' + 'file'.padEnd(34) + 'raw'.padStart(10) + 'gzip'.padStart(11) + 'brotli'.padStart(11));
console.log('  ' + '-'.repeat(66));
for (const t of targets) {
  const buf = readFileSync(t.outfile);
  console.log('  ' + t.outfile.padEnd(34) + kb(statSync(t.outfile).size).padStart(10) +
              kb(gzipSync(buf, { level: 9 }).length).padStart(11) +
              kb(brotliCompressSync(buf).length).padStart(11) + '   ' + t.label);
}
console.log('');
