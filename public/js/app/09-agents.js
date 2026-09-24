// ═══════════════════════════════════════════════════════
// <i data-lucide="briefcase-business" class="lucide-i"></i> AGENTS
// ═══════════════════════════════════════════════════════
async function loadAgents() {
    const { data } = await client
        .from('users')
        .select('*')
        .eq('company_id', currentUser.company_id)
        .order('created_at', { ascending: false });
    
    const container = document.getElementById('agents-list');
    
    if (!data || data.length === 0) {
        container.innerHTML = `
            <div class="empty">
                <div class="empty-icon"><i data-lucide="briefcase-business" class="lucide-i"></i></div>
                <div class="empty-title">გუნდი ცარიელია</div>
            </div>
        `;
        return;
    }
    
    container.innerHTML = `
        <table>
            <thead>
                <tr><th>${t("th_name")}</th><th>${t("th_email")}</th><th>${t("th_phone")}</th><th>${t("f_role")}</th><th>ონლაინ</th><th>${t("th_status")}</th><th></th></tr>
            </thead>
            <tbody>
                ${data.map(u => `
                    <tr>
                        <td><strong>${_escAgent(u.first_name)} ${_escAgent(u.last_name || '')}</strong></td>
                        <td>${_escAgent(u.email)}</td>
                        <td>${_escAgent(u.phone || '—')}</td>
                        <td>${roleNames[u.role] || u.role}</td>
                        <td>${_agentPresence(u)}</td>
                        <td><span class="badge ${u.is_active ? 'badge-active' : ''}">${u.is_active ? 'აქტიური' : 'გათიშული'}</span></td>
                        <td>
                            <div class="action-buttons">
                                <button class="action-btn edit" onclick="editAgent('${u.id}')" title="რედაქტირება"><i data-lucide="pencil" class="lucide-i"></i></button>
                                ${(u.id !== currentUser.id && ['MANAGER','OWNER','FOUNDER','ADMIN'].includes(currentUser.role)) ? `<button class="action-btn delete" onclick="confirmDeleteUser('${u.id}', '${_escAgent((u.first_name + ' ' + (u.last_name || '')).replace(/'/g, ''))}')" title="წაშლა"><i data-lucide="trash-2" class="lucide-i"></i></button>` : ''}
                            </div>
                        </td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
}


// ── Agent presence (#2) ──
function _agentPresence(u) {
    const last = u.last_seen_at ? Date.parse(u.last_seen_at) : 0;
    const online = last && (Date.now() - last < 5 * 60 * 1000);
    const label = online ? t('status_online', 'ონლაინ') : t('status_offline', 'ოფლაინ');
    return `<span style="display:inline-flex;align-items:center;gap:6px;font-size:13px;color:${online ? '#16a34a' : 'var(--text-muted)'}">
        <span style="width:8px;height:8px;border-radius:50%;background:${online ? '#16a34a' : '#cbd5e1'};display:inline-block"></span>
        ${label}</span>`;
}

// Heartbeat: keep myself "online" and refresh the agent list if it's open — no page reload.
if (!window._presenceInterval) {
    window._presenceInterval = setInterval(() => {
        if (!window.currentUser) return;
        fetch('/api/data/users?id=eq.' + currentUser.id + '&select=id', { credentials: 'include' }).catch(() => {});
        if (window.currentPage === 'agents' && typeof loadAgents === 'function') loadAgents();
    }, 60000);
}

// ── Safe user deletion (#4) ──
function _escAgent(v) { return escHtml(v); }   // delegates to the canonical escaper

async function confirmDeleteUser(id, name) {
    const { data: users } = await client.from('users').select('id, first_name, last_name').eq('company_id', currentUser.company_id).eq('is_active', true);
    const others = (users || []).filter(u => u.id !== id);
    const reassignOpts = '<option value="">— არ გადავანაწილო (დარჩება უმფლობელოდ) —</option>' +
        others.map(u => `<option value="${u.id}">${_escAgent(u.first_name + ' ' + (u.last_name || ''))}</option>`).join('');
    openModal('<i data-lucide="trash-2" class="lucide-i"></i> მომხმარებლის წაშლა', `
        <div style="margin-bottom:14px">გსურს <strong>${_escAgent(name)}</strong>-ის წაშლა?</div>
        <div class="form-group">
            <label style="display:flex;gap:8px;align-items:flex-start;margin-bottom:10px;cursor:pointer">
                <input type="radio" name="del-mode" value="soft" checked onchange="document.getElementById('del-reassign-wrap').style.display='none'" style="margin-top:3px">
                <span><strong>დეაქტივაცია</strong> <span style="font-size:11px;color:var(--brand)">(რეკომენდებული)</span><br><span style="font-size:12px;color:var(--text-muted)">ანგარიში გაითიშება, ყველა მონაცემი შენარჩუნდება</span></span>
            </label>
            <label style="display:flex;gap:8px;align-items:flex-start;cursor:pointer">
                <input type="radio" name="del-mode" value="hard" onchange="document.getElementById('del-reassign-wrap').style.display='block'" style="margin-top:3px">
                <span><strong style="color:#dc2626">სამუდამო წაშლა</strong><br><span style="font-size:12px;color:var(--text-muted)">ანგარიში წაიშლება; მისი კლიენტები/ობიექტები გადანაწილდება</span></span>
            </label>
        </div>
        <div class="form-group" id="del-reassign-wrap" style="display:none">
            <label class="form-label">კლიენტების / ობიექტების / გარიგებების გადანაწილება</label>
            <select class="form-select" id="del-reassign">${reassignOpts}</select>
        </div>
        <div style="display:flex;gap:8px;margin-top:6px">
            <button class="btn btn-secondary" style="flex:1" onclick="closeModal()">გაუქმება</button>
            <button class="btn" style="flex:1;background:#dc2626;color:#fff" onclick="doDeleteUser('${id}')"><i data-lucide="trash-2" class="lucide-i"></i> დადასტურება</button>
        </div>
    `);
    if (window.lucide) try { window.lucide.createIcons(); } catch(e){}
}

async function doDeleteUser(id) {
    const mode = (document.querySelector('input[name="del-mode"]:checked') || {}).value || 'soft';
    const reassignTo = (document.getElementById('del-reassign') || {}).value || '';
    try {
        const r = await fetch('/api/team/delete-user', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
            body: JSON.stringify({ userId: id, mode, reassignTo })
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || 'შეცდომა');
        closeModal();
        showToast(mode === 'hard' ? 'მომხმარებელი წაიშალა' : 'მომხმარებელი გაითიშა', 'success');
        if (typeof loadAgents === 'function') loadAgents();
    } catch (e) { showToast('შეცდომა: ' + (e.message || e), 'error'); }
}
