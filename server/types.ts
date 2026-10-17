import type { Context } from 'hono';
export type Realm = 'admin' | 'employee';
export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  ENVIRONMENT: 'development' | 'production' | 'test';
  APP_ORIGIN: string;
  AUTH_PEPPER: string;
  DATA_KEY: string;
  BOOTSTRAP_TOKEN?: string;
  SESSION_HOURS?: string;
  MAIL_API_KEY?: string;
  MAIL_FROM?: string;
}
export interface Principal {
  id: string; login: string; email: string | null; display_name: string;
  role: Realm; employee_id: string | null; active: number; must_change_password: number;
  token_hash: string; csrf_token: string; reauth_at: number; expires_at: number;
}
export type App = { Bindings: Env; Variables: { db: D1DatabaseSession; principal: Principal; requestId: string } };
export type Ctx = Context<App>;
export interface Schedule {
  name?: string; start: string; break_start: string; break_end: string; end: string;
  weekdays: number[]; paid_break: boolean;
}
export interface Rules {
  mark_tolerance: number; daily_tolerance: number; rounding_step: number;
  rounding_mode: 'floor' | 'nearest' | 'ceil'; auto_approve_overtime: boolean;
  compensation: 'review' | 'bank'; max_shift_hours: number;
}
export interface Employee {
  id: string; full_name: string; registration: string; job_title: string;
  admission_date: string; employment_end: string | null; status: string;
  notes: string; cpf_last4?: string | null;
}
export interface Occurrence {
  id: string; work_date: string; kind: string; reason: string;
  paid: number; status: string; review_reason?: string;
}
export interface DayResult {
  date: string; weekday: string; timezone: string; marks: (number | null)[]; raw_marks: (number | null)[];
  expected_minutes: number; worked_minutes: number; break_minutes: number;
  credited_minutes: number; late_minutes: number; early_minutes: number;
  overtime_minutes: number; overtime_pending_minutes: number; overtime_rejected_minutes: number;
  missing_minutes: number; raw_balance_minutes: number; balance_minutes: number;
  positive_minutes: number; status: string; worked_day: boolean; absence: boolean;
  incomplete: boolean; pending_occurrences: number; notes: string[];
  adjusted: boolean; schedule: Schedule | null; rules: Rules;
}
export interface Totals {
  expected_minutes: number; worked_minutes: number; break_minutes: number; credited_minutes: number;
  late_minutes: number; early_minutes: number; overtime_minutes: number; overtime_pending_minutes: number;
  missing_minutes: number; balance_minutes: number; raw_balance_minutes: number;
  worked_days: number; absences: number; incomplete_days: number; pending_occurrences: number;
}
export interface Report {
  employee: Employee; company: { company_name: string; company_document: string; timezone: string };
  month: string; from: string; to: string; generated_at: number;
  days: DayResult[]; totals: Totals;
  weeks: { from: string; to: string; totals: Totals }[];
  closure: null | { id: string; status: string; version: number; closed_at: number; report_hash: string };
  revision: number;
}
