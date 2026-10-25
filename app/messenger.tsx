'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import EmojiPicker from './emoji-picker';
import EmojiText from './emoji-text';
import AuthForm from './auth-form';
import MessageAttachment from './message-attachment';
import {FILE_LIMIT,fileSize,mediaUrl,type Attachment} from './chat-types';

type Person = {name: string; handle: string; bio?: string; avatarUrl?: string | null};
type Conversation = Person & {id: string; last: string | null; unread: number; updated: number; saved?: boolean};
type Message = {id: string; body: string; created: number; mine: number; savedId?: string | null; sourceName?: string | null; attachment?: Attachment | null;editedAt?:number|null};
type State = {signedIn: boolean; me: Person | null; conversations: Conversation[]; savedCount: number;authMode?:'password'};
type ApiResponse = State & {error?: string; people: Person[]; conversation: Conversation; message: Message; messages: Message[]; peerRead: number; hasMore: boolean; savedId: string;edit:{id:string;body:string;editedAt:number}};
type IconName = 'chat' | 'search' | 'plus' | 'arrow' | 'back' | 'close' | 'copy' | 'check' | 'profile' | 'info' | 'logout' | 'bookmark' | 'trash' | 'attach' | 'smile' | 'camera' | 'edit' | 'lock' | 'unlock';
function Icon({name, size = 20}: {name: IconName; size?: number}) {
  const paths: Record<IconName, React.ReactNode> = {
    chat: <><path d="M5 4h14a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H9l-5 3V5a1 1 0 0 1 1-1Z"/><path d="M8 9h8M8 13h5"/></>,
    search: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/></>,
    plus: <path d="M12 5v14M5 12h14"/>,
    arrow: <path d="M12 19V5m-6 6 6-6 6 6"/>,
    back: <path d="m14 5-7 7 7 7M7 12h14"/>,
    close: <path d="m6 6 12 12M6 18 18 6"/>,
    copy: <><rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></>,
    check: <path d="m5 12 4 4L19 6"/>,
    profile: <><circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/></>,
    bookmark: <path d="M6 4h12v17l-6-4-6 4V4Z"/>,
    trash: <><path d="M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7"/></>,
    attach: <path d="m8 12 6-6a3 3 0 0 1 4 4l-8 8a5 5 0 0 1-7-7l9-9m-6 12 8-8"/>,
    smile: <><circle cx="12" cy="12" r="9"/><path d="M8 14a4 4 0 0 0 8 0M8 9h.01M16 9h.01"/></>,
    camera: <><path d="M3 7h4l2-3h6l2 3h4v13H3V7Z"/><circle cx="12" cy="13" r="4"/></>,
    edit:<><path d="m4 16-1 5 5-1L20 8l-4-4L4 16Zm9-9 4 4"/></>,
    lock:<><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4M12 14v3"/></>,
    unlock:<><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 7-2M12 14v3"/></>,
    info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/></>,
    logout: <><path d="M10 4H5v16h5M9 12h12m-4-4 4 4-4 4"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
function Avatar({person, small = false}: {person: Person; small?: boolean}) {
  const shade = [...person.handle].reduce((n, c) => n + c.charCodeAt(0), 0) % 5;
  const [failed,setFailed]=useState(false);
  useEffect(()=>setFailed(false),[person.avatarUrl]);
  return <span className={`avatar shade-${shade}${small ? ' small' : ''}`} aria-hidden="true">{person.avatarUrl && !failed ? <img src={person.avatarUrl} alt="" onError={()=>setFailed(true)}/> : person.name.trim().slice(0, 1).toUpperCase()}</span>;
}
async function uploadFile(file:File,conversation:string|null,kind='attachment',locked=false):Promise<Attachment> {
  const query=new URLSearchParams({kind});
  if(conversation)query.set('conversation',conversation);
  if(locked)query.set('locked','1');
  const response=await fetch('/api/media?'+query,{method:'POST',headers:{'Content-Type':'application/octet-stream','X-File-Name':encodeURIComponent(file.name)},body:file});
  const data=await response.json() as {attachment:Attachment;error?:string};
  if(!response.ok)throw new Error(data.error||'Could not upload this file. Try again.');
  return data.attachment;
}
async function discardUpload(id:string) {
  try {await fetch('/api/media?id='+encodeURIComponent(id),{method:'DELETE'});}catch {/* Unreferenced uploads stay private if cleanup cannot connect. */}
}
type PendingFile={file:File;preview:string|null;uploaded?:Attachment;locked?:boolean};
async function updateDownloadLock(id:string,locked:boolean):Promise<Attachment> {
  const response=await fetch('/api/media?id='+encodeURIComponent(id),{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({locked})});
  const data=await response.json() as {attachment:Attachment;error?:string};
  if(!response.ok)throw new Error(data.error||'Could not update download settings.');
  return data.attachment;
}
async function api(query = '', body?: Record<string, unknown>) {
  const response = await fetch('/api/chat' + query, body ? {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)} : {cache: 'no-store'});
  const data = await response.json() as ApiResponse;
  if (!response.ok || data.error) throw new Error(data.error || 'Something went wrong. Try again.');
  return data;
}
const time = (n: number) => new Date(n).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
const day = (n: number) => {
  const date = new Date(n);
  return date.toDateString() === new Date().toDateString() ? 'Today' : date.toLocaleDateString([], {month: 'short', day: 'numeric', year: 'numeric'});
};

export default function Messenger() {
  const [state, setState] = useState<State | null>(null);
  const [selected, setSelected] = useState<Conversation | null>(null);
  const selectedRef = useRef<Conversation | null>(null);
  const messageVersion=useRef(0);
  const [messages, setMessages] = useState<Message[]>([]);
  const [peerRead, setPeerRead] = useState(0);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [olderLoading, setOlderLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [finding, setFinding] = useState(false);
  const [people, setPeople] = useState<Person[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [sending, setSending] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const [modal, setModal] = useState<'profile' | 'person' | 'image' | null>(null);
  const [copied, setCopied] = useState(false);
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileError, setProfileError] = useState('');
  const [savingMessage, setSavingMessage] = useState('');
  const [notice, setNotice] = useState('');
  const [pendingFiles,setPendingFiles]=useState<Record<string,PendingFile>>({});
  const [emojiOpen,setEmojiOpen]=useState(false);
  const [photoBusy,setPhotoBusy]=useState(false);
  const [profilePhoto,setProfilePhoto]=useState<{id:string|null;url:string|null}|null>(null);
  const [previewImage,setPreviewImage]=useState<Attachment|null>(null);
  const [editing,setEditing]=useState<{messageId:string;conversationId:string;hasAttachment:boolean}|null>(null);
  const [editText,setEditText]=useState('');
  const [lockBusy,setLockBusy]=useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const fileRef=useRef<HTMLInputElement>(null);
  const photoRef=useRef<HTMLInputElement>(null);
  const pendingRef=useRef(pendingFiles);
  const photoUploadRef=useRef<Attachment|null>(null);
  const profileEditorRef=useRef(false);
  const draft = editing ? editText : selected ? (drafts[selected.id] || '') : '';
  const pending=selected ? pendingFiles[selected.id] : undefined;
  useEffect(()=>{pendingRef.current=pendingFiles;},[pendingFiles]);
  useEffect(()=>()=>{for(const item of Object.values(pendingRef.current)){if(item.preview)URL.revokeObjectURL(item.preview);}},[]);
  useEffect(()=>{setEmojiOpen(false);setEditing(null);},[selected?.id]);
  useEffect(()=>{
    profileEditorRef.current=modal==='profile';
    if(modal!=='profile'){
      if(photoUploadRef.current)void discardUpload(photoUploadRef.current.id);
      photoUploadRef.current=null;setProfilePhoto(null);
    }
  },[modal]);
  const closeEmojis=useCallback(()=>{setEmojiOpen(false);composerRef.current?.focus();},[]);

  const refresh = useCallback(async () => {
    const data = await api();
    setState({signedIn: data.signedIn, me: data.me || null, conversations: data.conversations || [], savedCount: data.savedCount || 0,authMode:data.authMode});
    if(!data.signedIn){setSelected(null);setMessages([]);setModal(null);}
    else setSelected(old => old && !old.saved ? data.conversations?.find(c => c.id === old.id) || old : old);
    setError('');
  }, []);
  useEffect(() => {
    refresh().catch(e => setError(e.message));
    const timer = setInterval(() => { if (!document.hidden) refresh().catch(e => setError(e.message)); }, 6000);
    return () => clearInterval(timer);
  }, [refresh]);

  const loadMessages = useCallback(async (conversation: Conversation, initial = false) => {
    const version=messageVersion.current;
    const data = await api(conversation.saved ? '?action=saved' : '?action=messages&id=' + encodeURIComponent(conversation.id));
    if (selectedRef.current?.id !== conversation.id || messageVersion.current!==version) return;
    const el = scrollRef.current;
    const atBottom = !el || el.scrollHeight - el.scrollTop - el.clientHeight < 100;
    setMessages(previous => {
      const recent = data.messages as Message[];
      // Keep pages of older history when a new poll replaces the latest page.
      if (!initial && recent.length && previous.length) return [...previous.filter(m => m.created < recent[0].created || (m.created === recent[0].created && m.id < recent[0].id)), ...recent];
      return recent;
    });
    setPeerRead(data.peerRead);
    if (initial) setHasMore(data.hasMore);
    setMessagesLoading(false);
    if (initial || atBottom) requestAnimationFrame(() => { scrollRef.current?.scrollTo({top: scrollRef.current.scrollHeight, behavior: initial ? 'instant' : 'smooth'}); });
    if (!conversation.saved && !document.hidden && data.messages.length) {
      const last = data.messages[data.messages.length - 1];
      await api('', {action: 'read', id: conversation.id, at: last.created});
      setState(old => old ? {...old, conversations: old.conversations.map(c => c.id === conversation.id ? {...c, unread: 0} : c)} : old);
    }
  }, []);
  useEffect(() => {
    selectedRef.current = selected;
    if (!selected) return;
    setMessages([]); setMessagesLoading(true); setHasMore(false); setPeerRead(0);
    loadMessages(selected, true).catch(e => {setError(e.message); setMessagesLoading(false);});
    const timer = setInterval(() => { if (!document.hidden) loadMessages(selected).catch(e => setError(e.message)); }, 3000);
    return () => clearInterval(timer);
  }, [selected?.id, loadMessages]);

  useEffect(() => {
    const q = query.trim().replace(/^@/, '');
    if (!finding || q.length < 2 || !state?.me) {setPeople([]); setSearching(false); return;}
    let cancelled = false;
    setSearching(true); setSearchError('');
    const timer = setTimeout(() => {
      api('?action=search&q=' + encodeURIComponent(q)).then(data => {if (!cancelled) setPeople(data.people || []);})
        .catch(e => {if (!cancelled) setSearchError(e.message);})
        .finally(() => {if (!cancelled) setSearching(false);});
    }, 250);
    return () => {cancelled = true; clearTimeout(timer);};
  }, [query, finding, state?.me?.handle]);

  useEffect(() => {
    if (!modal) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    dialog?.querySelector<HTMLElement>('input, button')?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setModal(null);
      if (event.key === 'Tab') {
        const nodes = dialog?.querySelectorAll<HTMLElement>('button, input, textarea, a[href]');
        if (!nodes?.length) return;
        const first = nodes[0], last = nodes[nodes.length - 1];
        if (event.shiftKey && document.activeElement === first) {event.preventDefault(); last.focus();}
        else if (!event.shiftKey && document.activeElement === last) {event.preventDefault(); first.focus();}
      }
    };
    document.addEventListener('keydown', key);
    return () => {document.removeEventListener('keydown', key); previous?.focus();};
  }, [modal]);

  async function start(person: Person) {
    if (starting) return;
    setStarting(true);
    try {
      const data = await api('', {action: 'start', handle: person.handle});
      setSelected(data.conversation); setFinding(false); setQuery(''); await refresh();
    } catch (e) {setError((e as Error).message);} finally {setStarting(false);}
  }
  async function send() {
    if(editing){await saveEdit();return;}
    if (!selected || (!draft.trim() && !pending) || sending) return;
    const conversation = selected, text = draft;
    setSending(true); setError('');
    try {
      let uploaded=pending?.uploaded;
      if(pending && !uploaded){
        uploaded=await uploadFile(pending.file,conversation.saved?null:conversation.id,'attachment',!!pending.locked);
        const file=uploaded;
        setPendingFiles(old=>({...old,[conversation.id]:{...pending,uploaded:file}}));
      }
      if(uploaded&&pending&&!!uploaded.downloadLocked!==!!pending.locked)uploaded=await updateDownloadLock(uploaded.id,!!pending.locked);
      const data = await api('', {action: conversation.saved ? 'saveNote' : 'send', id: conversation.id, body: text, attachmentId:uploaded?.id});
      messageVersion.current++;
      if(pending){if(pending.preview)URL.revokeObjectURL(pending.preview);setPendingFiles(old=>{const next={...old};delete next[conversation.id];return next;});}
      setDrafts(old => ({...old, [conversation.id]: old[conversation.id] === text ? '' : old[conversation.id]}));
      if (selectedRef.current?.id === conversation.id) {
        setMessages(old => old.some(m => m.id === data.message.id) ? old : [...old, data.message]);
        requestAnimationFrame(() => scrollRef.current?.scrollTo({top: scrollRef.current.scrollHeight, behavior: 'smooth'}));
      }
      await refresh(); composerRef.current?.focus();
    } catch (e) {setError((e as Error).message);} finally {setSending(false);}
  }
  async function saveProfile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if(profileBusy||photoBusy)return;
    setProfileBusy(true); setProfileError('');
    const form = new FormData(event.currentTarget);
    try {
      await api('', {action: 'profile', name: form.get('name'), bio: form.get('bio') || '', ...(profilePhoto ? {avatarId:profilePhoto.id} : {})});
      photoUploadRef.current=null;
      await refresh(); setModal(null);
    } catch (e) {setProfileError((e as Error).message);} finally {setProfileBusy(false);}
  }
  async function copy(handle: string) {
    try {await navigator.clipboard.writeText(handle); setCopied(true); setTimeout(() => setCopied(false), 1800);}
    catch {setError('Could not copy. The ID is ' + handle);}
  }
  function find() {setFinding(true); requestAnimationFrame(() => searchRef.current?.focus());}
  function chooseFile(file:File) {
    if(!selected || sending)return;
    if(editing){setError('Finish or cancel editing before attaching a file.');return;}
    if(!file.size){setError('Choose a file that is not empty.');return;}
    if(file.size>FILE_LIMIT){setError('Files can be up to 10 MB.');return;}
    const old=pendingRef.current[selected.id];
    if(old?.preview)URL.revokeObjectURL(old.preview);
    if(old?.uploaded)void discardUpload(old.uploaded.id);
    setPendingFiles(files=>({...files,[selected.id]:{file,preview:file.type.startsWith('image/')?URL.createObjectURL(file):null}}));
    setError('');
  }
  function removeFile() {
    if(!selected || sending)return;
    if(pending?.preview)URL.revokeObjectURL(pending.preview);
    if(pending?.uploaded)void discardUpload(pending.uploaded.id);
    setPendingFiles(old=>{const next={...old};delete next[selected.id];return next;});
  }
  function insertEmoji(emoji:string) {
    if(!selected)return;
    const input=composerRef.current,start=input?.selectionStart??draft.length,end=input?.selectionEnd??start;
    const text=draft.slice(0,start)+emoji+draft.slice(end);
    if(text.length>4000){setError('Messages can have up to 4,000 characters.');return;}
    if(editing)setEditText(text);else setDrafts(old=>({...old,[selected.id]:text}));
    setEmojiOpen(false);
    requestAnimationFrame(()=>{input?.focus();input?.setSelectionRange(start+emoji.length,start+emoji.length);});
  }
  async function changePhoto(file:File) {
    if(photoBusy)return;
    setPhotoBusy(true);setProfileError('');
    try {
      if(!['image/jpeg','image/png','image/webp'].includes(file.type))throw new Error('Choose a JPG, PNG, or WebP photo.');
      if(file.size>FILE_LIMIT)throw new Error('Choose a photo smaller than 10 MB.');
      const image=await createImageBitmap(file);
      const crop=Math.min(image.width,image.height),canvas=document.createElement('canvas');
      canvas.width=canvas.height=Math.min(512,crop);
      const context=canvas.getContext('2d');
      if(!context||!crop){image.close();throw new Error('Could not open this photo.');}
      context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);
      context.drawImage(image,(image.width-crop)/2,(image.height-crop)/2,crop,crop,0,0,canvas.width,canvas.height);image.close();
      const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error('Could not prepare this photo.')),'image/jpeg',.88));
      const photo=await uploadFile(new File([blob],'profile.jpg',{type:'image/jpeg'}),null,'avatar');
      if(!profileEditorRef.current){void discardUpload(photo.id);return;}
      if(photoUploadRef.current)void discardUpload(photoUploadRef.current.id);
      photoUploadRef.current=photo;
      setProfilePhoto({id:photo.id,url:mediaUrl(photo)});
    }catch(e){setProfileError((e as Error).message);}finally{setPhotoBusy(false);}
  }
  function removePhoto(){
    if(photoUploadRef.current)void discardUpload(photoUploadRef.current.id);
    photoUploadRef.current=null;setProfilePhoto({id:null,url:null});
  }
  function showImage(file:Attachment){setPreviewImage(file);setModal('image');}
  async function signOutRender(){
    try{
      const response=await fetch('/api/auth/logout',{method:'POST'});
      if(!response.ok)throw new Error('Could not sign out. Please try again.');
      setSelected(null);setMessages([]);setModal(null);await refresh();
    }catch(error){setProfileError((error as Error).message);}
  }
  function beginEdit(message:Message){
    if(!selected||sending)return;
    setEditing({messageId:message.id,conversationId:selected.id,hasAttachment:!!message.attachment});setEditText(message.body);setError('');setEmojiOpen(false);
    requestAnimationFrame(()=>{composerRef.current?.focus();composerRef.current?.setSelectionRange(message.body.length,message.body.length);});
  }
  async function saveEdit(){
    if(!editing||!selected||sending||(!editText.trim()&&!editing.hasAttachment))return;
    const active=editing,body=editText;setSending(true);setError('');
    try{
      const data=await api('',{action:selected.saved?'editSaved':'edit',id:active.conversationId,messageId:active.messageId,body});
      messageVersion.current++;
      if(selectedRef.current?.id===active.conversationId){setMessages(old=>old.map(message=>message.id===active.messageId?{...message,...data.edit}:message));setEditing(null);}
      await refresh();
    }catch(error){setError((error as Error).message);}finally{setSending(false);}
  }
  async function toggleImageLock(file:Attachment){
    if(lockBusy)return;
    setLockBusy(file.id);
    try{
      const updated=await updateDownloadLock(file.id,!file.downloadLocked);messageVersion.current++;
      setMessages(old=>old.map(message=>message.attachment?.id===file.id?{...message,attachment:updated}:message));
      setPreviewImage(old=>old?.id===file.id?updated:old);
      setNotice(updated.downloadLocked?'Image downloads locked':'Image downloads allowed');setTimeout(()=>setNotice(''),2000);
    }catch(error){setError((error as Error).message);}finally{setLockBusy('');}
  }
  function openSaved() {
    setSelected({id: '__saved__', name: 'Saved Messages', handle: state!.me!.handle, last: null, unread: 0, updated: 0, saved: true});
    setFinding(false); setQuery('');
  }
  async function toggleSaved(message: Message) {
    if (savingMessage) return;
    const current = selectedRef.current;
    const savedId = current?.saved ? message.id : message.savedId;
    setSavingMessage(message.id);
    try {
      const data = await api('', savedId ? {action: 'removeSaved', savedId} : {action: 'saveMessage', messageId: message.id});
      messageVersion.current++;
      if (selectedRef.current?.id === current?.id) setMessages(old => current?.saved ? old.filter(m => m.id !== message.id) : old.map(m => m.id === message.id ? {...m, savedId: savedId ? null : data.savedId} : m));
      setNotice(savedId ? 'Removed from Saved Messages' : 'Message saved');
      setTimeout(() => setNotice(''), 2000);
      await refresh();
    } catch (e) {setError((e as Error).message);} finally {setSavingMessage('');}
  }
  async function older() {
    if (!selected || !messages.length) return;
    const id = selected.id, height = scrollRef.current?.scrollHeight || 0;
    setOlderLoading(true);
    try {
      const first = messages[0];
      const data = await api((selected.saved ? '?action=saved' : '?action=messages&id=' + encodeURIComponent(id)) + '&before=' + first.created + '&beforeId=' + encodeURIComponent(first.id));
      if (selectedRef.current?.id !== id) return;
      setMessages(old => [...data.messages, ...old]); setHasMore(data.hasMore);
      requestAnimationFrame(() => {if (scrollRef.current) scrollRef.current.scrollTop += scrollRef.current.scrollHeight - height;});
    } catch (e) {setError((e as Error).message);} finally {setOlderLoading(false);}
  }
  const profileForm = (editing: boolean) => <form className="profile-form" onSubmit={saveProfile}>
    <label>YOUR NAME<input name="name" placeholder="What should we call you?" defaultValue={editing ? state?.me?.name : ''} autoComplete="name" required maxLength={40}/></label>
    {editing && <label>BIO · OPTIONAL<textarea name="bio" placeholder="A little about you" defaultValue={state?.me?.bio || ''} maxLength={160} rows={3}/></label>}
    <label>YOUR UNIQUE ID<div className="handle-input permanent-id"><input aria-label="Your permanent ID" value={editing ? state?.me?.handle || '' : 'Assigned automatically'} readOnly/>{editing && <button type="button" className="icon-button" aria-label="Copy permanent ID" onClick={() => copy(state!.me!.handle)}><Icon name={copied ? 'check' : 'copy'} size={16}/></button>}</div></label>
    <p className="field-hint">{editing ? 'This is your permanent ID. It cannot be changed.' : 'Two letters and six digits, like TN123456. Your ID is generated for you and cannot be changed.'}</p>
    {profileError && <p className="form-error" role="alert">{profileError}</p>}
    <button className="primary wide" disabled={profileBusy||photoBusy}>{profileBusy ? 'Saving…' : photoBusy ? 'Preparing photo…' : editing ? 'Save changes' : 'Let’s get started'}<Icon name="arrow" size={17}/></button>
  </form>;

  return <main className={`messenger ${selected ? 'conversation-open' : ''}`}>
    <aside className="sidebar" aria-label="Conversations">
      <header className="brand"><span className="brand-mark"><Icon name="chat" size={23}/></span><span>deepi<span className="brand-light"> talk</span><i/></span><span className="brand-tag">MESSENGER</span></header>
      <div className="inbox-heading"><h1>Messages<span>{state?.conversations.length || 0}</span></h1><button className="icon-button new-button" onClick={find} aria-label="New message" title="New message" disabled={!state?.me}><Icon name="plus"/></button></div>
      <div className={`search-box ${finding ? 'focused' : ''}`}><Icon name="search" size={18}/><input ref={searchRef} aria-label="Find someone by ID" placeholder="Find someone by ID" value={query} onFocus={() => setFinding(true)} onChange={e => {setQuery(e.target.value); setFinding(true);}} disabled={!state?.me}/>{finding && <button className="icon-button tiny" onClick={() => {setFinding(false); setQuery('');}} aria-label="Close search"><Icon name="close" size={15}/></button>}</div>
      {state?.me && <button className={`saved-nav ${selected?.saved ? 'active' : ''}`} onClick={openSaved}><span className="saved-avatar"><Icon name="bookmark" size={18}/></span><span>Saved Messages<small>Notes and messages, just for you</small></span><b>{state.savedCount || ''}</b></button>}
      <div className="list-label">{finding ? 'FIND YOUR PEOPLE' : 'ALL CONVERSATIONS'}<span>{finding ? 'ID' : <span className="tiny-dot"/>}</span></div>
      <div className="conversation-list">
        {!state && !error ? <div className="list-empty"><span className="loading-ring"/><p>Getting things ready…</p></div> : finding ? <>
          {query.replace(/^@/, '').trim().length < 2 ? <div className="list-empty"><span className="empty-icon"><Icon name="search" size={23}/></span><p>Who’s on your mind?</p><small>Enter at least 2 characters of their ID.</small></div> : searching ? <div className="list-empty"><span className="loading-ring"/><p>Finding people…</p></div> : searchError ? <div className="list-empty"><p>{searchError}</p></div> : people.length ? people.map(person => <button key={person.handle} className="conversation-row search-result" disabled={starting} onClick={() => start(person)}><Avatar person={person}/><span className="row-copy"><strong>{person.name}</strong><span>{person.handle}</span></span><Icon name="plus" size={17}/></button>) : <div className="list-empty"><span className="empty-icon"><Icon name="search" size={23}/></span><p>No one here by that ID.</p><small>Check the spelling and try again.</small></div>}
        </> : state?.conversations.length ? state.conversations.map(c => <button className={`conversation-row ${selected?.id === c.id ? 'active' : ''}`} key={c.id} onClick={() => setSelected(c)}><Avatar person={c}/><span className="row-copy"><strong>{c.name}</strong><span>{c.last || 'Say hello 👋'}</span></span><span className="row-meta"><time>{day(c.updated) === 'Today' ? time(c.updated) : new Date(c.updated).toLocaleDateString([], {month: 'short', day: 'numeric'})}</time>{c.unread > 0 && <b aria-label={`${c.unread} unread messages`}>{c.unread > 99 ? '99+' : c.unread}</b>}</span></button>) : <div className="list-empty"><span className="empty-icon"><Icon name="chat" size={23}/></span><p>A fresh start.</p><small>Your conversations will appear here.</small></div>}
      </div>
      <footer className="sidebar-footer">{state?.me ? <><Avatar person={state.me} small/><div className="my-info"><strong>{state.me.name}<span>You</span></strong><button onClick={() => copy(state.me!.handle)} className="copy-id" title="Copy your ID">{state.me.handle}<Icon name={copied ? 'check' : 'copy'} size={12}/></button></div><button className="profile-button" aria-label="Open your profile" title="Your profile" onClick={() => {setProfileError(''); setModal('profile');}}><Icon name="profile" size={17}/><span>Profile</span></button></> : <><span className="avatar small guest">?</span><div className="my-info"><strong>Your little corner</strong><span className="muted">A name. An ID. A hello.</span></div></>}</footer>
    </aside>

    <section className="main-pane" aria-label={selected ? `Chat with ${selected.name}` : 'Welcome'} onDragOver={e=>{if(selected&&e.dataTransfer.types.includes('Files'))e.preventDefault();}} onDrop={e=>{if(selected&&e.dataTransfer.files.length){e.preventDefault();chooseFile(e.dataTransfer.files[0]);}}}>
      {error && <div className="error-banner" role="alert"><span>{error}</span><button onClick={() => refresh().then(() => selected && loadMessages(selected)).catch(e => setError(e.message))}>Retry</button><button className="icon-button tiny" onClick={() => setError('')} aria-label="Dismiss error"><Icon name="close" size={16}/></button></div>}
      {selected ? <>
        <header className="chat-header"><button className="icon-button mobile-back" onClick={() => setSelected(null)} aria-label="Back to conversations"><Icon name="back"/></button>{selected.saved ? <span className="saved-avatar"><Icon name="bookmark"/></span> : <Avatar person={selected} small/>}<div className="chat-person"><h2>{selected.name}</h2><span>{selected.saved ? 'Only you can see these messages' : selected.handle}</span></div>{!selected.saved && <button className="icon-button" aria-label="View person’s profile" title="View profile" onClick={() => setModal('person')}><Icon name="info"/></button>}</header>
        <div className="message-area" ref={scrollRef} aria-label="Message history" aria-busy={messagesLoading}>
          {messagesLoading ? <div className="chat-loading"><span className="loading-ring"/></div> : messages.length === 0 ? <div className="chat-start">{selected.saved ? <span className="saved-avatar large"><Icon name="bookmark" size={28}/></span> : <Avatar person={selected}/>}<h2>{selected.saved ? 'A space for yourself.' : 'This is the beginning.'}</h2><p>{selected.saved ? 'Write a note or save a message from any chat.' : `Say hello to ${selected.name.split(' ')[0]}.`}</p></div> : <>
            {hasMore && <button className="load-more" onClick={older} disabled={olderLoading}>{olderLoading ? 'Loading…' : 'Earlier messages'}</button>}
            {messages.map((m, index) => <div key={m.id}>
              {(index === 0 || day(messages[index - 1].created) !== day(m.created)) && <div className="day-divider"><span>{day(m.created)}</span></div>}
              <div className={`message ${m.mine ? 'mine' : 'theirs'}`}><div className="bubble" dir="auto">{selected.saved && m.sourceName && <span className="saved-source">From {m.sourceName}</span>}{m.attachment && <MessageAttachment file={m.attachment} onPreview={showImage}/>}<span className="message-text"><EmojiText text={m.body}/></span></div><span className="message-time">{time(m.created)}{m.editedAt && <span className="edited-label" title={'Edited '+new Date(m.editedAt).toLocaleString()}>edited</span>}{m.mine && !selected.saved ? <span className={m.created <= peerRead ? 'read-receipt read' : 'read-receipt'} title={m.created <= peerRead ? 'Read' : 'Sent'}><Icon name="check" size={12}/>{m.created <= peerRead && <Icon name="check" size={12}/>}</span> : null}{((!selected.saved&&m.mine)||(selected.saved&&!m.sourceName)) && <button className="message-save" disabled={sending} onClick={()=>beginEdit(m)} aria-label="Edit message" title="Edit message"><Icon name="edit" size={13}/></button>}{m.attachment?.canManage && m.attachment.type.startsWith('image/') && <button className="message-save" disabled={!!lockBusy} onClick={()=>toggleImageLock(m.attachment!)} aria-label={m.attachment.downloadLocked?'Allow image downloads':'Lock image downloads'} title={m.attachment.downloadLocked?'Allow image downloads':'Lock image downloads'}><Icon name={m.attachment.downloadLocked?'lock':'unlock'} size={13}/></button>}<button className={`message-save ${m.savedId ? 'is-saved' : ''}`} disabled={!!savingMessage} onClick={() => toggleSaved(m)} aria-label={selected.saved || m.savedId ? 'Remove from Saved Messages' : 'Save message'} title={selected.saved || m.savedId ? 'Remove from Saved Messages' : 'Save message'}><Icon name={selected.saved ? 'trash' : 'bookmark'} size={13}/></button></span></div>
            </div>)}
          </>}
        </div>
        <div className="composer-wrap">
          {pending && !editing && <div className="pending-file">{pending.preview ? <img src={pending.preview} alt="Attachment preview"/> : <span className="pending-file-icon"><Icon name="attach"/></span>}<div><strong>{pending.file.name}</strong><small>{fileSize(pending.file.size)}{sending ? ' · Sending…' : ' · Ready to send'}</small>{pending.file.type.startsWith('image/') && <label className="download-lock-option"><input type="checkbox" checked={!!pending.locked} disabled={sending} onChange={event=>setPendingFiles(old=>({...old,[selected.id]:{...pending,locked:event.target.checked}}))}/>Lock image downloads</label>}</div><button className="icon-button" aria-label="Remove attachment" disabled={sending} onClick={removeFile}><Icon name="close" size={17}/></button></div>}
          {editing && <div className="edit-banner"><Icon name="edit" size={16}/><span>Editing message<small>Escape to cancel</small></span><button className="icon-button" aria-label="Cancel edit" disabled={sending} onClick={()=>setEditing(null)}><Icon name="close" size={16}/></button></div>}{emojiOpen && <EmojiPicker onSelect={insertEmoji} onClose={closeEmojis}/>}
          <form className="composer" onSubmit={e => {e.preventDefault(); send();}}>
            <input type="file" ref={fileRef} hidden aria-label="Choose a file or image" onChange={e=>{const file=e.target.files?.[0];if(file)chooseFile(file);e.target.value='';}}/>
            <button type="button" className="icon-button composer-tool" aria-label="Attach a file or image" title="Attach a file or image (up to 10 MB)" disabled={sending||!!editing} onClick={()=>fileRef.current?.click()}><Icon name="attach" size={20}/></button>
            <textarea ref={composerRef} aria-label={selected.saved ? 'Write a private note' : `Message ${selected.name}`} placeholder={selected.saved ? 'Write a note…' : `Message ${selected.name.split(' ')[0]}…`} maxLength={4000} rows={1} value={draft} onPaste={e=>{const file=e.clipboardData.files[0];if(file){e.preventDefault();chooseFile(file);}}} onChange={e => {if(editing)setEditText(e.target.value);else setDrafts(old => ({...old, [selected.id]: e.target.value})); e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 140) + 'px';}} onKeyDown={e => {if(e.key==='Escape'&&editing&&!sending){e.preventDefault();setEditing(null);return;}if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {e.preventDefault(); send();}}}/>
            <button type="button" className={`icon-button composer-tool ${emojiOpen?'selected':''}`} aria-label="Add emoji" aria-expanded={emojiOpen} onClick={()=>setEmojiOpen(open=>!open)}><Icon name="smile" size={20}/></button>
            <button className="send-button" aria-label={editing?'Save edit':selected.saved ? 'Save note' : 'Send message'} disabled={(!draft.trim()&&!(editing?editing.hasAttachment:pending)) || sending}>{sending ? <span className="loading-ring"/> : <Icon name={editing?'check':'arrow'}/>}</button>
          </form>
          <p className="composer-hint">{selected.saved ? 'Only you can see your saved messages.' : 'Files and images up to 10 MB.'}<span>Enter to send · Shift + Enter for a new line</span></p>
        </div>
      </> : <>
        <div className="welcome-top"><span className="tiny-dot"/>A little space to connect.</div>
        <div className="welcome">
          <div className="welcome-art" aria-hidden="true"><span className="art-orbit"/><svg className="bubble-back" viewBox="0 0 100 86"><path d="M20 10h61a9 9 0 0 1 9 9v38a9 9 0 0 1-9 9H65l-1 15-21-15H20a9 9 0 0 1-9-9V19a9 9 0 0 1 9-9Z"/></svg><svg className="bubble-front" viewBox="0 0 100 86"><path d="M19 9h61a9 9 0 0 1 9 9v38a9 9 0 0 1-9 9H57L35 80V65H19a9 9 0 0 1-9-9V18a9 9 0 0 1 9-9Z"/><circle cx="34" cy="37" r="3"/><circle cx="49" cy="37" r="3"/><circle cx="64" cy="37" r="3"/></svg><span className="art-spark spark-one">+</span><span className="art-spark spark-two">+</span><span className="art-dot"/></div>
          {!state ? <><span className="eyebrow">JUST A CONVERSATION.</span><h2>A little closer.</h2><p>Your people. Your conversations.<br/>A simple space for both.</p>{error ? <button className="primary" onClick={() => refresh().catch(e => setError(e.message))}>Try again</button> : <span className="loading-ring"/>}</> : !state.signedIn ? <><span className="eyebrow">LESS NOISE. MORE HELLO.</span><h2>A little closer.</h2><p>Your people. Your conversations.<br/>A simple space for both.</p>{state.authMode==='password'?<AuthForm onAuthenticated={refresh}/>:<a className="primary" href="/signin-with-chatgpt?return_to=%2F" target="_top">Sign in to get started<Icon name="arrow" size={17}/></a>}<span className="welcome-note">A unique ID is all it takes to find each other.</span></> : !state.me ? <div className="onboarding"><span className="eyebrow">MAKE YOURSELF AT HOME.</span><h2>First, a little hello.</h2><p>Pick a name. Your permanent ID is generated for you.</p>{profileForm(false)}</div> : <><span className="eyebrow">LESS NOISE. MORE HELLO.</span><h2>A little closer.</h2><p>Good conversations start with a hello.<br/>Find someone by their ID and make the first move.</p><button className="primary" onClick={find}><Icon name="plus" size={18}/>Start a conversation</button><div className="share-id"><span>Your ID</span><button onClick={() => copy(state.me!.handle)}>{state.me.handle}<Icon name={copied ? 'check' : 'copy'} size={14}/></button></div></>}
        </div>
        <div className="welcome-bottom"><span className="mini-mark"><Icon name="chat" size={13}/></span>Just you and the conversation.</div>
      </>}
    </section>

    {modal && <div className="modal-overlay" onMouseDown={e => {if (e.target === e.currentTarget) setModal(null);}}><div className={`modal ${modal === 'image' ? 'image-modal' : ''}`} role="dialog" aria-modal="true" aria-labelledby="dialog-title" ref={dialogRef}><button className="icon-button modal-close" aria-label="Close dialog" onClick={() => setModal(null)}><Icon name="close"/></button>{modal === 'profile' ? <><span className="eyebrow">YOUR LITTLE CORNER</span><h2 id="dialog-title">Your profile.</h2><p>Your name can change. Your ID stays yours.</p>{state?.me && <div className="profile-preview"><Avatar person={{...state.me,avatarUrl:profilePhoto?profilePhoto.url:state.me.avatarUrl}}/><div><strong>{state.me.name}</strong><span>{state.me.handle}</span><div className="photo-actions"><input ref={photoRef} type="file" accept="image/jpeg,image/png,image/webp" hidden aria-label="Choose a profile photo" onChange={e=>{const file=e.target.files?.[0];if(file)void changePhoto(file);e.target.value='';}}/><button type="button" disabled={photoBusy||profileBusy} onClick={()=>photoRef.current?.click()}><Icon name="camera" size={13}/>{photoBusy?'Preparing\u2026':'Change photo'}</button>{(profilePhoto?profilePhoto.url:state.me.avatarUrl) && <button type="button" disabled={photoBusy||profileBusy} onClick={removePhoto}>Remove</button>}</div></div></div>}{profileForm(true)}{state?.authMode==='password'?<button className="signout" onClick={signOutRender}><Icon name="logout" size={16}/>Sign out</button>:<a className="signout" href="/signout-with-chatgpt?return_to=%2F" target="_top"><Icon name="logout" size={16}/>Sign out</a>}</> : modal === 'image' && previewImage ? <div className="image-dialog"><h2 className="sr-only" id="dialog-title">{previewImage.name}</h2><img src={mediaUrl(previewImage)} alt={previewImage.name} onContextMenu={event=>{if(previewImage.canDownload===false)event.preventDefault();}}/>{previewImage.canDownload!==false ? <a className="image-download" href={mediaUrl(previewImage,true)} download={previewImage.name}>{previewImage.name}<span>{fileSize(previewImage.size)} &middot; Download</span></a> : <p className="image-download-locked">Downloads locked by sender</p>}</div> : selected && <div className="person-dialog"><Avatar person={selected}/><h2 id="dialog-title">{selected.name}</h2><button className="person-id" onClick={() => copy(selected.handle)}>{selected.handle}<Icon name={copied ? 'check' : 'copy'} size={16}/></button><p className="person-bio">{selected.bio || 'A conversation, just between you two.'}</p></div>}</div></div>}
    <span className="sr-only" role="status" aria-live="polite">{copied ? 'ID copied to clipboard.' : notice}</span>{notice && <div className="toast" aria-hidden="true"><Icon name="check" size={15}/>{notice}</div>}
  </main>;
}
