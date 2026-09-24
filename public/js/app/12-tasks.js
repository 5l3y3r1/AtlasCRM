// ═══════════════════════════════════════════════════════
// TASKS
//
// One source of truth for task status lives in TASK_STATUS below. Everything
// else — filters, badges, the overdue test, the completion checkbox — derives
// from it, so the vocabulary can't drift apart again the way it had (the seed
// wrote DONE while the whole UI compared against COMPLETED, leaving those rows
// permanently unchecked, unfilterable and flagged overdue).
// ═══════════════════════════════════════════════════════

// Colour comes from the status itself (CSS keys off data-status), not from the
// shared .badge-* classes. Those are written for leads and listings, where
// badge-new and badge-active are both green — which meant a pending task and a
// completed one were exactly the same shade, and the column carried no
// information at a glance.
const TASK_STATUS = {
    PENDING:     { label: 'მოლოდინში',    icon: 'hourglass',       open: true  },
    IN_PROGRESS: { label: 'მიმდინარე',    icon: 'refresh-cw',      open: true  },
    COMPLETED:   { label: 'დასრულებული',  icon: 'check-circle-2',  open: false },
    CANCELLED:   { label: 'გაუქმებული',   icon: 'x',               open: false },
};
// Rows written before the vocabulary was unified. Normalised on read so old
// data behaves correctly even if the migration hasn't run against this DB.
const LEGACY_STATUS = { DONE: 'COMPLETED', CANCELED: 'CANCELLED' };

const OPEN_STATUSES   = Object.keys(TASK_STATUS).filter(k => TASK_STATUS[k].open);
const CLOSED_STATUSES = Object.keys(TASK_STATUS).filter(k => !TASK_STATUS[k].open);

function normStatus(s) {
    const up = String(s || 'PENDING').toUpperCase();
    return LEGACY_STATUS[up] || (TASK_STATUS[up] ? up : 'PENDING');
}
function isTaskOpen(s)   { return TASK_STATUS[normStatus(s)].open; }
function isTaskClosed(s) { return !isTaskOpen(s); }

const TASK_TYPES = {
    GENERAL:  { label: 'ზოგადი',    icon: 'pin' },
    CALL:     { label: 'ზარი',      icon: 'phone' },
    EMAIL:    { label: 'ემეილი',    icon: 'mail' },
    MEETING:  { label: 'შეხვედრა',  icon: 'handshake' },
    SHOWING:  { label: 'ჩვენება',   icon: 'home' },
    FOLLOWUP: { label: 'Follow-up', icon: 'refresh-cw' },
    DOCUMENT: { label: 'დოკუმენტი', icon: 'file-text' },
};

// Tokens, not hex: the old hardcoded values (#888, #4285f4, #ff9500, #ff3b30)
// were invisible against the dark theme and predated the blue palette.
const TASK_PRIORITY = {
    LOW:    { label: 'დაბალი',   color: 'var(--text-muted)' },
    MEDIUM: { label: 'საშ.',     color: 'var(--info)' },
    HIGH:   { label: 'მაღალი',   color: 'var(--warning)' },
    URGENT: { label: 'სასწრაფო', color: 'var(--danger)', icon: 'flame' },
};

// Who may hand work to somebody else. Mirrors WRITE_MANAGER_ROLES in
// routes/data.js — the server is the one that enforces this; the UI matches it
// so an agent is never shown a dropdown whose every other option comes back 403.
const TASK_MANAGER_ROLES = new Set(['MANAGER', 'FOUNDER', 'OWNER', 'ADMIN']);
function canAssignToOthers() {
    return !!(currentUser && TASK_MANAGER_ROLES.has(currentUser.role));
}

let currentTaskFilter = 'ALL';
let _taskAgentCache = null;
let _taskAgentCacheAt = 0;
// Long enough to keep the modal snappy, short enough that someone who joined
// the company today is assignable today. It used to be cached for the life of
// the session, so a new colleague simply never appeared.
const AGENT_CACHE_MS = 5 * 60 * 1000;

