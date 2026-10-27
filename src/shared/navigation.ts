import { maskSql, splitSql } from './sql';
import type { Dialect } from './types';

export function matchesSearch(query:string,...parts:(string|undefined)[]){
  return query.trim().toLocaleLowerCase().split(/\s+/).every(word=>parts.some(part=>part?.toLocaleLowerCase().includes(word)));
}
export function textMatches(text:string,query:string,limit=200){
  if(!query||limit<=0)return [];
  const pattern=new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'gi');
  const rows:{offset:number;length:number;line:number;column:number;preview:string}[]=[];
  let line=1,lineStart=0;
  for(const match of text.matchAll(pattern)){
    for(let pos=text.indexOf('\n',lineStart);pos>=0&&pos<match.index!;pos=text.indexOf('\n',lineStart)){line++;lineStart=pos+1;}
    const end=text.indexOf('\n',match.index!);
    rows.push({offset:match.index!,length:match[0].length,line,column:match.index!-lineStart+1,preview:text.slice(Math.max(lineStart,match.index!-80),Math.min(end<0?text.length:end,match.index!+160)).trim()});
    if(rows.length>=limit)break;
  }
  return rows;
}
export function sqlOutline(sql:string,dialect:Dialect){
  // ponytail: 复用分句器提供语句与子句导航；不把轻量大纲宣称为完整语法树。
  const masked=maskSql(sql,dialect);
  return splitSql(sql,dialect).flatMap((part,index)=>{
    const offset=part.start+Math.max(0,masked.slice(part.start,part.end).search(/\S/));
    const entries=[{offset,label:`语句 ${index+1} · ${sql.slice(offset,part.end).replace(/\s+/g,' ').slice(0,120)}`}];
    for(const match of masked.slice(offset,part.end).matchAll(/\b(FROM|JOIN|WHERE|GROUP\s+BY|HAVING|ORDER\s+BY|UNION|BEGIN|EXCEPTION)\b/gi)){
      const start=offset+match.index!;
      entries.push({offset:start,label:sql.slice(start,part.end).split('\n')[0].trim().slice(0,120)});
    }
    return entries.map(entry=>({...entry,line:sql.slice(0,entry.offset).split('\n').length}));
  });
}
