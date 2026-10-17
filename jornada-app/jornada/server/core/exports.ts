import { PDFDocument, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import notoFont from '../assets/NotoSans-Regular.ttf';
import type { Report } from '../types';
import { dateBr, duration, localTime } from './time';
const csvCell=(v:unknown)=>{
  let s=String(v??'');
  if(/^[\s]*[=+\-@\t\r]/.test(s))s="'"+s;
  return `"${s.replaceAll('"','""')}"`;
};
export const csv=(rows:unknown[][])=>'\uFEFF'+rows.map(r=>r.map(csvCell).join(';')).join('\r\n');
export function reportCsv(report:Report){
  const r=report;
  return csv([
    ['Empresa',r.company.company_name,'Funcionário',r.employee.full_name,'Matrícula',r.employee.registration,'Mês',r.month],
    ['Data','Dia','Entrada','Saída intervalo','Retorno','Saída final','Trabalhadas','Previstas','Abonadas','Extras aprovadas','Positivas pendentes','Faltantes','Atrasos','Saída antecipada','Saldo aprovado','Saldo bruto','Situação','Ocorrências'],
    ...r.days.map(d=>[dateBr(d.date),d.weekday,...d.marks.map(m=>localTime(m,d.timezone)),duration(d.worked_minutes),duration(d.expected_minutes),duration(d.credited_minutes),duration(d.overtime_minutes),duration(d.overtime_pending_minutes),duration(d.missing_minutes),duration(d.late_minutes),duration(d.early_minutes),duration(d.balance_minutes,true),duration(d.raw_balance_minutes,true),d.status,d.notes.join(' | ')]),
    ['TOTAIS','','','','','',duration(r.totals.worked_minutes),duration(r.totals.expected_minutes),duration(r.totals.credited_minutes),duration(r.totals.overtime_minutes),duration(r.totals.overtime_pending_minutes),duration(r.totals.missing_minutes),duration(r.totals.late_minutes),duration(r.totals.early_minutes),duration(r.totals.balance_minutes,true),duration(r.totals.raw_balance_minutes,true)],
    ['Dias trabalhados',r.totals.worked_days,'Faltas sem abono',r.totals.absences,'Incompletos',r.totals.incomplete_days,'Ocorrências pendentes',r.totals.pending_occurrences],
  ]);
}
export function generalCsv(reports:Report[]){return csv([
  ['Matrícula','Funcionário','Mês','Dias trabalhados','Previstas','Trabalhadas','Abonadas','Extras aprovadas','Positivas pendentes','Faltantes','Atrasos','Saldo aprovado','Faltas','Incompletos','Fechamento'],
  ...reports.map(r=>[r.employee.registration,r.employee.full_name,r.month,r.totals.worked_days,duration(r.totals.expected_minutes),duration(r.totals.worked_minutes),duration(r.totals.credited_minutes),duration(r.totals.overtime_minutes),duration(r.totals.overtime_pending_minutes),duration(r.totals.missing_minutes),duration(r.totals.late_minutes),duration(r.totals.balance_minutes,true),r.totals.absences,r.totals.incomplete_days,r.closure?.status||'open']),
]);}
const navy=rgb(.08,.16,.22),gray=rgb(.4,.46,.5),light=rgb(.94,.96,.97),teal=rgb(.04,.42,.36);
export async function reportPdf(report:Report){
  const doc=await PDFDocument.create();doc.registerFontkit(fontkit);
  const font=await doc.embedFont(notoFont,{subset:true});
  doc.setTitle(`Folha de ponto - ${report.employee.full_name} - ${report.month}`);doc.setAuthor(report.company.company_name);doc.setCreator('Jornada');
  const W=841.89,H=595.28,margin=28,available=W-2*margin;
  const widths=[47,28,39,39,39,39,47,47,44,44,46,available-559];
  // Total fixo: todas as colunas permanecem dentro da área A4 paisagem.
  const sum=widths.reduce((a,b)=>a+b,0);widths[widths.length-1]+=available-sum;
  const headers=['Data','Dia','Entrada','Intervalo','Retorno','Saída','Realizado','Previsto','HE aprov.','Faltantes','Saldo','Ocorrências'];
  const pages:PDFPage[]=[];const appendix:{date:string;notes:string}[]=[];let page!:PDFPage,y=0;
  const text=(txt:string,x:number,yy:number,size=8,color=navy)=>page.drawText(txt.replaceAll('−','-'),{x,y:yy,size,font,color});
  const fit=(value:string,width:number,size:number)=>{
    let s=value;if(font.widthOfTextAtSize(s,size)<=width)return s;
    while(s.length&&font.widthOfTextAtSize(s+'…',size)>width)s=s.slice(0,-1);
    return s+'…';
  };
  const wrap=(value:string,width:number,size:number)=>{
    const lines:string[]=[];let current='';
    for(const word of value.split(/\s+/)){
      if(font.widthOfTextAtSize((current?current+' ':'')+word,size)>width&&current){lines.push(current);current=word;}else current+=(current?' ':'')+word;
      if(font.widthOfTextAtSize(current,size)>width){while(current.length&&font.widthOfTextAtSize(current,size)>width){let n=current.length;while(n>1&&font.widthOfTextAtSize(current.slice(0,n),size)>width)n--;lines.push(current.slice(0,n));current=current.slice(n);}}
    }if(current)lines.push(current);return lines.length?lines:[''];
  };
  const startPage=(table=true)=>{
    page=doc.addPage([W,H]);pages.push(page);
    text('JORNADA',margin,H-33,9,teal);
    text('Folha de ponto individual',margin,H-55,18);
    text(fit(report.company.company_name,410,9)+(report.company.company_document?` · ${report.company.company_document}`:''),margin,H-72,9);
    text(`Período: ${report.month.split('-').reverse().join('/')}  ·  ${report.closure?.status==='closed'?'FECHADO':'EM CONFERÊNCIA'}`,W-270,H-35,9);
    text(`Funcionário: ${fit(report.employee.full_name,460,9)}`,margin,H-92,9);
    text(`Matrícula: ${report.employee.registration}  ·  Cargo: ${fit(report.employee.job_title||'Não informado',240,9)}`,margin,H-107,9);
    const schedules=[...new Set(report.days.filter(d=>d.schedule).map(d=>`${d.schedule!.name||'Jornada'} ${d.schedule!.start}–${d.schedule!.end} (intervalo ${d.schedule!.break_start}–${d.schedule!.break_end})`))];
    text(fit(`Jornada: ${schedules.join(' / ')||'Sem jornada atribuída'} · ${report.company.timezone}`,available,8),margin,H-123,8,gray);
    y=H-145;
    if(table){page.drawRectangle({x:margin,y:y-18,width:available,height:22,color:navy});
    let x=margin;headers.forEach((h,i)=>{text(h,x+4,y-10,7,rgb(1,1,1));x+=widths[i];});y-=18;}
  };
  startPage();
  for(const [idx,d] of report.days.entries()){
    const notes=d.notes.join(' · '),fullLines=wrap(notes,widths[11]-9,6.2);
    const noteLines=fullLines.length>3?[...fullLines.slice(0,2),'Observações completas: ver anexo.']:fullLines;
    if(fullLines.length>3||d.adjusted){appendix.push({date:d.date,notes:notes+(d.adjusted?' · Registros originais: '+d.raw_marks.map((m,i)=>['Entrada','Intervalo','Retorno','Saída'][i]+' '+localTime(m,d.timezone)).join(' / '):'')});}
    const rowH=Math.max(17,7+noteLines.length*8);
    if(y-rowH<margin+30)startPage();
    if(idx%2===0)page.drawRectangle({x:margin,y:y-rowH,width:available,height:rowH,color:light});
    const cells=[dateBr(d.date),d.weekday,...d.marks.map(m=>localTime(m,d.timezone)),duration(d.worked_minutes),duration(d.expected_minutes),duration(d.overtime_minutes),duration(d.missing_minutes),duration(d.balance_minutes,true)];
    let x=margin;cells.forEach((v,i)=>{text(fit(v,widths[i]-7,7),x+4,y-12,7);x+=widths[i];});
    noteLines.forEach((line,j)=>text(line,x+4,y-11-j*8,6.2,gray));y-=rowH;
  }
  // Totais e assinaturas nunca são cortados; passam juntos à página seguinte.
  if(y-159<margin+30)startPage(false);
  y-=22;text('Resumo do período',margin,y,11);y-=22;
  const t=report.totals;
  const summary=[['Previstas',duration(t.expected_minutes)],['Realizadas',duration(t.worked_minutes)],['Abonadas',duration(t.credited_minutes)],['HE aprovadas',duration(t.overtime_minutes)],['Faltantes',duration(t.missing_minutes)],['Saldo aprovado',duration(t.balance_minutes,true)]];
  summary.forEach(([label,value],i)=>{const x=margin+i*available/6;text(label,x,y,7,gray);text(value,x,y-19,14,i===5?teal:navy);});
  y-=43;text(`Dias trabalhados: ${t.worked_days} · Faltas sem abono: ${t.absences} · Incompletos: ${t.incomplete_days} · Atrasos: ${duration(t.late_minutes)} · Saídas antecipadas: ${duration(t.early_minutes)}`,margin,y,8);
  y-=15;text(`Positivas pendentes: ${duration(t.overtime_pending_minutes)} · Saldo bruto: ${duration(t.raw_balance_minutes,true)} · Ocorrências pendentes: ${t.pending_occurrences}`,margin,y,8);
  y-=15;text('Saldo aprovado = horas positivas aprovadas menos faltantes. Abonos não são horas trabalhadas. Sem assinatura digital ICP-Brasil.',margin,y,7,gray);
  y-=33;page.drawLine({start:{x:margin+20,y},end:{x:margin+320,y},thickness:.6,color:gray});page.drawLine({start:{x:W-margin-320,y},end:{x:W-margin-20,y},thickness:.6,color:gray});
  text('Assinatura do funcionário',margin+100,y-14,8,gray);text('Assinatura do responsável',W-margin-240,y-14,8,gray);
  if(appendix.length){
    startPage(false);text('Observações completas e rastreabilidade',margin,y,12);y-=27;
    for(const item of appendix){
      if(y<margin+65)startPage(false);
      text(dateBr(item.date),margin,y,9,teal);y-=17;
      for(const line of wrap(item.notes,available-10,8)){if(y<margin+40)startPage(false);text(line,margin,y,8,gray);y-=12;}y-=18;
    }
  }
  for(const [i,p] of pages.entries()){
    p.drawText(`Jornada · Gerado em ${new Date(report.generated_at).toISOString()} · Página ${i+1}/${pages.length}`,{x:margin,y:14,size:6,font,color:gray});
    if(report.closure?.report_hash)p.drawText(`SHA-256: ${report.closure.report_hash}`,{x:margin+340,y:14,size:5.3,font,color:gray});
  }
  return doc.save();
}
