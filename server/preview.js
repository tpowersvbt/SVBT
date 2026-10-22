// Isolated demonstration entry point. It never opens an existing database.
import express from 'express';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export async function createPreview(origin) {
  if (process.env.SVBT_PREVIEW_ONLY !== 'true') throw new Error('This entry point requires SVBT_PREVIEW_ONLY=true.');
  const url=new URL(origin);
  if(url.origin!==origin) throw new Error('Preview origin must be exact.');
  process.env.DEMO_CUSTOMER_EMAIL='customer@svbt-preview.example';
  process.env.DEMO_CUSTOMER_PASSWORD='PreviewCustomer2026!';
  process.env.DEMO_MODERATOR_EMAIL='owner@svbt-preview.example';
  process.env.DEMO_MODERATOR_PASSWORD='PreviewOwner2026!';
  // Never provision staff from operational environment variables or deliver email.
  delete process.env.MODERATOR_EMAIL;
  const {createApp}=await import('./index.js');
  const app=await createApp({production:false,origin,dbPath:':memory:',statementDir:mkdtempSync(join(tmpdir(),'svbt-preview-statements-')),demoSeed:true,sampleData:false,trustProxy:true,sendMail:null,ownerEmail:'owner@svbt-preview.example'});
  app.locals.db.prepare('UPDATE site_content SET overrides=? WHERE id=1').run(JSON.stringify({announcement:'TEST PREVIEW — sample data only. Do not enter real client or financial information.'}));
  const wrapper=express();
  wrapper.use((req,res,next)=>{
    res.set('X-SVBT-Preview','sample-data-only');
    if(req.method==='POST'&&req.path==='/api/register')return res.status(403).json({error:'Public registration is disabled on this sample preview. Use the test accounts.'});
    next();
  });
  wrapper.use(app);
  wrapper.locals.close=app.locals.close;
  return wrapper;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const origin=process.env.RENDER_EXTERNAL_URL||process.env.APP_ORIGIN;
  if(!origin)throw new Error('A preview origin is required.');
  const app=await createPreview(origin);
  const server=app.listen(Number(process.env.PORT||3000),'0.0.0.0',()=>console.log('SVBT sample-only preview ready. Data resets when this process restarts.'));
  for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>server.close(async()=>{await app.locals.close();process.exit(0);}));
}
