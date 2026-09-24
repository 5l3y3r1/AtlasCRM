// ═══════════════════════════════════════════════════════
// TEAMS
//
// A team groups agents under one manager. Membership lives on users.team_id
// (a user is in at most one team), and the manager is teams.manager_id — so
// "who manages me" and "who do I manage" are both one query, no join table.
//
// Creating and editing teams is manager-only; the server enforces that, this
// only hides the controls.
// ═══════════════════════════════════════════════════════

let _teams = [];
let _teamMembers = [];          // every active user in the company
let _editingTeamId = null;

const TEAM_COLORS = ['#1D4ED8', '#0891B2', '#059669', '#7C3AED', '#DB2777', '#EA580C', '#CA8A04', '#475569'];
const MGR_ROLES_UI = ['FOUNDER', 'MANAGER', 'OWNER', 'ADMIN'];

function _canManageTeams() {
    return !!(currentUser && MGR_ROLES_UI.includes(currentUser.role));
}
function _teamEsc(v) { return escHtml(v); }   // delegates to the canonical escaper
function _personName(u) {
    return ((u.first_name || '') + ' ' + (u.last_name || '')).trim() || u.email || '—';
}

/* ─── Load ────────────────────────────────────────────────────────────── */

async function loadTeams() {
    const body = document.getElementById('teams-body');
    if (!body) return;
    body.innerHTML = `<div class="card"><div class="skeleton" style="height:120px"></div></div>`;

    const [teamsRes, usersRes] = await Promise.all([
        client.from('teams').select('*').order('created_at', { ascending: true }),
        client.from('users').select('id,first_name,last_name,email,role,avatar_url,team_id,is_active')
              .eq('is_active', true).order('first_name', { ascending: true }),
    ]);
    _teams = teamsRes.data || [];
    _teamMembers = usersRes.data || [];

    renderTeams();

    // Only managers get the create button.
    const addBtn = document.querySelector('#page-teams .page-actions');
    if (addBtn) addBtn.style.display = _canManageTeams() ? '' : 'none';
}

function renderTeams() {
    const body = document.getElementById('teams-body');
    if (!body) return;

    const unassigned = _teamMembers.filter(u => !u.team_id);

    if (!_teams.length) {
        body.innerHTML = `
            <div class="card" style="text-align:center;padding:48px 24px">
                <div style="font-size:34px;color:var(--brand);margin-bottom:10px"><i data-lucide="users" class="lucide-i"></i></div>
                <div style="font-weight:700;font-size:16px;margin-bottom:6px">გუნდები ჯერ არ არის</div>
                <div style="font-size:13.5px;color:var(--text-muted);max-width:430px;margin:0 auto 18px">
                    შექმენი გუნდი, მიამაგრე მენეჯერი და დაამატე აგენტები — შემდეგ მენეჯერი
                    დაინახავს ვინ რაზე მუშაობს.
                </div>
                ${_canManageTeams() ? `<button class="btn btn-primary" onclick="openTeamModal()"><i data-lucide="plus" class="lucide-i"></i> ახალი გუნდი</button>` : ''}
            </div>`;
        if (window.lucide) { try { window.lucide.createIcons(); } catch (e) {} }
        return;
    }

    body.innerHTML = `
        <div class="team-grid">
            ${_teams.map(_teamCard).join('')}
        </div>
        ${unassigned.length ? `
            <div class="card" style="margin-top:18px">
                <div class="card-header">
                    <div>
                        <div class="card-title">გუნდის გარეშე</div>
                        <div style="font-size:13px;color:var(--text-muted);margin-top:4px">${unassigned.length} მომხმარებელი</div>
                    </div>
                </div>
                <div class="member-chips">
                    ${unassigned.map(u => _memberChip(u, null)).join('')}
                </div>
            </div>` : ''}
    `;

    // Grow the capacity bars on the next frame so the transition runs.
    if (typeof animateNextFrame === 'function') {
        animateNextFrame(() => {
            body.querySelectorAll('.team-bar span').forEach(el => { el.style.width = el.dataset.w + '%'; });
        });
    }
    if (window.lucide) { try { window.lucide.createIcons(); } catch (e) {} }
}

