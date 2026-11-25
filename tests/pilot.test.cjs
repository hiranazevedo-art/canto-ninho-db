const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { createServer } = require('node:http');
const { join, resolve, extname } = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { createContext, runInContext } = require('node:vm');
const { createECDH, randomBytes } = require('node:crypto');
const { chromium } = require('playwright');
const webPush = require('../push-worker/node_modules/web-push');

const root = resolve(__dirname, '..');
const source = name => readFileSync(join(root, name), 'utf8');
const secret = 'local-pilot-test-secret-not-for-production';
const password = 'senha exclusiva do proprietário';
const pilotPassword = 'senha exclusiva de quem recebeu o convite';
const taskDay = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Fortaleza' });
const legacyData = { version: 4, settings: { name: 'CRIADOURO LEGADO', setupComplete: true }, audit: [],
 birds: [{ id: 'ave-legada', name: 'AVE EXCLUSIVA LEGADA' }] };
const sqlite = new DatabaseSync(':memory:');
const DB = {
 prepare(sql) {
  const prepare = args => {
   const stmt = sqlite.prepare(sql);
   return {
    bind: (...bound) => prepare(bound),
    first: () => stmt.get(...args) || null,
    all: () => ({ results: stmt.all(...args) }),
    run: () => ({ meta: { changes: stmt.run(...args).changes } }),
    execute: () => /^SELECT\b/i.test(sql.trim()) ? { results: stmt.all(...args) } : { meta: { changes: stmt.run(...args).changes } }
   };
  };
  return prepare([]);
 },
 async batch(statements) {
  sqlite.exec('BEGIN');
  try {
   const results = [];
   for (const statement of statements) results.push(statement.execute());
   sqlite.exec('COMMIT');
   return results;
  } catch (error) {
   sqlite.exec('ROLLBACK');
   throw error;
  }
 }
};
async function main() {
 const { derive, sign } = await import('../functions/api/_security.js');
 const { pushDeviceId } = await import('../functions/lib/push-subscription.js');
 const handlers = Object.fromEntries(await Promise.all(['account', 'data', 'push'].map(async name =>
  [name, (await import('../functions/api/' + name + '.js')).onRequest])));
 const salt = '0123456789abcdef0123456789abcdef';
 const legacyHash = await derive(password, salt, 180000);
 sqlite.exec(source('schema.sql'));
 for (const file of ['001_records.sql', '002_tournament_relations.sql', '003_web_push.sql']) {
  sqlite.exec(source('migrations/' + file));
 }
 sqlite.prepare('INSERT INTO accounts(id,password_salt,password_hash) VALUES (?,?,?)').run('owner', salt, legacyHash);
 const legacyRows = { ...legacyData, ...Object.fromEntries(globalThis.CantoSync.collections.map(name =>
  [name, legacyData[name] || []])) };
 sqlite.prepare('INSERT INTO snapshots(owner_id,revision,payload) VALUES (?,?,?)').run('owner', 7, JSON.stringify(legacyRows));
 sqlite.exec(source('migrations/004_pilot_invites.sql'));
 sqlite.exec(source('migrations/004_pilot_invites.sql'));
 const { default: pushWorker } = await import('../push-worker/worker.js');
 const deliveries = [];
 const actualFetch = globalThis.fetch;
 globalThis.fetch = async (input, options) => {
  if (typeof input === 'string' && input.startsWith('https://fcm.googleapis.com/fcm/send/')) {
   assert.equal(options.method, 'POST');
   assert.ok(options.body.length > 0);
   deliveries.push(input);
   return new Response(null, { status: 201 });
  }
  return actualFetch(input, options);
 };
 const vapid = webPush.generateVAPIDKeys();
 const pushEnv = { DB, VAPID_PUBLIC_KEY: vapid.publicKey, VAPID_PRIVATE_KEY: vapid.privateKey,
  VAPID_SUBJECT: 'mailto:pilot-test@example.com' };
 const env = { DB, SESSION_SECRET: secret, PUSH: {
  fetch: (url, options) => pushWorker.fetch(new Request(url, options), pushEnv)
 } };
 const mime = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.webmanifest':'application/manifest+json' };
 const server = createServer(async (req, res) => {
  try {
   const url = new URL(req.url, 'http://' + req.headers.host);
   const handler = handlers[url.pathname.split('/')[2]];
   if (url.pathname.startsWith('/api/') && handler) {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const request = new Request(url, { method: req.method, headers: req.headers,
     body: ['GET','HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks) });
    const response = await handler({ request, env });
    res.writeHead(response.status, Object.fromEntries(response.headers));
    return res.end(Buffer.from(await response.arrayBuffer()));
   }
   const file = join(root, 'public', url.pathname === '/' ? 'index.html' : url.pathname);
   res.setHeader('content-type', mime[extname(file)] || 'application/octet-stream');
   return res.end(readFileSync(file));
  } catch (error) {
   res.writeHead(error.code === 'ENOENT' ? 404 : 500);
   res.end(String(error));
  }
 });
 await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
 const origin = 'http://127.0.0.1:' + server.address().port;
 let browser;
 try {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  await page.goto(origin);
  await page.evaluate(data => localStorage.setItem('caboclinho_manager_v04', JSON.stringify(data)), legacyRows);
  const appReady = async tab => {
   await tab.locator('.app').waitFor({ state: 'visible' });
   try { await tab.locator('#cloudButton[data-status=synced]').waitFor({ timeout: 10000 }); }
   catch (error) {
    const status = await tab.locator('#cloudButton').textContent();
    const content = await tab.locator('#content').textContent();
    throw new Error('Sincronização: ' + status + ' | ' + content.slice(0, 200), { cause: error });
   }
  };
  const login = async (login = '', tab = page) => {
   if (login) await tab.locator('#cloudLogin').fill(login);
   await tab.locator('#cloudPassword').fill(login ? pilotPassword : password);
   await tab.locator('#cloudForm [type=submit]').click();
   await appReady(tab);
  };
  const api = async (name, action, account, extra = {}, tab = page) => tab.evaluate(
   async ({ name, action, account, extra }) => {
    const response = await fetch('/api/' + name, {
     method: action ? 'POST' : 'GET',
     headers: { ...(account ? { 'x-canto-account': account } : {}), 'content-type': 'application/json' },
     body: action ? JSON.stringify({ action, ...extra }) : undefined
    });
    return { status: response.status, data: await response.json() };
   }, { name, action, account, extra });
  const signOut = async () => {
   await page.locator('#cloudButton').click();
   await page.locator('#cloudLogout').click();
   await page.locator('.app').waitFor({ state: 'hidden' });
   await page.locator('#cloudForm').waitFor();
  };
  await login();
  assert.equal((await api('data', null, 'owner')).data.data.birds[0].name, legacyData.birds[0].name);
  await page.locator('#cloudButton').click();
  await page.locator('#cloudInvites').click();
  async function createInvite(login) {
   await page.locator('#pilotLogin').fill(login);
   await page.locator('#pilotInviteForm [type=submit]').click();
   return page.getByRole('textbox', { name: 'Link do convite' }).inputValue();
  }
  const invitation = await createInvite('criadouro-teste');
  const second = await createInvite('criadouro-dois');
  await createInvite('criadouro-tres');
  assert.equal((await api('account', 'createInvite', 'owner', { login: 'criadouro-quatro' })).status, 409);
  assert.notEqual(invitation, second);
  const token = new URL(invitation).hash.slice('#convite='.length);
  assert.notEqual(sqlite.prepare('SELECT token_hash FROM pilot_invites WHERE login=?').get('criadouro-teste').token_hash, token);
  await page.locator('#pilotBack').click();
  await page.locator('#cloudDone').click();
  const secondTab = await context.newPage();
  await secondTab.goto(origin);
  await appReady(secondTab);
  const endpoint = 'https://fcm.googleapis.com/fcm/send/browser-owner';
  const keyPair = createECDH('prime256v1');
  keyPair.generateKeys();
  const keys = { p256dh: keyPair.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') };
  const device = await pushDeviceId(endpoint);
  assert.equal((await api('push', 'enable', 'owner', { endpoint, keys })).status, 200);
  assert.equal((await api('push', 'test', 'owner', { endpoint })).status, 200);
  const otherOwnerEndpoint = 'https://fcm.googleapis.com/fcm/send/owner-other-device';
  assert.equal((await api('push', 'enable', 'owner', { endpoint: otherOwnerEndpoint, keys })).status, 200);
  // Execute the real service worker push handlers with a simulated browser subscription.
  let currentEndpoint = endpoint;
  const shown = [];
  const locations = [];
  const workerEvents = {};
  const realm = createContext({ URL, TextEncoder, AbortSignal, crypto, fetch: async (url, options) => {
   const response = await api('push', 'status', options.headers['x-canto-account'], JSON.parse(options.body));
   return Response.json(response.data, { status: response.status });
  }, self: { navigator: {}, location: { origin }, addEventListener: (name, handler) => { workerEvents[name] = handler; },
   registration: { scope: origin + '/', pushManager: { getSubscription: async () => ({ endpoint: currentEndpoint }) },
    showNotification: async (title, options) => shown.push({ title, ...options }) },
   clients: { matchAll: async () => [], openWindow: async url => locations.push(url) } } });
  runInContext(source('public/sw.js'), realm);
  async function push(account, device, hash) {
   let done;
   workerEvents.push({ data: { json: () => ({ account, device, hash }) }, waitUntil: promise => { done = promise; } });
   await done;
  }
  await push('owner', device, 'lembrete=agenda');
  assert.equal(shown.length, 1);
  assert.equal(shown[0].body, 'Você tem um lembrete. Consulte a Agenda.');
  // Make logout see the same endpoint the simulated push service registered.
  await page.evaluate(endpoint => {
   const original = PushManager.prototype.getSubscription;
   PushManager.prototype.getSubscription = async function () {
    return (await original.call(this)) || { endpoint, unsubscribe: async () => true };
   };
  }, endpoint);
  await signOut();
  await secondTab.locator('.app').waitFor({ state: 'hidden' });
  await secondTab.locator('#cloudLogin').waitFor();
  await secondTab.close();
  assert.equal(sqlite.prepare('SELECT count(*) AS count FROM push_subscriptions WHERE owner_id=?').get('owner').count, 1);
  assert.equal(sqlite.prepare('SELECT endpoint FROM push_subscriptions WHERE owner_id=?').get('owner').endpoint, otherOwnerEndpoint);
  await page.goto(invitation);
  await page.locator('#cloudPassword').fill(pilotPassword);
  await page.locator('#cloudConfirm').fill(pilotPassword);
  await page.locator('#cloudForm [type=submit]').click();
  await appReady(page);
  const pilot = 'pilot:criadouro-teste';
  assert.equal((await api('data', null, pilot)).data.revision, 0);
  assert.equal((await api('data', null, 'owner')).status, 401);
  assert.equal((await api('data', null, null)).status, 401);
  assert.equal((await api('account', 'createInvite', pilot, { login: 'sem-acesso' })).status, 403);
  await page.locator('#navigation [data-page="tasks"]').click();
  await page.locator('[data-action="new:tasks"]').click();
  await page.locator('#recordForm [name="name"]').selectOption('LIMPEZA DAS GAIOLAS');
  await page.locator('#recordForm [name="date"]').fill(taskDay);
  const upload = page.waitForResponse(r => r.url() === origin + '/api/data' && r.request().method() === 'PUT');
  await page.locator('#recordForm [type=submit], #recordForm button:not([type])').first().click();
  await page.locator('#recordForm').waitFor({ state: 'detached' });
  assert.equal((await upload).status(), 200);
  assert.ok((await api('data', null, pilot)).data.data.tasks.some(item => item.name === 'LIMPEZA DAS GAIOLAS'));
  await appReady(page);
  await page.reload();
  await appReady(page);
  await page.locator('#navigation [data-page="tasks"]').click();
  await page.getByText('LIMPEZA DAS GAIOLAS', { exact: true }).filter({ visible: true }).first().waitFor({ timeout: 8000 });

  const pilotEndpoint = 'https://fcm.googleapis.com/fcm/send/browser-pilot';
  const pilotDevice = await pushDeviceId(pilotEndpoint);
  assert.equal((await api('push', 'enable', pilot, { endpoint: pilotEndpoint, keys })).status, 200);
  assert.equal((await api('push', 'test', pilot, { endpoint })).status, 409);
  assert.equal((await api('push', 'test', pilot, { endpoint: pilotEndpoint })).status, 200);
  await push('owner', device, 'lembrete=agenda'); // Delayed delivery from the previous account.
  assert.equal(shown.length, 1);
  let clicked;
  workerEvents.notificationclick({ notification: { data: shown[0].data, close() {} }, waitUntil: promise => { clicked = promise; } });
  await clicked;
  assert.deepEqual(locations, []);
  currentEndpoint = pilotEndpoint;
  await push(pilot, pilotDevice, 'lembrete=teste');
  assert.equal(shown.length, 2);
  assert.deepEqual(deliveries, [endpoint, pilotEndpoint]);
  let scheduled;
  await pushWorker.scheduled({ scheduledTime: Date.parse(taskDay + 'T15:00:00Z') }, pushEnv, {
   waitUntil(promise) { scheduled = promise; }
  });
  await scheduled;
  assert.deepEqual(deliveries, [endpoint, pilotEndpoint, pilotEndpoint]);
  assert.deepEqual(sqlite.prepare('SELECT DISTINCT owner_id FROM push_deliveries').all().map(row => row.owner_id), [pilot]);

  await signOut();
  await page.goto(invitation);
  await page.locator('#cloudPassword').fill(pilotPassword);
  await page.locator('#cloudConfirm').fill(pilotPassword);
  await page.locator('#cloudForm [type=submit]').click();
  await page.locator('#cloudError').getByText(/já utilizado/).waitFor();
  await page.goto(origin);
  await login();
  assert.equal((await api('data', null, 'owner')).data.data.birds[0].name, legacyData.birds[0].name);
  assert.equal((await api('data', null, 'owner')).data.data.tasks.length, 0);
  await signOut();
  await page.goto(origin);
  assert.equal((await api('account', 'login', null, { login: 'criadouro-teste', password })).status, 401);
  await login('criadouro-teste');
  assert.equal((await api('data', null, pilot)).data.data.tasks[0].name, 'LIMPEZA DAS GAIOLAS');
  assert.equal((await api('data', null, pilot)).data.data.birds.length, 0);

  const concurrentToken = new URL(second).hash.slice('#convite='.length);
  const redeem = () => fetch(origin + '/api/account', { method: 'POST',
   headers: { 'content-type': 'application/json' },
   body: JSON.stringify({ action: 'redeem', token: concurrentToken, password }) });
  const results = await Promise.all([redeem(), redeem()]);
  assert.equal(results.filter(r => r.status === 201).length, 1);
  assert.ok(results.some(r => [400, 409].includes(r.status)));
  const third = sqlite.prepare('SELECT login FROM pilot_invites WHERE login=?').get('criadouro-tres').login;
  sqlite.prepare('UPDATE pilot_invites SET expires_at=0 WHERE login=?').run(third);
  const ownerToken = await sign(secret, 'owner');
  const renewed = await fetch(origin + '/api/account', { method: 'POST',
   headers: { 'content-type': 'application/json', authorization: 'Bearer ' + ownerToken },
   body: JSON.stringify({ action: 'createInvite', login: third }) });
  assert.equal(renewed.status, 201);
  assert.equal(sqlite.prepare('SELECT password_hash FROM accounts WHERE id=?').get('owner').password_hash, legacyHash);
  assert.deepEqual(pageErrors, []);
  console.log('PASS: migração aditiva, convites, sincronização, troca de conta e notificações simuladas.');
 } finally {
  globalThis.fetch = actualFetch;
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
  sqlite.close();
 }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
