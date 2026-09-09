import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, realpathSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash, createHmac } from 'node:crypto';

// Reuse Wrangler's installed simulator, not a separate test framework.
const wranglerRequire = createRequire(realpathSync('worker/node_modules/wrangler/package.json'));
const { Miniflare, convertV4MiniflareOptions } = wranglerRequire('miniflare');
const sent = [];
const runtimeLogs = [];
const password = 'ai-agent-synthetic-password';
const secret = 'ai-agent-synthetic-jwt';
const hash = s => createHash('sha256').update(s).digest('hex');
const token = payload => {
  const content = [ {alg: 'HS256', typ: 'JWT'}, payload ].map(v => Buffer.from(JSON.stringify(v)).toString('base64url')).join('.');
  return content + '.' + createHmac('sha256', secret).update(content).digest('base64url');
};
const mf = new Miniflare(convertV4MiniflareOptions({
  modulesRoot: resolve('ai-agent-takeover/bundle/backend/code'),
  modules: [
    {type: 'ESModule', path: resolve('ai-agent-takeover/bundle/backend/code/worker.js')},
    ...readdirSync('ai-agent-takeover/bundle/backend/code').filter(name => name.endsWith('.wasm'))
      .map(name => ({type: 'CompiledWasm', path: resolve('ai-agent-takeover/bundle/backend/code', name)}))
  ],
  handleStructuredLogs: log => runtimeLogs.push(JSON.stringify(log)),
  compatibilityDate: '2025-06-14', compatibilityFlags: ['nodejs_compat'],
  d1Databases: ['DB'], kvNamespaces: ['KV'],
  bindings: { JWT_SECRET: secret, DOMAINS: ['test.example.com'], DEFAULT_DOMAINS: ['test.example.com'],
    ADMIN_PASSWORDS: JSON.stringify([password]), ENABLE_USER_CREATE_EMAIL: true,
    ENABLE_USER_DELETE_EMAIL: true, ENABLE_MAIL_GZIP: false, ENABLE_MAIL_READ_STATUS: false,
    E2E_TEST_MODE: true, RESEND_TOKEN: 'ai-agent-fake-resend-token', DEFAULT_SEND_BALANCE: 10 },
  outboundService: request => {
    const url = new URL(request.url);
    assert.equal(url.hostname, 'api.resend.com', 'Unexpected external request is blocked');
    assert.equal(url.pathname, '/emails');
    sent.push(request.url);
    return new Response(JSON.stringify({id: 'ai-agent-mocked-send'}), {headers: {'content-type': 'application/json'}});
  }
}));
const admin = {'x-admin-auth': password};
const mailbox = 'legacy@test.example.com';
const jwt = token({address: mailbox, address_id: 1}); // Old mailbox tokens may have no exp.
const mailboxHeaders = {Authorization: `Bearer ${jwt}`};
const userHeaders = {'x-user-token': token({user_id: 1, exp: Math.floor(Date.now()/1000)+3600})};
const raw = 'From: sender@test.example.com\r\nTo: legacy@test.example.com\r\nSubject: Synthetic legacy mail\r\nMessage-ID: <legacy@test>\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nLegacy body preserved.';
const checks = [];
async function call(path, {method = 'GET', headers = admin, body, status = 200} = {}) {
  const r = await mf.dispatchFetch(`http://localhost${path}`, {method, headers: {...headers, 'content-type': 'application/json'}, body: body === undefined ? undefined : JSON.stringify(body)});
  const text = await r.text();
  assert.equal(r.status, status, `${method} ${path}: ${text}`);
  return text ? (r.headers.get('content-type')?.includes('application/json') ? JSON.parse(text) : text) : null;
}
try {
  const db = await mf.getD1Database('DB');
  await db.exec(readFileSync('deploy/schema-v0.0.6.sql', 'utf8').split('\n').filter(l=>!l.startsWith('--')).join('\n'));
  await db.prepare('INSERT INTO address(id,name) VALUES (1,?)').bind(mailbox).run();
  await db.prepare('INSERT INTO raw_mails(id,address,raw,message_id) VALUES (1,?,?,?)').bind(mailbox,raw,'<legacy@test>').run();
  await db.prepare('INSERT INTO sendbox(id,address,raw) VALUES (1,?,?)').bind(mailbox,raw).run();
  await db.prepare('INSERT INTO users(id,user_email,password) VALUES (1,?,?)').bind('owner@test.example.com',hash(password)).run();
  await db.exec('INSERT INTO users_address(user_id,address_id) VALUES (1,1);');
  const mime = [
    'From: sender@test.example.com', 'To: legacy@test.example.com',
    'Subject: =?UTF-8?B?' + Buffer.from('解析测试').toString('base64') + '?=',
    'MIME-Version: 1.0', 'Content-Type: multipart/mixed; boundary="ai-agent-mime"', '',
    '--ai-agent-mime', 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64', '',
    Buffer.from('中文邮件正文').toString('base64'),
    '--ai-agent-mime', 'Content-Type: application/octet-stream; name="sample.bin"',
    'Content-Disposition: attachment; filename="sample.bin"', 'Content-Transfer-Encoding: base64', '',
    'AAEC/w==', '--ai-agent-mime--', ''
  ].join('\r\n');
  await db.prepare('INSERT INTO raw_mails(id,address,raw,message_id) VALUES (2,?,?,?)').bind(mailbox,mime,'<wasm@test>').run();
  const parsed = await call('/api/parsed_mail/2', {headers: mailboxHeaders});
  assert.equal(parsed.subject, '解析测试');
  assert.equal(parsed.text.trim(), '中文邮件正文');
  assert.equal(parsed.attachments[0].filename, 'sample.bin');
  assert.equal(parsed.attachments[0].size, 4);
  assert.ok(!runtimeLogs.some(log => log.includes('Failed use mail-parser-wasm-worker')), 'WASM parser fell back during MIME test');
  checks.push('Packaged WASM parser: encoded Chinese subject/body and binary attachment via parsed-mail API');
  const columns = async () => (await db.prepare('PRAGMA table_info(raw_mails)').all()).results.map(c=>c.name);
  assert.ok(!(await columns()).includes('raw_blob'));
  assert.ok(!(await columns()).includes('is_unread'));
  const before = await call('/admin/db_version');
  assert.equal(before.current_db_version, 'v0.0.6');
  assert.equal(before.code_db_version, 'v0.0.8');
  assert.equal(before.need_migration, true);
  await call('/admin/db_version', {headers: {}, status: 401});
  for (const phase of ['before-migration','after-migration']) {
    assert.equal(await call('/health_check', {headers:{}}), 'OK');
    assert.equal((await call('/open_api/settings', {headers:{}})).version, 'v1.12.0');
    for (const path of ['/admin/address?limit=20&offset=0','/admin/mails?limit=20&offset=0','/admin/sendbox?limit=20&offset=0','/admin/users?limit=20&offset=0']) await call(path);
    await call('/api/mails?limit=20&offset=0', {headers: mailboxHeaders});
    assert.equal((await call('/api/mail/1', {headers: mailboxHeaders})).raw, raw);
    await call('/user_api/bind_address?limit=20&offset=0', {headers:userHeaders});
    await call('/user_api/mails?limit=20&offset=0', {headers:userHeaders});
    await call('/user_api/sendbox?limit=20&offset=0', {headers:userHeaders});
    await call('/user_api/login', {method:'POST',headers:{},body:{email:'owner@test.example.com',password:hash(password)}});
    const received = await call('/admin/test/receive_mail', {method:'POST',body:{from:'sender@test.example.com',to:mailbox,raw:raw.replace('<legacy@test>',`<${phase}@test>`)}});
    assert.equal(received.success,true);
    assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM raw_mails WHERE message_id=?').bind(`<${phase}@test>`).first('n'), 1);
    await call('/admin/send_mail',{method:'POST',body:{from_name:'',from_mail:mailbox,to_name:'',to_mail:'recipient@test.example.com',subject:phase,content:'synthetic',is_html:false}});
    const created = await call('/api/new_address',{method:'POST',headers:{},body:{name:phase.replaceAll('-',''),domain:'test.example.com'}});
    assert.ok(created.jwt);
    checks.push(`${phase}: legacy headers/JWT, admin and user reads/login, receive handler, mocked send, create address`);
    if (phase === 'before-migration') {
      const counts = {};
      for (const table of ['users','address','raw_mails','sendbox']) counts[table] = await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first('n');
      assert.equal((await call('/admin/db_migration',{method:'POST'})).success,true);
      const migrated = await call('/admin/db_version');
      assert.equal(migrated.current_db_version,'v0.0.8');
      assert.equal(migrated.need_migration,false);
      assert.ok((await columns()).includes('raw_blob'));
      assert.ok((await columns()).includes('is_unread'));
      const expectedIndexes = [
        ['idx_raw_mails_address','raw_mails','address'], ['idx_raw_mails_created_at','raw_mails','created_at'],
        ['idx_raw_mails_message_id','raw_mails','message_id'], ['idx_address_name','address','name'],
        ['idx_address_created_at','address','created_at'], ['idx_address_updated_at','address','updated_at'],
        ['idx_address_source_meta','address','source_meta'], ['idx_auto_reply_mails_address','auto_reply_mails','address'],
        ['idx_address_sender_address','address_sender','address'], ['idx_sendbox_address','sendbox','address'],
        ['idx_sendbox_created_at','sendbox','created_at'], ['idx_users_user_email','users','user_email'],
        ['idx_users_address_user_id','users_address','user_id'], ['idx_users_address_address_id','users_address','address_id'],
        ['idx_user_roles_user_id','user_roles','user_id'], ['idx_user_passkeys_user_id','user_passkeys','user_id'],
        ['idx_user_passkeys_user_id_passkey_id','user_passkeys','user_id,passkey_id']
      ];
      for (const [name, table, cols] of expectedIndexes) {
        const indexes = (await db.prepare(`PRAGMA index_list(${table})`).all()).results;
        const index = indexes.find(i => i.name === name);
        assert.ok(index, `Missing index: ${name}`);
        assert.equal(index.unique, Number(name === 'idx_user_passkeys_user_id_passkey_id'));
        assert.equal((await db.prepare(`PRAGMA index_info(${name})`).all()).results.map(c=>c.name).join(','), cols);
      }
      for (const table of Object.keys(counts)) assert.equal(await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first('n'), counts[table]);
      assert.equal((await call('/admin/db_migration',{method:'POST'})).message,'Database does not need migration');
      assert.equal(await db.prepare('SELECT raw FROM raw_mails WHERE id=1').first('raw'),raw);
      checks.push('v0.0.6 -> v0.0.8 migration: columns, 17 index definitions and uniqueness, data counts, raw content and second-call idempotency');
    }
  }
  assert.equal(sent.length,2);
  for (const target of ['web', 'telegram']) {
    const assets = new Miniflare(convertV4MiniflareOptions({
      modules: true, script: 'export default {fetch(){return new Response("Unexpected fallback",{status:500})}}',
      compatibilityDate: '2026-03-19',
      assets: {directory: resolve(`ai-agent-takeover/bundle/${target}/assets`),
        routerConfig: {has_user_worker: false}, assetConfig: {not_found_handling: 'single-page-application'}}
    }));
    try {
      for (const path of ['/', '/admin', '/user']) {
        const r = await assets.dispatchFetch(`http://localhost${path}`, {headers: {'sec-fetch-mode': 'navigate'}});
        assert.equal(r.status, 200);
        assert.ok((await r.text()).includes('id="app"'));
      }
      checks.push(`${target}: packaged static assets serve SPA entry at /, /admin, /user`);
    } finally { await assets.dispose(); }
  }
  writeFileSync('ai-agent-takeover/rehearsal.json',JSON.stringify({success:true,checks,externalNetwork:'blocked; Resend mocked',productionDataUsed:false},null,2)+'\n');
  console.log(JSON.stringify({success:true,checks},null,2));
} finally { await mf.dispose(); }