// Task titles and descriptions are user input rendered into a template string.
function esc(v) { return escHtml(v); }   // delegates to the canonical escaper

/**
 * Turn a server refusal into something the person reading it can act on.
 *
 * The permission guards in routes/data.js answer in English, which is fine for
 * an API and useless in a Georgian UI — an agent who tried to reassign a task
 * would get a raw "Only managers may reassign a task" in a red toast.
 */
const TASK_ERROR_TEXT = [
    [/only managers may assign/i,   'დავალების სხვისთვის მინიჭება მხოლოდ მენეჯერს შეუძლია.'],
    [/only managers may reassign/i, 'დავალების გადანაწილება მხოლოდ მენეჯერს შეუძლია.'],
    [/only the person who created/i,'ამ დავალებას ვერ წაშლი — ის სხვისგან არის დანიშნული.'],
    [/you can only change tasks/i,  'შეგიძლია მხოლოდ შენზე მინიჭებული დავალებების შეცვლა.'],
    [/missing required field/i,     'შეავსე სავალდებულო ველები.'],
];
function taskErrorMessage(e) {
    const raw = (e && (e.message || e.error)) || String(e || '');
    for (const [pattern, text] of TASK_ERROR_TEXT) if (pattern.test(raw)) return text;
    return 'შეცდომა: ' + raw;
}

function taskIsOverdue(task) {
    return !!(task.due_at && new Date(task.due_at) < new Date() && isTaskOpen(task.status));
}

/* ─── Load & render ───────────────────────────────────────────────────── */

async function loadTasks() {
    if (typeof refreshTaskBadge === 'function') refreshTaskBadge();

    let query = client
        .from('tasks')
        .select('*, assigned:users!tasks_assigned_to_fkey(first_name, last_name)')
        .order('due_at', { ascending: true });

    // MINE and OVERDUE are filtered client-side: "overdue" depends on the
    // current clock and on the open/closed split, which is awkward to express
    // in the query dialect and trivial here.
    if (currentTaskFilter === 'PENDING')      query = query.eq('status', 'PENDING');
    else if (currentTaskFilter === 'IN_PROGRESS') query = query.eq('status', 'IN_PROGRESS');
    else if (currentTaskFilter === 'COMPLETED')   query = query.in('status', ['COMPLETED', 'DONE']);
    else if (currentTaskFilter === 'MINE')        query = query.eq('assigned_to', currentUser.id);
    else if (currentTaskFilter === 'TODAY') {
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
        query = query.gte('due_at', today.toISOString()).lt('due_at', tomorrow.toISOString());
    }

    const { data } = await query;
    let rows = data || [];
    if (currentTaskFilter === 'OVERDUE') rows = rows.filter(taskIsOverdue);

    // Open tasks first, then by due date — a completed task shouldn't sit at the
    // top of the queue just because its deadline was the earliest.
    rows.sort((a, b) => {
        const oa = isTaskOpen(a.status) ? 0 : 1, ob = isTaskOpen(b.status) ? 0 : 1;
        if (oa !== ob) return oa - ob;
        if (!a.due_at && !b.due_at) return 0;
        if (!a.due_at) return 1;          // undated tasks sink below dated ones
        if (!b.due_at) return -1;
        return new Date(a.due_at) - new Date(b.due_at);
    });

    const container = document.getElementById('tasks-list');
    if (!container) return;

    if (!rows.length) {
        container.innerHTML = `
            <div class="empty">
                <div class="empty-icon"><i data-lucide="clipboard-list" class="lucide-i"></i></div>
                <div class="empty-title">${currentTaskFilter === 'ALL' ? 'ამოცანები ჯერ არ არის' : 'ამ ფილტრით ამოცანა არ მოიძებნა'}</div>
                <div class="empty-sub">${esc(t('empty_tasks_sub'))}</div>
            </div>`;
        renderTaskCounts([]);
        if (window.lucide) { try { window.lucide.createIcons(); } catch (e) {} }
        return;
    }

    container.innerHTML = `
        <table>
            <thead>
                <tr>
                    <th style="width:34px"><i data-lucide="check" class="lucide-i"></i></th>
                    <th>ამოცანა</th>
                    <th>ვის</th>
                    <th>${esc(t('th_type'))}</th>
                    <th>პრიორ.</th>
                    <th>${esc(t('th_due'))}</th>
                    <th>${esc(t('th_status'))}</th>
                    <th style="width:90px"></th>
                </tr>
            </thead>
            <tbody>${rows.map(taskRow).join('')}</tbody>
        </table>`;

    renderTaskCounts(rows);
    if (window.lucide) { try { window.lucide.createIcons(); } catch (e) {} }
}

