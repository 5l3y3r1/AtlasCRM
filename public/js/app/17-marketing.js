// ═══════════════════════════════════════════════════════
// <i data-lucide="megaphone" class="lucide-i"></i> MARKETING MODULE
// ───────────────────────────────────────────────────────
// Metrics are DERIVED live from attributed leads + deals via /api/marketing/rollup.
// You never type leads/revenue/ROI — they come from real CRM data. The only
// external number is `spent`, which is either entered manually (myhome/ss.ge) or
// auto-synced from Meta/TikTok using the company's own API keys (Settings → Integrations).
// ═══════════════════════════════════════════════════════
let _mktRollup = { campaigns: [], totals: {} };

async function loadMarketing() {
    const container = document.getElementById('campaigns-list');
    try {
        const res = await fetch('/api/marketing/rollup', { credentials: 'include' });
        const json = await res.json();
        if (json.error) throw new Error(json.error);
        _mktRollup = json.data || { campaigns: [], totals: {} };
    } catch (e) {
        if (container) container.innerHTML = `<div class="empty"><div class="empty-title">ჩატვირთვის შეცდომა</div><div class="empty-sub">${escHtml(e.message)}</div></div>`;
        return;
    }

    const { campaigns, totals } = _mktRollup;

    // KPIs (all derived)
    const setK = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    setK('kpi-camp-active', totals.active || 0);
    setK('kpi-camp-spent', '$' + Math.round(totals.spent || 0).toLocaleString());
    setK('kpi-camp-leads', totals.leads || 0);
    setK('kpi-camp-roi', totals.roi == null ? '—' : totals.roi + '%');

    // Last sync hint + sync button
    const lastSync = campaigns.map(c => c.spent_synced_at).filter(Boolean).sort().pop();
    const syncBar = `
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px;flex-wrap:wrap">
            <div style="font-size:12px;color:var(--text-muted)">
                ${lastSync ? `<i data-lucide="refresh-cw" class="lucide-i"></i> სპენდი განახლდა: ${new Date(lastSync.replace(' ','T')+'Z').toLocaleString()}` : 'სპენდი ჯერ არ სინქრონიზებულა'}
            </div>
            <button class="btn btn-secondary" onclick="syncMarketingSpend(this)" style="font-size:13px">
                <i data-lucide="refresh-cw" class="lucide-i"></i> სპენდის სინქი (Meta/TikTok)
            </button>
        </div>`;

    if (!campaigns.length) {
        container.innerHTML = syncBar + `
            <div class="empty">
                <div class="empty-icon"><i data-lucide="megaphone" class="lucide-i"></i></div>
                <div class="empty-title">კამპანიები ჯერ არ გაქვს</div>
                <div class="empty-sub">დააჭირე "+ კამპანია" დასამატებლად</div>
            </div>`;
        if (window.lucide) try { window.lucide.createIcons(); } catch (e) {}
        return;
    }

    container.innerHTML = syncBar + `
        <table>
            <thead>
                <tr>
                    <th>${t("th_name")}</th>
                    <th>პლატფორმა</th>
                    <th>ბიუჯეტი</th>
                    <th>დახარჯ.</th>
                    <th>ლიდები</th>
                    <th>გარიგ.</th>
                    <th>შემოსავ.</th>
                    <th>ROI</th>
                    <th>${t("th_status")}</th>
                    <th></th>
                </tr>
            </thead>
            <tbody>
                ${campaigns.map(c => {
                    const roiTxt = c.roi == null ? '—' : c.roi + '%';
                    const roiColor = c.roi == null ? '#888' : (c.roi >= 0 ? '#34c759' : '#ff3b30');
                    const synced = c.external_campaign_id
                        ? `<span title="auto-synced from ${c.external_platform||''}"><i data-lucide="refresh-cw" class="lucide-i" style="width:12px;height:12px;opacity:.5"></i></span>` : '';
                    return `
                    <tr>
                        <td><strong>${escHtml(c.name)}</strong></td>
                        <td>${getPlatformIcon(c.platform)} ${c.platform || '—'}</td>
                        <td>${c.budget_amount ? '$' + Number(c.budget_amount).toLocaleString() : '—'}</td>
                        <td>$${Math.round(c.spent || 0).toLocaleString()} ${synced}</td>
                        <td>${c.leads_generated || 0}</td>
                        <td>${c.deals_won || 0}/${c.deals_total || 0}</td>
                        <td>$${Math.round(c.revenue || 0).toLocaleString()}</td>
                        <td style="color:${roiColor};font-weight:600">${roiTxt}</td>
                        <td><span class="badge ${getCampaignStatusClass(c.status)}">${getCampaignStatusName(c.status)}</span></td>
                        <td>
                            <div class="action-buttons">
                                <button class="action-btn edit" onclick="editCampaign('${c.id}')" title="რედაქტირება"><i data-lucide="pencil" class="lucide-i"></i></button>
                                <button class="action-btn delete" onclick="deleteRecord('marketing_campaigns', '${c.id}', '${escHtml((c.name||'').replace(/'/g, ''))}')" title="წაშლა"><i data-lucide="trash-2" class="lucide-i"></i></button>
                            </div>
                        </td>
                    </tr>
                `}).join('')}
            </tbody>
        </table>
    `;
    if (window.lucide) try { window.lucide.createIcons(); } catch (e) {}
}

