/**
 * Current company schedule for a new day of work.
 *
 * A cancellation is an immutable record that makes an assignment inactive.
 * Reuse the same exclusion rule as monthly reports so CPF punch and
 * the human-readable report cannot disagree about the assigned schedule.
 *
 * Bound arguments: [companyId, workDate, employeeId, workDate].
 */
export const SELECT_ACTIVE_COMPANY_SCHEDULE_SQL = [
  'SELECT COALESCE(h.config_json,s.config_json) AS config_json,',
  'a.id AS assignment_id FROM schedule_assignments a',
  'JOIN schedules s ON s.id=a.schedule_id AND s.company_id=?',
  'LEFT JOIN schedule_history h ON h.id=(',
  'SELECT sh.id FROM schedule_history sh',
  'WHERE sh.schedule_id=a.schedule_id AND sh.effective_from<=?',
  'ORDER BY sh.effective_from DESC,sh.id DESC LIMIT 1)',
  'WHERE a.employee_id=? AND a.effective_from<=?',
  'AND NOT EXISTS (',
  '  SELECT 1 FROM schedule_assignment_cancellations cac',
  '  WHERE cac.assignment_id=a.id',
  ')',
  'ORDER BY a.effective_from DESC,a.created_at DESC,a.id DESC LIMIT 1'
].join(' ');

/**
 * Embedded into the INSERT punch lookup, correlated with `employees e`.
 * Rechecks the latest *active* assignment inside the write transaction,
 * closing the race between reading the schedule and recording a punch.
 * Bound argument: [workDate]. Caller additionally compares to the ID
 * obtained when the schedule was read; existing frozen work days bypass it.
 */
export const CURRENT_ACTIVE_ASSIGNMENT_ID_SQL = [
  'SELECT a.id FROM schedule_assignments a',
  'JOIN schedules s ON s.id=a.schedule_id AND s.company_id=e.company_id',
  'WHERE a.employee_id=e.id AND a.effective_from<=?',
  'AND NOT EXISTS (',
  '  SELECT 1 FROM schedule_assignment_cancellations cac',
  '  WHERE cac.assignment_id=a.id',
  ')',
  'ORDER BY a.effective_from DESC,a.created_at DESC,a.id DESC LIMIT 1'
].join(' ');


/**
 * Current configuration for the assignment already selected at read time.
 * Revalidate the raw JSON to avoid freezing a stale schedule if a manager
 * edits the same schedule between the read and the first punch.
 * Bound arguments: [workDate, assignmentId]. The separate latest-ID check is essential.
 */
export const CURRENT_ASSIGNMENT_CONFIG_SQL = [
  'SELECT COALESCE(h.config_json,s.config_json) AS config_json',
  'FROM schedule_assignments a',
  'JOIN schedules s ON s.id=a.schedule_id AND s.company_id=e.company_id',
  'LEFT JOIN schedule_history h ON h.id=(',
  'SELECT sh.id FROM schedule_history sh',
  'WHERE sh.schedule_id=a.schedule_id AND sh.effective_from<=?',
  'ORDER BY sh.effective_from DESC,sh.id DESC LIMIT 1)',
  'WHERE a.id=?'
].join(' ');