function taskRow(task) {
    const status = normStatus(task.status);
    const closed = isTaskClosed(status);
    const overdue = taskIsOverdue(task);
    const who = [task.assigned?.first_name, task.assigned?.last_name].filter(Boolean).join(' ');

    return `
        <tr class="${overdue ? 'task-overdue' : ''}${closed ? ' task-done' : ''}">
            <td>
                <input type="checkbox" class="task-check" ${closed ? 'checked' : ''}
                       onchange="toggleTaskComplete('${esc(task.id)}', this.checked)"
                       aria-label="დასრულება">
            </td>
            <td class="task-title-cell">
                <strong>${esc(task.title)}</strong>
                ${task.description ? `<div class="task-desc">${esc(task.description)}</div>` : ''}
            </td>
            <td>${who ? esc(who) : '—'}</td>
            <td>${taskTypeLabel(task.task_type)}</td>
            <td>${priorityLabel(task.priority)}</td>
            <td class="${overdue ? 'task-due-late' : ''}">
                ${task.due_at ? esc(formatDateTime(task.due_at)) : '—'}
                ${overdue ? ' <i data-lucide="alert-triangle" class="lucide-i" title="ვადაგადაცილებული"></i>' : ''}
            </td>
            <td>${statusControl(task, status)}</td>
            <td>
                <div class="action-buttons">
                    <button class="action-btn edit" onclick="editTask('${esc(task.id)}')" title="რედაქტირება"><i data-lucide="pencil" class="lucide-i"></i></button>
                    <button class="action-btn delete" onclick="deleteTask('${esc(task.id)}')" title="წაშლა"><i data-lucide="trash-2" class="lucide-i"></i></button>
                </div>
            </td>
        </tr>`;
}

/**
 * Status, changeable in place.
 *
 * "In progress" existed in the vocabulary but was reachable only by opening the
 * edit modal, so in practice every task jumped straight from pending to done
 * and the middle of the workflow was never recorded. Cancelling had the same
 * problem — and it matters, because cancelling is how an agent declines work
 * visibly (it notifies whoever assigned it) instead of deleting the row.
 */
function statusControl(task, status) {
    const opts = Object.entries(TASK_STATUS)
        .map(([k, v]) => `<option value="${k}"${k === status ? ' selected' : ''}>${v.label}</option>`)
        .join('');
    return `<select class="task-status-select" data-status="${status}"
                    onchange="setTaskStatus('${esc(task.id)}', this.value)"
                    aria-label="სტატუსი">${opts}</select>`;
}

function taskTypeLabel(type) {
    const def = TASK_TYPES[type];
    if (!def) return esc(type || '—');
    return `<i data-lucide="${def.icon}" class="lucide-i"></i> ${def.label}`;
}

function priorityLabel(p) {
    const def = TASK_PRIORITY[p];
    if (!def) return esc(p || '—');
    return `<span class="task-priority" style="color:${def.color}">${
        def.icon ? `<i data-lucide="${def.icon}" class="lucide-i"></i> ` : ''}${def.label}</span>`;
}

