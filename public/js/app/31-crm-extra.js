// ═══════════════════════════════════════════════════════════════════════
// 31-crm-extra.js — Leads/Clients enhancements
//   • Bulk delete (checkboxes + select-all, single request)
//   • Clickable rows → detail modal (action buttons preserved)
//   • Instant client-side search across all fields
//   • Full-detail PDF export (every field) for leads & clients
//   • Send generated PDF via WhatsApp (Web Share file → fallback hosted link)
//
// This module loads AFTER 05-edit-delete.js / 06-clients.js, so its enhanced
// loadLeads()/loadClients() intentionally override the originals. All other
// modules keep calling loadLeads()/loadClients() and transparently get these.
// ═══════════════════════════════════════════════════════════════════════

// ── shared state ────────────────────────────────────────────────────────
window._recCache = window._recCache || { leads: [], clients: [] };
window._recSel   = window._recSel   || { leads: new Set(), clients: new Set() };
window._userNames = window._userNames || null;

// Resolve agent/owner names once per load (id → "First Last"). Cached.
async function _loadUserNames(force) {
    if (window._userNames && !force) return window._userNames;
    const map = {};
    try {
        const { data } = await client.from('users').select('id,first_name,last_name');
        (data || []).forEach(u => { map[u.id] = `${_esc(u.first_name || '')} ${_esc(u.last_name || '')}`.trim(); });
    } catch (e) { /* non-fatal */ }
    window._userNames = map;
    return map;
}
function _ownerName(id) { return (id && window._userNames && window._userNames[id]) || '—'; }

