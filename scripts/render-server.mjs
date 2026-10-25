import {createServer} from 'node:http';
import {Readable} from 'node:stream';
import {AsyncLocalStorage} from 'node:async_hooks';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {nodeDatabase} from './node-database.mjs';
import {localBucket} from './local-bucket.mjs';
import {compilePreviewApi} from './compile-preview-api.mjs';
import {renderAuth} from './render-auth.mjs';

export async function createRenderServer({origin,directory,assets='dist/render'}) {
  const parsed=new URL(origin);
  if(parsed.origin!==origin||parsed.username||parsed.password||!(parsed.protocol==='https:'||(parsed.protocol==='http:'&&['127.0.0.1','localhost'].includes(parsed.hostname))))throw new Error('APP_ORIGIN must be an HTTPS origin, or loopback HTTP for testing.');
  const {db,sqlite}=nodeDatabase(directory),context=new AsyncLocalStorage(),id=randomUUID();
  const runtime={db,context,bucket:localBucket(resolve(directory,'uploads'))};
  globalThis.__deepiNodeRuntimes??=new Map();globalThis.__deepiNodeRuntimes.set(id,runtime);
  const modules=compilePreviewApi('render-api-'+id,`const runtime=globalThis.__deepiNodeRuntimes.get(${JSON.stringify(id)});export const env={DB:runtime.db,BUCKET:runtime.bucket};export const getChatGPTUser=async()=>runtime.context.getStore()||null;`);
  const chat=await import(modules.chat),media=await import(modules.media),auth=renderAuth(sqlite,{origin,secure:parsed.protocol==='https:'});
  const staticFiles={'/':['text/html; charset=utf-8','index.html'],'/app.js':['text/javascript; charset=utf-8','app.js'],'/app.css':['text/css; charset=utf-8','app.css'],'/favicon.svg':['image/svg+xml','favicon.svg']};
  const cache=new Map(Object.entries(staticFiles).map(([path,[type,file]])=>[path,{type,body:readFileSync(resolve(assets,file))}]));
  const server=createServer(async(request,response)=>{
    response.setHeader('X-Content-Type-Options','nosniff');response.setHeader('Referrer-Policy','same-origin');response.setHeader('X-Frame-Options','DENY');
    response.setHeader('Cache-Control','no-store');
    response.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' blob: data: https://cdn.jsdelivr.net; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'; form-action 'self'");
    try{
      const url=new URL(request.url||'/',origin);
      if(url.pathname==='/healthz'){sqlite.prepare('SELECT 1').get();response.writeHead(200,{'Content-Type':'text/plain'});response.end('ok');return;}
      if(request.headers.host!==parsed.host){response.writeHead(403);response.end('Invalid host.');return;}
      const headers={...request.headers};for(const key of Object.keys(headers))if(key.startsWith('oai-authenticated-user-'))delete headers[key];
      if(url.pathname.startsWith('/api/')){
        const hasBody=!['GET','HEAD'].includes(request.method);
        const req=new Request(url,{method:request.method,headers,...(hasBody?{body:Readable.toWeb(request),duplex:'half'}:{})});
        const user=auth.identify(headers);
        let result;
        if(url.pathname.startsWith('/api/auth/')){
          const forwarded=String(request.headers['x-forwarded-for']||'').split(',').at(-1)?.trim();
          result=await auth.handle(req,forwarded||request.socket.remoteAddress);
        }else{
          const module=url.pathname==='/api/chat'?chat:url.pathname==='/api/media'?media:null;
          const handler=module?.[request.method];
          result=handler?await context.run(user,()=>handler(req)):Response.json({error:'Not found.'},{status:404});
          if(url.pathname==='/api/chat'&&request.method==='GET'){
            const data=await result.json();result=Response.json({...data,authMode:'password'},{status:result.status,headers:result.headers});
          }
        }
        response.writeHead(result.status,Object.fromEntries(result.headers));
        if(result.body)Readable.fromWeb(result.body).pipe(response);else response.end();
        return;
      }
      const asset=cache.get(url.pathname);
      if(!asset||request.method!=='GET'){response.writeHead(404);response.end('Not found.');return;}
      response.writeHead(200,{'Content-Type':asset.type});response.end(asset.body);
    }catch(error){
      console.error('Request failed',error);
      if(!response.headersSent)response.writeHead(500,{'Content-Type':'application/json'});
      response.end(JSON.stringify({error:'Something went wrong. Please try again.'}));
    }
  });
  server.requestTimeout=120000;server.headersTimeout=30000;
  server.on('close',()=>{globalThis.__deepiNodeRuntimes.delete(id);sqlite.close();});
  return {server,sqlite};
}
