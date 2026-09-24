'use strict';
/**
 * task-alerts.js — deadline alerts for tasks.
 *
 * Assignment raised a notification; deadlines raised nothing. A task could sit
 * a week past its due date and the only way to find out was to open the Tasks
 * page and read the red row — which is exactly the moment the alert was meant
 * to save. Two sweeps run on a timer:
 *
 *   TASK_DUE      due later today, still open
 *   TASK_OVERDUE  due date passed, still open
 *
 * Both go to the assignee. An overdue task also tells whoever assigned it, so a
 * manager learns that work is slipping without having to audit the queue.
 *
 * Each alert is sent once per task (notifyOnce, keyed on notifications.ref_id),
 * so a task that stays late for a fortnight does not produce a fortnight of
 * identical rows. Moving a deadline clears the record, so a second missed
 * deadline is reported again — see clearTaskAlerts() in routes/data.js.
 *
 *   TASK_ALERTS_DISABLED=1   turn the sweep off entirely
 */
const { db } = require('./db');
const { notifyOnce, userName } = require('./notify');

const INTERVAL_MIN = parseInt(process.env.TASK_ALERT_INTERVAL_MIN || '30', 10);

// Kept in step with the frontend's TASK_STATUS map (public/js/app/12-tasks.js):
// only tasks still open can be late. DONE/CANCELED are the pre-unification
// spellings, still possible in older rows.
const OPEN_STATUSES = ['PENDING', 'IN_PROGRESS'];

function openStatusClause() {
  return `status IN (${OPEN_STATUSES.map(() => '?').join(',')})`;
}

/** Tasks whose deadline has passed and which nobody has closed. */
function findOverdue() {
  return db.prepare(
    `SELECT id, title, due_at, assigned_to, created_by
       FROM tasks
      WHERE due_at IS NOT NULL
        AND due_at < ?
        AND ${openStatusClause()}
        AND assigned_to IS NOT NULL`
  ).all(new Date().toISOString(), ...OPEN_STATUSES);
}

/** Open tasks due between now and the end of today, local time. */
function findDueToday() {
  const now = new Date();
  const endOfDay = new Date(now);
  endOfDay.setHours(23, 59, 59, 999);
  return db.prepare(
    `SELECT id, title, due_at, assigned_to, created_by
       FROM tasks
      WHERE due_at IS NOT NULL
        AND due_at >= ?
        AND due_at <= ?
        AND ${openStatusClause()}
        AND assigned_to IS NOT NULL`
  ).all(now.toISOString(), endOfDay.toISOString(), ...OPEN_STATUSES);
}

function hhmm(iso) {
  const d = new Date(iso);
  return isNaN(d) ? '' : d.toTimeString().slice(0, 5);
}
function daysLate(iso) {
  const ms = Date.now() - Date.parse(iso);
  return ms > 0 ? Math.floor(ms / 86400000) : 0;
}

/** One pass. Returns how many alerts were actually created. */
function runSweep() {
  let sent = 0;
  try {
    for (const task of findDueToday()) {
      const at = hhmm(task.due_at);
      if (notifyOnce(task.assigned_to, {
        type: 'TASK_DUE',
        title: `დღეს ვადა: ${task.title || 'უსათაურო'}`,
        message: at ? `დასრულების ვადა დღეს ${at}-ზე.` : 'დასრულების ვადა დღეს.',
        link: '#tasks',
        refType: 'task',
        refId: task.id,
      })) sent++;
    }

    for (const task of findOverdue()) {
      const late = daysLate(task.due_at);
      const lateTxt = late > 0 ? ` ${late} დღით არის დაგვიანებული.` : ' ვადა გასულია.';

      if (notifyOnce(task.assigned_to, {
        type: 'TASK_OVERDUE',
        title: `ვადაგადაცილებული: ${task.title || 'უსათაურო'}`,
        message: `დავალება ჯერ არ დასრულებულა.${lateTxt}`,
        link: '#tasks',
        refType: 'task',
        refId: task.id,
      })) sent++;

      // Whoever asked for the work hears about the slip too — but not twice for
      // the same person, and not for work they assigned to themselves.
      if (task.created_by && task.created_by !== task.assigned_to) {
        const who = userName(task.assigned_to);
        if (notifyOnce(task.created_by, {
          type: 'TASK_OVERDUE',
          title: `ვადაგადაცილებული: ${task.title || 'უსათაურო'}`,
          message: (who ? `${who}-ს ` : '') + `დავალებას ვადა გაუვიდა.${lateTxt}`,
          link: '#tasks',
          refType: 'task',
          refId: task.id,
        })) sent++;
      }
    }
  } catch (e) {
    console.error('[task-alerts] sweep failed:', e.message);
  }
  return sent;
}

/** Start the sweep. Safe to call once at boot; no-op when disabled. */
function scheduleTaskAlerts() {
  if (process.env.TASK_ALERTS_DISABLED === '1') {
    console.log('[task-alerts] disabled via TASK_ALERTS_DISABLED');
    return null;
  }
  // A short delay so the first pass doesn't compete with the rest of boot.
  setTimeout(() => {
    const n = runSweep();
    if (n) console.log(`[task-alerts] ${n} alert(s) on startup sweep`);
  }, 8000);

  const timer = setInterval(runSweep, INTERVAL_MIN * 60 * 1000);
  timer.unref();
  console.log(`[task-alerts] deadline sweep every ${INTERVAL_MIN}m`);
  return timer;
}

module.exports = { scheduleTaskAlerts, runSweep, findOverdue, findDueToday };
