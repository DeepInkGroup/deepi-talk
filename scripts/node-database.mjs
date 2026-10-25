import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';

export function nodeDatabase(directory) {
  mkdirSync(directory,{recursive:true});
  const sqlite=new DatabaseSync(resolve(directory,'deepi.sqlite'));
  sqlite.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;');
  sqlite.exec('CREATE TABLE IF NOT EXISTS node_schema_migrations (tag TEXT PRIMARY KEY)');
  const journal=JSON.parse(readFileSync('drizzle/meta/_journal.json','utf8'));
  for(const migration of journal.entries){
    if(sqlite.prepare('SELECT tag FROM node_schema_migrations WHERE tag = ?').get(migration.tag))continue;
    sqlite.exec('BEGIN');
    try{
      sqlite.exec(readFileSync('drizzle/'+migration.tag+'.sql','utf8'));
      sqlite.prepare('INSERT INTO node_schema_migrations (tag) VALUES (?)').run(migration.tag);
      sqlite.exec('COMMIT');
    }catch(error){sqlite.exec('ROLLBACK');sqlite.close();throw error;}
  }
  const db={prepare(sql){return {bind(...args){return {
    async first(){return sqlite.prepare(sql).get(...args)||null;},
    async all(){return {results:sqlite.prepare(sql).all(...args)};},
    async run(){return sqlite.prepare(sql).run(...args);},
  };}};},async batch(statements){
    sqlite.exec('BEGIN');
    try{const result=await Promise.all(statements.map(statement=>statement.run()));sqlite.exec('COMMIT');return result;}
    catch(error){sqlite.exec('ROLLBACK');throw error;}
  }};
  return {sqlite,db};
}