function _teamCard(team) {
    const members = _teamMembers.filter(u => u.team_id === team.id);
    const manager = _teamMembers.find(u => u.id === team.manager_id);
    const color = team.color || TEAM_COLORS[0];
    const share = _teamMembers.length ? (members.length / _teamMembers.length) * 100 : 0;

    return `<div class="team-card" style="--team:${_teamEsc(color)}">
        <div class="team-head">
            <span class="team-dot"></span>
            <div style="min-width:0;flex:1">
                <div class="team-name">${_teamEsc(team.name)}</div>
                <div class="team-meta">${members.length} წევრი${team.description ? ' · ' + _teamEsc(team.description) : ''}</div>
            </div>
            ${_canManageTeams() ? `
                <button class="btn btn-secondary" style="padding:6px 9px" title="რედაქტირება" onclick="openTeamModal('${team.id}')"><i data-lucide="pencil" class="lucide-i"></i></button>
                <button class="btn btn-secondary" style="padding:6px 9px;color:var(--danger)" title="წაშლა" onclick="deleteTeam('${team.id}')"><i data-lucide="trash-2" class="lucide-i"></i></button>` : ''}
        </div>

        <div class="team-manager">
            <span class="team-avatar">${manager && manager.avatar_url
                ? `<img src="${_teamEsc(manager.avatar_url)}" alt="">`
                : _teamEsc(manager ? initialsOf(_personName(manager)) : '—')}</span>
            <div style="min-width:0">
                <div class="team-mgr-label">მენეჯერი</div>
                <div class="team-mgr-name">${manager ? _teamEsc(_personName(manager)) : '<em style="color:var(--text-subtle);font-style:normal">მიმაგრებული არ არის</em>'}</div>
            </div>
        </div>

        <div class="team-bar"><span data-w="${share.toFixed(1)}"></span></div>

        <div class="member-chips">
            ${members.length
                ? members.map(u => _memberChip(u, team.id)).join('')
                : `<span style="font-size:12.5px;color:var(--text-subtle)">წევრები არ არიან</span>`}
        </div>
    </div>`;
}

function _memberChip(u, teamId) {
    const name = _personName(u);
    return `<span class="member-chip" title="${_teamEsc(u.email || '')}">
        <span class="member-avatar">${u.avatar_url
            ? `<img src="${_teamEsc(u.avatar_url)}" alt="">`
            : _teamEsc(initialsOf(name))}</span>
        <span class="member-name">${_teamEsc(name)}</span>
        ${_canManageTeams() && teamId
            ? `<button class="member-x" title="გუნდიდან მოხსნა" onclick="setUserTeam('${u.id}', null)">&times;</button>`
            : ''}
    </span>`;
}

/* ─── Create / edit ───────────────────────────────────────────────────── */

function openTeamModal(teamId) {
    if (!_canManageTeams()) { showToast('მხოლოდ მენეჯერს შეუძლია გუნდის შექმნა', 'error'); return; }
    _editingTeamId = teamId || null;
    const team = teamId ? _teams.find(t => t.id === teamId) : null;
    const chosen = team && team.color ? team.color : TEAM_COLORS[_teams.length % TEAM_COLORS.length];

    const managers = _teamMembers.filter(u => MGR_ROLES_UI.includes(u.role));
    // Someone already on another team can't also be a member of this one.
    const assignable = _teamMembers.filter(u => !u.team_id || u.team_id === teamId);

    openModal(team ? 'გუნდის რედაქტირება' : 'ახალი გუნდი', `
        <div class="form-group">
            <label class="form-label">დასახელება *</label>
            <input class="form-input" id="team-name" maxlength="80" value="${_teamEsc(team ? team.name : '')}" placeholder="მაგ. გაყიდვების გუნდი">
        </div>
        <div class="form-group">
            <label class="form-label">მენეჯერი</label>
            <select class="form-input" id="team-manager">
                <option value="">— აირჩიე მენეჯერი —</option>
                ${managers.map(m => `<option value="${m.id}"${team && team.manager_id === m.id ? ' selected' : ''}>${_teamEsc(_personName(m))} (${_teamEsc(m.role)})</option>`).join('')}
            </select>
            ${managers.length ? '' : `<div style="font-size:12px;color:var(--warning);margin-top:6px">კომპანიაში მენეჯერი ჯერ არ არის — ჯერ დაამატე აგენტი MANAGER როლით.</div>`}
        </div>
        <div class="form-group">
            <label class="form-label">აღწერა</label>
            <input class="form-input" id="team-desc" maxlength="120" value="${_teamEsc(team ? (team.description || '') : '')}" placeholder="არასავალდებულო">
        </div>
        <div class="form-group">
            <label class="form-label">ფერი</label>
            <div class="color-picker" id="team-colors">
                ${TEAM_COLORS.map(c => `<button type="button" class="color-dot${c === chosen ? ' active' : ''}" style="background:${c}" data-color="${c}" onclick="pickTeamColor('${c}')"></button>`).join('')}
            </div>
        </div>
        <div class="form-group">
            <label class="form-label">წევრები</label>
            <div class="member-picker">
                ${assignable.length ? assignable.map(u => `
                    <label class="member-pick">
                        <input type="checkbox" value="${u.id}"${team && u.team_id === team.id ? ' checked' : ''}>
                        <span class="member-avatar">${u.avatar_url ? `<img src="${_teamEsc(u.avatar_url)}" alt="">` : _teamEsc(initialsOf(_personName(u)))}</span>
                        <span style="min-width:0">
                            <span class="member-name">${_teamEsc(_personName(u))}</span>
                            <span style="display:block;font-size:11px;color:var(--text-subtle)">${_teamEsc(u.role)}</span>
                        </span>
                    </label>`).join('')
                : `<div style="font-size:12.5px;color:var(--text-subtle)">ყველა მომხმარებელი უკვე სხვა გუნდშია</div>`}
            </div>
        </div>
        <input type="hidden" id="team-color" value="${_teamEsc(chosen)}">
        <div style="display:flex;gap:10px;margin-top:6px">
            <button class="btn btn-secondary" style="flex:1" onclick="closeModal()">გაუქმება</button>
            <button class="btn btn-primary" style="flex:1" onclick="saveTeam()"><i data-lucide="save" class="lucide-i"></i> შენახვა</button>
        </div>
    `);
}

