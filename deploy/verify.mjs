import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { createHash } from 'node:crypto';

const base = resolve('ai-agent-takeover/bundle');
function checkArtifact(path, bytes) {
  assert.ok(/^(backend\/code\/worker\.js|(backend|web|telegram)\/wrangler\.json|(web|telegram)\/assets\/(?:[\w-]+\/)*[\w.-]+\.(?:html|js|css|wasm|webmanifest|png|ico|svg|woff2?))$/.test(path), `Unexpected release file: ${path}`);
  const text = bytes.toString('utf8');
  // Pattern checks are a backstop, not proof that arbitrary opaque secrets are absent.
  const sensitive = [
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,}|AKIA[A-Z0-9]{16})\b/,
    /["']?(?:JWT_SECRET|ADMIN_PASSWORDS|RESEND_TOKEN|TELEGRAM_BOT_TOKEN|CLOUDFLARE_API_TOKEN)["']?\s*[:=]\s*(?:["'][^"'\r\n]{4,}["']|\[\s*["'][^"'\r\n]+)/,
    /^\s*\/\/[#@] sourceMappingURL=/m
  ];
  assert.ok(!sensitive.some(rule => rule.test(text)), `Potential credential or debug content in ${path}`);
}
// Negative checks must fail without printing the synthetic credential values.
assert.throws(() => checkArtifact('backend/code/worker.js.map', Buffer.from('{}')));
assert.throws(() => checkArtifact('web/assets/.env', Buffer.from('x')));
for (const text of ['JWT_SECRET="ai-agent-synthetic-secret"', '-----BEGIN PRIVATE KEY-----', 'ghp_' + 'a'.repeat(36)]) {
  assert.throws(() => checkArtifact('backend/code/worker.js', Buffer.from(text)));
}
checkArtifact('backend/code/worker.js', Buffer.from('export default {}'));
const manifest = JSON.parse(readFileSync(resolve(base, 'manifest.json'), 'utf8'));
const entries = readdirSync(base, {recursive: true, withFileTypes: true});
assert.ok(entries.every(e => e.isFile() || e.isDirectory()), 'Links and special files are not release artifacts');
const actual = entries
  .filter(e => e.isFile()).map(e => relative(base, resolve(e.parentPath, e.name)).replaceAll('\\', '/'))
  .filter(p => p !== 'manifest.json').sort();
assert.deepEqual(actual, Object.keys(manifest.hashes).sort(), 'Bundle file set changed');
if (process.env.GITHUB_SHA) assert.equal(manifest.sourceCommit, process.env.GITHUB_SHA);
for (const [path, hash] of Object.entries(manifest.hashes)) {
  assert.ok(!relative(base, resolve(base, path)).startsWith('..'), 'Path escapes bundle');
  const bytes = readFileSync(resolve(base, path));
  checkArtifact(path, bytes);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), hash, path);
}
for (const [target, name, domain] of [
  ['backend', 'paloexiz-s-email-api', 'apimail.paloexiz.me'],
  ['web', 'paloexiz-s-email', 'mail.paloexiz.me'],
  ['telegram', 'paloexiz-s-email-telegrambot', 'miniapp-mail.paloexiz.me']
]) {
  const c = JSON.parse(readFileSync(resolve(base, target, 'wrangler.json'), 'utf8'));
  const expected = JSON.parse(readFileSync(`deploy/${target}.json`, 'utf8'));
  if (target === 'backend') Object.assign(expected, {main: './code/worker.js', no_bundle: true});
  else expected.assets.directory = './assets';
  assert.deepEqual(c, expected, `${target}: bundle differs from reviewed configuration`);
  assert.equal(c.name, name);
  assert.deepEqual(c.routes, [{pattern: domain, custom_domain: true}]);
  assert.equal(c.workers_dev, true);
  assert.equal(c.preview_urls, target === 'backend');
  assert.equal(c.compatibility_date, target === 'backend' ? '2025-06-14' : '2026-03-19');
  if (target === 'backend') {
    assert.equal(c.keep_vars, true);
    assert.deepEqual(c.compatibility_flags, ['nodejs_compat']);
    assert.deepEqual(c.observability, {enabled: true, head_sampling_rate: 1, logs: {enabled: true, head_sampling_rate: 1, persist: true, invocation_logs: true}, traces: {enabled: false, persist: true, head_sampling_rate: 1}});
    assert.equal(c.no_bundle, true);
    assert.equal(c.d1_databases[0].database_id, '5de99125-134f-43d9-9ffa-aed6b0b386ea');
    assert.equal(c.kv_namespaces[0].id, 'c8a4ba14c9494cffba23b0c171f92285');
    assert.deepEqual(c.vars, {ENABLE_MAIL_GZIP: false, ENABLE_MAIL_READ_STATUS: false});
  } else assert.equal(c.assets.not_found_handling, 'single-page-application');
}
console.log('Bundle file policy, credential patterns, hashes and complete local target configurations verified; live equivalence requires separate preflight.');
