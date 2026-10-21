import { DateTime } from 'luxon';
import type { Schedule, ScheduleDay } from '../types';
export const localDate = (ms: number, zone: string) => DateTime.fromMillis(ms,{zone}).toISODate()!;
export const localTime = (ms: number | null, zone: string) => ms === null ? '—' : DateTime.fromMillis(ms,{zone}).toFormat('HH:mm');
export const dateBr = (date: string) => DateTime.fromISO(date).toFormat('dd/MM/yyyy');
export const minutesOf = (hhmm: string) => +hhmm.slice(0,2)*60 + +hhmm.slice(3);
export function scheduleForWeekday(s: Schedule, weekday: number): Schedule {
  const override = s.day_overrides?.[String(weekday) as keyof NonNullable<Schedule['day_overrides']>];
  return override ? { ...s, ...override } : s;
}
export function scheduleForDate(s: Schedule, date: string): Schedule {
  const weekday = DateTime.fromISO(date).weekday % 7;
  return scheduleForWeekday(s, weekday);
}
function dayMinutes(s: ScheduleDay) {
  const start=minutesOf(s.start);
  const offset=(v:string)=>minutesOf(v)<start?minutesOf(v)+1440:minutesOf(v);
  const end=minutesOf(s.end)<=start?minutesOf(s.end)+1440:minutesOf(s.end);
  const pause=offset(s.break_end)-offset(s.break_start);
  return {daily:end-start-(s.paid_break?0:pause),pause,overnight:end>1440};
}
export function scheduleMinutes(s: Schedule) {
  const base=dayMinutes(s);
  const weekly=s.weekdays.reduce((total,weekday)=>{
    return total+dayMinutes(scheduleForWeekday(s,weekday)).daily;
  },0);
  return {...base,weekly};
}
export function shiftBounds(date: string, s: Schedule, zone: string) {
  s=scheduleForDate(s,date);
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
  if (s) {
    // A madrugada pertence ao turno da vespera, inclusive com horario especial.
    const previousDate=d.minus({days:1}).toISODate()!;
    const previous=scheduleForDate(s,previousDate);
    if (minutesOf(previous.end)<minutesOf(previous.start) &&
        d.hour*60+d.minute < Math.min(minutesOf(previous.end)+240,minutesOf(previous.start))) {
      return previousDate;
    }
  }
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
