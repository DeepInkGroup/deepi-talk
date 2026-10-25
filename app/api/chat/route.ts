import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '../../chatgpt-auth';
import { generateUserId, ensurePermanentId } from './identity';
import { RequestError, attachment, attachmentColumns, ownedAttachment, readLimitedBody, withAttachment, type Upload } from '../media/storage';

export const dynamic = 'force-dynamic';
type Profile = {id: string; handle: string; name: string; bio: string; avatar: string | null};
type Conversation = {id: string; a: string; b: string; read_a: number; read_b: number};
const json = (data: unknown, status = 200) => Response.json(data, {status, headers: {'Cache-Control': 'no-store'}});
const publicProfile = (p: Profile) => ({handle: p.handle, name: p.name, bio: p.bio, avatarUrl: p.avatar ? '/api/media?id=' + p.avatar : null});

export async function GET(request: Request) {
  try {
    const user = await getChatGPTUser();
    if (!user) return json({signedIn: false});
    const db = env.DB!;
    let me = await db.prepare('SELECT * FROM profiles WHERE id = ?').bind(user.userId).first<Profile>();
    const url = new URL(request.url);
    const action = url.searchParams.get('action');
    if (!me) return json({signedIn: true, me: null});
    me = await ensurePermanentId(db, me);
    if (action === 'search') {
      const q = (url.searchParams.get('q') || '').trim().replace(/^@/, '').toUpperCase();
      if (!/^[A-Z0-9]{2,8}$/.test(q)) return json({people: []});
      const rows = await db.prepare("SELECT handle, name, bio, CASE WHEN avatar IS NOT NULL THEN '/api/media?id=' || avatar ELSE NULL END AS avatarUrl FROM profiles WHERE handle LIKE ? AND id != ? ORDER BY CASE WHEN handle = ? THEN 0 ELSE 1 END, handle LIMIT 15")
        .bind(q + '%', me.id, q).all();
      return json({people: rows.results});
    }
    if (action === 'saved') {
      const before = Number(url.searchParams.get('before') || 0), beforeId = url.searchParams.get('beforeId') || '';
      if (!Number.isFinite(before)) return json({error: 'Invalid message cursor.'}, 400);
      const rows = await db.prepare(`SELECT s.id, s.body, s.created, s.edited_at AS editedAt, s.source_name AS sourceName, 1 AS mine, ${attachmentColumns} FROM saved_messages s LEFT JOIN uploads f ON f.id = s.attachment WHERE s.owner = ? AND (? = 0 OR s.created < ? OR (s.created = ? AND s.id < ?)) ORDER BY s.created DESC, s.id DESC LIMIT 80`).bind(me.id, before, before, before, beforeId).all();
      return json({messages: rows.results.reverse().map(row=>withAttachment(row,me.id)), peerRead: 0, hasMore: rows.results.length === 80});
    }
    if (action === 'messages') {
      const id = url.searchParams.get('id');
      const c = await db.prepare('SELECT * FROM conversations WHERE id = ? AND (a = ? OR b = ?)').bind(id, me.id, me.id).first<Conversation>();
      if (!c) return json({error: 'Conversation not found.'}, 404);
      const before = Number(url.searchParams.get('before') || 0);
      const beforeId = url.searchParams.get('beforeId') || '';
      if (!Number.isFinite(before)) return json({error: 'Invalid message cursor.'}, 400);
      const rows = await db.prepare(`SELECT m.id, m.body, m.created, m.edited_at AS editedAt, m.sender = ? AS mine, (SELECT s.id FROM saved_messages s WHERE s.owner = ? AND s.source_message = m.id) AS savedId, ${attachmentColumns} FROM messages m LEFT JOIN uploads f ON f.id = m.attachment WHERE m.conversation = ? AND (? = 0 OR m.created < ? OR (m.created = ? AND m.id < ?)) ORDER BY m.created DESC, m.id DESC LIMIT 80`)
        .bind(me.id, me.id, id, before, before, before, beforeId).all();
      return json({messages: rows.results.reverse().map(row=>withAttachment(row,me.id)), peerRead: c.a === me.id ? c.read_b : c.read_a, hasMore: rows.results.length === 80});
    }
    const list = await db.prepare(`SELECT c.id, p.handle, p.name, p.bio, CASE WHEN p.avatar IS NOT NULL THEN '/api/media?id=' || p.avatar ELSE NULL END AS avatarUrl, c.updated,
      (SELECT CASE WHEN body <> '' THEN body WHEN attachment IS NOT NULL THEN 'Attachment' ELSE '' END FROM messages WHERE conversation = c.id ORDER BY created DESC, id DESC LIMIT 1) AS last,
      (SELECT COUNT(*) FROM messages WHERE conversation = c.id AND sender != ? AND created > CASE WHEN c.a = ? THEN c.read_a ELSE c.read_b END) AS unread
      FROM conversations c JOIN profiles p ON p.id = CASE WHEN c.a = ? THEN c.b ELSE c.a END
      WHERE c.a = ? OR c.b = ? ORDER BY c.updated DESC`).bind(me.id, me.id, me.id, me.id, me.id).all();
    const saved = await db.prepare('SELECT COUNT(*) AS count FROM saved_messages WHERE owner = ?').bind(me.id).first<{count: number}>();
    return json({signedIn: true, me: publicProfile(me), conversations: list.results, savedCount: saved?.count || 0});
  } catch (error) { console.error('Chat read failed', error); return json({error: 'Could not connect. Please try again.'}, 500); }
}

