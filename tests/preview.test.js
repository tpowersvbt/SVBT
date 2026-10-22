import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createPreview } from '../server/preview.js';

test('preview is opt-in, uses sample accounts, refuses public registration and leaves existing database paths untouched',async()=>{
  delete process.env.SVBT_PREVIEW_ONLY;
  await assert.rejects(()=>createPreview('http://localhost:3100'),/SVBT_PREVIEW_ONLY/);
  const dir=mkdtempSync(join(tmpdir(),'svbt-preview-safety-'));
  const sentinel=join(dir,'existing.sqlite');writeFileSync(sentinel,'existing database sentinel');
  process.env.DB_PATH=sentinel;process.env.SVBT_PREVIEW_ONLY='true';
  const app=await createPreview('http://localhost:3100');
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');
  const root=`http://127.0.0.1:${server.address().port}`;
  try{
    const health=await fetch(root+'/api/health');assert.equal(health.status,200);assert.equal(health.headers.get('x-svbt-preview'),'sample-data-only');
    const content=await (await fetch(root+'/api/site-content')).json();assert.match(content.overrides.announcement,/TEST PREVIEW/);
    assert.equal((await fetch(root+'/api/register',{method:'POST'})).status,403);
    const session=await fetch(root+'/api/session'),data=await session.json();
    const login=await fetch(root+'/api/login',{method:'POST',headers:{Origin:'http://localhost:3100',Cookie:session.headers.get('set-cookie').split(';')[0],'X-CSRF-Token':data.csrfToken,'Content-Type':'application/json'},body:JSON.stringify({email:'owner@svbt-preview.example',password:'PreviewOwner2026!'})});
    assert.equal(login.status,200);assert.equal((await login.json()).user.role,'owner');
    assert.equal(readFileSync(sentinel,'utf8'),'existing database sentinel');
  }finally{await new Promise(resolve=>server.close(resolve));await app.locals.close();}
});
