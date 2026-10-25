import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '../../chatgpt-auth';
import { generateUserId, ensurePermanentId } from './identity';

export const dynamic = 'force-dynamic';
type Profile = {id: string; handle: string; name: string; bio: string};
type Conversation = {id: string; a: string; b: string; read_a: number; read_b: number};
const json = (data: unknown, status = 200) => Response.json(data, {status, headers: {'Cache-Control': 'no-store'}});
const publicProfile = (p: Profile) => ({handle: p.handle, name: p.name, bio: p.bio});

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
      const rows = await db.prepare('SELECT handle, name, bio FROM profiles WHERE handle LIKE ? AND id != ? ORDER BY CASE WHEN handle = ? THEN 0 ELSE 1 END, handle LIMIT 15')
        .bind(q + '%', me.id, q).all();
      return json({people: rows.results});
    }
    if (action === 'saved') {
      const before = Number(url.searchParams.get('before') || 0), beforeId = url.searchParams.get('beforeId') || '';
      if (!Number.isFinite(before)) return json({error: 'Invalid message cursor.'}, 400);
      const rows = await db.prepare('SELECT id, body, created, source_name AS sourceName, 1 AS mine FROM saved_messages WHERE owner = ? AND (? = 0 OR created < ? OR (created = ? AND id < ?)) ORDER BY created DESC, id DESC LIMIT 80').bind(me.id, before, before, before, beforeId).all();
      return json({messages: rows.results.reverse(), peerRead: 0, hasMore: rows.results.length === 80});
    }
    if (action === 'messages') {
      const id = url.searchParams.get('id');
      const c = await db.prepare('SELECT * FROM conversations WHERE id = ? AND (a = ? OR b = ?)').bind(id, me.id, me.id).first<Conversation>();
      if (!c) return json({error: 'Conversation not found.'}, 404);
      const before = Number(url.searchParams.get('before') || 0);
      const beforeId = url.searchParams.get('beforeId') || '';
      if (!Number.isFinite(before)) return json({error: 'Invalid message cursor.'}, 400);
      const rows = await db.prepare('SELECT m.id, m.body, m.created, m.sender = ? AS mine, (SELECT s.id FROM saved_messages s WHERE s.owner = ? AND s.source_message = m.id) AS savedId FROM messages m WHERE conversation = ? AND (? = 0 OR m.created < ? OR (m.created = ? AND m.id < ?)) ORDER BY m.created DESC, m.id DESC LIMIT 80')
        .bind(me.id, me.id, id, before, before, before, beforeId).all();
      return json({messages: rows.results.reverse(), peerRead: c.a === me.id ? c.read_b : c.read_a, hasMore: rows.results.length === 80});
    }
    const list = await db.prepare(`SELECT c.id, p.handle, p.name, p.bio, c.updated,
      (SELECT body FROM messages WHERE conversation = c.id ORDER BY created DESC, id DESC LIMIT 1) AS last,
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
    const data = await request.json() as Record<string, unknown>;
    const db = env.DB!;
    if (data.action === 'profile') {
      const name = typeof data.name === 'string' ? data.name.trim() : '';
      const bio = typeof data.bio === 'string' ? data.bio.trim() : '';
      if (!name || name.length > 40) return json({error: 'Use a name between 1 and 40 characters.'}, 400);
      if (bio.length > 160) return json({error: 'Your bio can have up to 160 characters.'}, 400);
      if (Object.hasOwn(data, 'handle')) return json({error: 'Your ID is assigned automatically and cannot be changed.'}, 400);
      let profile = await db.prepare('SELECT * FROM profiles WHERE id = ?').bind(user.userId).first<Profile>();
      if (!profile) {
        for (let attempt = 0; attempt < 12; attempt++) {
          try {
            await db.prepare('INSERT INTO profiles (id, handle, name, bio) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO NOTHING').bind(user.userId, generateUserId(), name, bio).run();
            break;
          } catch (error) {if (!String(error).includes('UNIQUE') || attempt === 11) throw error;}
        }
      } else {
        await db.prepare('UPDATE profiles SET name = ?, bio = ? WHERE id = ?').bind(name, bio, user.userId).run();
      }
      profile = await db.prepare('SELECT * FROM profiles WHERE id = ?').bind(user.userId).first<Profile>();
      return json({me: publicProfile(await ensurePermanentId(db, profile!))});
    }
    const me = await db.prepare('SELECT * FROM profiles WHERE id = ?').bind(user.userId).first<Profile>();
    if (!me) return json({error: 'Create your profile first.'}, 400);
    if (data.action === 'saveNote' || data.action === 'saveMessage') {
      let body = typeof data.body === 'string' ? data.body.trim() : '';
      let sourceMessage: string | null = null, sourceName: string | null = null;
      if (data.action === 'saveMessage') {
        const source = await db.prepare('SELECT m.id, m.body, p.name FROM messages m JOIN conversations c ON c.id = m.conversation JOIN profiles p ON p.id = m.sender WHERE m.id = ? AND (c.a = ? OR c.b = ?)').bind(String(data.messageId || ''), me.id, me.id).first<{id: string; body: string; name: string}>();
        if (!source) return json({error: 'Message not found.'}, 404);
        body = source.body; sourceMessage = source.id; sourceName = source.name;
      }
      if (!body || body.length > 4000) return json({error: 'Messages need 1–4,000 characters.'}, 400);
      const id = crypto.randomUUID(), created = Date.now();
      await db.prepare('INSERT INTO saved_messages (id, owner, body, source_message, source_name, created) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(owner, source_message) DO NOTHING').bind(id, me.id, body, sourceMessage, sourceName, created).run();
      const saved = sourceMessage ? await db.prepare('SELECT id, body, created, source_name AS sourceName, 1 AS mine FROM saved_messages WHERE owner = ? AND source_message = ?').bind(me.id, sourceMessage).first() : {id, body, created, mine: 1, sourceName: null};
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
    if (data.action === 'read') {
      const at = Math.min(Date.now(), Number(data.at) || 0);
      await db.prepare(`UPDATE conversations SET ${c.a === me.id ? 'read_a' : 'read_b'} = MAX(${c.a === me.id ? 'read_a' : 'read_b'}, ?) WHERE id = ?`).bind(at, c.id).run();
      return json({ok: true});
    }
    if (data.action === 'send') {
      const body = typeof data.body === 'string' ? data.body.trim() : '';
      if (!body || body.length > 4000) return json({error: 'Messages need 1–4,000 characters.'}, 400);
      const created = Date.now(), id = crypto.randomUUID();
      await db.batch([
        db.prepare('INSERT INTO messages (id, conversation, sender, body, created) VALUES (?, ?, ?, ?, ?)').bind(id, c.id, me.id, body, created),
        db.prepare('UPDATE conversations SET updated = ? WHERE id = ?').bind(created, c.id),
      ]);
      return json({message: {id, body, created, mine: 1}});
    }
    return json({error: 'Unknown action.'}, 400);
  } catch (error) { console.error('Chat write failed', error); return json({error: 'Could not save. Please try again.'}, 500); }
}