async function syncMarketingSpend(btn) {
    if (btn) { btn.disabled = true; btn.innerHTML = '<i data-lucide="loader" class="lucide-i"></i> სინქი...'; }
    try {
        const res = await fetch('/api/marketing/sync', { method: 'POST', credentials: 'include' });
        const json = await res.json();
        const d = json.data || {};
        if (!d.configured) {
            showToast('ჯერ შეიყვანე Meta/TikTok გასაღები (პარამეტრები → ინტეგრაციები)', 'error');
        } else if (d.errors && d.errors.length) {
            showToast('სინქი: ' + d.errors.join('; '), 'error');
        } else {
            showToast(`<i data-lucide="check-circle-2" class="lucide-i"></i> განახლდა ${d.updated} კამპანია`);
        }
    } catch (e) {
        showToast('სინქის შეცდომა: ' + e.message, 'error');
    } finally {
        loadMarketing();
    }
}

function getPlatformIcon(p) {
    return {
        'FACEBOOK': '<i data-lucide="book" class="lucide-i"></i>',
        'INSTAGRAM': '<i data-lucide="camera" class="lucide-i"></i>',
        'TIKTOK': '<i data-lucide="music" class="lucide-i"></i>',
        'GOOGLE': '<i data-lucide="search" class="lucide-i"></i>',
        'MYHOME': '<i data-lucide="home" class="lucide-i"></i>',
        'SSGE': '<i data-lucide="buildings" class="lucide-i"></i>',
        'EMAIL': '<i data-lucide="mail" class="lucide-i"></i>',
        'SMS': '<i data-lucide="message-circle" class="lucide-i"></i>'
    }[p] || '<i data-lucide="megaphone" class="lucide-i"></i>';
}

function getCampaignStatusName(s) {
    return {
        'DRAFT': '<i data-lucide="pencil-line" class="lucide-i"></i> დრაფტი',
        'ACTIVE': '<i data-lucide="check-circle-2" class="lucide-i"></i> აქტიური',
        'PAUSED': '<i data-lucide="pause" class="lucide-i"></i> შეჩერებული',
        'COMPLETED': '<i data-lucide="check" class="lucide-i"></i> დასრულდა',
        'CANCELLED': '<i data-lucide="x" class="lucide-i"></i> გაუქმდა'
    }[s] || s;
}

function getCampaignStatusClass(s) {
    if (s === 'ACTIVE') return 'badge-active';
    if (s === 'CANCELLED' || s === 'COMPLETED') return '';
    return 'badge-warm';
}

// Platform → external-id field label hint
function _platformExternalLabel(platform) {
    if (platform === 'TIKTOK') return 'TikTok Campaign ID';
    return 'Meta Campaign ID';
}

