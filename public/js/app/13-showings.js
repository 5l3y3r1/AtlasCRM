// ═══════════════════════════════════════════════════════
// <i data-lucide="calendar" class="lucide-i"></i> SHOWINGS MODULE
// ═══════════════════════════════════════════════════════
async function loadShowings() {
    const { data } = await client
        .from('showings')
        .select('*, listings(title, district), agent:users!showings_agent_id_fkey(first_name, last_name), client:clients(first_name, last_name)')
        .order('scheduled_at', { ascending: true });
    
    const container = document.getElementById('showings-list');
    
    if (!data || data.length === 0) {
        container.innerHTML = `
            <div class="empty">
                <div class="empty-icon"><i data-lucide="calendar" class="lucide-i"></i></div>
                <div class="empty-title">ჩვენებები ჯერ არ არის</div>
                <div class="empty-sub">დაგეგმე ჩვენება ობიექტისთვის</div>
            </div>
        `;
        return;
    }
    
    container.innerHTML = `
        <table>
            <thead>
                <tr>
                    <th>${t("th_date")}</th>
                    <th>${t("th_listing")}</th>
                    <th>${t("th_client")}</th>
                    <th>${t("th_agent")}</th>
                    <th>ხანგრძ.</th>
                    <th>${t("th_status")}</th>
                    <th>ფიდბექი</th>
                    <th></th>
                </tr>
            </thead>
            <tbody>
                ${data.map(s => `
                    <tr>
                        <td><strong>${formatDateTime(s.scheduled_at)}</strong></td>
                        <td>${s.listings?.title || '—'}<br><small style="color:var(--text-muted)">${s.listings?.district || ''}</small></td>
                        <td>${s.client ? s.client.first_name + ' ' + (s.client.last_name || '') : '—'}</td>
                        <td>${s.agent?.first_name || ''} ${s.agent?.last_name || ''}</td>
                        <td>${s.duration_minutes || 30} წთ</td>
                        <td><span class="badge ${getShowingStatusClass(s.status)}">${getShowingStatusName(s.status)}</span></td>
                        <td>${s.interest_level ? getInterestLabel(s.interest_level) : '—'}</td>
                        <td>
                            <div class="action-buttons">
                                <button class="action-btn edit" onclick="editShowing('${s.id}')" title="რედაქტირება"><i data-lucide="pencil" class="lucide-i"></i></button>
                                <button class="action-btn delete" onclick="deleteRecord('showings', '${s.id}', 'ჩვენება')" title="წაშლა"><i data-lucide="trash-2" class="lucide-i"></i></button>
                            </div>
                        </td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
    if (window.lucide) try { window.lucide.createIcons(); } catch(e) {}
}

function getShowingStatusName(s) {
    return {
        'SCHEDULED': '<i data-lucide="calendar" class="lucide-i"></i> დაგეგმილი',
        'CONFIRMED': '<i data-lucide="check-circle-2" class="lucide-i"></i> დადასტურებული',
        'COMPLETED': '<i data-lucide="check" class="lucide-i"></i> შესრულდა',
        'CANCELLED': '<i data-lucide="x" class="lucide-i"></i> გაუქმდა',
        'NO_SHOW': '<i data-lucide="ghost" class="lucide-i"></i> არ მოვიდა'
    }[s] || s;
}

function getShowingStatusClass(s) {
    return s === 'COMPLETED' ? 'badge-active' : s === 'CANCELLED' || s === 'NO_SHOW' ? '' : 'badge-warm';
}

function getInterestLabel(i) {
    return {
        'VERY_INTERESTED': '<i data-lucide="flame" class="lucide-i"></i> ძალიან მაინტერესებს',
        'INTERESTED': '<i data-lucide="thumbs-up" class="lucide-i"></i> დაინტერესება',
        'NEUTRAL': '<i data-lucide="meh" class="lucide-i"></i> ნეიტრალური',
        'NOT_INTERESTED': '<i data-lucide="thumbs-down" class="lucide-i"></i> არ მაინტერესებს'
    }[i] || i;
}

async function openShowingModal() {
    // Load listings + clients
    const [listingsRes, clientsRes, agentsRes] = await Promise.all([
        client.from('listings').select('id, title, district').eq('status', 'ACTIVE'),
        client.from('clients').select('id, first_name, last_name'),
        client.from('users').select('id, first_name, last_name').eq('company_id', currentUser.company_id)
    ]);
    
    openModal(t("mt_new_showing"), `
        <div class="form-group">
            <label class="form-label">ობიექტი <span class="req" style="color:#EF4444;font-weight:700">*</span></label>
            <select class="form-select" id="sh-listing">
                <option value="">აირჩიე...</option>
                ${(listingsRes.data || []).map(l => `<option value="${l.id}">${escHtml(l.title)} (${escHtml(l.district || '')})</option>`).join('')}
            </select>
        </div>
        <div class="form-row">
            <div class="form-group">
                <label class="form-label">${t("f_client")}</label>
                <select class="form-select" id="sh-client">
                    <option value="">—</option>
                    ${(clientsRes.data || []).map(c => `<option value="${c.id}">${escHtml(c.first_name)} ${escHtml(c.last_name || '')}</option>`).join('')}
                </select>
            </div>
            <div class="form-group">
                <label class="form-label">აგენტი <span class="req" style="color:#EF4444;font-weight:700">*</span></label>
                <select class="form-select" id="sh-agent">
                    <option value="${currentUser.id}">${escHtml(currentUser.first_name)} (მე)</option>
                    ${(agentsRes.data || []).filter(u => u.id !== currentUser.id).map(u => `<option value="${u.id}">${escHtml(u.first_name)} ${escHtml(u.last_name || '')}</option>`).join('')}
                </select>
            </div>
        </div>
        <div class="form-row">
            <div class="form-group">
                <label class="form-label">თარიღი/დრო <span class="req" style="color:#EF4444;font-weight:700">*</span></label>
                <input class="form-input" id="sh-when" type="datetime-local">
            </div>
            <div class="form-group">
                <label class="form-label">ხანგრძლივობა (წთ)</label>
                <input class="form-input" id="sh-duration" type="number" value="30">
            </div>
        </div>
        <div class="form-group">
            <label class="form-label">შენიშვნა</label>
            <textarea class="form-textarea" id="sh-notes" rows="2"></textarea>
        </div>
        <button class="btn btn-primary" onclick="saveShowing()" style="width:100%"><i data-lucide="save" class="lucide-i"></i> დაგეგმვა</button>
    `);
}

