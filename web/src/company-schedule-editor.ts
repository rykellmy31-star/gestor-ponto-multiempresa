import type { Schedule, ScheduleDay } from '../../server/types';

export const allWeekdays: number[] = [0,1,2,3,4,5,6];
export type ShiftKey = keyof ScheduleDay;

export function shiftForDay(schedule: Schedule, day: number): ScheduleDay {
  return schedule.day_overrides?.[
    String(day) as keyof NonNullable<Schedule['day_overrides']>
  ] ?? {
    start:schedule.start, break_start:schedule.break_start,
    break_end:schedule.break_end, end:schedule.end,
    paid_break:schedule.paid_break
  };
}

// Each day override is a full, independent shift configuration.
export function updateShiftForDay(
  schedule: Schedule, day: number, field: ShiftKey, value: string | boolean
): Schedule {
  if (!schedule.weekdays.includes(day) || day < 0 || day > 6) return schedule;
  const key = String(day) as keyof NonNullable<Schedule['day_overrides']>;
  return {
    ...schedule,
    day_overrides: {
      ...schedule.day_overrides,
      [key]: {...shiftForDay(schedule, day), [field]: value}
    }
  };
}

export function resetShiftForDay(schedule: Schedule, day: number): Schedule {
  const overrides = {...(schedule.day_overrides ?? {})};
  delete overrides[String(day) as keyof typeof overrides];
  const {day_overrides: _previous, ...rest} = schedule;
  return Object.keys(overrides).length ? {...rest,day_overrides:overrides} : rest;
}

export function applyStandardShiftToAll<T extends Schedule>(schedule: T): T {
  const {day_overrides: _previous, ...rest} = schedule;
  // A configuracao adicional (ex.: nome do formulario) continua intacta,
  // mas a propriedade opcional day_overrides deve desaparecer de verdade.
  return rest as T;
}

export function selectScheduleDays(schedule: Schedule, days: number[]): Schedule {
  const unique = [...new Set(days)].filter(d=>Number.isInteger(d)&&d>=0&&d<=6).sort();
  const overrides = {...(schedule.day_overrides ?? {})};
  for (const day of allWeekdays) {
    if (!unique.includes(day)) delete overrides[String(day) as keyof typeof overrides];
  }
  const {day_overrides: _previous, ...rest} = schedule;
  return Object.keys(overrides).length
    ? {...rest,weekdays:unique,day_overrides:overrides}
    : {...rest,weekdays:unique};
}