function openCampaignModal() {
    openModal('+ ახალი კამპანია', `
        <div class="form-group">
            <label class="form-label">სახელი <span class="req" style="color:#EF4444;font-weight:700">*</span></label>
            <input class="form-input" id="cm-name" placeholder="მაგ: ვაკეში ბინების FB კამპანია">
        </div>
        <div class="form-row">
            <div class="form-group">
                <label class="form-label">${t("f_type")}</label>
                <select class="form-select" id="cm-type">
                    <option value="LEAD_GEN">Lead Gen</option>
                    <option value="AWARENESS">Awareness</option>
                    <option value="TRAFFIC">Traffic</option>
                    <option value="CONVERSION">Conversion</option>
                </select>
            </div>
            <div class="form-group">
                <label class="form-label">პლატფორმა</label>
                <select class="form-select" id="cm-platform">
                    <option value="FACEBOOK">Facebook</option>
                    <option value="INSTAGRAM">Instagram</option>
                    <option value="TIKTOK">TikTok</option>
                    <option value="GOOGLE">Google</option>
                    <option value="MYHOME">myhome.ge</option>
                    <option value="SSGE">ss.ge</option>
                    <option value="EMAIL">Email</option>
                    <option value="SMS">SMS</option>
                </select>
            </div>
        </div>
        <div class="form-row">
            <div class="form-group">
                <label class="form-label">ბიუჯეტი ($)</label>
                <input class="form-input" id="cm-budget" type="number">
            </div>
            <div class="form-group">
                <label class="form-label">${t("f_status")}</label>
                <select class="form-select" id="cm-status">
                    <option value="DRAFT">დრაფტი</option>
                    <option value="ACTIVE" selected>აქტიური</option>
                    <option value="PAUSED">შეჩერებული</option>
                </select>
            </div>
        </div>
        <div class="form-row">
            <div class="form-group">
                <label class="form-label">დაწყება</label>
                <input class="form-input" id="cm-start" type="date">
            </div>
            <div class="form-group">
                <label class="form-label">დასრულება</label>
                <input class="form-input" id="cm-end" type="date">
            </div>
        </div>
        <div style="background:var(--surface-2);border:1px solid #e8edf3;border-radius:10px;padding:12px;margin-bottom:14px">
            <div style="font-size:12px;font-weight:600;color:#475569;margin-bottom:8px"><i data-lucide="refresh-cw" class="lucide-i"></i> ავტო-სპენდი (არასავალდებულო)</div>
            <div style="font-size:11px;color:var(--text-muted);margin-bottom:8px">დააკავშირე Meta/TikTok-ის Campaign ID-ს და სპენდი ავტომატურად ჩამოიწერება. სხვა შემთხვევაში სპენდი ხელით შეჰყავ რედაქტირებისას.</div>
            <div class="form-row">
                <div class="form-group" style="margin-bottom:0">
                    <label class="form-label">პლატფორმა</label>
                    <select class="form-select" id="cm-extplatform">
                        <option value="">— არცერთი (ხელით) —</option>
                        <option value="META">Meta (FB/IG)</option>
                        <option value="TIKTOK">TikTok</option>
                    </select>
                </div>
                <div class="form-group" style="margin-bottom:0">
                    <label class="form-label">Campaign ID</label>
                    <input class="form-input" id="cm-extid" placeholder="120xxxxxxxxxxxx">
                </div>
            </div>
        </div>
        <div class="form-group">
            <label class="form-label">${t("f_desc")}</label>
            <textarea class="form-textarea" id="cm-desc" rows="2"></textarea>
        </div>
        <button class="btn btn-primary" onclick="saveCampaign()" style="width:100%"><i data-lucide="save" class="lucide-i"></i> შენახვა</button>
    `);
}

