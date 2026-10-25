// Run production route handlers against a temporary SQLite D1 adapter.
// No test identities or messages are included in the deployed application.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {compilePreviewApi} from './compile-preview-api.mjs';

mkdirSync('.sites-runtime', {recursive: true});
const sqlite = new DatabaseSync(':memory:');
sqlite.exec(readFileSync('drizzle/0000_messenger.sql', 'utf8'));
sqlite.prepare('INSERT INTO profiles (id, handle, name) VALUES (?, ?, ?)').run('legacy', 'old_custom_id', 'Legacy');
const journal = JSON.parse(readFileSync('drizzle/meta/_journal.json','utf8'));
for (const migration of journal.entries.slice(1)) sqlite.exec(readFileSync('drizzle/' + migration.tag + '.sql','utf8'));
const db = {
  prepare(sql) {
    return {bind(...args) {
      const statement = sqlite.prepare(sql);
      return {
        async first() {return statement.get(...args) || null;},
        async all() {return {results: statement.all(...args)};},
        async run() {return statement.run(...args);},
      };
    }};
  },
  async batch(statements) {return Promise.all(statements.map(s => s.run()));},
};
const objects=new Map();
const bucket={async put(id,bytes){objects.set(id,new Uint8Array(bytes));},async get(id){const bytes=objects.get(id);return bytes?{body:bytes}:null;},async delete(id){objects.delete(id);}};
globalThis.__chatTest = {db, user:null,bucket};
const modules=compilePreviewApi('test-api',"export const env={DB:globalThis.__chatTest.db,BUCKET:globalThis.__chatTest.bucket}; export const getChatGPTUser=async()=>globalThis.__chatTest.user;");
const {GET,POST}=await import(modules.chat);
const media=await import(modules.media);
const origin = 'http://localhost:5173';
async function call(user, data, query = '', expected = 200) {
  globalThis.__chatTest.user = user ? {userId: user, email: user + '@test.invalid'} : null;
  const response = await (data ? POST : GET)(new Request(origin + '/api/chat' + query, data ? {method: 'POST', headers: {'Origin': origin, 'Content-Type': 'application/json'}, body: JSON.stringify(data)} : {}));
  const result = await response.json();
  assert.equal(response.status, expected, JSON.stringify(result));
  return result;
}
assert.equal((await call(null)).signedIn, false);
await call(null, {action: 'profile', name: 'Guest', handle: 'guest'}, '', 401);
await call('alice', {action: 'profile', name: 'Alice', handle: 'TN123456'}, '', 400);
const alice = (await call('alice', {action: 'profile', name: 'Alice', bio: 'Hello there.'})).me;
const bob = (await call('bob', {action: 'profile', name: 'Bob'})).me;
const outsider = (await call('outsider', {action: 'profile', name: 'Other'})).me;
for (const person of [alice,bob,outsider]) assert.match(person.handle, /^[A-Z]{2}[0-9]{6}$/);
assert.equal(new Set([alice.handle,bob.handle,outsider.handle]).size,3);
assert.equal((await call('alice')).me.handle,alice.handle);
const legacy=(await call('legacy')).me;
assert.match(legacy.handle,/^[A-Z]{2}[0-9]{6}$/);
assert.equal(legacy.name,'Legacy');
assert.equal((await call('legacy')).me.handle,legacy.handle);
assert.throws(() => sqlite.prepare('UPDATE profiles SET handle = ? WHERE id = ?').run('ZZ000001','alice'),/cannot be changed/);
await call('alice', {action:'profile',name:'Alice',handle:'ZZ000001'},'',400);
await call('alice', {action:'profile',name:'Alice',bio:'x'.repeat(161)},'',400);
assert.deepEqual((await call('alice', null, '?action=search&q='+bob.handle.toLowerCase())).people, [{handle:bob.handle,name:'Bob',bio:'',avatarUrl:null}]);
assert((await call('alice',null,'?action=search&q='+bob.handle.slice(0,2))).people.some(p=>p.handle===bob.handle));
assert.equal((await call('alice',null,'?action=search&q='+alice.handle)).people.length,0);
assert.equal((await call('alice',null,'?action=search&q=%25')).people.length,0);
const first = await call('alice', {action:'start',handle:bob.handle.toLowerCase()});
const id = first.conversation.id;
assert.equal((await call('bob',{action:'start',handle:alice.handle})).conversation.id,id);
const sent = await call('alice', {action: 'send', id, body: 'Hello, Bob!'});
assert.equal((await call('bob')).conversations[0].unread, 1);
const received = await call('bob', null, '?action=messages&id=' + encodeURIComponent(id));
assert.equal(received.messages[0].body, 'Hello, Bob!');
assert.equal(received.messages[0].mine, 0);
assert.equal((await call('alice', null, '?action=messages&id=' + encodeURIComponent(id))).messages[0].mine, 1);
await call('bob', {action: 'read', id, at: sent.message.created});
assert.equal((await call('bob')).conversations[0].unread, 0);
assert.equal((await call('alice', null, '?action=messages&id=' + encodeURIComponent(id))).peerRead, sent.message.created);
await call('outsider', null, '?action=messages&id=' + encodeURIComponent(id), 404);
await call('outsider', {action: 'send', id, body: 'Not permitted'}, '', 404);
await call('outsider', {action: 'read', id, at: Date.now()}, '', 404);
assert.equal((await call('outsider')).conversations.length, 0);
await call('alice', {action: 'start', handle: alice.handle}, '', 404);
await call('alice', {action: 'send', id, body: '  '}, '', 400);
await call('alice', {action: 'send', id, body: 'x'.repeat(4001)}, '', 400);
const cross = await POST(new Request(origin + '/api/chat', {method: 'POST', headers: {Origin: 'http://elsewhere.invalid', 'Content-Type': 'application/json'}, body: '{}'}));
assert.equal(cross.status, 403);
await call('bob', {action: 'profile', name: 'Robert', bio: 'A short bio.'});
assert.equal((await call('alice')).conversations[0].name, 'Robert');
assert.equal((await call('alice')).conversations[0].handle, bob.handle);
assert.equal((await call('alice')).conversations[0].id, id);
assert.equal((await call('alice')).conversations[0].bio,'A short bio.');
const saved = await call('bob',{action:'saveMessage',messageId:sent.message.id});
assert.equal(saved.message.body,'Hello, Bob!');
assert.equal(saved.message.sourceName,'Alice');
assert.equal((await call('bob',{action:'saveMessage',messageId:sent.message.id})).savedId,saved.savedId);
assert.equal((await call('bob')).savedCount,1);
assert.equal((await call('bob',null,'?action=saved')).messages.length,1);
assert.equal((await call('alice',null,'?action=saved')).messages.length,0);
await call('outsider',{action:'saveMessage',messageId:sent.message.id},'',404);
await call('outsider',{action:'removeSaved',savedId:saved.savedId},'',404);
assert.equal((await call('bob',null,'?action=messages&id='+encodeURIComponent(id))).messages[0].savedId,saved.savedId);
assert.equal((await call('alice',null,'?action=messages&id='+encodeURIComponent(id))).messages[0].savedId,null);
const note=await call('bob',{action:'saveNote',body:'A private thought.'});
assert.equal(note.message.sourceName,null);
assert.equal((await call('bob')).savedCount,2);
await call('bob',{action:'saveNote',body:' '},'',400);
await call('bob',{action:'saveNote',body:'x'.repeat(4001)},'',400);
await call('bob',{action:'removeSaved',savedId:note.savedId});
await call('bob',{action:'removeSaved',savedId:saved.savedId});
assert.equal((await call('bob')).savedCount,0);
assert.equal((await call('bob',null,'?action=saved')).messages.length,0);
assert.equal((await call('bob',null,'?action=messages&id='+encodeURIComponent(id))).messages[0].body,'Hello, Bob!');
// A unique-ID collision retries instead of assigning a duplicate or failing signup.
const random=crypto.getRandomValues;
let calls=0;
crypto.getRandomValues = function(array) {if(calls++===0){array[0]=alice.handle.charCodeAt(0)-65;array[1]=alice.handle.charCodeAt(1)-65;array[2]=Number(alice.handle.slice(2));return array;}return random.call(crypto,array);};
try {const collision=(await call('collision',{action:'profile',name:'Collision check'})).me;assert.notEqual(collision.handle,alice.handle);assert(calls>=2);}finally{crypto.getRandomValues=random;}
// Exercise the compound history cursor when many messages share a millisecond.
const stamp = 1;
for (let i = 0; i < 85; i++) sqlite.prepare('INSERT INTO messages (id, conversation, sender, body, created) VALUES (?, ?, ?, ?, ?)').run('history-' + String(i).padStart(3, '0'), id, 'alice', 'History ' + i, stamp);
const page = await call('bob', null, '?action=messages&id=' + encodeURIComponent(id));
assert.equal(page.messages.length, 80);
assert.equal(page.hasMore, true);
const cursor = page.messages[0];
const history = await call('bob', null, '?action=messages&id=' + encodeURIComponent(id) + '&before=' + cursor.created + '&beforeId=' + cursor.id);
assert.equal(history.messages.length, 6);
assert.equal(new Set([...page.messages, ...history.messages].map(m => m.id)).size, 86);
assert.equal(JSON.stringify(await call('alice')).includes('test.invalid'), false);
for(let i=0;i<85;i++) sqlite.prepare('INSERT INTO saved_messages (id, owner, body, created) VALUES (?, ?, ?, ?)').run('saved-'+String(i).padStart(3,'0'),'bob','Private '+i,stamp);
const savedPage=await call('bob',null,'?action=saved');
assert.equal(savedPage.messages.length,80);
const savedCursor=savedPage.messages[0];
const savedHistory=await call('bob',null,'?action=saved&before='+savedCursor.created+'&beforeId='+savedCursor.id);
assert.equal(savedHistory.messages.length,5);
assert.equal(new Set([...savedPage.messages,...savedHistory.messages].map(m=>m.id)).size,85);
assert.equal((await call('alice',null,'?action=saved')).messages.length,0);