function _esc(v) { return escHtml(v); }   // delegates to the canonical escaper
function _q(v) { return (v == null ? '' : String(v)).replace(/'/g, ''); }

// Export gate (PDF / WhatsApp / Excel buttons are all "export"). Hidden when the
// "Export Data" permission is off for the role.
// Follow-up cell: shows next-contact date with an overdue/today indicator.
function _followUpCell(d) {
    if (!d) return '<span style="color:var(--text-subtle)">—</span>';
    const day = String(d).slice(0, 10);
    const today = new Date().toISOString().slice(0, 10);
    if (day < today)  return `<span style="color:#dc2626;font-weight:600">${day} • ${t('fu_overdue','ვადაგადაცილდა')}</span>`;
    if (day === today) return `<span style="color: var(--brand);font-weight:600">${day} • ${t('fu_today','დღეს')}</span>`;
    return `<span style="color:var(--text-muted)">${day}</span>`;
}
function _followUpText(d) {
    if (!d) return null;
    const day = String(d).slice(0, 10);
    const today = new Date().toISOString().slice(0, 10);
    if (day < today) return day + ' • ' + t('fu_overdue','ვადაგადაცილდა');
    if (day === today) return day + ' • ' + t('fu_today','დღეს');
    return day;
}

function _canExport() {
    return typeof hasPermission !== 'function' || hasPermission('pdf_export', 'can_create');
}

// ════════════════════════════════════════════════════════════════════════
// LEADS — list with checkboxes, clickable rows, search
// ════════════════════════════════════════════════════════════════════════
async function loadLeads() {
    const container = document.getElementById('leads-list');
    if (!container) return;
    await _loadUserNames();
    const { data } = await client.from('leads').select('*').order('created_at', { ascending: false });
    window._recCache.leads = data || [];
    // Drop selections that no longer exist
    const ids = new Set(window._recCache.leads.map(r => r.id));
    window._recSel.leads.forEach(id => { if (!ids.has(id)) window._recSel.leads.delete(id); });
    renderLeads();
}

function _filterRecords(rows, term, fields) {
    const q = (term || '').trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(r => fields.some(f => {
        const v = typeof f === 'function' ? f(r) : r[f];
        return v != null && String(v).toLowerCase().includes(q);
    }));
}

function renderLeads() {
    const container = document.getElementById('leads-list');
    if (!container) return;
    const term = document.getElementById('leads-search')?.value || '';
    const rows = _filterRecords(window._recCache.leads, term, [
        'lead_number', 'full_name', 'phone', 'phone2', 'phone3', 'myhome_id', 'ssge_id', 'email', 'source', 'status', 'temperature',
        r => _ownerName(r.agent_id),
    ]);

    if (!window._recCache.leads.length) {
        container.innerHTML = `
            <div class="empty">
                <div class="empty-icon"><i data-lucide="inbox" class="lucide-i"></i></div>
                <div class="empty-title">${t("empty_leads")}</div>
                <div class="empty-sub">${t("empty_leads_sub")}</div>
            </div>`;
        if (window.lucide) try { window.lucide.createIcons(); } catch (e) {}
        return;
    }

    const sel = window._recSel.leads;
    const allChecked = rows.length > 0 && rows.every(r => sel.has(r.id));

    container.innerHTML = `
        ${_bulkBar('leads')}
        <table>
            <thead>
                <tr>
                    <th style="width:34px"><input type="checkbox" ${allChecked ? 'checked' : ''} onchange="toggleSelectAll('leads', this.checked)" title="${t('select_all','ყველას მონიშვნა')}"></th>
                    <th>#</th>
                    <th>${t('f_owner_name','მფლობელი')}</th>
                    <th>${t("th_phone")}</th>
                    <th>${t("th_email")}</th>
                    <th>${t('th_agent','აგენტი')}</th>
                    <th>${t("th_source")}</th>
                    <th>${t("th_status")}</th>
                    <th>${t("th_temp")}</th>
                    <th>${t("th_date")}</th>
                    <th></th>
                </tr>
            </thead>
            <tbody>
                ${rows.map(l => `
                    <tr data-id="${l.id}" style="cursor:pointer" onclick="openLeadDetail('${l.id}')">
                        <td onclick="event.stopPropagation()"><input type="checkbox" ${sel.has(l.id) ? 'checked' : ''} onchange="toggleSelect('leads','${l.id}',this.checked)"></td>
                        <td>${l.lead_number || '—'}</td>
                        <td><strong>${_esc(l.full_name) || '—'}</strong></td>
                        <td>${_esc(l.phone) || '—'}${(l.phone2 || l.phone3) ? `<div style="font-size:11px;color:var(--text-muted)">${[l.phone2, l.phone3].filter(Boolean).map(_esc).join(' · ')}</div>` : ''}</td>
                        <td>${_esc(l.email) || '—'}</td>
                        <td>${_esc(_ownerName(l.agent_id))}</td>
                        <td>${_esc(l.source)}</td>
                        <td><span class="badge badge-new">${l.status || 'NEW'}</span></td>
                        <td><span class="badge badge-${(l.temperature || 'cold').toLowerCase()}">${l.temperature || 'COLD'}</span></td>
                        <td>${formatDate(l.created_at)}</td>
                        <td onclick="event.stopPropagation()">
                            <div class="action-buttons">
                                <button class="action-btn" onclick="openMsgModal('lead','${l.id}','${_esc(_q(l.phone))}','${_esc(_q(l.email))}','${_esc(_q(l.full_name))}')" title="${t('action_message','შეტყობინება')}" style="color:#25D366"><i data-lucide="message-circle" class="lucide-i"></i></button>
                                <button class="action-btn edit" onclick="editLead('${l.id}')" title="${t('action_edit','რედაქტირება')}"><i data-lucide="pencil" class="lucide-i"></i></button>
                                <button class="action-btn delete" onclick="deleteRecord('leads','${l.id}','${_esc(_q(l.full_name || l.phone || t('fallback_lead','ლიდი')))}')" title="${t('action_delete','წაშლა')}"><i data-lucide="trash-2" class="lucide-i"></i></button>
                            </div>
                        </td>
                    </tr>`).join('')}
                ${rows.length === 0 ? `<tr><td colspan="11" style="text-align:center;color:var(--text-muted);padding:24px">${t('no_results','ვერაფერი მოიძებნა')} "${_esc(term)}"</td></tr>` : ''}
            </tbody>
        </table>`;
    if (window.lucide) try { window.lucide.createIcons(); } catch (e) {}
}

function filterLeads() { renderLeads(); }

// ════════════════════════════════════════════════════════════════════════
// CLIENTS — list with checkboxes, clickable rows, search
// ════════════════════════════════════════════════════════════════════════
async function loadClients() {
    const container = document.getElementById('clients-list');
    if (!container) return;
    await _loadUserNames();
    const { data } = await client.from('clients').select('*').order('created_at', { ascending: false });
    window._recCache.clients = data || [];
    const ids = new Set(window._recCache.clients.map(r => r.id));
    window._recSel.clients.forEach(id => { if (!ids.has(id)) window._recSel.clients.delete(id); });
    renderClients();
}

function renderClients() {
    const container = document.getElementById('clients-list');
    if (!container) return;
    const term = document.getElementById('clients-search')?.value || '';
    const rows = _filterRecords(window._recCache.clients, term, [
        'client_number', 'first_name', 'last_name', 'middle_name', 'phone', 'phone2', 'email',
        'whatsapp', 'telegram', 'personal_id', 'status', 'city', 'occupation', 'company_name',
        'preferred_location', 'preferred_property_type', 'looking_for', 'tags', 'priority', 'lead_source',
        r => (Array.isArray(r.client_type) ? r.client_type.join(' ') : r.client_type),
        r => _ownerName(r.primary_agent_id),
    ]);

    if (!window._recCache.clients.length) {
        container.innerHTML = `
            <div class="empty">
                <div class="empty-icon"><i data-lucide="users" class="lucide-i"></i></div>
                <div class="empty-title">${t("empty_clients")}</div>
                <div class="empty-sub">${t("empty_clients_sub")}</div>
            </div>`;
        if (window.lucide) try { window.lucide.createIcons(); } catch (e) {}
        return;
    }

    const sel = window._recSel.clients;
    const allChecked = rows.length > 0 && rows.every(r => sel.has(r.id));

    container.innerHTML = `
        ${_bulkBar('clients')}
        <table>
            <thead>
                <tr>
                    <th style="width:34px"><input type="checkbox" ${allChecked ? 'checked' : ''} onchange="toggleSelectAll('clients', this.checked)" title="${t('select_all','ყველას მონიშვნა')}"></th>
                    <th>#</th>
                    <th>${t("th_name")}</th>
                    <th>${t("th_phone")}</th>
                    <th>${t("th_email")}</th>
                    <th>${t('th_owner','მფლობელი')}</th>
                    <th>${t("th_type")}</th>
                    <th>${t("th_budget")}</th>
                    <th>${t('th_followup','Follow-up')}</th>
                    <th></th>
                </tr>
            </thead>
            <tbody>
                ${rows.map(c => `
                    <tr data-id="${c.id}" style="cursor:pointer" onclick="openClientDetail('${c.id}')">
                        <td onclick="event.stopPropagation()"><input type="checkbox" ${sel.has(c.id) ? 'checked' : ''} onchange="toggleSelect('clients','${c.id}',this.checked)"></td>
                        <td>${c.client_number || '—'}</td>
                        <td><strong>${_esc(c.first_name)} ${_esc(c.last_name) || ''}</strong></td>
                        <td>${_esc(c.phone) || '—'}</td>
                        <td>${_esc(c.email) || '—'}</td>
                        <td>${_esc(_ownerName(c.primary_agent_id))}</td>
                        <td>${Array.isArray(c.client_type) ? _esc(c.client_type.join(', ')) : (_esc(c.client_type) || '—')}</td>
                        <td>${c.budget_max ? '$' + Number(c.budget_max).toLocaleString() : '—'}</td>
                        <td>${_followUpCell(c.follow_up_date)}</td>
                        <td onclick="event.stopPropagation()">
                            <div class="action-buttons">
                                <button class="action-btn" onclick="openMsgModal('client','${c.id}','${_esc(_q(c.phone))}','${_esc(_q(c.email))}','${_esc(_q((c.first_name + ' ' + (c.last_name || '')).trim()))}')" title="${t('action_message','შეტყობინება')}" style="color:#25D366"><i data-lucide="message-circle" class="lucide-i"></i></button>
                                <button class="action-btn edit" onclick="editClient('${c.id}')" title="${t('action_edit','რედაქტირება')}"><i data-lucide="pencil" class="lucide-i"></i></button>
                                <button class="action-btn delete" onclick="deleteRecord('clients','${c.id}','${_esc(_q((c.first_name + ' ' + (c.last_name || '')).trim()))}')" title="${t('action_delete','წაშლა')}"><i data-lucide="trash-2" class="lucide-i"></i></button>
                            </div>
                        </td>
                    </tr>`).join('')}
                ${rows.length === 0 ? `<tr><td colspan="10" style="text-align:center;color:var(--text-muted);padding:24px">${t('no_results','ვერაფერი მოიძებნა')} "${_esc(term)}"</td></tr>` : ''}
            </tbody>
        </table>`;
    if (window.lucide) try { window.lucide.createIcons(); } catch (e) {}
}

function filterClients() { renderClients(); }

// ════════════════════════════════════════════════════════════════════════
// BULK SELECT + DELETE
// ════════════════════════════════════════════════════════════════════════
function _bulkBar(table) {
    const n = window._recSel[table].size;
    if (!n) return '';
    const label = table === 'leads' ? 'ლიდი' : 'კლიენტი';
    return `
        <div class="bulk-bar" style="display:flex;align-items:center;gap:12px;padding:10px 12px;margin-bottom:10px;background:var(--brand-soft,#EFF6FF);border:1px solid var(--brand-border,#BFDBFE);border-radius:8px">
            <strong style="color:var(--brand-hover,#1D4ED8)">${n} მონიშნული ${label}</strong>
            <button class="btn btn-secondary" style="margin-left:auto" onclick="clearSelection('${table}')">გასუფთავება</button>
            <button class="btn btn-danger" style="background:#EF4444;color:#fff" onclick="bulkDelete('${table}')"><i data-lucide="trash-2" class="lucide-i"></i> წაშლა (${n})</button>
        </div>`;
}
function toggleSelect(table, id, checked) {
    if (checked) window._recSel[table].add(id); else window._recSel[table].delete(id);
    (table === 'leads' ? renderLeads : renderClients)();
}
function toggleSelectAll(table, checked) {
    const term = document.getElementById(table + '-search')?.value || '';
    const fields = table === 'leads'
        ? ['lead_number', 'full_name', 'phone', 'phone2', 'phone3', 'email', 'source', 'status', 'temperature', r => _ownerName(r.agent_id)]
        : ['client_number', 'first_name', 'last_name', 'phone', 'email', 'status',
           r => (Array.isArray(r.client_type) ? r.client_type.join(' ') : r.client_type), r => _ownerName(r.primary_agent_id)];
    const visible = _filterRecords(window._recCache[table], term, fields);
    visible.forEach(r => { if (checked) window._recSel[table].add(r.id); else window._recSel[table].delete(r.id); });
    (table === 'leads' ? renderLeads : renderClients)();
}
function clearSelection(table) {
    window._recSel[table].clear();
    (table === 'leads' ? renderLeads : renderClients)();
}
function bulkDelete(table) {
    const ids = Array.from(window._recSel[table]);
    if (!ids.length) return;
    const label = table === 'leads' ? 'ლიდი' : 'კლიენტი';
    showConfirm('მასობრივი წაშლა',
        `დარწმუნებული ხარ რომ წაშლი ${ids.length} ${label}-ს? ეს მოქმედება შეუქცევადია.`,
        async () => {
            try {
                // POST body instead of a giant ?id=in.(...) query string — the old
                // approach silently dropped ids past a few hundred once the URL got
                // too long. The server itself batches internally, so this is a single
                // request no matter how many ids are selected.
                const res = await fetch('/api/data/' + table + '/bulk-delete', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({ ids }),
                });
                const j = await res.json();
                if (!res.ok) throw new Error(j.error || 'შეცდომა');
                window._recSel[table].clear();
                const deleted = j.data?.deleted ?? ids.length;
                showToast(`<i data-lucide="check-circle-2" class="lucide-i"></i> ${deleted} ჩანაწერი წაიშალა`);
                table === 'leads' ? loadLeads() : loadClients();
            } catch (e) {
                showToast('შეცდომა: ' + e.message, 'error');
            }
        }, 'delete');
}

// ════════════════════════════════════════════════════════════════════════
// DETAIL MODALS  (clickable rows)
// ════════════════════════════════════════════════════════════════════════
function _row(label, val) {
    const v = (val == null || val === '') ? '—' : _esc(val);
    return `<div class="info-row" style="display:flex;gap:8px;padding:8px 12px;background:var(--surface-2);border-radius:6px">
        <span style="font-weight:600;color:var(--text);min-width:140px;flex-shrink:0">${label}</span><span>${v}</span></div>`;
}
function _fmtDateTime(s) { if (!s) return '—'; try { return new Date(s).toLocaleString('ka-GE'); } catch (e) { return s; } }

async function openLeadDetail(id) {
    openModalLoading('<i data-lucide="user" class="lucide-i"></i> ' + t('lead_details','ლიდის დეტალები'));
    await _loadUserNames();
    const { data: l } = await client.from('leads').select('*').eq('id', id).single();
    if (!l) { showToast(t('lead_not_found','ლიდი ვერ მოიძებნა'), 'error'); return; }
    // Linked properties (extension/owner data): listings whose owner is this lead.
    let linked = [];
    try { const r = await client.from('listings').select('id,listing_number,title,list_price,source').eq('owner_lead_id', id); linked = r.data || []; } catch (e) {}

    const linkedHtml = linked.length ? `
        <div class="section-title" style="font-weight:700;color:var(--brand,#1D4ED8);margin:16px 0 8px">${t('linked_properties','დაკავშირებული ობიექტები (ექსტენშენი)')}</div>
        ${linked.map(x => `<div class="info-row" style="display:flex;gap:8px;padding:8px 12px;background:var(--brand-soft);border-radius:6px">
            <span style="font-weight:600;min-width:90px">${x.listing_number || '—'}</span>
            <span>${_esc(x.title) || '—'} — $${Number(x.list_price || 0).toLocaleString()} ${x.source ? '· ' + _esc(x.source) : ''}</span></div>`).join('')}` : '';

    openModal('<i data-lucide="user" class="lucide-i"></i> ' + (_esc(l.full_name) || t('fallback_lead','ლიდი')), `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
            ${_row('Lead ID', l.lead_number)}
            ${_row(t('th_status'), l.status)}
            ${_row(t('f_owner_name','მფლობელი'), l.full_name)}
            ${_row(t('f_temperature','სიმხურვალე'), l.temperature)}
            ${_row(t('f_phone'), l.phone)}
            ${_row(t('f_phone') + ' 2', l.phone2)}
            ${_row(t('f_phone') + ' 3', l.phone3)}
            ${l.myhome_id ? _row('MyHome ID', l.myhome_id) : ''}
            ${l.ssge_id ? _row('SS.GE ID', l.ssge_id) : ''}
            ${_row(t('f_email'), l.email)}
            ${_row(t('th_source'), l.source)}
            ${_row(t('f_owner_agent','მფლობელი (აგენტი)'), _ownerName(l.agent_id))}
            ${_row(t('f_direction','მიმართულება'), l.direction)}
            ${_row(t('f_contacted_at','დაკავშირდა'), _fmtDateTime(l.contacted_at))}
            ${_row(t('f_created','შეიქმნა'), _fmtDateTime(l.created_at))}
            ${_row(t('f_updated','განახლდა'), _fmtDateTime(l.updated_at))}
        </div>
        ${_row(t('f_message','შეტყობინება'), l.inquiry_message)}
        ${_row(t('f_notes','შენიშვნები'), l.notes)}
        ${linkedHtml}
        <div style="display:flex;gap:8px;margin-top:16px;flex-wrap:wrap">
            <button class="btn btn-primary" style="flex:1;min-width:120px" onclick="editLead('${l.id}')"><i data-lucide="pencil" class="lucide-i"></i> ${t('action_edit','რედაქტირება')}</button>
            ${_canExport() ? `<button class="btn btn-secondary" onclick="downloadLeadPDF('${l.id}')"><i data-lucide="file-text" class="lucide-i"></i> PDF</button>
            <button class="btn btn-secondary" style="color:#25D366" onclick="sendRecordPDFViaWhatsApp('lead','${l.id}')"><i data-lucide="send" class="lucide-i"></i> WhatsApp</button>` : ''}
        </div>
    `);
}

async function openClientDetail(id) {
    openModalLoading('<i data-lucide="user" class="lucide-i"></i> ' + t('client_details','კლიენტის დეტალები'));
    await _loadUserNames();
    const { data: c } = await client.from('clients').select('*').eq('id', id).single();
    if (!c) { showToast(t('client_not_found','კლიენტი ვერ მოიძებნა'), 'error'); return; }
    const budget = (c.budget_min || c.budget_max)
        ? `$${Number(c.budget_min || 0).toLocaleString()} – $${Number(c.budget_max || 0).toLocaleString()}` : null;

    openModal('<i data-lucide="user" class="lucide-i"></i> ' + (_esc((c.first_name || '') + ' ' + (c.last_name || '')).trim() || t('fallback_client','კლიენტი')), `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
            ${_row('Client ID', c.client_number)}
            ${_row(t('th_status'), c.status)}
            ${_row(t('f_name','სახელი'), c.first_name)}
            ${_row(t('f_lastname'), c.last_name)}
            ${_row(t('f_phone'), c.phone)}
            ${_row(t('f_email'), c.email)}
            ${_row(t('th_type'), Array.isArray(c.client_type) ? c.client_type.join(', ') : c.client_type)}
            ${_row(t('f_budget','ბიუჯეტი'), budget)}
            ${c.looking_for ? _row(t('f_looking_for','რას ეძებს'), c.looking_for) : ''}
            ${c.preferred_property_type ? _row(t('f_pref_type','სასურველი ტიპი'), c.preferred_property_type) : ''}
            ${c.preferred_location ? _row(t('f_pref_location','სასურველი ლოკაცია'), c.preferred_location) : ''}
            ${c.financing_method ? _row(t('f_financing','დაფინანსება'), c.financing_method) : ''}
            ${c.mortgage_status ? _row(t('f_mortgage','იპოთეკა'), c.mortgage_status) : ''}
            ${c.middle_name ? _row(t('f_middle_name','მამის სახელი'), c.middle_name) : ''}
            ${c.date_of_birth ? _row(t('f_dob_short','დაბ. თარიღი'), String(c.date_of_birth).slice(0,10)) : ''}
            ${c.gender ? _row(t('f_gender','სქესი'), c.gender) : ''}
            ${c.nationality ? _row(t('f_nationality','მოქალაქეობა'), c.nationality) : ''}
            ${c.personal_id ? _row(t('f_personal_id','პირადი №'), c.personal_id) : ''}
            ${c.phone2 ? _row(t('f_phone2','ტელეფონი 2'), c.phone2) : ''}
            ${c.whatsapp ? _row('WhatsApp', c.whatsapp) : ''}
            ${c.telegram ? _row('Telegram', c.telegram) : ''}
            ${c.preferred_contact ? _row(t('f_pref_contact','სასურველი კონტაქტი'), c.preferred_contact) : ''}
            ${[c.street, c.city, c.region, c.country, c.zip_code].filter(Boolean).length ? _row(t('f_address','მისამართი'), [c.street, c.city, c.region, c.country, c.zip_code].filter(Boolean).join(', ')) : ''}
            ${c.occupation ? _row(t('f_occupation','პროფესია'), c.occupation) : ''}
            ${c.company_name ? _row(t('f_company','კომპანია'), c.company_name) : ''}
            ${c.job_title ? _row(t('f_job_title','თანამდებობა'), c.job_title) : ''}
            ${c.annual_income ? _row(t('f_annual_income','წლ. შემოსავალი'), '$' + Number(c.annual_income).toLocaleString()) : ''}
            ${c.lead_source ? _row(t('th_source','წყარო'), c.lead_source) : ''}
            ${c.priority ? _row(t('f_priority','პრიორიტეტი'), c.priority) : ''}
            ${c.tags ? _row(t('f_tags','ტეგები'), c.tags) : ''}
            ${c.last_contact_date ? _row(t('f_last_contact','ბოლო კონტაქტი'), String(c.last_contact_date).slice(0,10)) : ''}
            ${_row(t('th_followup','შემდეგი კონტაქტი'), _followUpText(c.follow_up_date))}
            ${_row(t('fu_note','Follow-up შენიშვნა'), c.follow_up_note)}
            ${_row(t('f_owner_agent','მფლობელი (აგენტი)'), _ownerName(c.primary_agent_id))}
            ${_row(t('f_created','შეიქმნა'), _fmtDateTime(c.created_at))}
            ${_row(t('f_updated','განახლდა'), _fmtDateTime(c.updated_at))}
        </div>
        ${_row(t('f_notes','შენიშვნები'), c.notes)}
        <div style="display:flex;gap:8px;margin-top:16px;flex-wrap:wrap">
            <button class="btn btn-primary" style="flex:1;min-width:120px" onclick="editClient('${c.id}')"><i data-lucide="pencil" class="lucide-i"></i> ${t('action_edit','რედაქტირება')}</button>
            ${_canExport() ? `<button class="btn btn-secondary" onclick="downloadClientPDF('${c.id}')"><i data-lucide="file-text" class="lucide-i"></i> PDF</button>
            <button class="btn btn-secondary" style="color:#25D366" onclick="sendRecordPDFViaWhatsApp('client','${c.id}')"><i data-lucide="send" class="lucide-i"></i> WhatsApp</button>` : ''}
        </div>
    `);
}

// ════════════════════════════════════════════════════════════════════════
// PDF EXPORT — all fields  (reuses _loadPdfLibs from 22-pdf-export.js)
// ════════════════════════════════════════════════════════════════════════
const _PDF_CSS = `
  #wpdfRoot * { margin:0; padding:0; box-sizing:border-box; }
  #wpdfRoot { font-family:'Inter',Arial,sans-serif; color:var(--text); background:var(--surface); padding:32px; font-size:13px; width:760px; }
  #wpdfRoot .header { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:20px; padding-bottom:14px; border-bottom:3px solid #1D4ED8; }
  #wpdfRoot .brand { font-size:22px; font-weight:800; color: var(--brand); }
  #wpdfRoot .id-badge { background: var(--brand); color:#fff; padding:4px 12px; border-radius:20px; font-weight:700; font-size:12px; }
  #wpdfRoot h1 { font-size:20px; font-weight:700; margin:6px 0 12px; }
  #wpdfRoot .section-title { font-weight:700; font-size:14px; color: var(--brand); margin:16px 0 8px; border-bottom:1px solid #eee; padding-bottom:4px; }
  #wpdfRoot .info-grid { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
  #wpdfRoot .info-row { display:flex; gap:8px; padding:8px 12px; background:var(--surface-2); border-radius:6px; }
  #wpdfRoot .info-label { font-weight:600; color:var(--text); min-width:130px; flex-shrink:0; }
  #wpdfRoot .full { grid-column:1 / -1; }
  #wpdfRoot .footer { margin-top:24px; padding-top:12px; border-top:1px solid #eee; color:var(--text-muted); font-size:11px; display:flex; justify-content:space-between; }
`;
function _pdfRow(label, val, full) {
    const v = (val == null || val === '') ? '—' : String(val)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return `<div class="info-row${full ? ' full' : ''}"><span class="info-label">${label}:</span><span>${v}</span></div>`;
}

// Shared renderer: build hidden DOM → html2canvas → multi-page jsPDF.
// Returns a Blob when opts.returnBlob, otherwise triggers a download.
async function _renderPdf(bodyMarkup, filename, opts = {}) {
    if (typeof _loadPdfLibs !== 'function') throw new Error('PDF library loader unavailable');
    await _loadPdfLibs();
    const holder = document.createElement('div');
    holder.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;overflow:hidden;z-index:-1';
    const root = document.createElement('div');
    root.id = 'wpdfRoot';
    root.style.width = '760px';
    root.innerHTML = `<style>${_PDF_CSS}</style>${bodyMarkup}`;
    holder.appendChild(root);
    document.body.appendChild(holder);
    try { await document.fonts?.ready; } catch (e) {}
    await new Promise(r => setTimeout(r, 120));
    try {
        return await _renderRootPaginated(root, filename, opts);
    } finally {
        holder.remove();
    }
}

// Render an (already in-DOM, laid-out) root element to a multi-page A4 PDF.
// Page breaks are snapped to the gaps BETWEEN top-level blocks so a row, the
// owner box, or a heading is never sliced across two pages. Falls back to a
// forced cut only when a single block is taller than a whole page.
async function _renderRootPaginated(root, filename, opts = {}) {
    if (typeof _loadPdfLibs === 'function') await _loadPdfLibs();
    const canvas = await html2canvas(root, { scale: 2, useCORS: true, backgroundColor: '#ffffff', logging: false });
    if (!canvas || !canvas.width) throw new Error('Could not render PDF');

    // Map each top-level block's bottom edge into canvas-pixel space → safe cut points.
    const sx = canvas.width / root.offsetWidth;
    const breaks = [0];
    Array.from(root.children).forEach(el => {
        if (el.tagName === 'STYLE') return;
        breaks.push(Math.round((el.offsetTop + el.offsetHeight) * sx));
    });
    breaks.push(canvas.height);
    const safeBreaks = [...new Set(breaks)].filter(b => b >= 0 && b <= canvas.height).sort((a, b) => a - b);

    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const margin = 8;
    const imgW = pageW - margin * 2;
    const usableHmm = pageH - margin * 2;
    const pageHpx = Math.floor(usableHmm * canvas.width / imgW);

    let startY = 0, firstPage = true;
    while (startY < canvas.height) {
        const target = startY + pageHpx;
        let cut;
        if (target >= canvas.height) {
            cut = canvas.height;
        } else {
            cut = safeBreaks.filter(b => b > startY && b <= target).pop();
            if (!cut) cut = target;             // single oversized block → forced cut
        }
        const sliceH = cut - startY;
        const slice = document.createElement('canvas');
        slice.width = canvas.width;
        slice.height = sliceH;
        slice.getContext('2d').drawImage(canvas, 0, startY, canvas.width, sliceH, 0, 0, canvas.width, sliceH);
        const sliceHmm = sliceH * imgW / canvas.width;
        if (!firstPage) pdf.addPage();
        pdf.addImage(slice.toDataURL('image/jpeg', 0.95), 'JPEG', margin, margin, imgW, sliceHmm);
        firstPage = false;
        startY = cut;
    }

    const safe = filename.replace(/[^\w.-]+/g, '_');
    if (opts.returnBlob) return { blob: pdf.output('blob'), filename: safe + '.pdf' };
    pdf.save(safe + '.pdf');
    return null;
}

function _leadPdfMarkup(l, linked) {
    const company = (currentUser && currentUser.company) || 'AtlasCRM';
    return `
<div class="header"><div class="brand">AtlasCRM</div><div><span class="id-badge">${l.lead_number || l.id?.slice(0, 8)}</span></div></div>
<h1>${(l.full_name || 'ლიდი').replace(/</g, '&lt;')}</h1>
<div class="section-title">ლიდის ინფორმაცია</div>
<div class="info-grid">
  ${_pdfRow('Lead ID', l.lead_number)}
  ${_pdfRow('სტატუსი', l.status)}
  ${_pdfRow(t('f_owner_name','მფლობელი'), l.full_name)}
  ${_pdfRow('კომპანია', company)}
  ${_pdfRow('ტელეფონი', l.phone)}
  ${_pdfRow('ტელეფონი 2', l.phone2)}
  ${_pdfRow('ტელეფონი 3', l.phone3)}
  ${l.myhome_id ? _pdfRow('MyHome ID', l.myhome_id) : ''}
  ${l.ssge_id ? _pdfRow('SS.GE ID', l.ssge_id) : ''}
  ${_pdfRow('ემეილი', l.email)}
  ${_pdfRow('წყარო', l.source)}
  ${_pdfRow('სიმხურვალე', l.temperature)}
  ${_pdfRow('მფლობელი (აგენტი)', _ownerName(l.agent_id))}
  ${_pdfRow('მიმართულება', l.direction)}
  ${_pdfRow('დაკავშირდა', _fmtDateTime(l.contacted_at))}
  ${_pdfRow('შეიქმნა', _fmtDateTime(l.created_at))}
  ${_pdfRow('განახლდა', _fmtDateTime(l.updated_at))}
  ${_pdfRow('შეტყობინება', l.inquiry_message, true)}
  ${_pdfRow('შენიშვნები', l.notes, true)}
</div>
${linked && linked.length ? `<div class="section-title">დაკავშირებული ობიექტები</div><div class="info-grid">${
    linked.map(x => _pdfRow(x.listing_number || '—', `${_esc(x.title || '')} ($${Number(x.list_price || 0).toLocaleString()})`, true)).join('')}</div>` : ''}
<div class="footer"><span>${_esc(company)} — Real Estate CRM</span><span>${new Date().toLocaleDateString('ka-GE')}</span></div>`;
}

function _clientPdfMarkup(c) {
    const company = (currentUser && currentUser.company) || 'AtlasCRM';
    const budget = `$${Number(c.budget_min || 0).toLocaleString()} – $${Number(c.budget_max || 0).toLocaleString()}`;
    return `
<div class="header"><div class="brand">AtlasCRM</div><div><span class="id-badge">${c.client_number || c.id?.slice(0, 8)}</span></div></div>
<h1>${((c.first_name || '') + ' ' + (c.last_name || '')).trim().replace(/</g, '&lt;') || 'კლიენტი'}</h1>
<div class="section-title">კლიენტის ინფორმაცია</div>
<div class="info-grid">
  ${_pdfRow('Client ID', c.client_number)}
  ${_pdfRow('სტატუსი', c.status)}
  ${_pdfRow('სახელი', c.first_name)}
  ${_pdfRow('გვარი', c.last_name)}
  ${_pdfRow('კომპანია', company)}
  ${_pdfRow('ტელეფონი', c.phone)}
  ${_pdfRow('ემეილი', c.email)}
  ${_pdfRow('ტიპი', Array.isArray(c.client_type) ? c.client_type.join(', ') : c.client_type)}
  ${_pdfRow('ბიუჯეტი', budget)}
  ${_pdfRow('მფლობელი (აგენტი)', _ownerName(c.primary_agent_id))}
  ${_pdfRow('შეიქმნა', _fmtDateTime(c.created_at))}
  ${_pdfRow('განახლდა', _fmtDateTime(c.updated_at))}
  ${_pdfRow('შენიშვნები', c.notes, true)}
</div>
<div class="footer"><span>${_esc(company)} — Real Estate CRM</span><span>${new Date().toLocaleDateString('ka-GE')}</span></div>`;
}

async function downloadLeadPDF(id) {
    if (typeof hasPermission === 'function' && !hasPermission('pdf_export','can_create')) { if (typeof showToast==='function') showToast('ექსპორტი გათიშულია თქვენი როლისთვის', 'error'); return; }
    showToast('<i data-lucide="loader" class="lucide-i"></i> PDF მზადდება...');
    try {
        await _loadUserNames();
        const { data: l } = await client.from('leads').select('*').eq('id', id).single();
        if (!l) throw new Error('ლიდი ვერ მოიძებნა');
        let linked = [];
        try { const r = await client.from('listings').select('listing_number,title,list_price').eq('owner_lead_id', id); linked = r.data || []; } catch (e) {}
        await _renderPdf(_leadPdfMarkup(l, linked), 'warm_lead_' + (l.lead_number || id));
        showToast('<i data-lucide="check-circle-2" class="lucide-i"></i> PDF ჩამოიტვირთა');
    } catch (e) { showToast('PDF შეცდომა: ' + (e.message || e), 'error'); }
}

async function downloadClientPDF(id) {
    if (typeof hasPermission === 'function' && !hasPermission('pdf_export','can_create')) { if (typeof showToast==='function') showToast('ექსპორტი გათიშულია თქვენი როლისთვის', 'error'); return; }
    showToast('<i data-lucide="loader" class="lucide-i"></i> PDF მზადდება...');
    try {
        await _loadUserNames();
        const { data: c } = await client.from('clients').select('*').eq('id', id).single();
        if (!c) throw new Error('კლიენტი ვერ მოიძებნა');
        await _renderPdf(_clientPdfMarkup(c), 'warm_client_' + (c.client_number || id));
        showToast('<i data-lucide="check-circle-2" class="lucide-i"></i> PDF ჩამოიტვირთა');
    } catch (e) { showToast('PDF შეცდომა: ' + (e.message || e), 'error'); }
}

// ════════════════════════════════════════════════════════════════════════
// SEND PDF VIA WHATSAPP
// ────────────────────────────────────────────────────────────────────────
// WhatsApp has no public API to push a file from a web page into a chat.
// The two supported paths, best-first:
//   1) Web Share API (mobile / some desktops): navigator.share({ files:[pdf] })
//      opens the native share sheet and WhatsApp can receive the actual file.
//   2) Fallback: upload the PDF to our own server (/api/upload), then open
//      wa.me/<number>?text=<link> so the recipient taps a link to download it.
//      (A plain wa.me link cannot carry a binary attachment — platform limit.)
// ════════════════════════════════════════════════════════════════════════
async function sendRecordPDFViaWhatsApp(kind, id) {
    if (typeof hasPermission === 'function' && !hasPermission('pdf_export','can_create')) { if (typeof showToast==='function') showToast('ექსპორტი გათიშულია თქვენი როლისთვის', 'error'); return; }
    showToast('<i data-lucide="loader" class="lucide-i"></i> PDF მზადდება...');
    let rec, markup, fnameBase, phone;
    try {
        await _loadUserNames();
        if (kind === 'lead') {
            const { data: l } = await client.from('leads').select('*').eq('id', id).single();
            if (!l) throw new Error('ვერ მოიძებნა');
            let linked = [];
            try { const r = await client.from('listings').select('listing_number,title,list_price').eq('owner_lead_id', id); linked = r.data || []; } catch (e) {}
            rec = l; phone = l.phone; fnameBase = 'warm_lead_' + (l.lead_number || id); markup = _leadPdfMarkup(l, linked);
        } else {
            const { data: c } = await client.from('clients').select('*').eq('id', id).single();
            if (!c) throw new Error('ვერ მოიძებნა');
            rec = c; phone = c.phone; fnameBase = 'warm_client_' + (c.client_number || id); markup = _clientPdfMarkup(c);
        }
        const { blob, filename } = await _renderPdf(markup, fnameBase, { returnBlob: true });
        const file = new File([blob], filename, { type: 'application/pdf' });

        // 1) Native share with the real file (mobile → can attach to WhatsApp)
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
            try {
                await navigator.share({ files: [file], title: filename, text: 'AtlasCRM' });
                showToast('<i data-lucide="check-circle-2" class="lucide-i"></i> გაზიარდა');
                return;
            } catch (e) {
                if (e && e.name === 'AbortError') return; // user cancelled
                // otherwise fall through to link fallback
            }
        }

        // 2) Fallback: upload + send a download link via wa.me
        const fd = new FormData();
        fd.append('files', file, filename);
        const res = await fetch('/api/upload', { method: 'POST', body: fd, credentials: 'include' });
        const body = await res.json();
        if (!res.ok || !body.data || !body.data[0]) throw new Error(body.error || 'ატვირთვა ვერ მოხერხდა');
        const link = location.origin + body.data[0].url;
        const clean = (phone || '').replace(/[^0-9]/g, '');
        const text = encodeURIComponent('AtlasCRM — დოკუმენტი: ' + link);
        window.open(`https://wa.me/${clean}?text=${text}`, '_blank', 'width=1000,height=700');
        showToast('<i data-lucide="check-circle-2" class="lucide-i"></i> WhatsApp გაიხსნა (ბმული გაგზავნე)');
    } catch (e) {
        showToast('WhatsApp შეცდომა: ' + (e.message || e), 'error');
    }
}