async function saveShowing() {
    const listing = document.getElementById('sh-listing').value;
    const when = document.getElementById('sh-when').value;
    
    if (!listing || !when) {
        showToast('ობიექტი და დრო აუცილებელია', 'error');
        return;
    }
    
    try {
        const { error } = await client.from('showings').insert({
            company_id: currentUser.company_id,
            listing_id: listing,
            client_id: document.getElementById('sh-client').value || null,
            agent_id: document.getElementById('sh-agent').value,
            scheduled_at: new Date(when).toISOString(),
            duration_minutes: Number(document.getElementById('sh-duration').value) || 30,
            agent_notes: document.getElementById('sh-notes').value.trim() || null,
            status: 'SCHEDULED'
        });
        
        if (error) throw error;
        showToast('<i data-lucide="check-circle-2" class="lucide-i"></i> ჩვენება დაიგეგმა');
        closeModal();
        loadShowings();
    } catch (e) {
        showToast('შეცდომა: ' + e.message, 'error');
    }
}

async function editShowing(id) {
    openModalLoading('<i data-lucide="pencil" class="lucide-i"></i> ჩვენების რედაქტირება');
    const { data: s } = await client.from('showings').select('*').eq('id', id).single();
    if (!s) return;
    
    openModal('<i data-lucide="pencil" class="lucide-i"></i> ჩვენების რედაქტირება', `
        <div class="form-row">
            <div class="form-group">
                <label class="form-label">${t("f_status")}</label>
                <select class="form-select" id="sh-status">
                    <option value="SCHEDULED" ${s.status === 'SCHEDULED' ? 'selected' : ''}><i data-lucide="calendar" class="lucide-i"></i> დაგეგმილი</option>
                    <option value="CONFIRMED" ${s.status === 'CONFIRMED' ? 'selected' : ''}><i data-lucide="check-circle-2" class="lucide-i"></i> დადასტურებული</option>
                    <option value="COMPLETED" ${s.status === 'COMPLETED' ? 'selected' : ''}><i data-lucide="check" class="lucide-i"></i> შესრულდა</option>
                    <option value="CANCELLED" ${s.status === 'CANCELLED' ? 'selected' : ''}><i data-lucide="x" class="lucide-i"></i> გაუქმდა</option>
                    <option value="NO_SHOW" ${s.status === 'NO_SHOW' ? 'selected' : ''}><i data-lucide="ghost" class="lucide-i"></i> არ მოვიდა</option>
                </select>
            </div>
            <div class="form-group">
                <label class="form-label">ინტერესი</label>
                <select class="form-select" id="sh-interest">
                    <option value="">—</option>
                    <option value="VERY_INTERESTED" ${s.interest_level === 'VERY_INTERESTED' ? 'selected' : ''}><i data-lucide="flame" class="lucide-i"></i> ძალიან</option>
                    <option value="INTERESTED" ${s.interest_level === 'INTERESTED' ? 'selected' : ''}><i data-lucide="thumbs-up" class="lucide-i"></i> დაინტერესება</option>
                    <option value="NEUTRAL" ${s.interest_level === 'NEUTRAL' ? 'selected' : ''}><i data-lucide="meh" class="lucide-i"></i> ნეიტრალური</option>
                    <option value="NOT_INTERESTED" ${s.interest_level === 'NOT_INTERESTED' ? 'selected' : ''}><i data-lucide="thumbs-down" class="lucide-i"></i> არა</option>
                </select>
            </div>
        </div>
        <div class="form-group">
            <label class="form-label">ფიდბექი</label>
            <textarea class="form-textarea" id="sh-feedback" rows="3">${escHtml(s.feedback || '')}</textarea>
        </div>
        <button class="btn btn-primary" onclick="updateShowing('${id}')" style="width:100%"><i data-lucide="save" class="lucide-i"></i> განახლება</button>
    `);
}

async function updateShowing(id) {
    try {
        const { error } = await client.from('showings').update({
            status: document.getElementById('sh-status').value,
            interest_level: document.getElementById('sh-interest').value || null,
            feedback: document.getElementById('sh-feedback').value.trim() || null
        }).eq('id', id);
        
        if (error) throw error;
        showToast('<i data-lucide="check-circle-2" class="lucide-i"></i> განახლდა');
        closeModal();
        loadShowings();
    } catch (e) {
        showToast('შეცდომა: ' + e.message, 'error');
    }
}