async function mediaCall(user,method,query='',body=null,name='file',expected=200,extra={}) {
  globalThis.__chatTest.user=user?{userId:user,email:user+'@test.invalid'}:null;
  const response=await media[method](new Request(origin+'/api/media'+query,{method,headers:{Origin:origin,'Content-Type':'application/octet-stream','X-File-Name':encodeURIComponent(name),...extra},...(body!==null?{body}: {})}));
  if(response.status!==expected)assert.equal(response.status,expected,await response.text());
  return response;
}
const png=new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jPR0AAAAASUVORK5CYII=','base64'));
const scope='?kind=attachment&conversation='+encodeURIComponent(id);
await mediaCall(null,'POST',scope,png,'photo.png',401);
await mediaCall('no-profile','POST',scope,png,'photo.png',400);
await mediaCall('outsider','POST',scope,png,'photo.png',404);
await mediaCall('bob','POST',scope,new Uint8Array(),'empty.txt',400);
await mediaCall('bob','POST',scope,png,'big.png',413,{'Content-Length':String(10*1024*1024+1)});
await mediaCall('bob','POST',scope,new Uint8Array(10*1024*1024+1),'actual-big.bin',413);
await mediaCall('bob','POST','?kind=avatar',new Uint8Array(2*1024*1024+1),'big-avatar.png',413);
await mediaCall('bob','POST','?kind=avatar',new TextEncoder().encode('<svg onload="alert(1)"></svg>'),'avatar.svg',400);
await mediaCall('bob','POST',scope,png,'photo.png',403,{Origin:'https://elsewhere.invalid'});
const image=(await (await mediaCall('bob','POST',scope,png,'hello.png')).json()).attachment;
assert.equal(image.type,'image/png');
assert.equal(image.size,png.length);
await mediaCall(null,'GET','?id='+image.id,null,'',401);
await mediaCall('alice','GET','?id='+image.id,null,'',404); // Still a private draft.
assert.deepEqual(new Uint8Array(await (await mediaCall('bob','GET','?id='+image.id)).arrayBuffer()),png);
await call('alice',{action:'send',id,attachmentId:image.id},'',403);
await call('bob',{action:'saveNote',attachmentId:image.id},'',403); // Wrong destination.
const other=(await call('bob',{action:'start',handle:outsider.handle})).conversation.id;
await call('bob',{action:'send',id:other,attachmentId:image.id},'',403);
const imageMessage=(await call('bob',{action:'send',id,body:'A photo ??',attachmentId:image.id})).message;
assert.equal(imageMessage.attachment.id,image.id);
const imageResponse=await mediaCall('alice','GET','?id='+image.id);
assert.equal(imageResponse.headers.get('content-type'),'image/png');
assert.match(imageResponse.headers.get('content-disposition'),/^inline;/);
await mediaCall('outsider','GET','?id='+image.id,null,'',404);
await mediaCall('bob','DELETE','?id='+image.id,null,'',409);
const download=await mediaCall('alice','GET','?id='+image.id+'&download=1');
assert.match(download.headers.get('content-disposition'),/^attachment;/);
const inbox=await call('alice',null,'?action=messages&id='+encodeURIComponent(id));
assert.equal(inbox.messages.find(m=>m.id===imageMessage.id).attachment.name,'hello.png');
const kept=await call('alice',{action:'saveMessage',messageId:imageMessage.id});
assert.equal(kept.message.attachment.id,image.id);
assert((await call('alice',null,'?action=saved')).messages.some(m=>m.attachment?.id===image.id));
sqlite.prepare('DELETE FROM messages WHERE id = ?').run(imageMessage.id);
await mediaCall('alice','GET','?id='+image.id); // Saved copy retains access.
await call('alice',{action:'removeSaved',savedId:kept.savedId});
await mediaCall('alice','GET','?id='+image.id,null,'',404);
const raw=new TextEncoder().encode('<script>alert(1)</script>');
const document=(await (await mediaCall('bob','POST',scope,raw,'../report\r\n.html',200,{'Content-Type':'image/png'})).json()).attachment;
assert.equal(document.type,'application/octet-stream');
assert(!/[\r\n\/\\]/.test(document.name));
const documentMessage=await call('bob',{action:'send',id,attachmentId:document.id});
assert.equal(documentMessage.message.body,'');
const documentResponse=await mediaCall('alice','GET','?id='+document.id);
assert.equal(documentResponse.headers.get('content-type'),'application/octet-stream');
assert.equal(documentResponse.headers.get('x-content-type-options'),'nosniff');
assert.match(documentResponse.headers.get('content-disposition'),/^attachment;/);
assert.match(documentResponse.headers.get('content-security-policy'),/sandbox/);
assert.deepEqual(new Uint8Array(await documentResponse.arrayBuffer()),raw);
const privateFile=(await (await mediaCall('bob','POST','?kind=attachment',raw,'private.txt')).json()).attachment;
const privateNote=await call('bob',{action:'saveNote',attachmentId:privateFile.id});
assert.equal(privateNote.message.attachment.id,privateFile.id);
await mediaCall('alice','GET','?id='+privateFile.id,null,'',404);
await mediaCall('bob','DELETE','?id='+privateFile.id,null,'',409);
const avatar=(await (await mediaCall('bob','POST','?kind=avatar',png,'avatar.png')).json()).attachment;
await mediaCall('alice','GET','?id='+avatar.id,null,'',404);
await call('alice',{action:'profile',name:'Alice',avatarId:avatar.id},'',403);
await call('bob',{action:'send',id,attachmentId:avatar.id},'',403);
const photoProfile=(await call('bob',{action:'profile',name:'Robert',bio:'Still me.',avatarId:avatar.id})).me;
assert.equal(photoProfile.handle,bob.handle);
assert.equal(photoProfile.avatarUrl,'/api/media?id='+avatar.id);
assert.equal((await call('alice')).conversations.find(c=>c.id===id).avatarUrl,photoProfile.avatarUrl);
await mediaCall('outsider','GET','?id='+avatar.id); // Profile photos are discoverable to signed-in users.
await mediaCall('bob','DELETE','?id='+avatar.id,null,'',409);
await call('bob',{action:'profile',name:'Robert',avatarId:null});
assert.equal((await call('bob')).me.avatarUrl,null);
await mediaCall('outsider','GET','?id='+avatar.id,null,'',404);
await mediaCall('bob','DELETE','?id='+avatar.id);
assert.equal(objects.has(avatar.id),false);
const unicode=(await (await mediaCall('bob','POST',scope,raw,String.fromCodePoint(0x1f600).repeat(121)+String.fromCharCode(13,10)+'.txt')).json()).attachment;
assert.equal([...unicode.name].length,120);
assert.match((await mediaCall('bob','GET','?id='+unicode.id)).headers.get('content-disposition'),/filename\*/);
await mediaCall('bob','DELETE','?id='+unicode.id);
const canceled=(await (await mediaCall('bob','POST',scope,png,'canceled.png')).json()).attachment;
await mediaCall('alice','DELETE','?id='+canceled.id,null,'',404);
await mediaCall('bob','DELETE','?id='+canceled.id);
assert.equal(objects.has(canceled.id),false);
await mediaCall('bob','GET','?id='+canceled.id,null,'',404);
const emoji='Hello \u{1f44b}\u{1f3fd} \u2764\ufe0f \u{1f9d1}\u200d\u{1f4bb} \u{1f389}';
assert(/\p{Extended_Pictographic}/u.test(emoji));
assert(emoji.includes(String.fromCodePoint(0x1f9d1)));
const emojiMessage=await call('alice',{action:'send',id,body:emoji});
assert.equal(emojiMessage.message.body,emoji);
assert.equal((await call('bob',null,'?action=messages&id='+encodeURIComponent(id))).messages.find(m=>m.id===emojiMessage.message.id).body,emoji);
await call('bob',{action:'saveMessage',messageId:emojiMessage.message.id});
assert((await call('bob',null,'?action=saved')).messages.some(m=>m.body===emoji));
console.log('Passed: private file/image uploads, byte-preserving downloads, membership checks, size limits, MIME validation, avatar ownership/removal, saved attachments, cleanup, and Unicode emojis.');