export async function POST(request: Request) {
  try {
    if (request.headers.get('Origin') !== new URL(request.url).origin) return json({error: 'Invalid request origin.'}, 403);
    const user = await getChatGPTUser();
    if (!user) return json({error: 'Please sign in.'}, 401);
    if (Number(request.headers.get('content-length') || 0) > 24000) return json({error: 'Message is too long.'}, 413);
    let data: Record<string, unknown>;
    try {data = JSON.parse(new TextDecoder().decode(await readLimitedBody(request,24000)));}
    catch(error) {if (error instanceof RequestError) throw error; return json({error:'Invalid request body.'},400);}
    if (!data || typeof data !== 'object' || Array.isArray(data)) return json({error:'Invalid request body.'},400);
    const db = env.DB!;
    if (data.action === 'profile') {
      const name = typeof data.name === 'string' ? data.name.trim() : '';
      const bio = typeof data.bio === 'string' ? data.bio.trim() : '';
      if (!name || name.length > 40) return json({error: 'Use a name between 1 and 40 characters.'}, 400);
      if (bio.length > 160) return json({error: 'Your bio can have up to 160 characters.'}, 400);
      if (Object.hasOwn(data, 'handle')) return json({error: 'Your ID is assigned automatically and cannot be changed.'}, 400);
      let profile = await db.prepare('SELECT * FROM profiles WHERE id = ?').bind(user.userId).first<Profile>();
      let avatarId = profile?.avatar || null;
      if (Object.hasOwn(data,'avatarId')) {
        if (data.avatarId === null) avatarId = null;
        else {
          if (typeof data.avatarId !== 'string') return json({error:'Invalid profile photo.'},400);
          const photo = await db.prepare('SELECT id FROM uploads WHERE id = ? AND owner = ? AND kind = ?').bind(data.avatarId,user.userId,'avatar').first<{id:string}>();
          if (!photo) return json({error:'This profile photo is not available.'},403);
          avatarId = photo.id;
        }
      }
      if (!profile) {
        for (let attempt = 0; attempt < 12; attempt++) {
          try {
            await db.prepare('INSERT INTO profiles (id, handle, name, bio) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO NOTHING').bind(user.userId, generateUserId(), name, bio).run();
            break;
          } catch (error) {if (!String(error).includes('UNIQUE') || attempt === 11) throw error;}
        }
      } else {
        await db.prepare('UPDATE profiles SET name = ?, bio = ?, avatar = ? WHERE id = ?').bind(name, bio, avatarId, user.userId).run();
      }
      profile = await db.prepare('SELECT * FROM profiles WHERE id = ?').bind(user.userId).first<Profile>();
      return json({me: publicProfile(await ensurePermanentId(db, profile!))});
    }
    const me = await db.prepare('SELECT * FROM profiles WHERE id = ?').bind(user.userId).first<Profile>();
    if (!me) return json({error: 'Create your profile first.'}, 400);
    if(data.action==='editSaved') {
      const id=String(data.messageId||''),body=typeof data.body==='string'?data.body.trim():'';
      const note=await db.prepare('SELECT * FROM saved_messages WHERE id = ? AND owner = ? AND source_message IS NULL').bind(id,me.id).first<{attachment:string|null}>();
      if(!note)return json({error:'Private note not found.'},404);
      if((!body&&!note.attachment)||body.length>4000)return json({error:'Add text or keep an attachment (up to 4,000 characters).'},400);
      const editedAt=Date.now();
      await db.prepare('UPDATE saved_messages SET body = ?, edited_at = ? WHERE id = ? AND owner = ? AND source_message IS NULL').bind(body,editedAt,id,me.id).run();
      return json({edit:{id,body,editedAt}});
    }
    if (data.action === 'saveNote' || data.action === 'saveMessage') {
      let body = typeof data.body === 'string' ? data.body.trim() : '';
      let file: Upload | null = null;
      let sourceMessage: string | null = null, sourceName: string | null = null;
      if (data.action === 'saveMessage') {
        const source = await db.prepare('SELECT m.id, m.body, m.attachment, p.name FROM messages m JOIN conversations c ON c.id = m.conversation JOIN profiles p ON p.id = m.sender WHERE m.id = ? AND (c.a = ? OR c.b = ?)').bind(String(data.messageId || ''), me.id, me.id).first<{id: string; body: string; name: string; attachment: string | null}>();
        if (!source) return json({error: 'Message not found.'}, 404);
        body = source.body; sourceMessage = source.id; sourceName = source.name;
        if (source.attachment) file = await db.prepare('SELECT * FROM uploads WHERE id = ?').bind(source.attachment).first<Upload>();
      } else {file = await ownedAttachment(db,me.id,data.attachmentId,null);}
      if ((!body && !file) || body.length > 4000) return json({error: 'Add a message or an attachment (up to 4,000 characters).'}, 400);
      const id = crypto.randomUUID(), created = Date.now();
      await db.prepare('INSERT INTO saved_messages (id, owner, body, attachment, source_message, source_name, created) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(owner, source_message) DO NOTHING').bind(id, me.id, body, file?.id || null, sourceMessage, sourceName, created).run();
      const saved = sourceMessage ? await db.prepare(`SELECT s.id, s.body, s.created, s.edited_at AS editedAt, s.source_name AS sourceName, 1 AS mine, ${attachmentColumns} FROM saved_messages s LEFT JOIN uploads f ON f.id = s.attachment WHERE s.owner = ? AND s.source_message = ?`).bind(me.id, sourceMessage).first().then(row => row ? withAttachment(row,me.id) : null) : {id, body, created, mine: 1, sourceName: null, attachment:attachment(file,me.id)};
      return json({message: saved, savedId: saved!.id});
    }
    if (data.action === 'removeSaved') {
      const savedId = String(data.savedId || '');
      const saved = await db.prepare('SELECT id FROM saved_messages WHERE id = ? AND owner = ?').bind(savedId, me.id).first();
      if (!saved) return json({error: 'Saved message not found.'}, 404);
      await db.prepare('DELETE FROM saved_messages WHERE id = ? AND owner = ?').bind(savedId, me.id).run();
      return json({ok: true});
    }
    if (data.action === 'start') {
      const peer = await db.prepare('SELECT * FROM profiles WHERE handle = ? AND id != ?').bind(String(data.handle || '').trim().replace(/^@/, '').toUpperCase(), me.id).first<Profile>();
      if (!peer) return json({error: 'This person could not be found.'}, 404);
      const [a, b] = [me.id, peer.id].sort();
      const id = JSON.stringify([a, b]);
      await db.prepare('INSERT INTO conversations (id, a, b, updated) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO NOTHING').bind(id, a, b, Date.now()).run();
      return json({conversation: {id, ...publicProfile(peer), last: null, unread: 0, updated: Date.now()}});
    }
    const c = await db.prepare('SELECT * FROM conversations WHERE id = ? AND (a = ? OR b = ?)').bind(String(data.id || ''), me.id, me.id).first<Conversation>();
    if (!c) return json({error: 'Conversation not found.'}, 404);
    if(data.action==='edit') {
      const id=String(data.messageId||''),body=typeof data.body==='string'?data.body.trim():'';
      const message=await db.prepare('SELECT attachment FROM messages WHERE id = ? AND conversation = ? AND sender = ?').bind(id,c.id,me.id).first<{attachment:string|null}>();
      if(!message)return json({error:'Your message could not be found.'},404);
      if((!body&&!message.attachment)||body.length>4000)return json({error:'Add text or keep an attachment (up to 4,000 characters).'},400);
      const editedAt=Date.now();
      await db.prepare('UPDATE messages SET body = ?, edited_at = ? WHERE id = ? AND conversation = ? AND sender = ?').bind(body,editedAt,id,c.id,me.id).run();
      return json({edit:{id,body,editedAt}});
    }
    if (data.action === 'read') {
      const at = Math.min(Date.now(), Number(data.at) || 0);
      await db.prepare(`UPDATE conversations SET ${c.a === me.id ? 'read_a' : 'read_b'} = MAX(${c.a === me.id ? 'read_a' : 'read_b'}, ?) WHERE id = ?`).bind(at, c.id).run();
      return json({ok: true});
    }
    if (data.action === 'send') {
      const body = typeof data.body === 'string' ? data.body.trim() : '';
      const file = await ownedAttachment(db,me.id,data.attachmentId,c.id);
      if ((!body && !file) || body.length > 4000) return json({error: 'Add a message or an attachment (up to 4,000 characters).'}, 400);
      const created = Date.now(), id = crypto.randomUUID();
      await db.batch([
        db.prepare('INSERT INTO messages (id, conversation, sender, body, attachment, created) VALUES (?, ?, ?, ?, ?, ?)').bind(id, c.id, me.id, body, file?.id || null, created),
        db.prepare('UPDATE conversations SET updated = ? WHERE id = ?').bind(created, c.id),
      ]);
      return json({message: {id, body, created, mine: 1, attachment:attachment(file,me.id)}});
    }
    return json({error: 'Unknown action.'}, 400);
  } catch (error) { if (error instanceof RequestError) return json({error:error.message},error.status); console.error('Chat write failed', error); return json({error: 'Could not save. Please try again.'}, 500); }
}
