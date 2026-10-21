import { describe, expect, it } from 'vitest';
import type { Schedule } from '../server/types';
import {
  allWeekdays, applyStandardShiftToAll, resetShiftForDay,
  selectScheduleDays, shiftForDay, updateShiftForDay
} from '../web/src/company-schedule-editor';
import { scheduleSchema } from '../server/core/validation';
import { scheduleForDate, scheduleMinutes } from '../server/core/time';

const original: Schedule = {
  start:'07:00', break_start:'11:00', break_end:'12:00',
  end:'16:00', paid_break:false, weekdays:[1,2,3,4,5]
};

describe('CR JORNADA — gestor configura turnos semanais e por funcionário', () => {
  it('permite marcar todos os dias com a mesma configuração', () => {
    const schedule=selectScheduleDays(original,allWeekdays);
    expect(schedule.weekdays).toHaveLength(7);
    expect(schedule.day_overrides).toBeUndefined();
    expect(scheduleSchema.safeParse(schedule).success).toBe(true);
  });
  it('João entra às 07h na segunda e 13h na terça com jornada válida', () => {
    let joao=updateShiftForDay(original,2,'start','13:00');
    joao=updateShiftForDay(joao,2,'break_start','16:00');
    joao=updateShiftForDay(joao,2,'break_end','17:00');
    joao=updateShiftForDay(joao,2,'end','22:00');
    expect(scheduleSchema.safeParse(joao).success).toBe(true);
    expect(shiftForDay(joao,1).start).toBe('07:00');
    expect(shiftForDay(joao,2).start).toBe('13:00');
    expect(scheduleForDate(joao,'2026-10-26').start).toBe('07:00');
    expect(scheduleForDate(joao,'2026-10-27').start).toBe('13:00');
    expect(scheduleMinutes(joao).weekly).toBe(2400);
  });
  it('funcionários diferentes podem receber modelos independentes', () => {
    const joao=updateShiftForDay(original,2,'start','13:00');
    expect(shiftForDay(original,2).start).toBe('07:00');
    expect(shiftForDay(joao,2).start).toBe('13:00');
  });
  it('restaura somente um dia ou reaplica o padrão a todos', () => {
    let schedule=updateShiftForDay(original,2,'start','13:00');
    schedule=updateShiftForDay(schedule,3,'start','14:00');
    schedule=resetShiftForDay(schedule,2);
    expect(shiftForDay(schedule,2).start).toBe('07:00');
    expect(shiftForDay(schedule,3).start).toBe('14:00');
    expect(applyStandardShiftToAll(schedule).day_overrides).toBeUndefined();
  });
  it('modo uniforme limpa turnos especiais antes de persistir escala',()=>{
    let personalized=updateShiftForDay(original,2,'start','13:00');
    personalized=updateShiftForDay(personalized,2,'break_start','16:00');
    personalized=updateShiftForDay(personalized,2,'break_end','17:00');
    personalized=updateShiftForDay(personalized,2,'end','22:00');
    const uniform=applyStandardShiftToAll(personalized);
    expect(uniform.day_overrides).toBeUndefined();
    expect(uniform.weekdays).toEqual([1,2,3,4,5]);
    expect(scheduleSchema.safeParse(uniform).success).toBe(true);
    expect(scheduleForDate(uniform,'2026-10-27').start).toBe('07:00');
    expect(JSON.parse(JSON.stringify(uniform)).day_overrides).toBeUndefined();
    const named={...personalized,name:'Comercial - modo individual'};
    const clean=applyStandardShiftToAll(named);
    expect(clean.name).toBe('Comercial - modo individual');
    expect(Object.hasOwn(clean,'day_overrides')).toBe(false);
    expect(JSON.stringify(clean)).not.toContain('day_overrides');
    expect(scheduleForDate(clean,'2026-10-27').start).toBe('07:00');
  });
  it('desmarcar o dia exclui apenas seu horário especial', () => {
    const schedule=selectScheduleDays(updateShiftForDay(original,2,'start','13:00'),[1,3,4,5]);
    expect(schedule.weekdays).toEqual([1,3,4,5]);
    expect(schedule.day_overrides).toBeUndefined();
    expect(updateShiftForDay(schedule,2,'start','15:00')).toBe(schedule);
  });
  it('não autoriza um horário especial fora da ordem', () => {
    const invalid=updateShiftForDay(original,2,'break_start','07:00');
    expect(scheduleSchema.safeParse(invalid).success).toBe(false);
  });
});
