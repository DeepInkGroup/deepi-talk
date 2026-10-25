// Compile production API modules against the selected Node runtime adapter.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {dirname,resolve,relative} from 'node:path';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';

export function compilePreviewApi(name,contextSource) {
  const root = process.cwd(), output = resolve('.sites-runtime',name), seen = new Set();
  mkdirSync(output,{recursive:true});
  const context = resolve(output,'context.mjs');
  writeFileSync(context,contextSource);
  function compile(input) {
    const destination = resolve(output,relative(root,input).replace(/\.ts$/,'.mjs'));
    if (seen.has(input)) return destination;
    seen.add(input);
    const source = readFileSync(input,'utf8').replace(/from\s+(['"])([^'"]+)\1/g, (match,quote,specifier) => {
      if (specifier === 'cloudflare:workers' || specifier.endsWith('/chatgpt-auth')) return 'from ' + JSON.stringify(pathToFileURL(context).href);
      if (specifier.startsWith('.')) {
        const dependency = resolve(dirname(input),specifier.endsWith('.ts') ? specifier : specifier + '.ts');
        return 'from ' + JSON.stringify(pathToFileURL(compile(dependency)).href);
      }
      return match;
    });
    mkdirSync(dirname(destination),{recursive:true});
    writeFileSync(destination,ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText);
    return destination;
  }
  return {
    chat:pathToFileURL(compile(resolve('app/api/chat/route.ts'))).href,
    media:pathToFileURL(compile(resolve('app/api/media/route.ts'))).href,
  };
}
