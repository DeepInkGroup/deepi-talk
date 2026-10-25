import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {build} from 'rolldown';

mkdirSync('dist/render',{recursive:true});mkdirSync('.sites-runtime',{recursive:true});
writeFileSync('.sites-runtime/render-entry.tsx',"import React from 'react'; import {createRoot} from 'react-dom/client'; import Messenger from '../app/messenger'; createRoot(document.getElementById('root')!).render(<Messenger/>);");
await build({input:'./.sites-runtime/render-entry.tsx',platform:'browser',transform:{jsx:{runtime:'automatic'},define:{'process.env.NODE_ENV':JSON.stringify('production')}},output:{file:'dist/render/app.js',format:'esm'}});
writeFileSync('dist/render/app.css',readFileSync('app/globals.css','utf8').replace("@import 'tailwindcss';",''));
writeFileSync('dist/render/favicon.svg',readFileSync('public/favicon.svg'));
writeFileSync('dist/render/index.html','<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Deepi Talk</title><meta name="description" content="Find your people by ID. Start a conversation."><link rel="icon" href="/favicon.svg"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>');
console.log('Built Render frontend in dist/render.');
