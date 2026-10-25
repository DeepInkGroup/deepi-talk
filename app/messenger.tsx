'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

type Person = {name: string; handle: string; bio?: string};
type Conversation = Person & {id: string; last: string | null; unread: number; updated: number; saved?: boolean};
type Message = {id: string; body: string; created: number; mine: number; savedId?: string | null; sourceName?: string | null};
type State = {signedIn: boolean; me: Person | null; conversations: Conversation[]; savedCount: number};
type ApiResponse = State & {error?: string; people: Person[]; conversation: Conversation; message: Message; messages: Message[]; peerRead: number; hasMore: boolean; savedId: string};
type IconName = 'chat' | 'search' | 'plus' | 'arrow' | 'back' | 'close' | 'copy' | 'check' | 'profile' | 'info' | 'logout' | 'bookmark' | 'trash';
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
    info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/></>,
    logout: <><path d="M10 4H5v16h5M9 12h12m-4-4 4 4-4 4"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
function Avatar({person, small = false}: {person: Person; small?: boolean}) {
  const shade = [...person.handle].reduce((n, c) => n + c.charCodeAt(0), 0) % 5;
  return <span className={`avatar shade-${shade}${small ? ' small' : ''}`} aria-hidden="true">{person.name.trim().slice(0, 1).toUpperCase()}</span>;
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
  const [modal, setModal] = useState<'profile' | 'person' | null>(null);
  const [copied, setCopied] = useState(false);
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileError, setProfileError] = useState('');
  const [savingMessage, setSavingMessage] = useState('');
  const [notice, setNotice] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const draft = selected ? (drafts[selected.id] || '') : '';

  const refresh = useCallback(async () => {
    const data = await api();
    setState({signedIn: data.signedIn, me: data.me || null, conversations: data.conversations || [], savedCount: data.savedCount || 0});
    setSelected(old => old && !old.saved ? data.conversations?.find(c => c.id === old.id) || old : old);
    setError('');
  }, []);
  useEffect(() => {
    refresh().catch(e => setError(e.message));
    const timer = setInterval(() => { if (!document.hidden) refresh().catch(e => setError(e.message)); }, 6000);
    return () => clearInterval(timer);
  }, [refresh]);

  const loadMessages = useCallback(async (conversation: Conversation, initial = false) => {
    const data = await api(conversation.saved ? '?action=saved' : '?action=messages&id=' + encodeURIComponent(conversation.id));
    if (selectedRef.current?.id !== conversation.id) return;
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
    if (!selected || !draft.trim() || sending) return;
    const conversation = selected, text = draft;
    setSending(true); setError('');
    try {
      const data = await api('', {action: conversation.saved ? 'saveNote' : 'send', id: conversation.id, body: text});
      setDrafts(old => ({...old, [conversation.id]: old[conversation.id] === text ? '' : old[conversation.id]}));
      if (selectedRef.current?.id === conversation.id) {
        setMessages(old => old.some(m => m.id === data.message.id) ? old : [...old, data.message]);
        requestAnimationFrame(() => scrollRef.current?.scrollTo({top: scrollRef.current.scrollHeight, behavior: 'smooth'}));
      }
      await refresh(); composerRef.current?.focus();
    } catch (e) {setError((e as Error).message);} finally {setSending(false);}
  }
  async function saveProfile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setProfileBusy(true); setProfileError('');
    const form = new FormData(event.currentTarget);
    try {
      await api('', {action: 'profile', name: form.get('name'), bio: form.get('bio') || ''});
      await refresh(); setModal(null);
    } catch (e) {setProfileError((e as Error).message);} finally {setProfileBusy(false);}
  }
  async function copy(handle: string) {
    try {await navigator.clipboard.writeText(handle); setCopied(true); setTimeout(() => setCopied(false), 1800);}
    catch {setError('Could not copy. The ID is ' + handle);}
  }
  function find() {setFinding(true); requestAnimationFrame(() => searchRef.current?.focus());}
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
    <button className="primary wide" disabled={profileBusy}>{profileBusy ? 'Saving…' : editing ? 'Save changes' : 'Let’s get started'}<Icon name="arrow" size={17}/></button>
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

    <section className="main-pane" aria-label={selected ? `Chat with ${selected.name}` : 'Welcome'}>
      {error && <div className="error-banner" role="alert"><span>{error}</span><button onClick={() => refresh().then(() => selected && loadMessages(selected)).catch(e => setError(e.message))}>Retry</button><button className="icon-button tiny" onClick={() => setError('')} aria-label="Dismiss error"><Icon name="close" size={16}/></button></div>}
      {selected ? <>
        <header className="chat-header"><button className="icon-button mobile-back" onClick={() => setSelected(null)} aria-label="Back to conversations"><Icon name="back"/></button>{selected.saved ? <span className="saved-avatar"><Icon name="bookmark"/></span> : <Avatar person={selected} small/>}<div className="chat-person"><h2>{selected.name}</h2><span>{selected.saved ? 'Only you can see these messages' : selected.handle}</span></div>{!selected.saved && <button className="icon-button" aria-label="View person’s profile" title="View profile" onClick={() => setModal('person')}><Icon name="info"/></button>}</header>
        <div className="message-area" ref={scrollRef} aria-label="Message history" aria-busy={messagesLoading}>
          {messagesLoading ? <div className="chat-loading"><span className="loading-ring"/></div> : messages.length === 0 ? <div className="chat-start">{selected.saved ? <span className="saved-avatar large"><Icon name="bookmark" size={28}/></span> : <Avatar person={selected}/>}<h2>{selected.saved ? 'A space for yourself.' : 'This is the beginning.'}</h2><p>{selected.saved ? 'Write a note or save a message from any chat.' : `Say hello to ${selected.name.split(' ')[0]}.`}</p></div> : <>
            {hasMore && <button className="load-more" onClick={older} disabled={olderLoading}>{olderLoading ? 'Loading…' : 'Earlier messages'}</button>}
            {messages.map((m, index) => <div key={m.id}>
              {(index === 0 || day(messages[index - 1].created) !== day(m.created)) && <div className="day-divider"><span>{day(m.created)}</span></div>}
              <div className={`message ${m.mine ? 'mine' : 'theirs'}`}><div className="bubble" dir="auto">{selected.saved && m.sourceName && <span className="saved-source">From {m.sourceName}</span>}{m.body}</div><span className="message-time">{time(m.created)}{m.mine && !selected.saved ? <span className={m.created <= peerRead ? 'read-receipt read' : 'read-receipt'} title={m.created <= peerRead ? 'Read' : 'Sent'}><Icon name="check" size={12}/>{m.created <= peerRead && <Icon name="check" size={12}/>}</span> : null}<button className={`message-save ${m.savedId ? 'is-saved' : ''}`} disabled={!!savingMessage} onClick={() => toggleSaved(m)} aria-label={selected.saved || m.savedId ? 'Remove from Saved Messages' : 'Save message'} title={selected.saved || m.savedId ? 'Remove from Saved Messages' : 'Save message'}><Icon name={selected.saved ? 'trash' : 'bookmark'} size={13}/></button></span></div>
            </div>)}
          </>}
        </div>
        <div className="composer-wrap"><form className="composer" onSubmit={e => {e.preventDefault(); send();}}><textarea ref={composerRef} aria-label={selected.saved ? 'Write a private note' : `Message ${selected.name}`} placeholder={selected.saved ? 'Write a note…' : `Message ${selected.name.split(' ')[0]}…`} maxLength={4000} rows={1} value={draft} onChange={e => {setDrafts(old => ({...old, [selected.id]: e.target.value})); e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 140) + 'px';}} onKeyDown={e => {if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {e.preventDefault(); send();}}}/><button className="send-button" aria-label={selected.saved ? 'Save note' : 'Send message'} disabled={!draft.trim() || sending}>{sending ? <span className="loading-ring"/> : <Icon name="arrow"/>}</button></form><p className="composer-hint">{selected.saved ? 'Only you can see your saved messages.' : 'A little thought goes a long way.'}<span>Enter to send · Shift + Enter for a new line</span></p></div>
      </> : <>
        <div className="welcome-top"><span className="tiny-dot"/>A little space to connect.</div>
        <div className="welcome">
          <div className="welcome-art" aria-hidden="true"><span className="art-orbit"/><svg className="bubble-back" viewBox="0 0 100 86"><path d="M20 10h61a9 9 0 0 1 9 9v38a9 9 0 0 1-9 9H65l-1 15-21-15H20a9 9 0 0 1-9-9V19a9 9 0 0 1 9-9Z"/></svg><svg className="bubble-front" viewBox="0 0 100 86"><path d="M19 9h61a9 9 0 0 1 9 9v38a9 9 0 0 1-9 9H57L35 80V65H19a9 9 0 0 1-9-9V18a9 9 0 0 1 9-9Z"/><circle cx="34" cy="37" r="3"/><circle cx="49" cy="37" r="3"/><circle cx="64" cy="37" r="3"/></svg><span className="art-spark spark-one">+</span><span className="art-spark spark-two">+</span><span className="art-dot"/></div>
          {!state ? <><span className="eyebrow">JUST A CONVERSATION.</span><h2>A little closer.</h2><p>Your people. Your conversations.<br/>A simple space for both.</p>{error ? <button className="primary" onClick={() => refresh().catch(e => setError(e.message))}>Try again</button> : <span className="loading-ring"/>}</> : !state.signedIn ? <><span className="eyebrow">LESS NOISE. MORE HELLO.</span><h2>A little closer.</h2><p>Your people. Your conversations.<br/>A simple space for both.</p><a className="primary" href="/signin-with-chatgpt?return_to=%2F" target="_top">Sign in to get started<Icon name="arrow" size={17}/></a><span className="welcome-note">A unique ID is all it takes to find each other.</span></> : !state.me ? <div className="onboarding"><span className="eyebrow">MAKE YOURSELF AT HOME.</span><h2>First, a little hello.</h2><p>Pick a name and an ID that’s yours.</p>{profileForm(false)}</div> : <><span className="eyebrow">LESS NOISE. MORE HELLO.</span><h2>A little closer.</h2><p>Good conversations start with a hello.<br/>Find someone by their ID and make the first move.</p><button className="primary" onClick={find}><Icon name="plus" size={18}/>Start a conversation</button><div className="share-id"><span>Your ID</span><button onClick={() => copy(state.me!.handle)}>{state.me.handle}<Icon name={copied ? 'check' : 'copy'} size={14}/></button></div></>}
        </div>
        <div className="welcome-bottom"><span className="mini-mark"><Icon name="chat" size={13}/></span>Just you and the conversation.</div>
      </>}
    </section>

    {modal && <div className="modal-overlay" onMouseDown={e => {if (e.target === e.currentTarget) setModal(null);}}><div className="modal" role="dialog" aria-modal="true" aria-labelledby="dialog-title" ref={dialogRef}><button className="icon-button modal-close" aria-label="Close dialog" onClick={() => setModal(null)}><Icon name="close"/></button>{modal === 'profile' ? <><span className="eyebrow">YOUR LITTLE CORNER</span><h2 id="dialog-title">Your profile.</h2><p>Your name can change. Your ID stays yours.</p>{state?.me && <div className="profile-preview"><Avatar person={state.me}/><div><strong>{state.me.name}</strong><span>{state.me.handle}</span></div></div>}{profileForm(true)}<a className="signout" href="/signout-with-chatgpt?return_to=%2F" target="_top"><Icon name="logout" size={16}/>Sign out</a></> : selected && <div className="person-dialog"><Avatar person={selected}/><h2 id="dialog-title">{selected.name}</h2><button className="person-id" onClick={() => copy(selected.handle)}>{selected.handle}<Icon name={copied ? 'check' : 'copy'} size={16}/></button><p className="person-bio">{selected.bio || 'A conversation, just between you two.'}</p></div>}</div></div>}
    <span className="sr-only" role="status" aria-live="polite">{copied ? 'ID copied to clipboard.' : notice}</span>{notice && <div className="toast" aria-hidden="true"><Icon name="check" size={15}/>{notice}</div>}
  </main>;
}
