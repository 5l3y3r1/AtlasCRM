// ═══════════════════════════════════════════════════════════════════════
// PERMISSIONS PAGE
// ═══════════════════════════════════════════════════════════════════════


// Called once after login to load and enforce permissions
async function initPermissions() {
    if (currentUser.role === 'FOUNDER') { _permsLoaded = true; return; } // founder sees all
    try {
        const { data } = await client.from('role_permissions').select('*').eq('company_id', currentUser.company_id);
        _permsState = {};
        // Seed defaults first
        for (const res of PERM_RESOURCES) {
            const key = currentUser.role + ':' + res.key;
            const ov  = DEFAULT_OVERRIDES[currentUser.role]?.[res.key];
            _permsState[key] = ov ? {...DEFAULT_PERMS[currentUser.role], ...ov} : {...(DEFAULT_PERMS[currentUser.role] || {can_view:1,can_create:0,can_edit:0,can_delete:0})};
        }
        // Override with saved
        for (const p of (data || [])) {
            if (p.role === currentUser.role)
                _permsState[p.role + ':' + p.resource] = {can_view:_permBit(p.can_view), can_create:_permBit(p.can_create), can_edit:_permBit(p.can_edit), can_delete:_permBit(p.can_delete)};
        }
        _permsLoaded = true;
        applyPermissionsToNav();
    } catch(e) { _permsLoaded = true; }
}

// Normalise a permission flag coming from defaults (JS numbers) OR the database
// (PostgREST returns boolean columns as true/false, sometimes 't'/'f' or '1'/'0').
// Returns 1 when granted, 0 otherwise. This is the single source of truth so the
// owner's matrix (truthy display) and the enforced gate agree on every value type.
function _permBit(v) {
    return (v === 1 || v === true || v === '1' || v === 't' || v === 'true') ? 1 : 0;
}

function hasPermission(resource, action = 'can_view') {
    if (currentUser.role === 'FOUNDER') return true;
    const key = currentUser.role + ':' + resource;
    const p   = _permsState[key];
    if (!p) return DEFAULT_PERMS[currentUser.role]?.[action] !== 0;
    return _permBit(p[action]) === 1;
}

// Hide nav items and redirect away from pages the user can't see
function applyPermissionsToNav() {
    if (currentUser.role === 'FOUNDER') return;

    const resourceForPage = {
        dashboard: 'dashboard', analytics: 'analytics', map: 'map',
        leads: 'leads', 'universal-import': 'excel_import', clients: 'clients', deals: 'deals', listings: 'listings',
        tasks: 'tasks', showings: 'showings',
        marketing: 'marketing', agents: 'agents',
        ai: 'ai', permissions: 'permissions',
    };

    document.querySelectorAll('.nav-item[data-page]').forEach(btn => {
        const page = btn.dataset.page;
        if (page === 'lawyer') {
            // Two resources feed one nav item — visible if either is viewable.
            btn.style.display = (hasPermission('documents', 'can_view') || hasPermission('contracts', 'can_view')) ? '' : 'none';
            return;
        }
        const res  = resourceForPage[page];
        if (!res) return; // profile always visible
        if (!hasPermission(res, 'can_view')) {
            btn.style.display = 'none';
        } else {
            btn.style.display = '';
        }
    });

    // Gate "+ New" / create buttons by can_create on each page
    document.querySelectorAll('[data-create-res]').forEach(btn => {
        const res = btn.dataset.createRes;
        btn.style.display = hasPermission(res, 'can_create') ? '' : 'none';
    });

    // Show/hide nav section containers based on whether any child nav-item is visible
    document.querySelectorAll('.nav-section').forEach(section => {
        const items = section.querySelectorAll('.nav-item[data-page]');
        if (!items.length) return;
        const anyVisible = Array.from(items).some(it => it.style.display !== 'none');
        section.style.display = anyVisible ? '' : 'none';
    });

    // Team menu: founders/managers always; others only with permissions view access
    const navTeam = document.getElementById('nav-team');
    if (navTeam) {
        const showTeam = ['FOUNDER','MANAGER'].includes(currentUser.role) || hasPermission('permissions', 'can_view');
        navTeam.style.display = showTeam ? '' : 'none';
    }
}

