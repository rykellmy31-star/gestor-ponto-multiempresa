import { z } from 'zod';
const common={work_date:z.string().regex(/^20\d{2}-\d{2}-\d{2}$/),employee_id:z.string().min(1).max(128).optional(),
  expected_revision:z.number().int().min(0),reason:z.string().trim().min(10).max(500)};
export const companyDayEventSchema=z.discriminatedUnion('kind',[
  z.object({...common,kind:z.literal('holiday'),value:z.object({name:z.string().trim().min(2).max(120)}).strict().nullable()}).strict(),
  z.object({...common,kind:z.literal('occurrence'),value:z.object({kind:z.enum(['day_off','medical','justified_absence']),paid:z.boolean()}).strict().nullable()}).strict(),
  z.object({...common,kind:z.literal('adjustment'),value:z.object({marks:z.tuple([z.number().int(),z.number().int(),z.number().int(),z.number().int()])}).strict().nullable()}).strict()
]);
export type CompanyDayEvent={id:string;employee_id:string|null;work_date:string;kind:'holiday'|'occurrence'|'adjustment';
  revision:number;value_json:string;reason:string;created_at:number};
