export {FILE_LIMIT,AVATAR_LIMIT} from '../../chat-types';
export type Upload = {id: string; owner: string; conversation: string | null; kind: string; name: string; type: string; size: number; download_locked?:number};
export class RequestError extends Error {
  constructor(message: string, public status = 400) {super(message);}
}
export function attachment(upload: Upload | null, viewer?:string) {
  return upload ? {id: upload.id, name: upload.name, type: upload.type, size: upload.size,downloadLocked:!!upload.download_locked,canDownload:!upload.download_locked||upload.owner===viewer,canManage:upload.owner===viewer} : null;
}
export const attachmentColumns = 'f.id AS uploadId, f.name AS uploadName, f.type AS uploadType, f.size AS uploadSize, f.owner AS uploadOwner, f.download_locked AS uploadLocked';
export function withAttachment(row: Record<string, unknown>,viewer:string) {
  const {uploadId, uploadName, uploadType, uploadSize,uploadOwner,uploadLocked, ...rest} = row;
  return {...rest, id:row.id, attachment: uploadId ? {id: uploadId, name: uploadName, type: uploadType, size: uploadSize,downloadLocked:!!uploadLocked,canDownload:!uploadLocked||uploadOwner===viewer,canManage:uploadOwner===viewer} : null};
}
export async function ownedAttachment(db: D1Database, owner: string, value: unknown, conversation: string | null) {
  if (value == null) return null;
  if (typeof value !== 'string') throw new RequestError('Invalid attachment.');
  const file = await db.prepare('SELECT * FROM uploads WHERE id = ? AND owner = ? AND kind = ? AND conversation IS ?').bind(value, owner, 'attachment', conversation).first<Upload>();
  if (!file) throw new RequestError('This attachment is not available in this conversation.', 403);
  return file;
}
export async function readLimitedBody(request: Request, limit: number) {
  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > limit) throw new RequestError('This file is too large.', 413);
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) {await reader.cancel(); throw new RequestError('This file is too large.', 413);}
      chunks.push(value);
    }
  } finally {reader.releaseLock();}
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {bytes.set(chunk, offset); offset += chunk.length;}
  return bytes;
}
export function imageType(bytes: Uint8Array): string | null {
  if (bytes.length >= 24 && [137,80,78,71,13,10,26,10].every((n,i) => bytes[i] === n)) return 'image/png';
  if (bytes.length >= 12 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  const text = new TextDecoder('ascii').decode(bytes.slice(0,12));
  if (bytes.length >= 12 && text.startsWith('RIFF') && text.slice(8,12) === 'WEBP') return 'image/webp';
  if (bytes.length >= 13 && (text.startsWith('GIF87a') || text.startsWith('GIF89a'))) return 'image/gif';
  return null;
}
