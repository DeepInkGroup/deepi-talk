'use client';
import {useState} from 'react';

export function emojiAsset(emoji:string) {
  const sequence=emoji.includes('\u200d')?emoji:emoji.replace(/\ufe0f/g,'');
  const code=[...sequence].map(character=>character.codePointAt(0)!.toString(16)).join('-');
  return `https://cdn.jsdelivr.net/gh/jdecked/twemoji@v17.0.3/assets/svg/${code}.svg`;
}
export function EmojiGlyph({emoji,decorative=false}:{emoji:string;decorative?:boolean}) {
  const [failed,setFailed]=useState(false);
  return failed ? <>{emoji}</> : <img className="emoji-art" src={emojiAsset(emoji)} alt={decorative?'':emoji} aria-hidden={decorative||undefined} loading="lazy" referrerPolicy="no-referrer" draggable={false} onError={()=>setFailed(true)}/>;
}
export default function EmojiText({text}:{text:string}) {
  if(typeof Intl.Segmenter!=='function')return <>{text}</>;
  const parts=[...new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(text)];
  return <>{parts.map(({segment,index})=>/\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20e3/u.test(segment)?<EmojiGlyph key={index+':'+segment} emoji={segment}/>:segment)}</>;
}
