import {env} from 'cloudflare:workers';
import {getChatGPTUser} from '../../chatgpt-auth';
import {AVATAR_LIMIT, FILE_LIMIT, RequestError, attachment, imageType, readLimitedBody, type Upload} from './storage';

export const dynamic = 'force-dynamic';
const json = (data: unknown, status = 200) => Response.json(data, {status, headers: {'Cache-Control':'no-store'}});
const failure = (error: unknown) => {
  if (error instanceof RequestError) return json({error:error.message}, error.status);
  console.error('Media request failed', error);
  return json({error:'Could not access this file. Please try again.'},500);
};
async function identity(request: Request, write = false) {
  if (write && request.headers.get('Origin') !== new URL(request.url).origin) throw new RequestError('Invalid request origin.',403);
  const user = await getChatGPTUser();
  if (!user) throw new RequestError('Please sign in.',401);
  return user.userId;
}

export async function POST(request: Request) {
  try {
    const owner = await identity(request,true), db = env.DB!;
    if (!await db.prepare('SELECT id FROM profiles WHERE id = ?').bind(owner).first()) throw new RequestError('Create your profile first.');
    if (!env.BUCKET) throw new RequestError('File storage is not configured.',503);
    const url = new URL(request.url), kind = url.searchParams.get('kind') || 'attachment';
    if (kind !== 'attachment' && kind !== 'avatar') throw new RequestError('Invalid upload type.');
    const conversation = kind === 'attachment' ? url.searchParams.get('conversation') : null;
    if (conversation && !await db.prepare('SELECT id FROM conversations WHERE id = ? AND (a = ? OR b = ?)').bind(conversation,owner,owner).first()) throw new RequestError('Conversation not found.',404);
    const bytes = await readLimitedBody(request,kind === 'avatar' ? AVATAR_LIMIT : FILE_LIMIT);
    if (!bytes.length) throw new RequestError('Choose a file that is not empty.');
    const detected = imageType(bytes);
    const locked=url.searchParams.get('locked')==='1';
    if(locked && (kind!=='attachment'||!detected))throw new RequestError('Download locks apply to shared images.');
    if (kind === 'avatar' && (!detected || detected === 'image/gif')) throw new RequestError('Choose a JPG, PNG, or WebP profile photo.');
    let name: string;
    try {name = decodeURIComponent(request.headers.get('X-File-Name') || 'file');} catch {throw new RequestError('Invalid filename.');}
    name = [...name.replace(/[\x00-\x1f\x7f/\\]/g,'_').trim()].slice(0,120).join('') || 'file';
    const id = crypto.randomUUID(), type = detected || 'application/octet-stream', created = Date.now();
    await env.BUCKET.put(id,bytes,{httpMetadata:{contentType:type}});
    try {
      await db.prepare('INSERT INTO uploads (id, owner, conversation, kind, name, type, size, created, download_locked) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(id,owner,conversation,kind,name,type,bytes.length,created,locked?1:0).run();
    } catch(error) {await env.BUCKET.delete(id); throw error;}
    return json({attachment:attachment({id,owner,conversation,kind,name,type,size:bytes.length,download_locked:locked?1:0},owner)});
  } catch(error) {return failure(error);}
}

export async function GET(request: Request) {
  try {
    const owner = await identity(request), id = new URL(request.url).searchParams.get('id') || '', db = env.DB!;
    const file = await db.prepare('SELECT * FROM uploads WHERE id = ?').bind(id).first<Upload>();
    if (!file) throw new RequestError('File not found.',404);
    const allowed = file.owner === owner ||
      await db.prepare('SELECT id FROM profiles WHERE avatar = ?').bind(id).first() ||
      await db.prepare('SELECT m.id FROM messages m JOIN conversations c ON c.id = m.conversation WHERE m.attachment = ? AND (c.a = ? OR c.b = ?) LIMIT 1').bind(id,owner,owner).first() ||
      await db.prepare('SELECT id FROM saved_messages WHERE attachment = ? AND owner = ? LIMIT 1').bind(id,owner).first();
    if (!allowed) throw new RequestError('File not found.',404);
    if(file.download_locked && file.owner!==owner && new URL(request.url).searchParams.get('download')==='1')throw new RequestError('The sender has locked downloads for this image.',403);
    const object = await env.BUCKET?.get(id);
    if (!object) throw new RequestError('File not found.',404);
    const inline = file.type.startsWith('image/') && new URL(request.url).searchParams.get('download') !== '1';
    return new Response(object.body,{headers:{
      'Content-Type':file.type,
      'Content-Length':String(file.size),
      'Content-Disposition':`${inline ? 'inline' : 'attachment'}; filename="download"; filename*=UTF-8''${encodeURIComponent(file.name).replace(/['()*]/g,c => '%' + c.charCodeAt(0).toString(16))}`,
      'Cache-Control':'private, no-store',
      'X-Content-Type-Options':'nosniff',
      'Content-Security-Policy':"default-src 'none'; sandbox",
      'Cross-Origin-Resource-Policy':'same-origin',
    }});
  } catch(error) {return failure(error);}
}

export async function PATCH(request:Request) {
  try {
    const owner=await identity(request,true),db=env.DB!,id=new URL(request.url).searchParams.get('id')||'';
    let data: {locked?:unknown};
    try {data=JSON.parse(new TextDecoder().decode(await readLimitedBody(request,1024)));}catch(error){if(error instanceof RequestError)throw error;throw new RequestError('Invalid download setting.');}
    if(!data||typeof data.locked!=='boolean')throw new RequestError('Choose whether downloads are locked.');
    const file=await db.prepare('SELECT * FROM uploads WHERE id = ? AND owner = ? AND kind = ?').bind(id,owner,'attachment').first<Upload>();
    if(!file)throw new RequestError('Image not found.',404);
    if(!file.type.startsWith('image/'))throw new RequestError('Download locks apply to shared images.');
    await db.prepare('UPDATE uploads SET download_locked = ? WHERE id = ? AND owner = ?').bind(data.locked?1:0,id,owner).run();
    return json({attachment:attachment({...file,download_locked:data.locked?1:0},owner)});
  }catch(error){return failure(error);}
}

export async function DELETE(request: Request) {
  try {
    const owner = await identity(request,true), id = new URL(request.url).searchParams.get('id') || '', db = env.DB!;
    const file = await db.prepare('SELECT id FROM uploads WHERE id = ? AND owner = ?').bind(id,owner).first();
    if (!file) throw new RequestError('File not found.',404);
    const used = await db.prepare('SELECT id FROM messages WHERE attachment = ? UNION ALL SELECT id FROM saved_messages WHERE attachment = ? UNION ALL SELECT id FROM profiles WHERE avatar = ? LIMIT 1').bind(id,id,id).first();
    if (used) throw new RequestError('This file is already in use.',409);
    // Remove the metadata first: a concurrent message insert then fails its foreign key.
    await db.prepare('DELETE FROM uploads WHERE id = ? AND owner = ?').bind(id,owner).run();
    await env.BUCKET?.delete(id);
    return json({ok:true});
  } catch(error) {return failure(error);}
}
