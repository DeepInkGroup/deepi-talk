'use client';
import {useEffect,useRef} from 'react';
import {EmojiGlyph} from './emoji-text';

const groups = [
  {name:'Faces',items:[['😀','grinning face'],['😃','happy face'],['😄','smile'],['😁','beaming face'],['😊','blushing smile'],['🙂','slight smile'],['😂','tears of joy'],['🤣','rolling with laughter'],['🥹','holding back tears'],['😍','heart eyes'],['🥰','smiling with hearts'],['😘','blowing a kiss'],['😎','cool face'],['🤩','star eyes'],['🥳','party face'],['🤔','thinking'],['🫡','salute'],['🤗','hug'],['😅','relieved laugh'],['😉','wink'],['🙃','upside down face'],['😴','sleeping'],['🥺','pleading face'],['😭','crying'],['😢','sad face'],['😮','surprise'],['😤','frustrated face'],['😬','grimacing'],['🤯','mind blown'],['🤫','quiet'],['😇','innocent'],['🤭','giggle']]},
  {name:'Gestures & love',items:[['👋','hello'],['👍','thumbs up'],['👎','thumbs down'],['👏','applause'],['🙌','celebration'],['🤝','handshake'],['🙏','thank you'],['💪','strong'],['✌️','peace'],['🤞','fingers crossed'],['🫶','heart hands'],['👌','okay'],['❤️','red heart'],['🧡','orange heart'],['💛','yellow heart'],['💚','green heart'],['💙','blue heart'],['💜','purple heart'],['🤍','white heart'],['🖤','black heart'],['💔','broken heart'],['💕','two hearts'],['💯','one hundred'],['✨','sparkles']]},
  {name:'Little things',items:[['🎉','party popper'],['🎂','birthday cake'],['🎁','gift'],['🎈','balloon'],['🔥','fire'],['⭐','star'],['☀️','sun'],['🌙','moon'],['🌈','rainbow'],['☕','coffee'],['🍵','tea'],['🍕','pizza'],['🍰','cake'],['🌸','blossom'],['🌻','sunflower'],['🌿','leaves'],['🐱','cat'],['🐶','dog'],['🦋','butterfly'],['🌍','earth'],['🎵','music'],['📷','camera'],['💡','idea'],['✅','check mark']]},
];
export default function EmojiPicker({onSelect,onClose}:{onSelect:(emoji:string)=>void;onClose:()=>void}) {
  const ref=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    ref.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const outside=(event:PointerEvent)=>{if(event.target instanceof Element && event.target.closest('[aria-label="Add emoji"]'))return;if(!ref.current?.contains(event.target as Node))onClose();};
    const key=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();onClose();}};
    document.addEventListener('pointerdown',outside);document.addEventListener('keydown',key);
    return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',key);};
  },[onClose]);
  return <div className="emoji-picker" ref={ref} role="region" aria-label="Emoji picker">
    <div className="emoji-heading"><span>A little expression.</span><button type="button" onClick={onClose} aria-label="Close emoji picker">×</button></div>
    {groups.map(group=><section key={group.name}><h3>{group.name}</h3><div className="emoji-grid">{group.items.map(([emoji,name])=><button type="button" key={name} aria-label={name} title={name} onClick={()=>onSelect(emoji)}><EmojiGlyph emoji={emoji} decorative/></button>)}</div></section>)}
    <a className="emoji-credit" href="https://github.com/jdecked/twemoji#license" target="_blank" rel="noreferrer">Twemoji · CC BY 4.0</a>
  </div>;
}