async function loadPermissions() {
    if (currentUser.role !== 'FOUNDER') {
        const p = document.getElementById('page-permissions');
        if (p) p.innerHTML = `<div class="empty" style="padding-top:80px"><div class="empty-icon"><i data-lucide="shield-off" class="lucide-i"></i></div><div class="empty-title">წვდომა შეზღუდულია</div><div class="empty-sub">მხოლოდ დამფუძნებელს შეუძლია ნებართვების მართვა</div></div>`;
        if(window.lucide)try{window.lucide.createIcons();}catch(e){}
        return;
    }
    const {data:saved} = await client.from('role_permissions').select('*').eq('company_id',currentUser.company_id);
    // Build state for ALL roles (for the matrix)
    _permsState = {};
    for (const role of PERM_ROLES) for (const res of PERM_RESOURCES) {
        const key = role+':'+res.key;
        const ov  = DEFAULT_OVERRIDES[role]?.[res.key];
        _permsState[key] = ov ? {...DEFAULT_PERMS[role],...ov} : {...DEFAULT_PERMS[role]};
    }
    for (const p of (saved||[])) _permsState[p.role+':'+p.resource] = {can_view:_permBit(p.can_view),can_create:_permBit(p.can_create),can_edit:_permBit(p.can_edit),can_delete:_permBit(p.can_delete)};
    renderRoleCards(); renderPermTable(); await renderTeamList();
    if(window.lucide)try{window.lucide.createIcons();}catch(e){}
}

function renderRoleCards() {
    const el = document.getElementById('perm-role-cards'); if (!el) return;
    el.innerHTML = PERM_ROLES.map(role => {
        const c = ROLE_COLORS[role], icon = ROLE_ICONS[role], label = ROLE_LABELS[role];
        const allowed = PERM_RESOURCES.filter(r => _permsState[role+':'+r.key]?.can_view).length;
        const full    = PERM_RESOURCES.filter(r => { const p=_permsState[role+':'+r.key]; return p?.can_view&&p?.can_create&&p?.can_edit&&p?.can_delete; }).length;
        return `<div class="card" style="padding:16px;border-top:3px solid ${c}">
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
                <div style="width:34px;height:34px;background:${c}22;border-radius:8px;display:flex;align-items:center;justify-content:center"><i data-lucide="${icon}" class="lucide-i" style="color:${c};width:16px;height:16px"></i></div>
                <div><div style="font-weight:700;font-size:13px">${label}</div><div style="font-size:11px;color:var(--text-muted)">${allowed}/${PERM_RESOURCES.length} რესურსი</div></div>
            </div>
            <div style="height:5px;background:var(--border);border-radius:3px"><div style="height:100%;width:${Math.round(full/PERM_RESOURCES.length*100)}%;background:${c};border-radius:3px"></div></div>
            <div style="font-size:11px;color:var(--text-muted);margin-top:5px">${full} სრული · ${allowed-full} ნაწილობრივი</div>
        </div>`;
    }).join('');
}

function renderPermTable() {
    const head = document.getElementById('perm-table-head');
    const body = document.getElementById('perm-table-body');
    if (!head || !body) return;
    const actions = ['can_view','can_create','can_edit','can_delete'];
    const aLabels = {can_view:'👁',can_create:'➕',can_edit:'✏️',can_delete:'🗑'};
    head.innerHTML = `<tr><th style="min-width:120px">რესურსი</th>${PERM_ROLES.map(r=>`<th colspan="4" style="text-align:center;border-left:2px solid var(--border);color:${ROLE_COLORS[r]}">${ROLE_LABELS[r]}</th>`).join('')}</tr>
    <tr style="font-size:11px"><th></th>${PERM_ROLES.map(()=>actions.map(a=>`<th style="text-align:center;padding:3px 5px;font-size:10px;color:var(--text-muted)">${aLabels[a]}</th>`).join('')).join('')}</tr>`;
    body.innerHTML = PERM_RESOURCES.map(res =>
        `<tr><td style="font-weight:600;font-size:13px">${res.label}</td>${PERM_ROLES.map((role,ri) => {
            const p = _permsState[role+':'+res.key]||{};
            const isFo = role==='FOUNDER';
            return actions.map((a,ai) => {
                const bl = ai===0?'border-left:2px solid var(--border);':'';
                return `<td style="text-align:center;${bl}padding:5px">
                    <input type="checkbox" ${p[a]?'checked':''} ${isFo?'disabled':''} style="width:15px;height:15px;cursor:${isFo?'not-allowed':'pointer'};accent-color:${ROLE_COLORS[role]}"
                    onchange="togglePerm('${role}','${res.key}','${a}',this.checked)"></td>`;
            }).join('');
        }).join('')}</tr>`
    ).join('');
}

function togglePerm(role,resource,action,value) {
    const key = role+':'+resource;
    if(!_permsState[key]) _permsState[key]={can_view:0,can_create:0,can_edit:0,can_delete:0};
    _permsState[key][action] = value?1:0;
    if(action==='can_view'&&!value) { _permsState[key].can_create=0; _permsState[key].can_edit=0; _permsState[key].can_delete=0; renderPermTable(); }
    if(action!=='can_view'&&value)  { _permsState[key].can_view=1; }
    renderRoleCards();
}

