import assert from 'node:assert/strict';
import {createServer as createNetServer} from 'node:net';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {existsSync,readFileSync} from 'node:fs';
import {createRenderServer} from './render-server.mjs';

if(!existsSync('dist/render/index.html'))await import('./build-render.mjs');
const directory=resolve('.sites-runtime','render-check-'+randomUUID());
let running;
async function start(){
  const reserve=createNetServer();await new Promise(resolve=>reserve.listen(0,'127.0.0.1',resolve));
  const port=reserve.address().port;await new Promise(resolve=>reserve.close(resolve));
  const origin='http://127.0.0.1:'+port;
  const app=await createRenderServer({origin,directory});
  await new Promise((resolve,reject)=>{app.server.once('error',reject);app.server.listen(port,'127.0.0.1',resolve);});
  running={...app,origin};return running;
}
async function stop(){if(running){const app=running;running=null;await new Promise(resolve=>app.server.close(resolve));}}
async function request(path,{cookie,method='GET',json,bytes,headers={},status=200}={}){
  const response=await fetch(running.origin+path,{method,headers:{Origin:running.origin,...(cookie?{Cookie:cookie}:{}),...(json?{'Content-Type':'application/json'}:{}),...headers},...(json?{body:JSON.stringify(json)}:bytes?{body:bytes}:{})});
  const type=response.headers.get('content-type')||'',body=type.includes('application/json')?await response.json():new Uint8Array(await response.arrayBuffer());
  assert.equal(response.status,status,JSON.stringify(body));
  return {body,headers:response.headers};
}
try{
  await start();
  await request('/healthz');await request('/');await request('/app.js');
  const anonymous=await request('/api/chat');assert.equal(anonymous.body.authMode,'password');assert.equal(anonymous.body.signedIn,false);
  const forged=await request('/api/chat',{headers:{'oai-authenticated-user-id':'fake-user','oai-authenticated-user-email':'fake@example.invalid'}});assert.equal(forged.body.signedIn,false);
  await request('/api/auth/register',{method:'POST',json:{email:'alice@example.invalid',password:'short'},status:400});
  await request('/api/auth/register',{method:'POST',json:{email:'alice@example.invalid',password:'A-long-test-password'},headers:{Origin:'https://elsewhere.invalid'},status:403});
  let aliceCookie=(await request('/api/auth/register',{method:'POST',json:{email:'alice@example.invalid',password:'A-long-test-password'}})).headers.get('set-cookie').split(';')[0];
  assert.match(aliceCookie,/^__deepi_session=/);
  const account=running.sqlite.prepare('SELECT * FROM render_accounts WHERE email = ?').get('alice@example.invalid');
  assert.notEqual(account.password_hash,'A-long-test-password');assert.equal(account.salt.length,32);
  assert.equal(running.sqlite.prepare('SELECT token_hash FROM render_sessions WHERE token_hash = ?').get(aliceCookie.split('=')[1]),undefined);
  await request('/api/auth/register',{method:'POST',json:{email:'alice@example.invalid',password:'A-long-test-password'},status:409});
  const alice=(await request('/api/chat',{cookie:aliceCookie,method:'POST',json:{action:'profile',name:'Alice'}})).body.me;
  const bobCookie=(await request('/api/auth/register',{method:'POST',json:{email:'bob@example.invalid',password:'Another-long-password'}})).headers.get('set-cookie').split(';')[0];
  const bob=(await request('/api/chat',{cookie:bobCookie,method:'POST',json:{action:'profile',name:'Bob'}})).body.me;
  assert.match(alice.handle,/^[A-Z]{2}[0-9]{6}$/);assert.notEqual(alice.handle,bob.handle);
  const id=(await request('/api/chat',{cookie:aliceCookie,method:'POST',json:{action:'start',handle:bob.handle}})).body.conversation.id;
  const sent=(await request('/api/chat',{cookie:aliceCookie,method:'POST',json:{action:'send',id,body:'Hello \u{1f44b}'}})).body.message;
  await request('/api/chat',{cookie:bobCookie,method:'POST',json:{action:'edit',id,messageId:sent.id,body:'Not mine'},status:404});
  await request('/api/chat',{cookie:aliceCookie,method:'POST',json:{action:'edit',id,messageId:sent.id,body:'Updated \u{1f44b}'}});
  const png=new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jPR0AAAAASUVORK5CYII=','base64'));
  const upload=(await request('/api/media?kind=attachment&locked=1&conversation='+encodeURIComponent(id),{cookie:aliceCookie,method:'POST',bytes:png,headers:{'X-File-Name':'render-photo.png'}})).body.attachment;
  await request('/api/media?id='+upload.id,{cookie:bobCookie,status:404});
  await request('/api/chat',{cookie:aliceCookie,method:'POST',json:{action:'send',id,attachmentId:upload.id}});
  assert.deepEqual((await request('/api/media?id='+upload.id,{cookie:bobCookie})).body,png);
  await request('/api/media?id='+upload.id+'&download=1',{cookie:bobCookie,status:403});
  await request('/api/media?id='+upload.id,{cookie:bobCookie,method:'PATCH',json:{locked:false},status:404});
  await request('/api/media?id='+upload.id,{status:401});
  await request('/api/auth/login',{method:'POST',json:{email:'alice@example.invalid',password:'Wrong-password'},status:401});
  await request('/api/auth/logout',{cookie:aliceCookie,method:'POST'});
  assert.equal((await request('/api/chat',{cookie:aliceCookie})).body.signedIn,false);
  aliceCookie=(await request('/api/auth/login',{method:'POST',json:{email:'alice@example.invalid',password:'A-long-test-password'}})).headers.get('set-cookie').split(';')[0];
  await stop();await start();
  assert.equal((await request('/api/chat',{cookie:aliceCookie})).body.me.handle,alice.handle);
  const received=(await request('/api/chat?action=messages&id='+encodeURIComponent(id),{cookie:bobCookie})).body.messages;
  assert.equal(received.find(message=>message.id===sent.id).body,'Updated \u{1f44b}');assert(received.find(message=>message.id===sent.id).editedAt);
  assert.deepEqual((await request('/api/media?id='+upload.id,{cookie:bobCookie})).body,png);
  await request('/api/media?id='+upload.id+'&download=1',{cookie:bobCookie,status:403});
  await request('/api/media?id='+upload.id,{cookie:aliceCookie,method:'PATCH',json:{locked:false}});
  await request('/api/media?id='+upload.id+'&download=1',{cookie:bobCookie});
  assert(!JSON.stringify(received).includes('example.invalid'));
  const frontend=readFileSync('dist/render/app.js','utf8');assert(frontend.includes('Edit message'));assert(frontend.includes('Lock image downloads'));assert(frontend.includes('twemoji@v17.0.3'));
  console.log('Passed: Render account creation/login/logout, hashed passwords/sessions, spoofed identity rejection, two-user chats, edits, private file access, download locks, and account/message/file persistence across a restart.');
}finally{await stop();}
