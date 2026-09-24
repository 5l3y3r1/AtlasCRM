// ═══════════════════════════════════════════════════════
// <i data-lucide="user" class="lucide-i"></i> PROFILE PAGE
// ═══════════════════════════════════════════════════════
async function loadProfile() {
    const u = currentUser;
    const fullName = u.first_name + ' ' + (u.last_name || '');
    const initials = (u.first_name[0] || '') + (u.last_name?.[0] || '');

    renderUserAvatar();
    const av = document.getElementById('profile-avatar');
    if (av) {
        av.style.position = 'relative';
        av.style.cursor = 'pointer';
        av.title = 'ფოტოს შეცვლა';
        av.onclick = () => document.getElementById('avatar-file-input')?.click();
        if (!document.getElementById('avatar-file-input')) {
            const inp = document.createElement('input');
            inp.type = 'file'; inp.id = 'avatar-file-input';
            inp.accept = 'image/jpeg,image/jpg,image/png,image/webp';
            inp.style.display = 'none';
            inp.onchange = () => uploadAvatar(inp);
            document.body.appendChild(inp);
        }
        // small edit badge + delete option
        let ctrl = document.getElementById('avatar-controls');
        if (!ctrl) {
            ctrl = document.createElement('div');
            ctrl.id = 'avatar-controls';
            ctrl.style.cssText = 'margin-top:8px;display:flex;gap:8px;justify-content:center';
            ctrl.innerHTML = `<button class="btn btn-secondary" style="font-size:12px;padding:5px 10px" onclick="document.getElementById('avatar-file-input').click()"><i data-lucide="upload" class="lucide-i"></i> ფოტო</button>` +
                (u.avatar_url ? `<button class="btn btn-secondary" style="font-size:12px;padding:5px 10px;color:#dc2626" onclick="deleteAvatar()"><i data-lucide="trash-2" class="lucide-i"></i> წაშლა</button>` : '');
            av.parentNode.insertBefore(ctrl, av.nextSibling);
        }
    }
    document.getElementById('profile-name').textContent = fullName.trim();
    document.getElementById('profile-role').textContent = roleNames[u.role] || u.role;
    document.getElementById('profile-email').textContent = u.email;
    document.getElementById('profile-phone').textContent = u.phone || '—';
    document.getElementById('profile-company').textContent = u.companies?.name || '—';
    document.getElementById('profile-created').textContent = formatDate(u.created_at);
    
    // Stats
    const [listingsRes, dealsRes, closedDealsRes, commissionRes] = await Promise.all([
        client.from('listings').select('*', { count: 'exact', head: true }).eq('agent_id', u.id),
        client.from('deals').select('*', { count: 'exact', head: true }).or(`buyer_agent_id.eq.${u.id},seller_agent_id.eq.${u.id}`),
        client.from('deals').select('*', { count: 'exact', head: true }).or(`buyer_agent_id.eq.${u.id},seller_agent_id.eq.${u.id}`).eq('current_stage', 'CLOSED_WON'),
        client.from('commission_records').select('user_amount').eq('user_id', u.id)
    ]);
    
    const totalCommission = (commissionRes.data || []).reduce((s, c) => s + Number(c.user_amount || 0), 0);
    
    document.getElementById('profile-listings').textContent = listingsRes.count || 0;
    document.getElementById('profile-deals').textContent = dealsRes.count || 0;
    document.getElementById('profile-closed').textContent = closedDealsRes.count || 0;
    document.getElementById('profile-commission').textContent = '$' + totalCommission.toLocaleString();
    
    // Recent activities
    const { data: tasks } = await client
        .from('tasks')
        .select('title, status, created_at, task_type')
        .eq('assigned_to', u.id)
        .order('created_at', { ascending: false })
        .limit(10);
    
    const activitiesEl = document.getElementById('profile-activities');
    
    if (!tasks || tasks.length === 0) {
        activitiesEl.innerHTML = '<div class="empty"><div class="empty-icon"><i data-lucide="clipboard-list" class="lucide-i"></i></div><div class="empty-title">აქტივობები ჯერ არ არის</div></div>';
        return;
    }
    
    // Uses the task module's single source of truth (TASK_STATUS / TASK_TYPES)
    // rather than its own copy. The previous version called
    // getTaskTypeName(...).split(' ')[0] to pull out an "emoji" — but the label
    // starts with an <i> icon tag, so it rendered the literal text "<i".
    // `task`, not `t`: `t` is the global i18n lookup.
    activitiesEl.innerHTML = `
        <div style="display:grid;gap:10px">
            ${tasks.map(task => {
                const st = typeof normStatus === 'function' ? normStatus(task.status) : task.status;
                const sdef = (typeof TASK_STATUS !== 'undefined' && TASK_STATUS[st]) || null;
                const tdef = (typeof TASK_TYPES !== 'undefined' && TASK_TYPES[task.task_type]) || null;
                const closed = sdef ? !sdef.open : false;
                const safe = (v) => String(v == null ? '' : v)
                    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                return `
                <div style="display:flex;align-items:center;gap:12px;padding:12px;background:var(--surface-2);border-radius:10px">
                    <div style="font-size:18px;color:var(--brand)"><i data-lucide="${tdef ? tdef.icon : 'pin'}" class="lucide-i"></i></div>
                    <div style="flex:1;min-width:0">
                        <div style="font-weight:600;${closed ? 'text-decoration:line-through;color:var(--text-muted)' : ''}">${safe(task.title)}</div>
                        <div style="font-size:12px;color:var(--text-muted)">${safe(formatDate(task.created_at))}</div>
                    </div>
                    <span class="badge ${sdef ? sdef.cls : 'badge-new'}">${sdef ? sdef.label : safe(st)}</span>
                </div>`;
            }).join('')}
        </div>
    `;
    if (window.lucide) try { window.lucide.createIcons(); } catch(e) {}
}