async function saveCampaign() {
    const name = document.getElementById('cm-name').value.trim();
    if (!name) { showToast('სახელი აუცილებელია', 'error'); return; }
    try {
        const budget = document.getElementById('cm-budget').value;
        const { error } = await client.from('marketing_campaigns').insert({
            company_id: currentUser.company_id,
            name: name,
            campaign_type: document.getElementById('cm-type').value,
            platform: document.getElementById('cm-platform').value,
            budget_amount: budget ? Number(budget) : null,
            currency: 'USD',
            start_date: document.getElementById('cm-start').value || null,
            end_date: document.getElementById('cm-end').value || null,
            status: document.getElementById('cm-status').value,
            external_platform: document.getElementById('cm-extplatform').value || null,
            external_campaign_id: document.getElementById('cm-extid').value.trim() || null,
            description: document.getElementById('cm-desc').value.trim() || null,
            created_by: currentUser.id
        });
        if (error) throw error;
        showToast('<i data-lucide="check-circle-2" class="lucide-i"></i> კამპანია შეიქმნა');
        closeModal();
        loadMarketing();
    } catch (e) {
        showToast('შეცდომა: ' + e.message, 'error');
    }
}

async function editCampaign(id) {
    const c = (_mktRollup.campaigns || []).find(x => x.id === id)
        || (await client.from('marketing_campaigns').select('*').eq('id', id).single()).data;
    if (!c) return;

    openModal('<i data-lucide="pencil" class="lucide-i"></i> კამპანიის რედაქტირება', `
        <div class="form-group">
            <label class="form-label">${t("f_name")}</label>
            <input class="form-input" id="cm-name" value="${escHtml(c.name || '')}">
        </div>
        <div class="form-row">
            <div class="form-group">
                <label class="form-label">ბიუჯეტი ($)</label>
                <input class="form-input" id="cm-budget" type="number" value="${c.budget_amount || ''}">
            </div>
            <div class="form-group">
                <label class="form-label">დახარჯული ($) ${c.external_campaign_id ? '<span style="font-size:10px;color:var(--text-muted)">(ავტო-სინქი)</span>' : ''}</label>
                <input class="form-input" id="cm-spent" type="number" value="${c.spent || ''}" ${c.external_campaign_id ? 'disabled title="auto-synced from ' + (c.external_platform||'') + '"' : ''}>
            </div>
        </div>
        <div style="background:var(--success-soft);border:1px solid #dcfce7;border-radius:10px;padding:10px 12px;margin-bottom:14px;font-size:12px;color:#15803d">
            <div><i data-lucide="users" class="lucide-i"></i> ლიდები: <strong>${c.leads_generated || 0}</strong> &nbsp;·&nbsp; გარიგებები: <strong>${c.deals_won || 0}/${c.deals_total || 0}</strong></div>
            <div style="margin-top:4px"><i data-lucide="dollar-sign" class="lucide-i"></i> შემოსავალი: <strong>$${Math.round(c.revenue || 0).toLocaleString()}</strong> &nbsp;·&nbsp; ROI: <strong>${c.roi == null ? '—' : c.roi + '%'}</strong></div>
            <div style="margin-top:4px;font-size:11px;color:#86b899">ეს მაჩვენებლები ავტომატურია — გამოითვლება მიბმული ლიდებიდან/გარიგებებიდან.</div>
        </div>
        <div class="form-row">
            <div class="form-group">
                <label class="form-label">ავტო-სპენდი პლატფორმა</label>
                <select class="form-select" id="cm-extplatform">
                    <option value="" ${!c.external_platform ? 'selected' : ''}>— არცერთი (ხელით) —</option>
                    <option value="META" ${c.external_platform === 'META' ? 'selected' : ''}>Meta (FB/IG)</option>
                    <option value="TIKTOK" ${c.external_platform === 'TIKTOK' ? 'selected' : ''}>TikTok</option>
                </select>
            </div>
            <div class="form-group">
                <label class="form-label">Campaign ID</label>
                <input class="form-input" id="cm-extid" value="${c.external_campaign_id || ''}" placeholder="120xxxxxxxxxxxx">
            </div>
        </div>
        <div class="form-group">
            <label class="form-label">${t("f_status")}</label>
            <select class="form-select" id="cm-status">
                <option value="DRAFT" ${c.status === 'DRAFT' ? 'selected' : ''}>დრაფტი</option>
                <option value="ACTIVE" ${c.status === 'ACTIVE' ? 'selected' : ''}>აქტიური</option>
                <option value="PAUSED" ${c.status === 'PAUSED' ? 'selected' : ''}>შეჩერებული</option>
                <option value="COMPLETED" ${c.status === 'COMPLETED' ? 'selected' : ''}>დასრულდა</option>
                <option value="CANCELLED" ${c.status === 'CANCELLED' ? 'selected' : ''}>გაუქმდა</option>
            </select>
        </div>
        <button class="btn btn-primary" onclick="updateCampaign('${id}')" style="width:100%"><i data-lucide="save" class="lucide-i"></i> განახლება</button>
    `);
}

