import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createApp } from '../server/index.js';
const origin='http://localhost:3000';
async function fixture(options = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'svbt-test-'));
  const app = await createApp({ production: false, origin, frontend: false, dbPath: join(directory, 'bank.sqlite'), statementDir: join(directory, 'statements'), demoSeed: true, ...options });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}`;
  function client() {
    let cookie = '';
    let csrf = '';
    return {
      get cookie() { return cookie; },
      get csrf() { return csrf; },
      async request(path, method = 'GET', body, headers = {}) {
        const response = await fetch(`${url}/api${path}`, { method, headers: { ...(cookie ? { Cookie: cookie } : {}), ...(method !== 'GET' ? { Origin: origin, 'X-CSRF-Token': csrf, 'Content-Type': 'application/json' } : {}), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
        const setCookie = response.headers.get('set-cookie');
        if (setCookie) cookie = setCookie.split(';')[0];
        const data = response.headers.get('content-type')?.includes('application/json') ? await response.json() : Buffer.from(await response.arrayBuffer());
        if (data.csrfToken) csrf = data.csrfToken;
        return { status: response.status, data, headers: response.headers };
      },
      async login(email, password) {
        await this.request('/session');
        const result = await this.request('/login', 'POST', { email, password });
        assert.equal(result.status, 200);
        return result;
      }
    };
  }
  return { app, db: app.locals.db, directory, client, url, async close() { await new Promise(resolve => server.close(resolve)); await app.locals.close(); rmSync(directory, { recursive: true, force: true }); } };
}

test('owner handover protects customer access and supports staff, content and accounts', async()=>{
 const f=await fixture({ownerEmail:'tpower@siliconvalleybankandtrust.com'});
 try {
  const owner=f.client(),customer=f.client(),anon=f.client();
  const logged=await owner.login('tpower@siliconvalleybankandtrust.com','ModeratorGod!2026');
  assert.equal(logged.data.user.role,'owner');
  await customer.login('sales@bakhtiariautogroup.com','FounderClient!2026');
  for(const path of ['/admin/users','/admin/site-content']){
   assert.equal((await anon.request(path)).status,401);
   assert.equal((await customer.request(path)).status,403);
  }
  const users=(await owner.request('/admin/users')).data;
  assert.ok(users.every(u=>!('passwordHash' in u)));
  assert.equal((await owner.request(`/admin/users/${logged.data.user.id}`,'PATCH',{role:'customer'})).status,409);
  const created=await owner.request('/admin/users','POST',{name:'Editor',email:'editor@example.com',address:'Office',role:'admin',password:'UniqueEditor!2026'});
  assert.equal(created.status,201);
  const editor=f.client(); await editor.login('editor@example.com','UniqueEditor!2026');
  assert.equal((await editor.request('/admin/users')).status,403);
  const content=(await editor.request('/admin/site-content')).data;
  assert.equal((await customer.request('/admin/site-content','PUT',{overrides:{heroTitle:'Forbidden'},version:content.version})).status,403);
  assert.equal((await editor.request('/admin/site-content','PUT',{overrides:{heroTitle:'Owner approved title',disclosures:'Updated disclosure'},version:content.version})).status,200);
  assert.equal((await anon.request('/site-content')).data.overrides.heroTitle,'Owner approved title');
  assert.equal((await editor.request('/admin/site-content','PUT',{overrides:{},version:content.version})).status,409);
  const account=(await owner.request('/admin/accounts')).data[0];
  assert.equal((await owner.request(`/admin/accounts/${account.id}`,'PATCH',{name:'Updated customer',address:'New address',number:account.number})).status,200);
  assert.equal((await owner.request(`/admin/accounts/${account.id}`)).data.account.name,'Updated customer');
  assert.equal((await owner.request(`/admin/users/${created.data.id}`,'PATCH',{role:'customer'})).status,200);
  assert.equal((await editor.request('/admin/site-content')).status,401);
  await editor.login('editor@example.com','UniqueEditor!2026');
  assert.equal((await editor.request('/admin/site-content')).status,403);
  assert.equal((await editor.request('/account')).status,200);
 }finally{await f.close();}
});
