// A loopback-only preview for Windows environments that cannot create process pipes.
// Uses the real React component and API handlers with SQLite and the starter's mock auth.
import {createServer} from 'node:http';
import {AsyncLocalStorage} from 'node:async_hooks';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync, writeFileSync, mkdirSync, existsSync} from 'node:fs';
import {build} from 'rolldown';
import ts from 'typescript';
import {sites} from './vite/sites-vite-plugin.ts';

mkdirSync('.sites-runtime', {recursive:true});
writeFileSync('.sites-runtime/preview-entry.tsx', "import React from 'react'; import {createRoot} from 'react-dom/client'; import Messenger from '../app/messenger'; createRoot(document.getElementById('root')!).render(<Messenger/>);");
await build({input:'./.sites-runtime/preview-entry.tsx',platform:'browser',transform:{jsx:{runtime:'automatic'},define:{'process.env.NODE_ENV':JSON.stringify('production')}},output:{file:'.sites-runtime/preview-app.js',format:'esm'}});
const newDatabase = !existsSync('.sites-runtime/preview.sqlite');
const sqlite = new DatabaseSync('.sites-runtime/preview.sqlite');
if (newDatabase) sqlite.exec(readFileSync('drizzle/0000_messenger.sql', 'utf8'));
sqlite.exec('CREATE TABLE IF NOT EXISTS local_schema_migrations (tag TEXT PRIMARY KEY)');
sqlite.prepare('INSERT OR IGNORE INTO local_schema_migrations (tag) VALUES (?)').run('0000_messenger');
const journal = JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8'));
for (const migration of journal.entries) {
  if (sqlite.prepare('SELECT tag FROM local_schema_migrations WHERE tag = ?').get(migration.tag)) continue;
  sqlite.exec('BEGIN');
  try {
    sqlite.exec(readFileSync('drizzle/' + migration.tag + '.sql', 'utf8'));
    sqlite.prepare('INSERT INTO local_schema_migrations (tag) VALUES (?)').run(migration.tag);
    sqlite.exec('COMMIT');
  } catch (error) {sqlite.exec('ROLLBACK'); throw error;}
}
const database = {prepare(sql) {
  return {bind(...args) {const statement = sqlite.prepare(sql); return {
    async first() {return statement.get(...args) || null;},
    async all() {return {results: statement.all(...args)};},
    async run() {return statement.run(...args);},
  };}};
}, async batch(statements) {
  sqlite.exec('BEGIN');
  try {const result = await Promise.all(statements.map(statement => statement.run())); sqlite.exec('COMMIT'); return result;}
  catch(error) {sqlite.exec('ROLLBACK'); throw error;}
}};
const context = new AsyncLocalStorage();
globalThis.__deepiPreview = {database, context};
writeFileSync('.sites-runtime/preview-context.mjs', `export const env={DB:globalThis.__deepiPreview.database}; export async function getChatGPTUser(){const headers=globalThis.__deepiPreview.context.getStore(); const userId=headers['oai-authenticated-user-id']; return userId ? {userId,email:headers['oai-authenticated-user-email']} : null;}`);
const identity = readFileSync('app/api/chat/identity.ts','utf8');
writeFileSync('.sites-runtime/preview-identity.mjs', ts.transpileModule(identity,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText);
const route = readFileSync('app/api/chat/route.ts','utf8').replace("'cloudflare:workers'", "'./preview-context.mjs'").replace("'../../chatgpt-auth'", "'./preview-context.mjs'").replace("'./identity'", "'./preview-identity.mjs'");
writeFileSync('.sites-runtime/preview-api.mjs', ts.transpileModule(route,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText);
const {GET,POST} = await import('../.sites-runtime/preview-api.mjs');
const middleware = [];
const mockAuth = sites({mockAuth:true});
mockAuth.configureServer({config:{server:{},logger:console},middlewares:{use(fn){middleware.push(fn);}}});
const css = readFileSync('app/globals.css','utf8').replace("@import 'tailwindcss';",'');
const html = '<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Deepi Talk</title><link rel="icon" href="/favicon.svg"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>';
const server = createServer(async (request, response) => {
  if (!['127.0.0.1:5173','localhost:5173'].includes(request.headers.host)) {response.writeHead(403); response.end(); return;}
  let index = 0;
  const next = () => {
    if (middleware[index]) return middleware[index++](request,response,next);
    context.run(request.headers, async () => {
      try {
        const url = new URL(request.url,'http://' + request.headers.host);
        if (url.pathname === '/api/chat') {
          let body = '';
          for await (const chunk of request) {body += chunk; if (body.length > 24000) {response.writeHead(413); response.end(); return;}}
          const req = new Request(url, {method:request.method,headers:request.headers,...(body ? {body} : {})});
          const result = request.method === 'POST' ? await POST(req) : await GET(req);
          response.writeHead(result.status,Object.fromEntries(result.headers)); response.end(await result.text()); return;
        }
        const assets = {'/app.css':['text/css',css],'/app.js':['text/javascript',readFileSync('.sites-runtime/preview-app.js')],'/favicon.svg':['image/svg+xml',readFileSync('public/favicon.svg')]};
        if (assets[url.pathname]) {response.writeHead(200,{'Content-Type':assets[url.pathname][0]}); response.end(assets[url.pathname][1]);return;}
        if (url.pathname !== '/') {response.writeHead(404);response.end();return;}
        response.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});response.end(html);
      } catch(error) {console.error(error);response.writeHead(500);response.end('Preview request failed.');}
    });
  };
  next();
});
server.listen(5173,'127.0.0.1',() => console.log('Deepi Talk local preview: http://127.0.0.1:5173'));
for(const signal of ['SIGINT','SIGTERM']) process.on(signal,() => server.close(() => {sqlite.close();process.exit(0);}));
