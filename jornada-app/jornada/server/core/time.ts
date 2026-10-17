import { DateTime } from 'luxon';
import type { Schedule } from '../types';
export const localDate = (ms: number, zone: string) => DateTime.fromMillis(ms,{zone}).toISODate()!;
export const localTime = (ms: number | null, zone: string) => ms === null ? '—' : DateTime.fromMillis(ms,{zone}).toFormat('HH:mm');
export const dateBr = (date: string) => DateTime.fromISO(date).toFormat('dd/MM/yyyy');
export const minutesOf = (hhmm: string) => +hhmm.slice(0,2)*60 + +hhmm.slice(3);
export function scheduleMinutes(s: Schedule) {
  const start=minutesOf(s.start);
  const offset=(v:string)=>minutesOf(v)<start?minutesOf(v)+1440:minutesOf(v);
  const end=minutesOf(s.end)<=start?minutesOf(s.end)+1440:minutesOf(s.end);
  const pause=offset(s.break_end)-offset(s.break_start);
  return { daily:end-start-(s.paid_break?0:pause), weekly:(end-start-(s.paid_break?0:pause))*s.weekdays.length, pause, overnight:end>1440 };
}
export function shiftBounds(date: string, s: Schedule, zone: string) {
  const start=DateTime.fromISO(`${date}T${s.start}`,{zone});
  const relative=(t:string,isEnd=false)=>{
    let d=DateTime.fromISO(`${date}T${t}`,{zone});
    if (minutesOf(t)<minutesOf(s.start)||(isEnd&&minutesOf(t)===minutesOf(s.start))) d=d.plus({days:1});
    return d.toMillis();
  };
  return { start:start.toMillis(), breakStart:relative(s.break_start), breakEnd:relative(s.break_end), end:relative(s.end,true) };
}
export function anchorDate(now:number,s:Schedule|null,zone:string) {
  const d=DateTime.fromMillis(now,{zone});
  if (s && minutesOf(s.end)<minutesOf(s.start) && d.hour*60+d.minute < Math.min(minutesOf(s.end)+240,minutesOf(s.start))) return d.minus({days:1}).toISODate()!;
  return d.toISODate()!;
}
export function fromLocal(input:string,zone:string) {
  const parsed=DateTime.fromISO(input,{zone});
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(input)||!parsed.isValid||parsed.toFormat("yyyy-MM-dd'T'HH:mm")!==input.slice(0,16)) return null;
  return parsed.toMillis();
}
export function duration(minutes:number, signed=false) {
  const sign=minutes<0?'−':signed&&minutes>0?'+':'';
  const n=Math.abs(Math.trunc(minutes)); return `${sign}${Math.floor(n/60).toString().padStart(2,'0')}:${(n%60).toString().padStart(2,'0')}`;
}
export function datesBetween(from:string,to:string) {
  const result:string[]=[];let d=DateTime.fromISO(from);const end=DateTime.fromISO(to);
  while(d<=end){result.push(d.toISODate()!);d=d.plus({days:1});}return result;
}
