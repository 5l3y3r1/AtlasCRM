'use strict';
/**
 * notify.js — In-app notifications.
 *
 * The `notifications` table existed but nothing ever wrote to it, so the bell
 * and the notifications page only ever showed seed rows. This is the single
 * place that creates them, so the shape stays consistent wherever they come
 * from.
 *
 * Columns are the table's own: type / title / message / link / ref_type /
 * ref_id. (The frontend used to read body / notification_type / action_url,
 * which matched nothing — every notification rendered with an empty body and a
 * dead link.)
 *
 * Task alerts in particular have to cover the whole round trip, not just the
 * handover: a manager assigns work and hears nothing back until they go looking
 * at the list. Assignment, reassignment, completion, cancellation and missed
 * deadlines all raise one.
 */
const { nanoid } = require('nanoid');
const { db } = require('./db');

/** Create one notification. Never throws — a failed notice must not fail the
 *  action that triggered it. Returns the row id, or null. */
function notify(userId, { type = 'INFO', title, message = null, link = null, refType = null, refId = null } = {}) {
  if (!userId || !title) return null;
  try {
    const id = nanoid();
    db.prepare(
      `INSERT INTO notifications (id, user_id, type, title, message, link, ref_type, ref_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, userId, type, title, message, link, refType, refId);
    return id;
  } catch (e) {
    console.error('[notify] failed:', e.message);
    return null;
  }
}

/**
 * Create one notification, unless this person has already had this exact alert
 * about this exact record. Used by the scheduled sweep: "your task is overdue"
 * is worth saying once, not once per tick for as long as it stays late.
 */
function notifyOnce(userId, opts) {
  if (!userId || !opts || !opts.refId) return null;
  try {
    const existing = db.prepare(
      'SELECT 1 FROM notifications WHERE user_id = ? AND type = ? AND ref_id = ? LIMIT 1'
    ).get(userId, opts.type, opts.refId);
    if (existing) return null;
  } catch (e) {
    console.error('[notify] dedupe check failed:', e.message);
    return null;   // better silent than a repeat every tick
  }
  return notify(userId, opts);
}

/** Clear previously-sent alerts of these types for a record, so the next time
 *  it genuinely qualifies the alert can fire again — a task whose deadline is
 *  pushed out and missed a second time should say so a second time. */
function clearAlerts(refId, types) {
  if (!refId || !types || !types.length) return;
  try {
    const ph = types.map(() => '?').join(',');
    db.prepare(`DELETE FROM notifications WHERE ref_id = ? AND type IN (${ph})`).run(refId, ...types);
  } catch (e) {
    console.error('[notify] clear failed:', e.message);
  }
}

/** Display name for a user id, for use inside notification copy. */
function userName(id) {
  try {
    const u = db.prepare('SELECT first_name, last_name FROM users WHERE id = ?').get(id);
    return u ? `${u.first_name || ''} ${u.last_name || ''}`.trim() : '';
  } catch (e) { return ''; }
}

const TASK_ALERT_TYPES = ['TASK_ASSIGNED', 'TASK_REASSIGNED', 'TASK_DUE', 'TASK_OVERDUE', 'TASK_COMPLETED', 'TASK_CANCELLED'];

function dueSuffix(task) {
  return task && task.due_at ? ` · ვადა ${String(task.due_at).slice(0, 10)}` : '';
}
function taskTitle(task) {
  return (task && task.title) || 'უსათაურო';
}

/**
 * Someone assigned a task to someone else.
 *
 * Skipped when a user assigns a task to themselves — they already know, and a
 * notification for your own action is noise that trains people to ignore the
 * bell.
 */
function notifyTaskAssigned(task, assignerId) {
  const assignee = task.assigned_to;
  if (!assignee || assignee === assignerId) return null;

  const who = userName(assignerId);
  return notify(assignee, {
    type: 'TASK_ASSIGNED',
    title: `ახალი დავალება: ${taskTitle(task)}`,
    message: (who ? `${who}-მ დაგინიშნა დავალება.` : 'თქვენ დაგინიშნათ დავალება.') + dueSuffix(task),
    link: '#tasks',
    refType: 'task',
    refId: task.id,
  });
}

/**
 * A task moved off someone's plate. They were working from a queue that no
 * longer contains it, so silence here means they keep chasing work that is not
 * theirs — or assume it is still handled when it has been handed on.
 */
function notifyTaskTakenAway(task, previousAssigneeId, actorId) {
  if (!previousAssigneeId || previousAssigneeId === actorId) return null;
  const who = userName(actorId);
  const now = task.assigned_to ? userName(task.assigned_to) : null;
  return notify(previousAssigneeId, {
    type: 'TASK_REASSIGNED',
    title: `დავალება გადავიდა სხვასთან: ${taskTitle(task)}`,
    message: (who ? `${who}-მ ` : '') + (now ? `გადაანაწილა ${now}-ზე.` : 'მოხსნა თქვენი სიიდან.'),
    link: '#tasks',
    refType: 'task',
    refId: task.id,
  });
}

/**
 * The assignee closed a task out. This is the half of the loop that was
 * missing: whoever asked for the work had no way to learn it was done short of
 * re-reading the list.
 */
function notifyTaskClosed(task, actorId, status) {
  const creator = task.created_by;
  if (!creator || creator === actorId) return null;

  const who = userName(actorId);
  const done = status === 'COMPLETED';
  return notify(creator, {
    type: done ? 'TASK_COMPLETED' : 'TASK_CANCELLED',
    title: `${done ? 'დავალება შესრულდა' : 'დავალება გაუქმდა'}: ${taskTitle(task)}`,
    message: who ? `${who}-მ ${done ? 'დაასრულა' : 'გააუქმა'} თქვენ მიერ დანიშნული დავალება.` : null,
    link: '#tasks',
    refType: 'task',
    refId: task.id,
  });
}

module.exports = {
  notify,
  notifyOnce,
  clearAlerts,
  userName,
  notifyTaskAssigned,
  notifyTaskTakenAway,
  notifyTaskClosed,
  TASK_ALERT_TYPES,
};