async function updateCampaign(id) {
    try {
        const budget = document.getElementById('cm-budget').value;
        const spentEl = document.getElementById('cm-spent');
        const extPlatform = document.getElementById('cm-extplatform').value || null;
        const extId = document.getElementById('cm-extid').value.trim() || null;

        const updates = {
            name: document.getElementById('cm-name').value.trim(),
            budget_amount: budget ? Number(budget) : null,
            status: document.getElementById('cm-status').value,
            external_platform: extPlatform,
            external_campaign_id: extId
        };
        // Only accept manual spend when the campaign isn't auto-synced
        if (!extId && !spentEl.disabled) {
            updates.spent = spentEl.value ? Number(spentEl.value) : 0;
        }

        const { error } = await client.from('marketing_campaigns').update(updates).eq('id', id);
        if (error) throw error;
        showToast('<i data-lucide="check-circle-2" class="lucide-i"></i> განახლდა');
        closeModal();
        loadMarketing();
    } catch (e) {
        showToast('შეცდომა: ' + e.message, 'error');
    }
}

async function exportMarketing() {
    if (typeof hasPermission === 'function' && !hasPermission('export_data','can_create')) { if (typeof showToast==='function') showToast('ექსპორტი გათიშულია თქვენი როლისთვის', 'error'); return; }
    const data = _mktRollup.campaigns || [];
    if (!data.length) { showToast('მონაცემები არ არის', 'error'); return; }
    const translated = data.map(c => ({
        'სახელი': c.name,
        'ტიპი': c.campaign_type,
        'პლატფორმა': c.platform,
        'ბიუჯეტი': c.budget_amount,
        'დახარჯული': c.spent,
        'ლიდები': c.leads_generated,
        'გარიგებები (won)': c.deals_won,
        'შემოსავალი': c.revenue,
        'ROI %': c.roi,
        'კონვერსია %': c.conversion_rate,
        'სტატუსი': c.status
    }));
    const ws = XLSX.utils.json_to_sheet(translated);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'მარკეტინგი');
    XLSX.writeFile(wb, `warm_marketing_${new Date().toISOString().split('T')[0]}.xlsx`);
    showToast('<i data-lucide="check-circle-2" class="lucide-i"></i> ექსპორტი');
}

// Shared: fill a <select> with the company's campaigns (used by lead + deal modals).
// Auto-selects a match from ?utm_campaign= (by id or name) for hands-off attribution.
async function populateCampaignSelect(selectId, selectedId) {
    const el = document.getElementById(selectId);
    if (!el) return;
    try {
        const { data } = await client.from('marketing_campaigns')
            .select('id, name, status').order('created_at', { ascending: false });
        const utm = new URLSearchParams(location.search).get('utm_campaign');
        const pre = selectedId || '';
        el.innerHTML = '<option value="">— კამპანია არ არის —</option>' +
            (data || []).map(c => {
                const sel = (c.id === pre) || (utm && (c.id === utm || c.name === utm)) ? 'selected' : '';
                const tag = c.status && c.status !== 'ACTIVE' ? ` (${c.status})` : '';
                return `<option value="${c.id}" ${sel}>${escHtml(c.name)}${tag}</option>`;
            }).join('');
    } catch (e) { /* leave the placeholder */ }
}