// Editing is authorized by the original sender, not just conversation membership.
const snapshot=await call('bob',{action:'saveMessage',messageId:sent.message.id});
const unreadBefore=(await call('bob')).conversations.find(c=>c.id===id).unread;
const edited=await call('alice',{action:'edit',id,messageId:sent.message.id,body:'An edited hello \u{1f44b}'});
assert(edited.edit.editedAt>0);
assert.equal(sqlite.prepare('SELECT created FROM messages WHERE id = ?').get(sent.message.id).created,sent.message.created);
assert.equal((await call('bob')).conversations.find(c=>c.id===id).unread,unreadBefore);
assert.equal(sqlite.prepare('SELECT body FROM messages WHERE id = ?').get(sent.message.id).body,'An edited hello \u{1f44b}');
assert.equal(sqlite.prepare('SELECT body FROM saved_messages WHERE id = ?').get(snapshot.savedId).body,'Hello, Bob!');
await call('bob',{action:'edit',id,messageId:sent.message.id,body:'Not mine'},'',404);
await call('outsider',{action:'edit',id,messageId:sent.message.id,body:'Not mine'},'',404);
await call('alice',{action:'edit',id:other,messageId:sent.message.id,body:'Wrong chat'},'',404);
await call('alice',{action:'edit',id,messageId:sent.message.id,body:' '},'',400);
await call('alice',{action:'edit',id,messageId:sent.message.id,body:'x'.repeat(4001)},'',400);
const caption=(await call('bob',{action:'send',id,body:'Before caption',attachmentId:image.id})).message;
await call('bob',{action:'edit',id,messageId:caption.id,body:''});
const captionAfter=(await call('alice',null,'?action=messages&id='+encodeURIComponent(id))).messages.find(m=>m.id===caption.id);
assert.equal(captionAfter.body,'');assert.equal(captionAfter.attachment.id,image.id);assert(captionAfter.editedAt);
await call('bob',{action:'editSaved',messageId:privateNote.savedId,body:'My updated private note'});
assert.equal((await call('bob',null,'?action=saved')).messages.find(m=>m.id===privateNote.savedId).body,'My updated private note');
await call('alice',{action:'editSaved',messageId:privateNote.savedId,body:'Other note'},'',404);
await call('bob',{action:'editSaved',messageId:snapshot.savedId,body:'Change a saved snapshot'},'',404);
await mediaCall('alice','PATCH','?id='+image.id,JSON.stringify({locked:true}),'',404);
await mediaCall('outsider','PATCH','?id='+image.id,JSON.stringify({locked:true}),'',404);
await mediaCall('bob','PATCH','?id='+image.id,JSON.stringify({locked:'yes'}),'',400);
await mediaCall('bob','PATCH','?id='+document.id,JSON.stringify({locked:true}),'',400);
const locked=(await (await mediaCall('bob','PATCH','?id='+image.id,JSON.stringify({locked:true}))).json()).attachment;
assert.equal(locked.downloadLocked,true);assert.equal(locked.canDownload,true);assert.equal(locked.canManage,true);
await mediaCall('alice','GET','?id='+image.id); // Viewing remains allowed.
await mediaCall('alice','GET','?id='+image.id+'&download=1',null,'',403);
await mediaCall('bob','GET','?id='+image.id+'&download=1');
const recipientFile=(await call('alice',null,'?action=messages&id='+encodeURIComponent(id))).messages.find(m=>m.id===caption.id).attachment;
assert.equal(recipientFile.canDownload,false);assert.equal(recipientFile.downloadLocked,true);assert.equal(recipientFile.canManage,false);
const lockedCopy=await call('alice',{action:'saveMessage',messageId:caption.id});
assert.equal(lockedCopy.message.attachment.canDownload,false);
assert.equal((await call('alice',null,'?action=saved')).messages.find(m=>m.id===lockedCopy.savedId).attachment.canDownload,false);
await mediaCall('bob','PATCH','?id='+image.id,JSON.stringify({locked:false}));
await mediaCall('alice','GET','?id='+image.id+'&download=1');
assert.equal((await call('alice',null,'?action=saved')).messages.find(m=>m.id===lockedCopy.savedId).attachment.canDownload,true);
const initiallyLocked=(await (await mediaCall('bob','POST',scope+'&locked=1',png,'locked-at-send.png')).json()).attachment;
assert.equal(initiallyLocked.downloadLocked,true);
await call('bob',{action:'send',id,attachmentId:initiallyLocked.id});
await mediaCall('alice','GET','?id='+initiallyLocked.id+'&download=1',null,'',403);
const objectCount=objects.size;
await mediaCall('bob','POST',scope+'&locked=1',raw,'not-an-image.html',400);
assert.equal(objects.size,objectCount);
console.log('Passed: sender-only edits, caption edits, edited timestamps, note ownership, unchanged unread order, saved snapshots, sender-only image locks, saved-copy lock enforcement, and unlocks.');

sqlite.close();
console.log('Passed: automatic permanent IDs, collision retries, legacy migration, profiles, search, messaging, read receipts, private saved messages, notes, authorization, and history pagination.');