function pickTeamColor(c) {
    document.getElementById('team-color').value = c;
    document.querySelectorAll('#team-colors .color-dot').forEach(b =>
        b.classList.toggle('active', b.dataset.color === c));
}

async function saveTeam() {
    const name = document.getElementById('team-name').value.trim();
    if (!name) { showToast('დასახელება აუცილებელია', 'error'); return; }

    const payload = {
        name,
        manager_id: document.getElementById('team-manager').value || null,
        description: document.getElementById('team-desc').value.trim() || null,
        color: document.getElementById('team-color').value || null,
    };
    const picked = [...document.querySelectorAll('.member-picker input[type=checkbox]:checked')].map(i => i.value);

    try {
        let teamId = _editingTeamId;
        if (teamId) {
            const { error } = await client.from('teams').update(payload).eq('id', teamId);
            if (error) throw error;
        } else {
            const { data, error } = await client.from('teams').insert(payload).select().single();
            if (error) throw error;
            teamId = data && data.id;
        }
        if (!teamId) throw new Error('გუნდი ვერ შეიქმნა');

        // Membership is a column on users, so it is written separately from the
        // team row: everyone ticked joins, everyone previously in the team but
        // now unticked is released.
        const wasIn = _teamMembers.filter(u => u.team_id === teamId).map(u => u.id);
        const toAdd = picked.filter(id => !wasIn.includes(id));
        const toRemove = wasIn.filter(id => !picked.includes(id));

        for (const id of toAdd)    await client.from('users').update({ team_id: teamId }).eq('id', id);
        for (const id of toRemove) await client.from('users').update({ team_id: null }).eq('id', id);

        closeModal();
        showToast('<i data-lucide="check-circle-2" class="lucide-i"></i> გუნდი შენახულია');
        await loadTeams();
    } catch (e) {
        showToast('შეცდომა: ' + (e.message || e), 'error');
    }
}

async function setUserTeam(userId, teamId) {
    try {
        const { error } = await client.from('users').update({ team_id: teamId }).eq('id', userId);
        if (error) throw error;
        await loadTeams();
    } catch (e) {
        showToast('შეცდომა: ' + (e.message || e), 'error');
    }
}

function deleteTeam(teamId) {
    const team = _teams.find(t => t.id === teamId);
    if (!team) return;
    const members = _teamMembers.filter(u => u.team_id === teamId).length;
    showConfirm(
        `წავშალო „${team.name}"?`,
        members ? `${members} წევრი დარჩება გუნდის გარეშე. ანგარიშები არ წაიშლება.`
                : 'ეს მოქმედება შეუქცევადია.',
        async () => {
            try {
                // Release members first: users.team_id has no FK constraint
                // (SQLite can't add one via ALTER), so nothing would clear it
                // automatically and they would point at a team that is gone.
                for (const u of _teamMembers.filter(x => x.team_id === teamId)) {
                    await client.from('users').update({ team_id: null }).eq('id', u.id);
                }
                const { error } = await client.from('teams').delete().eq('id', teamId);
                if (error) throw error;
                showToast('გუნდი წაიშალა');
                await loadTeams();
            } catch (e) {
                showToast('შეცდომა: ' + (e.message || e), 'error');
            }
        }
    );
}