/** Live counts beside each filter button, so the queue's shape is visible. */
function renderTaskCounts(visible) {
    const el = document.getElementById('task-counts');
    if (!el) return;
    const mine = visible.filter(x => x.assigned_to === currentUser.id).length;
    const overdue = visible.filter(taskIsOverdue).length;
    el.innerHTML = `${visible.length} ამოცანა`
        + (mine ? ` · ${mine} ჩემი` : '')
        + (overdue ? ` · <span style="color:var(--danger);font-weight:600">${overdue} ვადაგადაცილებული</span>` : '');
}

/* ─── Filters ─────────────────────────────────────────────────────────── */

// Bound once via delegation rather than re-attached on every render.
(function bindTaskFilters() {
    function bind() {
        const bar = document.getElementById('task-filters');
        if (!bar) return;
        bar.addEventListener('click', (ev) => {
            const btn = ev.target.closest('.task-filter');
            if (!btn) return;
            bar.querySelectorAll('.task-filter').forEach(b => b.classList.toggle('active', b === btn));
            currentTaskFilter = btn.dataset.filter;
            loadTasks();
        });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
    else bind();
})();

/* ─── Create / edit ───────────────────────────────────────────────────── */

/** Company agents for the assignee dropdown. Only a manager can use the list,
 *  so only a manager pays for fetching it. */
async function taskAgents() {
    if (!canAssignToOthers()) return [];
    if (_taskAgentCache && Date.now() - _taskAgentCacheAt < AGENT_CACHE_MS) return _taskAgentCache;
    // Team name comes along so a manager assigning work can see which team the
    // person is on, rather than picking from a flat list of first names.
    const { data } = await client.from('users')
        .select('id, first_name, last_name, role, team_id, team:teams(name)')
        .eq('is_active', true);
    _taskAgentCache = data || [];
    _taskAgentCacheAt = Date.now();
    return _taskAgentCache;
}

function agentLabel(u) {
    const name = [u.first_name, u.last_name].filter(Boolean).join(' ') || 'უსახელო';
    const team = u.team && u.team.name;
    return team ? `${name} · ${team}` : name;
}

/**
 * Options for the assignee field.
 *
 * A non-manager gets exactly one: whoever holds the task now (themselves, in
 * every case they can reach except a task they raised and a manager has since
 * moved on). The server refuses anything else — see checkTaskAssignment in
 * routes/data.js — so offering a full list would only produce a 403 the user
 * could not have predicted.
 */
function agentOptions(agents, selectedId, holderLabel) {
    const sel = selectedId || currentUser.id;

    if (!canAssignToOthers()) {
        // agents is empty for a non-manager, so the name of anyone other than
        // the current user comes from the task's own embedded assignee.
        const label = sel === currentUser.id
            ? `${esc(currentUser.first_name || '')} (მე)`
            : esc(holderLabel || '—');
        return `<option value="${esc(sel)}" selected>${label}</option>`;
    }

    const me = `<option value="${esc(currentUser.id)}"${sel === currentUser.id ? ' selected' : ''}>${esc(currentUser.first_name)} (მე)</option>`;
    return me + agents
        .filter(u => u.id !== currentUser.id)
        .map(u => `<option value="${esc(u.id)}"${u.id === sel ? ' selected' : ''}>${esc(agentLabel(u))}</option>`)
        .join('');
}

function selectOptions(map, selected) {
    return Object.entries(map)
        .map(([k, v]) => `<option value="${k}"${k === selected ? ' selected' : ''}>${v.label}</option>`)
        .join('');
}

/** Shared form body for both create and edit. `task` is null when creating. */
function taskFormHtml(task, agents) {
    const status = task ? normStatus(task.status) : 'PENDING';
    // datetime-local wants "YYYY-MM-DDTHH:mm" in LOCAL time. Slicing the stored
    // UTC string shifts the deadline by the timezone offset, which is how a
    // 09:00 task became 05:00 on reopening the form.
    let dueLocal = '';
    if (task && task.due_at) {
        const d = new Date(task.due_at);
        if (!isNaN(d)) dueLocal = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    }

    return `
        <div class="form-group">
            <label class="form-label">სათაური <span class="req" style="color:var(--danger);font-weight:700">*</span></label>
            <input class="form-input" id="task-title" maxlength="200" value="${esc(task ? task.title : '')}" placeholder="მაგ: გიორგის დარეკვა">
        </div>
        <div class="form-group">
            <label class="form-label">${esc(t('f_desc'))}</label>
            <textarea class="form-textarea" id="task-desc" rows="2">${esc(task ? (task.description || '') : '')}</textarea>
        </div>
        <div class="form-row">
            <div class="form-group">
                <label class="form-label">ვის ეკუთვნის</label>
                <select class="form-select" id="task-assigned"${canAssignToOthers() ? '' : ' disabled'}>${
                    agentOptions(agents, task && task.assigned_to,
                        task && task.assigned && [task.assigned.first_name, task.assigned.last_name].filter(Boolean).join(' '))}</select>
                ${canAssignToOthers() ? '' :
                    '<div class="form-hint">დავალების სხვისთვის მინიჭება მენეჯერს შეუძლია.</div>'}
            </div>
            <div class="form-group">
                <label class="form-label">${esc(t('f_type'))}</label>
                <select class="form-select" id="task-type">${selectOptions(TASK_TYPES, task ? task.task_type : 'GENERAL')}</select>
            </div>
        </div>
        <div class="form-row">
            <div class="form-group">
                <label class="form-label">${esc(t('f_priority'))}</label>
                <select class="form-select" id="task-priority">${selectOptions(TASK_PRIORITY, task ? task.priority : 'MEDIUM')}</select>
            </div>
            <div class="form-group">
                <label class="form-label">${esc(t('f_deadline'))}</label>
                <input class="form-input" id="task-due" type="datetime-local" value="${dueLocal}">
            </div>
        </div>
        ${task ? `
        <div class="form-group">
            <label class="form-label">${esc(t('f_status'))}</label>
            <select class="form-select" id="task-status">${selectOptions(TASK_STATUS, status)}</select>
        </div>` : ''}
        <button class="btn btn-primary" onclick="${task ? `updateTask('${esc(task.id)}')` : 'saveTask()'}" style="width:100%">
            <i data-lucide="save" class="lucide-i"></i> ${task ? 'განახლება' : 'შენახვა'}
        </button>`;
}

function readTaskForm() {
    const title = document.getElementById('task-title').value.trim();
    if (!title) { showToast('სათაური აუცილებელია', 'error'); return null; }
    const dueAt = document.getElementById('task-due').value;
    return {
        title,
        description: document.getElementById('task-desc').value.trim() || null,
        assigned_to: document.getElementById('task-assigned').value || null,
        task_type: document.getElementById('task-type').value,
        priority: document.getElementById('task-priority').value,
        due_at: dueAt ? new Date(dueAt).toISOString() : null,
    };
}

async function openTaskModal() {
    openModalLoading(t('mt_new_task'));
    const agents = await taskAgents();
    openModal(t('mt_new_task'), taskFormHtml(null, agents));
}

async function saveTask() {
    const form = readTaskForm();
    if (!form) return;
    try {
        const { error } = await client.from('tasks').insert({
            ...form,
            company_id: currentUser.company_id,
            // created_by is stamped by the server, not sent from here — a task
            // raised by anything that forgot to send it had no owner at all, and
            // the completion alert then had nobody to notify.
            status: 'PENDING',
        });
        if (error) throw error;
        showToast('<i data-lucide="check-circle-2" class="lucide-i"></i> ამოცანა დაემატა');
        closeModal();
        loadTasks();
    } catch (e) {
        showToast(taskErrorMessage(e), 'error');
    }
}

async function editTask(id) {
    openModalLoading('ამოცანის რედაქტირება');
    // Named `task`, NOT `t` — `t` is the global i18n lookup, and shadowing it
    // here made every t('…') call in this form throw "t is not a function",
    // so the edit modal never rendered at all.
    const [{ data: task }, agents] = await Promise.all([
        // The assignee is embedded so the form can name whoever holds the task
        // even when the viewer isn't a manager and has no agent list to look in.
        client.from('tasks')
            .select('*, assigned:users!tasks_assigned_to_fkey(first_name, last_name)')
            .eq('id', id).single(),
        taskAgents(),
    ]);
    if (!task) { closeModal(); showToast('ამოცანა ვერ მოიძებნა', 'error'); return; }
    openModal('ამოცანის რედაქტირება', taskFormHtml(task, agents));
}

async function updateTask(id) {
    const form = readTaskForm();
    if (!form) return;
    try {
        const status = normStatus(document.getElementById('task-status').value);
        const updates = { ...form, status };
        // completed_at tracks when it closed; clearing it on reopen keeps the
        // field honest rather than leaving a stale completion date behind.
        updates.completed_at = isTaskClosed(status) ? new Date().toISOString() : null;

        const { error } = await client.from('tasks').update(updates).eq('id', id);
        if (error) throw error;
        showToast('<i data-lucide="check-circle-2" class="lucide-i"></i> განახლდა');
        closeModal();
        loadTasks();
    } catch (e) {
        showToast(taskErrorMessage(e), 'error');
    }
}

/** Move a task to a given status from the list, without opening the editor. */
async function setTaskStatus(id, raw) {
    const status = normStatus(raw);
    try {
        const { error } = await client.from('tasks').update({
            status,
            // completed_at tracks when it closed; clearing it on reopen keeps the
            // field honest rather than leaving a stale completion date behind.
            completed_at: isTaskClosed(status) ? new Date().toISOString() : null,
        }).eq('id', id);
        if (error) throw error;
        showToast(`<i data-lucide="${TASK_STATUS[status].icon}" class="lucide-i"></i> ${TASK_STATUS[status].label}`);
        loadTasks();
    } catch (e) {
        showToast(taskErrorMessage(e), 'error');
        loadTasks();   // the select is showing a status the server rejected
    }
}

async function toggleTaskComplete(id, isCompleted) {
    await setTaskStatus(id, isCompleted ? 'COMPLETED' : 'PENDING');
}

/** Confirm by title rather than passing it through an inline onclick string. */
async function deleteTask(id) {
    const { data: task } = await client.from('tasks').select('title').eq('id', id).single();
    const title = (task && task.title) || 'ეს ამოცანა';
    showConfirm(`წავშალო „${esc(title)}"?`, 'ეს მოქმედება შეუქცევადია.', async () => {
        try {
            const { error } = await client.from('tasks').delete().eq('id', id);
            if (error) throw error;
            showToast('ამოცანა წაიშალა');
            loadTasks();
        } catch (e) {
            showToast(taskErrorMessage(e), 'error');
        }
    }, 'delete');
}

/* ─── Sidebar badge ───────────────────────────────────────────────────── */

// Count of open tasks assigned to me. Derived from OPEN_STATUSES so it can't
// disagree with what the list considers finished.
async function refreshTaskBadge() {
    const badge = document.getElementById('task-badge');
    // `client` is a top-level `let`, so it is in scope here but NOT on window.
    if (!badge || !currentUser || typeof client === 'undefined' || !client) return;
    try {
        const { count } = await client
            .from('tasks')
            .select('*', { count: 'exact', head: true })
            .eq('assigned_to', currentUser.id)
            .in('status', OPEN_STATUSES);
        const n = count || 0;
        badge.textContent = n > 99 ? '99+' : n;
        badge.style.display = n ? 'inline-block' : 'none';
    } catch (e) {
        badge.style.display = 'none';
    }
}

// Poll on the same cadence as the notification bell so a task assigned by a
// manager shows up without the agent reloading the page.
(function startTaskBadgePolling() {
    const TICK = 60000;
    function tick() { if (currentUser) refreshTaskBadge(); }
    setTimeout(tick, 2500);
    setInterval(tick, TICK);
})();
