import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

// Run with node deploy/publish-workflow.test.mjs; Windows requires Git Bash.
const workflow = readFileSync(new URL('../.github/workflows/publish.yaml', import.meta.url), 'utf8');
const script = workflow.split('        run: |\n').at(-1).replace(/^          /gm, '');
assert.match(workflow, /default: all/);
const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
// Stub only Wrangler: exercise the actual workflow shell without credentials or deployment.
const stub = `node() {
  printf '%s\\n' "$4"
  if [[ "$4" == *"/$FAIL_TARGET/"* && -n "$FAIL_TARGET" ]]; then return 7; fi
  return 0
}\n`;
function run(target, failTarget = '', token = 'synthetic-test-token') {
  const result = spawnSync(bash, ['--noprofile', '--norc', '-eo', 'pipefail', '-c', stub + script], {
    encoding: 'utf8',
    env: { ...process.env, TARGET: target, FAIL_TARGET: failTarget,
      CLOUDFLARE_ACCOUNT_ID: 'synthetic-account', CLOUDFLARE_API_TOKEN: token },
  });
  if (result.error) throw result.error;
  return { status: result.status, targets: [...result.stdout.matchAll(/bundle\/(backend|web|telegram)\/wrangler.json/g)].map(m => m[1]) };
}
assert.deepEqual(run('all'), { status: 0, targets: ['backend', 'web', 'telegram'] });
for (const target of ['backend', 'web', 'telegram']) {
  assert.deepEqual(run(target), { status: 0, targets: [target] });
}
assert.deepEqual(run('invalid'), { status: 1, targets: [] });
assert.deepEqual(run('all', '', ''), { status: 1, targets: [] });
assert.deepEqual(run('all', 'web'), { status: 7, targets: ['backend', 'web'] });
console.log('PASS: all targets, individual targets, invalid input, missing token, stop on failure');
