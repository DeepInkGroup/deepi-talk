'use client';
import {mediaUrl,fileSize,type Attachment} from './chat-types';

export default function MessageAttachment({file,onPreview}:{file:Attachment;onPreview:(file:Attachment)=>void}) {
  return <div className="shared-attachment">
    {file.type.startsWith('image/') && <button className="shared-image" onClick={()=>onPreview(file)} onContextMenu={event=>{if(file.canDownload===false)event.preventDefault();}} aria-label={`View image: ${file.name}`}><img src={mediaUrl(file)} alt={file.name} loading="lazy" draggable={file.canDownload!==false}/></button>}
    {file.canDownload!==false ? <a className="file-download" href={mediaUrl(file,true)} download={file.name}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M6 3h8l4 4v14H6V3Zm8 0v5h4M12 11v6m-3-3 3 3 3-3"/></svg>
      <span><strong>{file.name}</strong><small>{fileSize(file.size)} · Download</small></span>
    </a> : <div className="file-locked"><span>{file.name}</span><small>Downloads locked by sender</small></div>}
  </div>;
}
