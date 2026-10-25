import {randomBytes,randomUUID,scrypt as deriveKey,timingSafeEqual,createHash} from 'node:crypto';
import {promisify} from 'node:util';
const scrypt=promisify(deriveKey),ttl=30*24*60*60*1000;
const digest=value=>createHash('sha256').update(value).digest('hex');
const json=(data,status=200,headers={})=>Response.json(data,{status,headers:{'Cache-Control':'no-store',...headers}});

export function renderAuth(sqlite,{origin,secure=true}) {
  // These tables are specific to the Render runtime and never use request identity headers.
  sqlite.exec(`CREATE TABLE IF NOT EXISTS render_accounts (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, salt TEXT NOT NULL, password_hash TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS render_sessions (token_hash TEXT PRIMARY KEY, account TEXT NOT NULL REFERENCES render_accounts(id), expires INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS render_sessions_account ON render_sessions(account);`);
  sqlite.prepare('DELETE FROM render_sessions WHERE expires <= ?').run(Date.now());
  const attempts=new Map();let active=0;
  const cookie=(token,maxAge=ttl/1000)=>`__deepi_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure?'; Secure':''}`;
  function identify(headers){
    const cookies=(headers.cookie||'').split(';').map(value=>value.trim()).filter(value=>value.startsWith('__deepi_session='));
    if(cookies.length!==1)return null;
    const token=cookies[0].slice('__deepi_session='.length);
    if(!/^[A-Za-z0-9_-]{43}$/.test(token))return null;
    const row=sqlite.prepare('SELECT a.id, a.email FROM render_sessions s JOIN render_accounts a ON a.id = s.account WHERE s.token_hash = ? AND s.expires > ?').get(digest(token),Date.now());
    return row?{userId:row.id,email:row.email}:null;
  }
  async function handle(request,clientIp='unknown'){
    if(request.method!=='POST')return json({error:'Method not allowed.'},405);
    if(request.headers.get('origin')!==origin)return json({error:'Invalid request origin.'},403);
    const action=new URL(request.url).pathname.split('/').pop();
    if(action==='logout'){
      const token=(request.headers.get('cookie')||'').split(';').map(value=>value.trim()).find(value=>value.startsWith('__deepi_session='))?.slice('__deepi_session='.length);
      if(token)sqlite.prepare('DELETE FROM render_sessions WHERE token_hash = ?').run(digest(token));
      return json({ok:true},200,{'Set-Cookie':cookie('',0)});
    }
    if(!['register','login'].includes(action))return json({error:'Not found.'},404);
    const now=Date.now();
    for(const [key,value]of attempts)if(value.until<now)attempts.delete(key);
    const limit=attempts.get(clientIp)||{count:0,until:now+15*60*1000};
    if(limit.count>=20)return json({error:'Too many sign-in attempts. Please try again later.'},429);
    limit.count++;attempts.set(clientIp,limit);
    if(active>=4)return json({error:'Sign-in is busy. Please try again in a moment.'},429);
    active++;
    try{
      const chunks=[];let size=0;
      for await(const chunk of request.body||[]){size+=chunk.length;if(size>4096)return json({error:'Request is too large.'},413);chunks.push(chunk);}
      let data;try{data=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{return json({error:'Invalid request.'},400);}
      const email=typeof data?.email==='string'?data.email.trim().toLowerCase():'',password=typeof data?.password==='string'?data.password:'';
      if(email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||!password||password.length>128)return json({error:'Enter a valid email and password.'},400);
      let account=sqlite.prepare('SELECT * FROM render_accounts WHERE email = ?').get(email);
      if(action==='register'){
        if(password.length<10)return json({error:'Use at least 10 characters for your password.'},400);
        const salt=randomBytes(16).toString('hex'),hash=await scrypt(password,salt,64);
        if(account)return json({error:'An account already uses this email. Try signing in.'},409);
        account={id:randomUUID(),email,salt,password_hash:hash.toString('hex')};
        try{sqlite.prepare('INSERT INTO render_accounts (id, email, salt, password_hash) VALUES (?, ?, ?, ?)').run(account.id,email,salt,account.password_hash);}
        catch(error){if(String(error).includes('UNIQUE'))return json({error:'An account already uses this email. Try signing in.'},409);throw error;}
      }else{
        const hash=await scrypt(password,account?.salt||'unknown-account-salt',64),expected=Buffer.from(account?.password_hash||'00'.repeat(64),'hex');
        if(!account||expected.length!==hash.length||!timingSafeEqual(hash,expected))return json({error:'Email or password is incorrect.'},401);
      }
      const token=randomBytes(32).toString('base64url');
      sqlite.prepare('INSERT INTO render_sessions (token_hash, account, expires) VALUES (?, ?, ?)').run(digest(token),account.id,Date.now()+ttl);
      return json({ok:true},200,{'Set-Cookie':cookie(token)});
    }finally{active--;}
  }
  return {identify,handle};
}
