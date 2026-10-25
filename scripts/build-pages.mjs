import {mkdirSync,writeFileSync} from 'node:fs';

const input=process.env.APP_URL;
if(!input)throw new Error('Set APP_URL to the live Render app URL before building GitHub Pages.');
const url=new URL(input);
if(url.protocol!=='https:'||url.username||url.password||url.hostname.endsWith('.github.io'))throw new Error('APP_URL must be the HTTPS address of the live messenger, not its GitHub Pages launch page.');
const target=url.href,attribute=target.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const script=JSON.stringify(target).replace(/</g,'\\u003c');
mkdirSync('dist/pages',{recursive:true});
writeFileSync('dist/pages/.nojekyll','');
writeFileSync('dist/pages/index.html',`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Deepi Talk</title><meta name="description" content="Find your people by ID. Start a conversation."><style>body{margin:0;min-height:100dvh;display:grid;place-items:center;background:#fafbf8;color:#293c2b;font:15px system-ui,sans-serif}main{text-align:center;padding:35px}svg{color:#789267}h1{font-weight:500;font-size:35px;letter-spacing:-1.5px;margin:22px 0 10px}p{color:#9aa58e;font-size:13px}a{display:inline-block;padding:13px 22px;margin:18px 0;border-radius:8px;background:#315d4d;color:white;text-decoration:none;font-size:13px}a:focus-visible{outline:3px solid #8da477;outline-offset:4px}</style></head><body><main><svg width="45" height="45" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><path d="M4 4h16v14H9l-5 3V4Z"/><path d="M8 9h8m-8 4h5"/></svg><h1>deepi talk.</h1><p>A little space to connect.</p><a href="${attribute}" rel="noopener">Open messenger</a></main><script>location.replace(${script});</script></body></html>`);
console.log('Built the GitHub Pages launch page in dist/pages.');