// Send a LISTING PDF via WhatsApp. Builds the property PDF, then:
//   • mobile / file-share capable → native share sheet with the real PDF
//     attached (user picks the WhatsApp chat).
//   • otherwise → upload the PDF and open wa.me WITHOUT a number, so WhatsApp
//     shows the contact picker and the chosen chat receives a download link.
//     (wa.me links can't carry a binary attachment — platform limitation.)
async function sendListingPDFViaWhatsApp(id) {
    if (typeof hasPermission === 'function' && !hasPermission('pdf_export','can_create')) { if (typeof showToast==='function') showToast('ექსპორტი გათიშულია თქვენი როლისთვის', 'error'); return; }
    if (typeof downloadListingPDF !== 'function') { showToast('PDF გენერატორი ვერ მოიძებნა', 'error'); return; }
    showToast('<i data-lucide="loader" class="lucide-i"></i> PDF მზადდება...');
    try {
        const result = await downloadListingPDF(id, { returnBlob: true });
        if (!result || !result.blob) throw new Error('PDF ვერ შეიქმნა');
        const file = new File([result.blob], result.filename, { type: 'application/pdf' });

        // 1) Native share with the real file → user chooses the WhatsApp chat.
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
            try {
                await navigator.share({ files: [file], title: result.filename, text: 'AtlasCRM' });
                return;
            } catch (e) {
                if (e && e.name === 'AbortError') return;   // user cancelled
            }
        }

        // 2) Fallback: upload + open WhatsApp contact chooser with a link.
        const fd = new FormData();
        fd.append('files', file, result.filename);
        const res = await fetch('/api/upload', { method: 'POST', body: fd, credentials: 'include' });
        const body = await res.json();
        if (!res.ok || !body.data || !body.data[0]) throw new Error(body.error || 'ატვირთვა ვერ მოხერხდა');
        const link = location.origin + body.data[0].url;
        const text = encodeURIComponent('AtlasCRM — ობიექტი: ' + link);
        window.open('https://wa.me/?text=' + text, '_blank', 'width=1000,height=700');
        showToast('<i data-lucide="check-circle-2" class="lucide-i"></i> WhatsApp გაიხსნა — აირჩიე ვის გაუგზავნი');
    } catch (e) {
        showToast('WhatsApp შეცდომა: ' + (e.message || e), 'error');
    }
}
// exportData() already builds + downloads the workbook; this just guards the
// library and adds a timestamp to the filename via a thin wrapper.
// ════════════════════════════════════════════════════════════════════════
async function downloadExcel(table) {
    if (typeof XLSX === 'undefined') {
        showToast('Excel ბიბლიოთეკა იტვირთება...', 'error');
        return;
    }
    if (typeof exportData === 'function') return exportData(table);
}

