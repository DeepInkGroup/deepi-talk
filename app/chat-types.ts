export type Attachment = {id:string; name:string; type:string; size:number; downloadLocked?:boolean; canDownload?:boolean; canManage?:boolean};
export const FILE_LIMIT=10*1024*1024;
export const AVATAR_LIMIT=2*1024*1024;
export const mediaUrl = (file: Attachment, download = false) => '/api/media?id=' + encodeURIComponent(file.id) + (download ? '&download=1' : '');
export function fileSize(bytes:number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
