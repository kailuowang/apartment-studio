#!/usr/bin/env node
import { readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');
const docsDir = path.join(root, 'docs');
const tmpBundle = path.join(root, 'model', '_studio_bundle.tmp.js');
const outHtml = path.join(root, 'apartment_studio.html');
const docsIndexHtml = path.join(docsDir, 'index.html');
const docsStudioHtml = path.join(docsDir, 'apartment_studio.html');

await build({
  entryPoints: [path.join(root, 'src', 'studio.js')],
  bundle: true,
  minify: true,
  format: 'iife',
  target: ['es2022'],
  outfile: tmpBundle,
});

// Verify JS syntax cleanly with node --check
execFileSync('node', ['--check', tmpBundle], { stdio: 'inherit' });

const jsBundle = readFileSync(tmpBundle, 'utf8').replace(/<\/script/gi, '<\\/script');
unlinkSync(tmpBundle);

const specJson = readFileSync(path.join(root, 'model', 'apartment_spec.json'), 'utf8')
  .replace(/<\/script/gi, '<\\/script');
const glbBase64 = readFileSync(path.join(root, 'model', 'apartment_exact.glb')).toString('base64');
const fpBase64 = readFileSync(path.join(root, 'floorplan.jpeg')).toString('base64');

let html = readFileSync(path.join(root, 'src', 'template.html'), 'utf8');
html = html.split('__EMBED_SPEC__').join(specJson);
html = html.split('__EMBED_GLB__').join(glbBase64);
html = html.split('__EMBED_FLOORPLAN__').join(fpBase64);
html = html.split('__EMBED_BUNDLE__').join(jsBundle);

mkdirSync(docsDir, { recursive: true });
writeFileSync(outHtml, html, 'utf8');
writeFileSync(docsIndexHtml, html, 'utf8');
writeFileSync(docsStudioHtml, html, 'utf8');
writeFileSync(path.join(docsDir, '.nojekyll'), '', 'utf8');

console.log(`Built ${outHtml}, ${docsIndexHtml}, and ${docsStudioHtml} (${html.length.toLocaleString()} bytes)`);
console.log(`Embedded payloads: spec=${specJson.length} B, glb_b64=${glbBase64.length} B, floorplan_b64=${fpBase64.length} B, js=${jsBundle.length} B`);