// ════════════════════════════════════════════════════════════════════════
// EXTENSION PAGE — fill the CRM URL and copy buttons
// ════════════════════════════════════════════════════════════════════════
function fillExtensionPage() {
    const u = document.getElementById('ext-crm-url');
    if (u) u.value = location.origin;
    const k = document.getElementById('ext-crm-key');
    if (k) k.value = currentUser?.extension_key || '';
}
function copyExtField(id, btn) {
    const el = document.getElementById(id);
    if (!el) return;
    try { el.select(); } catch (e) {}
    navigator.clipboard?.writeText(el.value || '').then(() => {
        if (btn) { const prev = btn.textContent; btn.textContent = '✓'; setTimeout(() => (btn.textContent = prev), 900); }
    }).catch(() => {});
}
async function regenerateExtKey(btn) {
    if (!confirm('ძველი გასაღები დაუყოვნებლივ გაუქმდება — ნებისმიერი მოწყობილობა, სადაც ძველი გასაღებია შეყვანილი, გაფართოებით ობიექტების დამატებას ვეღარ შეძლებს, სანამ ახალს არ ჩასვამ. გავაგრძელოთ?')) return;
    if (btn) btn.disabled = true;
    try {
        const r = await fetch('/api/auth/regenerate-extension-key', {
            method: 'POST', headers: {'Content-Type':'application/json'},
            credentials: 'include'
        });
        const body = await r.json().catch(() => ({}));
        if (!r.ok) { showToast(body.error || 'გასაღების განახლება ვერ მოხერხდა', 'error'); return; }
        currentUser.extension_key = body.data.extension_key;
        const k = document.getElementById('ext-crm-key');
        if (k) k.value = currentUser.extension_key;
        showToast('ახალი გასაღები დაგენერირდა', 'success');
    } catch (e) {
        showToast('გასაღების განახლება ვერ მოხერხდა', 'error');
    } finally {
        if (btn) btn.disabled = false;
    }
}
