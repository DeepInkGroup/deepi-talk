import {mkdirSync,writeFileSync,readFileSync,existsSync,unlinkSync} from 'node:fs';
import {resolve} from 'node:path';

export function localBucket(directory) {
  mkdirSync(directory,{recursive:true});
  const filePath = key => {
    if (!/^[a-f0-9-]{36}$/.test(key)) throw new Error('Invalid storage key.');
    return resolve(directory,key);
  };
  return {
    async put(key,bytes) {writeFileSync(filePath(key),bytes);},
    async get(key) {const path=filePath(key);return existsSync(path) ? {body:readFileSync(path)} : null;},
    async delete(key) {const path=filePath(key);if(existsSync(path))unlinkSync(path);},
  };
}