// ── Profile picture (#9) ──
function renderUserAvatar() {
    const u = currentUser || {};
    const initials = (((u.first_name || '')[0] || '') + ((u.last_name || '')[0] || '')).toUpperCase() || '?';
    const url = u.avatar_url || '';
    for (const id of ['user-avatar', 'profile-avatar']) {
        const el = document.getElementById(id);
        if (!el) continue;
        if (url) {
            el.innerHTML = `<img src="${url}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
            el.style.overflow = 'hidden';
        } else if (!el.querySelector('img') || url === '') {
            el.innerHTML = '';
            el.textContent = initials;
        }
    }
}

async function uploadAvatar(input) {
    const file = input.files && input.files[0];
    if (!file) return;
    const okTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (!okTypes.includes(file.type)) { showToast('მხოლოდ JPG, PNG ან WEBP', 'error'); input.value = ''; return; }
    if (file.size > 5 * 1024 * 1024) { showToast('ფაილი ძალიან დიდია (მაქს. 5MB)', 'error'); input.value = ''; return; }
    try {
        showToast('იტვირთება...', 'info');
        const fd = new FormData(); fd.append('files', file);
        const r = await fetch('/api/upload', { method: 'POST', body: fd, credentials: 'include' });
        const j = await r.json();
        if (!r.ok || !j.data || !j.data[0]) throw new Error(j.error || 'ატვირთვა ვერ მოხერხდა');
        // Store the server-relative path. Prefixing location.origin bakes the
        // hostname into the row, so every avatar breaks on a domain change.
        const url = j.data[0].url || '';
        const { error } = await client.from('users').update({ avatar_url: url }).eq('id', currentUser.id);
        if (error) throw error;
        currentUser.avatar_url = url;
        renderUserAvatar();
        if (typeof loadProfile === 'function') loadProfile();
        showToast('ფოტო განახლდა', 'success');
    } catch (e) { showToast('შეცდომა: ' + (e.message || e), 'error'); }
    finally { input.value = ''; }
}

async function deleteAvatar() {
    if (!confirm('წავშალო პროფილის ფოტო?')) return;
    try {
        const { error } = await client.from('users').update({ avatar_url: null }).eq('id', currentUser.id);
        if (error) throw error;
        currentUser.avatar_url = null;
        const av = document.getElementById('profile-avatar'); if (av) av.innerHTML = '';
        renderUserAvatar();
        if (typeof loadProfile === 'function') loadProfile();
        showToast('ფოტო წაიშალა', 'success');
    } catch (e) { showToast('შეცდომა: ' + (e.message || e), 'error'); }
}
