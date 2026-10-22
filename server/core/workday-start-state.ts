/**
 * A preexisting company workday with no punch is not a started/frozen day.
 * The CPF route must not bypass live schedule-assignment validation for it.
 *
 * The normal first punch creates the workday and punch atomically in D1.batch;
 * therefore an unstarted preexisting workday needs administrative review.
 */
export function canUseFrozenCompanyWorkday(day: { next_seq: number } | null): boolean {
  return day === null || (Number.isInteger(day.next_seq) && day.next_seq >= 1 && day.next_seq <= 4);
}