async function savePermissions() {
    const rows = Object.entries(_permsState).map(([key,p]) => {
        const [role,resource] = key.split(':');
        return {
            company_id: currentUser.company_id,
            role,
            resource,
            can_view:   p.can_view   ? 1 : 0,
            can_create: p.can_create ? 1 : 0,
            can_edit:   p.can_edit   ? 1 : 0,
            can_delete: p.can_delete ? 1 : 0
        };
    });
    try {
        // 1) Delete ALL existing rows for this company and WAIT for it to finish
        const delRes = await client.from('role_permissions').delete().eq('company_id', currentUser.company_id);
        if (delRes && delRes.error) throw new Error('delete: ' + delRes.error.message);

        // 2) Insert fresh rows in batches, checking each batch for errors
        for (let i = 0; i < rows.length; i += 20) {
            const batch = rows.slice(i, i + 20).map(r => ({ id: Math.random().toString(36).slice(2), ...r }));
            const insRes = await client.from('role_permissions').insert(batch);
            if (insRes && insRes.error) throw new Error('insert: ' + insRes.error.message);
        }
        showToast('<i data-lucide="check-circle-2" class="lucide-i"></i> ნებართვები შენახულია!');
        renderRoleCards();
        applyPermissionsToNav();
    } catch (e) {
        console.error('savePermissions failed:', e);
        showToast('შენახვა ვერ მოხერხდა: ' + e.message, 'error');
    }
}

function resetPermissions() {
    showConfirm('ნაგულისხმევი','ნებართვები ნაგულისხმევ მნიშვნელობებზე დაბრუნდება?', async()=>{
        await client.from('role_permissions').delete().eq('company_id',currentUser.company_id);
        await loadPermissions();
        showToast('ნებართვები გადაყენდა');
    });
}

async function renderTeamList() {
    const container = document.getElementById('perm-team-list'); if(!container) return;
    const {data:users} = await client.from('users').select('id,first_name,last_name,email,role,is_active,phone').eq('company_id',currentUser.company_id).order('role');
    if(!users?.length){container.innerHTML='<div class="empty">გუნდი ცარიელია</div>';return;}
    container.innerHTML = `<table class="data-table"><thead><tr><th>სახელი</th><th>ემეილი</th><th>ტელეფონი</th><th>როლი</th><th>სტატუსი</th><th></th></tr></thead>
    <tbody>${users.map(u=>{
        const c = ROLE_COLORS[u.role]||'#888';
        const isOwn = u.id===currentUser.id;
        const can = currentUser.role==='FOUNDER'&&!isOwn;
        return `<tr>
            <td><strong>${escHtml(u.first_name)} ${escHtml(u.last_name||'')}</strong></td>
            <td style="font-size:12px;color:var(--text-muted)">${escHtml(u.email)}</td>
            <td style="font-size:12px;color:var(--text-muted)">${escHtml(u.phone||'—')}</td>
            <td>${can
                ?`<select class="form-select" style="height:28px;font-size:12px;padding:0 8px;border-color:${c};color:${c}" onchange="changeUserRole('${u.id}',this.value)">${PERM_ROLES.map(r=>`<option value="${r}" ${u.role===r?'selected':''}>${ROLE_LABELS[r]}</option>`).join('')}</select>`
                :`<span class="badge" style="background:${c}22;color:${c};border-color:${c}44">${ROLE_LABELS[u.role]||u.role}</span>`
            }</td>
            <td><span class="badge ${u.is_active?'badge-active':''}">${u.is_active?'აქტიური':'არააქტიური'}</span></td>
            <td>${can?`<div class="action-buttons"><button class="action-btn" onclick="toggleUserActive('${u.id}',${u.is_active})" style="color:${u.is_active?'#ef4444':'#22c55e'}" title="${u.is_active?'გათიშვა':'გააქტიურება'}"><i data-lucide="${u.is_active?'user-x':'user-check'}" class="lucide-i"></i></button></div>`:''}</td>
        </tr>`;
    }).join('')}</tbody></table>`;
    if(window.lucide)try{window.lucide.createIcons();}catch(e){}
}

async function changeUserRole(userId,newRole) {
    const {error} = await client.from('users').update({role:newRole}).eq('id',userId);
    if(error){showToast('შეცდომა: '+error.message,'error');return;}
    showToast('როლი შეიცვალა'); await renderTeamList(); renderRoleCards();
}
async function toggleUserActive(userId,cur) {
    const {error} = await client.from('users').update({is_active:cur?0:1}).eq('id',userId);
    if(error){showToast('შეცდომა: '+error.message,'error');return;}
    showToast(cur?'მომხმარებელი გათიშულია':'მომხმარებელი გააქტიურდა'); await renderTeamList();
}

/* ─── Auto-redirect to /login when there's no session ───────────────── */
(async function ensureSession() {
    // Login page itself shouldn't redirect
    if (location.pathname === '/login' || location.pathname === '/' ||
        location.pathname.endsWith('warm_login.html')) return;
    try {
        const r = await fetch('/api/auth/session', { credentials: 'include' });
        const j = await r.json();
        if (!j.data || !j.data.session) {
            location.href = '/login';
        }
    } catch (e) { location.href = '/login'; }
})();

