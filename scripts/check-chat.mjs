// Run production route handlers against a temporary SQLite D1 adapter.
// No test identities or messages are included in the deployed application.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import ts from 'typescript';

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
globalThis.__chatTest = {db, user: null};
writeFileSync('.sites-runtime/test-context.mjs', `export const env = {DB: globalThis.__chatTest.db};\nexport const getChatGPTUser = async () => globalThis.__chatTest.user;\n`);
writeFileSync('.sites-runtime/test-identity.mjs', ts.transpileModule(readFileSync('app/api/chat/identity.ts','utf8'), {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText);
let source = readFileSync('app/api/chat/route.ts', 'utf8')
  .replace("'cloudflare:workers'", "'./test-context.mjs'")
  .replace("'../../chatgpt-auth'", "'./test-context.mjs'")
  .replace("'./identity'", "'./test-identity.mjs'");
source = ts.transpileModule(source, {compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext}}).outputText;
writeFileSync('.sites-runtime/chat-api.mjs', source);
const {GET, POST} = await import('../.sites-runtime/chat-api.mjs');
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
assert.deepEqual((await call('alice', null, '?action=search&q='+bob.handle.toLowerCase())).people, [{handle:bob.handle,name:'Bob',bio:''}]);
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
const stamp = Date.now() + 10;
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
sqlite.close();
console.log('Passed: automatic permanent IDs, collision retries, legacy migration, profiles, search, messaging, read receipts, private saved messages, notes, authorization, and history pagination.');
