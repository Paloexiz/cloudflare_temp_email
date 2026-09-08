// Local build only: no Cloudflare credentials or deployment command without --dry-run.
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, readdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, 'ai-agent-takeover');
const wrangler = join(root, 'worker/node_modules/wrangler/bin/wrangler.js');
const vite = join(root, 'frontend/node_modules/vite/bin/vite.js');
const env = { ...process.env, CI: 'true', WRANGLER_SEND_METRICS: 'false' };
for (const key of Object.keys(env)) {
  if (/^(CLOUDFLARE_|CF_API_|VITE_)/.test(key)) delete env[key];
}
function run(script, args, cwd) {
  execFileSync(process.execPath, [script, ...args], { cwd: join(root, cwd), env, stdio: 'inherit' });
}
assert.equal(process.versions.node, '24.15.0', 'Use Node 24.15.0, matching CI');
for (const name of ['.env', '.env.local', '.env.prod', '.env.prod.local']) {
  assert.ok(!existsSync(join(root, 'frontend', name)), `Remove local build input frontend/${name} before preparing release artifacts`);
}
// Only this script's named output directory is replaceable; never accept a caller-supplied path.
assert.equal(output, resolve(root, 'ai-agent-takeover'));
rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });
run(wrangler, ['deploy', '--config', '../deploy/backend.json', '--dry-run', '--minify', '--outdir', join(output, 'backend')], 'worker');
Object.assign(env, { VITE_API_BASE: 'https://apimail.paloexiz.me', VITE_DEFAULT_LANG: 'zh', VITE_CF_WEB_ANALY_TOKEN: '' });
for (const target of ['web', 'telegram']) {
  env.VITE_IS_TELEGRAM = String(target === 'telegram');
  run(vite, ['build', '--mode', 'prod', '--outDir', join(output, target), '--emptyOutDir'], 'frontend');
  assert.ok(readFileSync(join(output, target, 'index.html'), 'utf8').includes('id="app"'));
  run(wrangler, ['deploy', '--config', `../deploy/${target}.json`, '--dry-run'], 'worker');
}
// Package the exact tested files; the publish job never invokes Vite or re-bundles.
const bundle = join(output, 'bundle');
for (const target of ['backend', 'web', 'telegram']) {
  const dir = join(bundle, target);
  mkdirSync(dir, { recursive: true });
  if (target === 'backend') {
    mkdirSync(join(dir, 'code'));
    const code = readFileSync(join(output, target, 'worker.js'), 'utf8').replace(/^\/\/# sourceMappingURL=.*$/gm, '');
    writeFileSync(join(dir, 'code/worker.js'), code);
  } else cpSync(join(output, target), join(dir, 'assets'), { recursive: true });
  const config = JSON.parse(readFileSync(join(root, 'deploy', `${target}.json`), 'utf8'));
  if (target === 'backend') {
    config.main = './code/worker.js';
    config.no_bundle = true;
    assert.ok(readFileSync(join(dir, 'code/worker.js')).length > 0);
  } else config.assets.directory = './assets';
  writeFileSync(join(dir, 'wrangler.json'), JSON.stringify(config, null, 2) + '\n');
  run(wrangler, ['deploy', '--config', join(dir, 'wrangler.json'), '--dry-run'], 'worker');
}
function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)]);
}
const hashes = Object.fromEntries(files(bundle).filter(p => !p.endsWith('manifest.json')).sort().map(p => [
  p.slice(bundle.length + 1).replaceAll('\\', '/'), createHash('sha256').update(readFileSync(p)).digest('hex')
]));
writeFileSync(join(bundle, 'manifest.json'), JSON.stringify({
  sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  node: process.versions.node, hashes
}, null, 2) + '\n');
console.log('Prepared three Workers without publishing. Run node deploy/rehearse.mjs next.');
