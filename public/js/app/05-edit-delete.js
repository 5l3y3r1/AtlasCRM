// ═══════════════════════════════════════════════════════
// <i data-lucide="trash-2" class="lucide-i"></i> DELETE / <i data-lucide="pencil" class="lucide-i"></i> EDIT
// ═══════════════════════════════════════════════════════

let confirmCallback = null;

function showConfirm(title, text, callback, type) {
    document.getElementById('confirm-title').textContent = title;
    document.getElementById('confirm-text').textContent = text;
    document.getElementById('confirm-icon').innerHTML = type === 'delete' ? '<i data-lucide="trash-2" class="lucide-i"></i>' : '<i data-lucide="alert-triangle" class="lucide-i"></i>';
    confirmCallback = callback;
    document.getElementById('confirm').classList.add('show');
}

function closeConfirm() {
    document.getElementById('confirm').classList.remove('show');
    confirmCallback = null;
}

async function deleteRecord(table, id, name) {
    showConfirm(
        'წაშლა',
        `დარწმუნებული ხარ რომ წაშლი: "${name}"? ეს მოქმედება შეუქცევადია.`,
        async () => {
            try {
                const { error } = await client.from(table).delete().eq('id', id);
                if (error) throw error;
                
                showToast('<i data-lucide="check-circle-2" class="lucide-i"></i> წაიშალა');
                
                if (currentPage === 'leads') loadLeads();
                if (currentPage === 'clients') loadClients();
                if (currentPage === 'deals') loadDeals();
                if (currentPage === 'listings') loadListings();
                if (currentPage === 'agents') loadAgents();
                if (currentPage === 'dashboard') loadDashboard();
                if (currentPage === 'lawyer') {
                    const contractsVisible = document.getElementById('lawyer-tab-contracts')?.style.display !== 'none';
                    if (contractsVisible) loadContracts(); else loadDocuments();
                }
                
            } catch (e) {
                showToast('შეცდომა: ' + e.message, 'error');
            }
        },
        'delete'
    );
}

async function editLead(id) {
    openModalLoading('<i data-lucide="pencil" class="lucide-i"></i> ლიდის რედაქტირება');
    const { data: lead } = await client.from('leads').select('*').eq('id', id).single();
    if (!lead) { showToast('ლიდი ვერ მოიძებნა', 'error'); return; }
    
    openModal('<i data-lucide="pencil" class="lucide-i"></i> ლიდის რედაქტირება', `
        <div class="form-row">
            <div class="form-group">
                <label class="form-label">${t('f_owner_name','მფლობელი')}</label>
                <input class="form-input" id="lead-name" value="${escHtml(lead.full_name || '')}">
            </div>
            <div class="form-group">
                <label class="form-label">${t("f_phone")} <span class="req" style="color:#EF4444;font-weight:700">*</span></label>
                <input class="form-input" id="lead-phone" value="${escHtml(lead.phone || '')}">
            </div>
        </div>
        <div class="form-group">
            <label class="form-label">${t("f_email")}</label>
            <input class="form-input" id="lead-email" type="email" value="${escHtml(lead.email || '')}">
        </div>
        <div class="form-row">
            <div class="form-group">
                <label class="form-label">${t("f_phone")} 2</label>
                <input class="form-input" id="lead-phone2" value="${lead.phone2 || ''}">
            </div>
            <div class="form-group">
                <label class="form-label">${t("f_phone")} 3</label>
                <input class="form-input" id="lead-phone3" value="${lead.phone3 || ''}">
            </div>
        </div>
        <div class="form-row">
            <div class="form-group">
                <label class="form-label">MyHome ID</label>
                <input class="form-input" id="lead-myhome" value="${lead.myhome_id || ''}">
            </div>
            <div class="form-group">
                <label class="form-label">SS.GE ID</label>
                <input class="form-input" id="lead-ssge" value="${lead.ssge_id || ''}">
            </div>
        </div>
        <div class="form-row">
            <div class="form-group">
                <label class="form-label">${t("f_source")}</label>
                <select class="form-select" id="lead-source">
                    ${['FACEBOOK','INSTAGRAM','TIKTOK','MYHOME','SSGE','COLD_CALL','REFERRAL','WEBSITE','WALK_IN','OTHER'].map(s => 
                        `<option value="${s}" ${lead.source === s ? 'selected' : ''}>${s}</option>`
                    ).join('')}
                </select>
            </div>
            <div class="form-group">
                <label class="form-label">${t("f_temp")}</label>
                <select class="form-select" id="lead-temp">
                    <option value="HOT" ${lead.temperature === 'HOT' ? 'selected' : ''}><i data-lucide="flame" class="lucide-i"></i> HOT</option>
                    <option value="WARM" ${lead.temperature === 'WARM' ? 'selected' : ''}><i data-lucide="sun" class="lucide-i"></i> WARM</option>
                    <option value="COLD" ${lead.temperature === 'COLD' ? 'selected' : ''}><i data-lucide="snowflake" class="lucide-i"></i> COLD</option>
                </select>
            </div>
        </div>
        <div class="form-group">
            <label class="form-label">${t("f_status")}</label>
            <select class="form-select" id="lead-status">
                ${['NEW','ASSIGNED','CONTACTED','QUALIFIED','CONVERTED','LOST'].map(s => 
                    `<option value="${s}" ${lead.status === s ? 'selected' : ''}>${s}</option>`
                ).join('')}
            </select>
        </div>
        <div class="form-group">
            <label class="form-label">${t("f_notes")}</label>
            <textarea class="form-textarea" id="lead-msg" rows="2">${(lead.inquiry_message || '').replace(/`/g,'\\`')}</textarea>
        </div>
        <div class="form-group">
            <label class="form-label">${t('ef_comments_notes','კომენტარი / შენიშვნები')}</label>
            <textarea class="form-textarea" id="lead-notes" rows="2">${(lead.notes || '').replace(/`/g,'\\`')}</textarea>
        </div>
        <div style="display:flex;gap:8px;margin-top:12px">
            <button class="btn btn-primary" onclick="updateLead('${id}')" style="flex:1"><i data-lucide="save" class="lucide-i"></i> ${t("btn_update")}</button>
            <button type="button" class="btn btn-secondary" onclick="openWhatsAppDirect('${escHtml(lead.phone || '')}','lead')" style="flex:0 0 auto;min-width:120px" title="WhatsApp Web-ში გახსნა"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style="vertical-align:middle;margin-right:4px"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a.518.518 0 0 0-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.127.558 4.122 1.532 5.849L.054 23.454a.5.5 0 0 0 .492.593l5.763-1.512A11.94 11.94 0 0 0 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-1.907 0-3.693-.513-5.232-1.41l-.374-.222-3.882 1.018 1.037-3.792-.244-.389A9.955 9.955 0 0 1 2 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z"/></svg> WhatsApp</button>
        </div>
    `);
}

async function updateLead(id) {
    const phone = document.getElementById('lead-phone').value.trim();
    if (!phone) { showToast('ტელეფონი აუცილებელია', 'error'); return; }
    
    try {
        const { error } = await client.from('leads').update({
            full_name: document.getElementById('lead-name').value.trim() || null,
            phone: phone,
            phone2: document.getElementById('lead-phone2')?.value.trim() || null,
            phone3: document.getElementById('lead-phone3')?.value.trim() || null,
            myhome_id: document.getElementById('lead-myhome')?.value.trim() || null,
            ssge_id: document.getElementById('lead-ssge')?.value.trim() || null,
            email: document.getElementById('lead-email').value.trim() || null,
            source: document.getElementById('lead-source').value,
            temperature: document.getElementById('lead-temp').value,
            status: document.getElementById('lead-status').value,
            inquiry_message: document.getElementById('lead-msg').value.trim() || null,
            notes: document.getElementById('lead-notes')?.value.trim() || null
        }).eq('id', id);
        
        if (error) throw error;
        showToast('<i data-lucide="check-circle-2" class="lucide-i"></i> განახლდა');
        closeModal();
        loadLeads();
    } catch (e) {
        showToast('შეცდომა: ' + e.message, 'error');
    }
}

async function editClient(id) {
    openModalLoading('<i data-lucide="pencil" class="lucide-i"></i> კლიენტის რედაქტირება');
    const { data: c } = await client.from('clients').select('*').eq('id', id).single();
    if (!c) { showToast('კლიენტი ვერ მოიძებნა', 'error'); return; }
    openModal('<i data-lucide="pencil" class="lucide-i"></i> კლიენტის რედაქტირება', `
        <div style="max-height:65vh;overflow-y:auto;padding-right:6px">${_clientFormBody(c)}</div>
        <button class="btn btn-primary" onclick="updateClient('${id}')" style="width:100%;margin-top:14px"><i data-lucide="save" class="lucide-i"></i> ${t("btn_update")}</button>
    `);
    if (window.lucide) try { window.lucide.createIcons(); } catch(e) {}
}

async function updateClient(id) {
    const data = _readClientForm();
    if (!data.first_name || !data.phone) { showToast('სახელი და ტელეფონი აუცილებელია', 'error'); return; }
    try {
        const { error } = await client.from('clients').update(data).eq('id', id);
        if (error) throw error;
        showToast('კლიენტი განახლდა', 'success');
        closeModal();
        if (typeof loadClients === 'function') loadClients();
    } catch (e) {
        showToast('შეცდომა: ' + (e.message || e), 'error');
    }
}

async function editDeal(id) {
    openModalLoading('<i data-lucide="pencil" class="lucide-i"></i> გარიგების რედაქტირება');
    const { data: d } = await client.from('deals').select('*').eq('id', id).single();
    if (!d) { showToast('გარიგება ვერ მოიძებნა', 'error'); return; }
    
    openModal('<i data-lucide="pencil" class="lucide-i"></i> გარიგების რედაქტირება', `
        <div class="form-group">
            <label class="form-label">სათაური <span class="req" style="color:#EF4444;font-weight:700">*</span></label>
            <input class="form-input" id="d-title" value="${escHtml(d.title || '')}">
        </div>
        <div class="form-row">
            <div class="form-group">
                <label class="form-label">${t("f_type")}</label>
                <select class="form-select" id="d-type">
                    <option value="SALE" ${d.deal_type === 'SALE' ? 'selected' : ''}>გაყიდვა</option>
                    <option value="RENT" ${d.deal_type === 'RENT' ? 'selected' : ''}>ქირა</option>
                </select>
            </div>
            <div class="form-group">
                <label class="form-label">${t("f_stage")}</label>
                <select class="form-select" id="d-stage">
                    ${['LEAD','QUALIFICATION','SHOWING','NEGOTIATION','DEPOSIT','CLOSED_WON','CLOSED_LOST'].map(s => 
                        `<option value="${s}" ${d.current_stage === s ? 'selected' : ''}>${s}</option>`
                    ).join('')}
                </select>
            </div>
        </div>
        <div class="form-row">
            <div class="form-group">
                <label class="form-label">${t('ef_asking_price','სავარაუდო ფასი ($)')}</label>
                <input class="form-input" id="d-price" type="number" value="${d.asking_price || ''}">
            </div>
            <div class="form-group">
                <label class="form-label">${t('ef_final_price','საბოლოო ფასი ($)')}</label>
                <input class="form-input" id="d-final" type="number" value="${d.final_price || ''}">
            </div>
        </div>
        <div style="background:var(--surface-2);border:1px solid #e8edf3;border-radius:10px;padding:12px;margin-bottom:14px">
            <div style="font-size:12px;font-weight:600;color:#475569;margin-bottom:8px"><i data-lucide="dollar-sign" class="lucide-i"></i> საკომისიო (CLOSED_WON-ზე ავტომატურად დაჯავშნდება)</div>
            <div class="form-row">
                <div class="form-group" style="margin-bottom:0">
                    <label class="form-label">${t('ef_agency_pct','სააგენტოს % (ფასის)')}</label>
                    <input class="form-input" id="d-commpct" type="number" step="0.1" value="${d.commission_percent || ''}" placeholder="მაგ: 3">
                </div>
                <div class="form-group" style="margin-bottom:0">
                    <label class="form-label">${t('ef_agent_commission_pct','აგენტის წილი % (საკომისიოს)')}</label>
                    <input class="form-input" id="d-split" type="number" step="1" value="${d.agent_split_percent != null ? d.agent_split_percent : 50}" placeholder="მაგ: 50">
                </div>
            </div>
            ${d.commission_generated_at ? '<div style="font-size:11px;color:#15803d;margin-top:8px"><i data-lucide="check-circle-2" class="lucide-i"></i> საკომისიო უკვე დაჯავშნულია</div>' : ''}
        </div>
        <button class="btn btn-primary" onclick="updateDeal('${id}')" style="width:100%"><i data-lucide="save" class="lucide-i"></i> ${t("btn_update")}</button>
    `);
}

async function updateDeal(id) {
    const title = document.getElementById('d-title').value.trim();
    if (!title) { showToast('სათაური აუცილებელია', 'error'); return; }
    
    try {
        const price = document.getElementById('d-price').value;
        const final_price = document.getElementById('d-final').value;
        const commPct = document.getElementById('d-commpct') ? document.getElementById('d-commpct').value : '';
        const split = document.getElementById('d-split') ? document.getElementById('d-split').value : '';
        const stage = document.getElementById('d-stage').value;

        const { error } = await client.from('deals').update({
            title: title,
            deal_type: document.getElementById('d-type').value,
            current_stage: stage,
            asking_price: price ? Number(price) : null,
            final_price: final_price ? Number(final_price) : null,
            commission_percent: commPct ? Number(commPct) : null,
            agent_split_percent: split ? Number(split) : null,
            stage_changed_at: new Date().toISOString()
        }).eq('id', id);

        if (error) throw error;

        // When a deal is won, book the commission + agency income (idempotent server-side)
        if (stage === 'CLOSED_WON') {
            try {
                const res = await fetch('/api/finance/commissions/generate', {
                    method: 'POST', credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ deal_id: id })
                });
                const j = await res.json();
                if (j.data && j.data.generated) {
                    showToast('<i data-lucide="check-circle-2" class="lucide-i"></i> საკომისიო დაჯავშნულია ($' + Math.round(j.data.agency_gross).toLocaleString() + ')');
                } else if (j.data && j.data.reason === 'no commission amount on deal') {
                    showToast('შეავსე სააგენტოს % რომ საკომისიო დაიჯავშნოს', 'error');
                }
            } catch (e) { /* non-fatal */ }
        }

        showToast('<i data-lucide="check-circle-2" class="lucide-i"></i> განახლდა');
        closeModal();
        loadDeals();
    } catch (e) {
        showToast('შეცდომა: ' + e.message, 'error');
    }
}

async function editListing(id) {
    openModalLoading('<i data-lucide="pencil" class="lucide-i"></i> ობიექტის რედაქტირება');
    const { data: l } = await client.from('listings').select('*').eq('id', id).single();
    if (!l) { showToast('ობიექტი ვერ მოიძებნა', 'error'); return; }
    
    openModal('<i data-lucide="pencil" class="lucide-i"></i> ობიექტის რედაქტირება', `
        <div style="font-size:11px;color:var(--text-muted);margin-bottom:12px;font-weight:600">ID: ${l.listing_number || l.listing_key || l.id?.slice(0,8)}</div>
        <div class="form-group">
            <label class="form-label">სათაური <span class="req" style="color:#EF4444;font-weight:700">*</span></label>
            <input class="form-input" id="lst-title" value="${escHtml(l.title || '')}">
        </div>
        <div class="form-row">
            <div class="form-group">
                <label class="form-label">${t('lf_deal_type','გარიგების ტიპი')}</label>
                <select class="form-select" id="lst-deal">
                    <option value="SALE" ${l.listing_type === 'SALE' ? 'selected' : ''}>იყიდება</option>
                    <option value="RENT" ${l.listing_type === 'RENT' ? 'selected' : ''}>ქირავდება</option>
                    <option value="DAILY_RENT" ${l.listing_type === 'DAILY_RENT' ? 'selected' : ''}>დღიური ქირა</option>
                </select>
            </div>
            <div class="form-group">
                <label class="form-label">${t('lf_property_type','ქონების ტიპი')}</label>
                <select class="form-select" id="lst-type">
                    <option value="RESIDENTIAL" ${l.property_type === 'RESIDENTIAL' ? 'selected' : ''}>საცხოვრებელი (ბინა)</option>
                    <option value="HOUSE" ${l.property_type === 'HOUSE' ? 'selected' : ''}>კერძო სახლი</option>
                    <option value="COMMERCIAL" ${l.property_type === 'COMMERCIAL' ? 'selected' : ''}>კომერციული</option>
                    <option value="LAND" ${l.property_type === 'LAND' ? 'selected' : ''}>მიწა</option>
                    <option value="HOTEL" ${l.property_type === 'HOTEL' ? 'selected' : ''}>სასტუმრო</option>
                    <option value="MULTI_FAMILY" ${l.property_type === 'MULTI_FAMILY' ? 'selected' : ''}>მრავალბინიანი</option>
                </select>
            </div>
        </div>
        <div class="form-row">
            <div class="form-group">
                <label class="form-label">ფასი ($) <span class="req" style="color:#EF4444;font-weight:700">*</span></label>
                <input class="form-input" id="lst-price" type="number" value="${l.list_price || ''}">
            </div>
            <div class="form-group">
                <label class="form-label">${t("f_status")}</label>
                <select class="form-select" id="lst-status">
                    <option value="ACTIVE" ${l.status === 'ACTIVE' ? 'selected' : ''}>აქტიური</option>
                    <option value="PENDING" ${l.status === 'PENDING' ? 'selected' : ''}>მოლოდინში</option>
                    <option value="SOLD" ${l.status === 'SOLD' ? 'selected' : ''}>გაყიდული</option>
                    <option value="RENTED" ${l.status === 'RENTED' ? 'selected' : ''}>გაქირავებული</option>
                    <option value="WITHDRAWN" ${l.status === 'WITHDRAWN' ? 'selected' : ''}>ამოღებული</option>
                </select>
            </div>
        </div>
        <div class="form-row">
            <div class="form-group">
                <label class="form-label">${t("f_area")} (მ²)</label>
                <input class="form-input" id="lst-area" type="number" value="${l.living_area || ''}">
            </div>
            <div class="form-group">
                <label class="form-label">${t('lf_rooms','ოთახები')}</label>
                <input class="form-input" id="lst-rooms" type="number" value="${l.bedrooms_total || ''}">
            </div>
        </div>

        <!-- ── შენობა და მდგომარეობა ── -->
        <div style="font-weight:700;font-size:13px;color:var(--brand);margin:14px 0 8px;padding-bottom:6px;border-bottom:1px solid var(--border)">${t('sec_building','შენობა და მდგომარეობა')}</div>
        <div class="form-row">
            <div class="form-group">
                <label class="form-label">${t('lf_bathrooms','სველი წერტილები')}</label>
                <input class="form-input" id="lst-bathrooms" type="number" min="0" value="${l.bathrooms || ''}">
            </div>
            <div class="form-group">
                <label class="form-label">${t('lf_balconies_count','აივნების რაოდენობა')}</label>
                <input class="form-input" id="lst-balconies" type="number" min="0" value="${l.balconies_count || ''}">
            </div>
        </div>
        <div class="form-row">
            <div class="form-group">
                <label class="form-label">${t('lf_floor','სართული')}</label>
                <input class="form-input" id="lst-floor" type="number" value="${l.floor || ''}">
            </div>
            <div class="form-group">
                <label class="form-label">${t('lf_total_floors','სართულების რაოდენობა')}</label>
                <input class="form-input" id="lst-total-floors" type="number" min="0" value="${l.total_floors || ''}">
            </div>
        </div>
        <div class="form-row">
            <div class="form-group">
                <label class="form-label">${t('lf_year_built','აშენების წელი')}</label>
                <input class="form-input" id="lst-year-built" type="number" value="${l.year_built || ''}">
            </div>
            <div class="form-group">
                <label class="form-label">${t('lf_ceiling_height','ჭერის სიმაღლე (მ)')}</label>
                <input class="form-input" id="lst-ceiling" type="number" step="0.1" value="${l.ceiling_height || ''}">
            </div>
        </div>
        <div class="form-row">
            <div class="form-group">
                <label class="form-label">${t('lf_building_material','შენობის მასალა')}</label>
                <select class="form-select" id="lst-material">
                    <option value="">—</option>
                    <option value="BLOCK" ${l.building_material==='BLOCK'?'selected':''}>${t('opt_block','ბლოკი')}</option>
                    <option value="BRICK" ${l.building_material==='BRICK'?'selected':''}>${t('opt_brick','აგური')}</option>
                    <option value="PANEL" ${l.building_material==='PANEL'?'selected':''}>${t('opt_panel','პანელური')}</option>
                    <option value="MONOLITH" ${l.building_material==='MONOLITH'?'selected':''}>${t('opt_monolith','მონოლითი')}</option>
                    <option value="WOOD" ${l.building_material==='WOOD'?'selected':''}>${t('opt_wood','ხის')}</option>
                    <option value="OTHER" ${l.building_material==='OTHER'?'selected':''}>${t('opt_other','სხვა')}</option>
                </select>
            </div>
            <div class="form-group">
                <label class="form-label">${t('lf_building_status','შენობის სტატუსი')}</label>
                <select class="form-select" id="lst-building-status">
                    <option value="">—</option>
                    <option value="NEW" ${l.building_status==='NEW'?'selected':''}>${t('opt_new_building','ახალი აშენებული')}</option>
                    <option value="OLD" ${l.building_status==='OLD'?'selected':''}>${t('opt_old_building','ძველი აშენებული')}</option>
                    <option value="UNDER_CONSTRUCTION" ${l.building_status==='UNDER_CONSTRUCTION'?'selected':''}>${t('opt_under_construction','მშენებარე')}</option>
                </select>
            </div>
        </div>
        <div class="form-group">
            <label class="form-label">${t('lf_renovation_status','მდგომარეობა / რემონტი')}</label>
            <select class="form-select" id="lst-renovation">
                <option value="">—</option>
                <option value="NEWLY_RENOVATED" ${l.renovation_status==='NEWLY_RENOVATED'?'selected':''}>${t('opt_newly_renovated','ახალი გარემონტებული')}</option>
                <option value="GOOD" ${l.renovation_status==='GOOD'?'selected':''}>${t('opt_good_condition','კარგ მდგომარეობაში')}</option>
                <option value="NEEDS_RENOVATION" ${l.renovation_status==='NEEDS_RENOVATION'?'selected':''}>${t('opt_needs_renovation','საჭიროებს რემონტს')}</option>
                <option value="BLACK_FRAME" ${l.renovation_status==='BLACK_FRAME'?'selected':''}>${t('opt_black_frame','შავი კარკასი')}</option>
                <option value="WHITE_FRAME" ${l.renovation_status==='WHITE_FRAME'?'selected':''}>${t('opt_white_frame','თეთრი კარკასი')}</option>
                <option value="GREEN_FRAME" ${l.renovation_status==='GREEN_FRAME'?'selected':''}>${t('opt_green_frame','მწვანე კარკასი')}</option>
            </select>
        </div>
        <div class="form-group">
            <label class="form-label">${t('lf_view_type','ხედი')}</label>
            <select class="form-select" id="lst-view">
                <option value="">—</option>
                <option value="SEA" ${l.view_type==='SEA'?'selected':''}>${t('opt_view_sea','ზღვაზე')}</option>
                <option value="MOUNTAIN" ${l.view_type==='MOUNTAIN'?'selected':''}>${t('opt_view_mountain','მთაზე')}</option>
                <option value="YARD" ${l.view_type==='YARD'?'selected':''}>${t('opt_view_yard','ეზოში')}</option>
                <option value="STREET" ${l.view_type==='STREET'?'selected':''}>${t('opt_view_street','ქუჩაზე')}</option>
                <option value="PARK" ${l.view_type==='PARK'?'selected':''}>${t('opt_view_park','პარკზე')}</option>
                <option value="OTHER" ${l.view_type==='OTHER'?'selected':''}>${t('opt_other','სხვა')}</option>
            </select>
        </div>

        <!-- ── კომუნიკაციები და სისტემები ── -->
        <div style="font-weight:700;font-size:13px;color:var(--brand);margin:14px 0 8px;padding-bottom:6px;border-bottom:1px solid var(--border)">${t('sec_systems','კომუნიკაციები და სისტემები')}</div>
        <div class="form-row">
            <div class="form-group">
                <label class="form-label">${t('lf_heating_type','გათბობა')}</label>
                <select class="form-select" id="lst-heating">
                    <option value="">—</option>
                    <option value="CENTRAL" ${l.heating_type==='CENTRAL'?'selected':''}>${t('opt_central','ცენტრალური')}</option>
                    <option value="INDIVIDUAL" ${l.heating_type==='INDIVIDUAL'?'selected':''}>${t('opt_individual','ინდივიდუალური')}</option>
                    <option value="FLOOR" ${l.heating_type==='FLOOR'?'selected':''}>${t('opt_floor_heating','იატაკის გათბობა')}</option>
                    <option value="NONE" ${l.heating_type==='NONE'?'selected':''}>${t('opt_none','არ არის')}</option>
                    <option value="OTHER" ${l.heating_type==='OTHER'?'selected':''}>${t('opt_other','სხვა')}</option>
                </select>
            </div>
            <div class="form-group">
                <label class="form-label">${t('lf_hot_water_type','ცხელი წყალი')}</label>
                <select class="form-select" id="lst-hotwater">
                    <option value="">—</option>
                    <option value="CENTRAL" ${l.hot_water_type==='CENTRAL'?'selected':''}>${t('opt_central','ცენტრალური')}</option>
                    <option value="BOILER" ${l.hot_water_type==='BOILER'?'selected':''}>${t('opt_boiler','გამაცხელებელი / ავზი')}</option>
                    <option value="GAS_HEATER" ${l.hot_water_type==='GAS_HEATER'?'selected':''}>${t('opt_gas_heater','გაზის გამაცხელებელი')}</option>
                    <option value="NONE" ${l.hot_water_type==='NONE'?'selected':''}>${t('opt_none','არ არის')}</option>
                </select>
            </div>
        </div>
        <div class="form-group">
            <label class="form-label">${t('lf_furniture_status','ავეჯი')}</label>
            <select class="form-select" id="lst-furniture">
                <option value="">—</option>
                <option value="FULL" ${l.furniture_status==='FULL'?'selected':''}>${t('opt_full_furniture','სრულად ავეჯით')}</option>
                <option value="PARTIAL" ${l.furniture_status==='PARTIAL'?'selected':''}>${t('opt_partial_furniture','ნაწილობრივ')}</option>
                <option value="NONE" ${l.furniture_status==='NONE'?'selected':''}>${t('opt_no_furniture','უავეჯოდ')}</option>
            </select>
        </div>

        <!-- ── კეთილმოწყობა ── -->
        <div style="font-weight:700;font-size:13px;color:var(--brand);margin:14px 0 8px;padding-bottom:6px;border-bottom:1px solid var(--border)">${t('sec_amenities','კეთილმოწყობა')}</div>
        <div style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:14px">
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:13px"><input type="checkbox" id="lst-elevator" ${l.has_elevator?'checked':''} style="accent-color:var(--brand)"> ${t('am_elevator','ლიფტი')}</label>
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:13px"><input type="checkbox" id="lst-ac" ${l.has_ac?'checked':''} style="accent-color:var(--brand)"> ${t('am_ac','კონდიციონერი')}</label>
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:13px"><input type="checkbox" id="lst-internet" ${l.has_internet?'checked':''} style="accent-color:var(--brand)"> ${t('am_internet','ინტერნეტი')}</label>
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:13px"><input type="checkbox" id="lst-tv" ${l.has_tv_cable?'checked':''} style="accent-color:var(--brand)"> ${t('am_tv','საკაბელო TV')}</label>
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:13px"><input type="checkbox" id="lst-alarm" ${l.has_alarm?'checked':''} style="accent-color:var(--brand)"> ${t('am_alarm','სიგნალიზაცია')}</label>
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:13px"><input type="checkbox" id="lst-storage" ${l.has_storage?'checked':''} style="accent-color:var(--brand)"> ${t('am_storage','სათავსო')}</label>
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:13px"><input type="checkbox" id="lst-fireplace" ${l.has_fireplace?'checked':''} style="accent-color:var(--brand)"> ${t('am_fireplace','ბუხარი')}</label>
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:13px"><input type="checkbox" id="lst-negotiable" ${l.is_negotiable?'checked':''} style="accent-color:var(--brand)"> ${t('lf_negotiable','ფასი შეთანხმებადია')}</label>
        </div>

        <!-- ── მედია ── -->
        <div style="font-weight:700;font-size:13px;color:var(--brand);margin:14px 0 8px;padding-bottom:6px;border-bottom:1px solid var(--border)">${t('sec_media','მედია')}</div>
        <div class="form-row">
            <div class="form-group">
                <label class="form-label">${t('lf_video_url','ვიდეო ტური (ლინკი)')}</label>
                <input class="form-input" id="lst-video-url" value="${escHtml(l.video_url || '')}">
            </div>
            <div class="form-group">
                <label class="form-label">${t('lf_virtual_tour_url','3D / ვირტუალური ტური (ლინკი)')}</label>
                <input class="form-input" id="lst-tour-url" value="${escHtml(l.virtual_tour_url || '')}">
            </div>
        </div>
        <div class="form-row">
            <div class="form-group">
                <label class="form-label">${t("f_district")}</label>
                <input class="form-input" id="lst-district" value="${escHtml(l.district || '')}">
            </div>
            <div class="form-group">
                <label class="form-label">${t('ef_land_area','მიწის ფართი (მ²)')}</label>
                <input class="form-input" id="lst-land-area" type="number" value="${l.land_area || ''}">
            </div>
        </div>
        <div class="form-group">
            <label class="form-label">${t('ef_cadastral_code','საკადასტრო კოდი')}</label>
            <input class="form-input" id="lst-cadastral" value="${escHtml(l.cadastral_code || '')}" placeholder="01.10.05.001.001">
        </div>
        <div class="form-group">
            <label class="form-label">${t('lf_description','აღწერა / კომენტარი')}</label>
            <textarea class="form-textarea" id="lst-desc" rows="3">${escHtml(l.description || '')}</textarea>
        </div>
        <div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:12px">
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px">
                <input type="checkbox" id="lst-exclusive" ${l.is_exclusive ? 'checked' : ''} style="accent-color:var(--brand)">
                <span><strong style="color:var(--brand)">★ ექსკლუზიური</strong></span>
            </label>
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px">
                <input type="checkbox" id="lst-vacation" ${l.is_vacation_home ? 'checked' : ''} style="accent-color:var(--brand)">
                <span>სააგარაკე</span>
            </label>
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px">
                <input type="checkbox" id="lst-parking" ${l.parking_available ? 'checked' : ''} style="accent-color:var(--brand)">
                <span>პარკინგი</span>
            </label>
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px">
                <input type="checkbox" id="lst-pool" ${l.has_pool ? 'checked' : ''} style="accent-color:var(--brand)">
                <span>აუზი</span>
            </label>
        </div>
        <div class="form-group">
            <label class="form-label"><i data-lucide="camera" class="lucide-i"></i> ფოტოები — ახლის დამატება</label>
            <div class="photo-upload" id="photo-upload">
                <input type="file" id="photo-input" accept="image/*" multiple>
                <div class="photo-upload-icon"><i data-lucide="camera" class="lucide-i"></i></div>
                <div class="photo-upload-text">დააჭირე ან ჩააგდე ფოტოები</div>
                <div class="photo-upload-hint">JPG, PNG • მაქს. 10MB თითო</div>
            </div>
            <div class="photo-previews" id="photo-previews"></div>
        </div>
        <div style="display:flex;gap:8px">
            <button class="btn btn-primary" onclick="updateListing('${id}')" style="flex:1"><i data-lucide="save" class="lucide-i"></i> ${t("btn_update")}</button>
        </div>
    `);
    setupPhotoUpload();
}

async function updateListing(id) {
    const title = document.getElementById('lst-title').value.trim();
    const price = document.getElementById('lst-price').value;
    if (!title || !price) { showToast('სათაური და ფასი აუცილებელია', 'error'); return; }
    
    try {
        const area = document.getElementById('lst-area').value;
        const rooms = document.getElementById('lst-rooms').value;
        const cadastral = document.getElementById('lst-cadastral').value.trim();
        const landArea = document.getElementById('lst-land-area')?.value;
        const desc = document.getElementById('lst-desc')?.value.trim() || null;
        const priceNum = Number(price);
        const landAreaNum = landArea ? Number(landArea) : null;
        const gV = (id) => document.getElementById(id)?.value || null;
        const gN = (id) => { const v = document.getElementById(id)?.value; return v ? Number(v) : null; };
        const gC = (id) => document.getElementById(id)?.checked ? 1 : 0;
        
        const { error } = await client.from('listings').update({
            title: title,
            listing_type: document.getElementById('lst-deal').value,
            property_type: document.getElementById('lst-type').value,
            list_price: priceNum,
            living_area: area ? Number(area) : null,
            bedrooms_total: rooms ? Number(rooms) : null,
            district: document.getElementById('lst-district').value.trim() || null,
            status: document.getElementById('lst-status').value,
            cadastral_code: cadastral || null,
            description: desc,
            land_area: landAreaNum,
            is_exclusive: document.getElementById('lst-exclusive')?.checked ? 1 : 0,
            is_vacation_home: document.getElementById('lst-vacation')?.checked ? 1 : 0,
            parking_available: document.getElementById('lst-parking')?.checked ? 1 : 0,
            has_pool: document.getElementById('lst-pool')?.checked ? 1 : 0,
            price_per_sqm: (landAreaNum && priceNum) ? priceNum / landAreaNum : null,
            bathrooms: gN('lst-bathrooms'),
            total_area: gN('lst-area'),
            floor: gN('lst-floor'),
            total_floors: gN('lst-total-floors'),
            year_built: gN('lst-year-built'),
            ceiling_height: gN('lst-ceiling'),
            balconies_count: gN('lst-balconies'),
            building_material: gV('lst-material'),
            building_status: gV('lst-building-status'),
            renovation_status: gV('lst-renovation'),
            view_type: gV('lst-view'),
            heating_type: gV('lst-heating'),
            hot_water_type: gV('lst-hotwater'),
            furniture_status: gV('lst-furniture'),
            has_elevator: gC('lst-elevator'),
            has_ac: gC('lst-ac'),
            has_internet: gC('lst-internet'),
            has_tv_cable: gC('lst-tv'),
            has_alarm: gC('lst-alarm'),
            has_storage: gC('lst-storage'),
            has_fireplace: gC('lst-fireplace'),
            is_negotiable: gC('lst-negotiable'),
            video_url: (document.getElementById('lst-video-url')?.value || '').trim() || null,
            virtual_tour_url: (document.getElementById('lst-tour-url')?.value || '').trim() || null,
        }).eq('id', id);
        
        if (error) throw error;

        // Upload any newly added photos. Keep the existing primary photo if there is one;
        // only let a new photo become primary when the listing has none yet.
        if (typeof selectedPhotos !== 'undefined' && selectedPhotos.length > 0) {
            let hasPhotos = false;
            try {
                const { data: existing } = await client.from('property_images').select('id').eq('listing_id', id).limit(1);
                hasPhotos = !!(existing && existing.length);
            } catch(e) {}
            await uploadPhotos(id, !hasPhotos);
        }

        showToast('<i data-lucide="check-circle-2" class="lucide-i"></i> განახლდა');
        closeModal();
        loadListings();
        if (currentPage === 'map') refreshMapMarkers();
    } catch (e) {
        showToast('შეცდომა: ' + e.message, 'error');
    }
}

async function viewListing(id) {
    const { data: l } = await client
        .from('listings')
        .select('*, property_images(*)')
        .eq('id', id)
        .single();
    
    if (!l) return;
    
    const photos = l.property_images || [];
    const photosHtml = photos.length > 0 
        ? `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:16px">
             ${photos.map(p => `<img src="${p.image_url}" style="width:100%;aspect-ratio:1;object-fit:cover;border-radius:8px">`).join('')}
           </div>`
        : '';
    
    openModal('<i data-lucide="eye" class="lucide-i"></i> ობიექტის ნახვა', `
        ${photosHtml}
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;flex-wrap:wrap">
            <span style="background:var(--brand);color:white;padding:3px 10px;border-radius:6px;font-size:13px;font-weight:700">${l.listing_number || l.listing_key || 'N/A'}</span>
            ${l.is_exclusive ? '<span style="background:var(--warning-soft);color:#92400E;padding:3px 10px;border-radius:6px;font-size:12px;font-weight:700">★ ექსკლუზიური</span>' : ''}
            ${l.is_vacation_home ? '<span style="background:var(--success-soft);color:#065F46;padding:3px 10px;border-radius:6px;font-size:12px">🏡 სააგარაკე</span>' : ''}
        </div>
        <div style="font-size:20px;font-weight:700;margin-bottom:6px">${escHtml(l.title)}</div>
        <div style="color:var(--brand);font-size:24px;font-weight:700;margin-bottom:16px">$${(l.list_price || 0).toLocaleString()}</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;font-size:14px">
            <div><strong>ID:</strong> ${l.listing_number || l.listing_key || '—'}</div>
            <div><strong>ტიპი:</strong> ${l.property_type}</div>
            <div><strong>ფართი:</strong> ${(l.living_area || l.total_area) ? (l.living_area || l.total_area) + ' მ²' : '—'}</div>
            <div><strong>ოთახები:</strong> ${l.bedrooms_total || '—'}</div>
            <div><strong>უბანი:</strong> ${escHtml(l.district || '—')}</div>
            <div><strong>სტატუსი:</strong> ${l.status}</div>
            ${l.land_area ? `<div><strong>მიწა:</strong> ${l.land_area} მ²</div>` : ''}
            ${l.parking_available ? `<div><strong>პარკინგი:</strong> ${l.parking_type || 'კი'}</div>` : ''}
            ${l.land_coefficient ? `<div><strong>კოეფ.:</strong> ${l.land_coefficient}</div>` : ''}
            ${l.functional_zone ? `<div><strong>ფ. ზონა:</strong> ${l.functional_zone}</div>` : ''}
            ${l.land_road_type ? `<div><strong>გზა:</strong> ${l.land_road_type}</div>` : ''}
            ${l.price_per_sqm ? `<div><strong>მ² ფასი:</strong> $${Math.round(l.price_per_sqm)}</div>` : ''}
            ${l.bathrooms ? `<div><strong>${t('lf_bathrooms','სველი წერტილები')}:</strong> ${l.bathrooms}</div>` : ''}
            ${l.floor ? `<div><strong>${t('lf_floor','სართული')}:</strong> ${l.floor}${l.total_floors ? ' / ' + l.total_floors : ''}</div>` : ''}
            ${l.year_built ? `<div><strong>${t('lf_year_built','აშენების წელი')}:</strong> ${l.year_built}</div>` : ''}
            ${l.ceiling_height ? `<div><strong>${t('lf_ceiling_height','ჭერის სიმაღლე')}:</strong> ${l.ceiling_height} მ</div>` : ''}
            ${l.balconies_count ? `<div><strong>${t('lf_balconies_count','აივნები')}:</strong> ${l.balconies_count}</div>` : ''}
            ${l.building_material ? `<div><strong>${t('lf_building_material','მასალა')}:</strong> ${t('opt_' + l.building_material.toLowerCase(), l.building_material)}</div>` : ''}
            ${l.building_status ? `<div><strong>${t('lf_building_status','სტატუსი')}:</strong> ${l.building_status}</div>` : ''}
            ${l.renovation_status ? `<div><strong>${t('lf_renovation_status','მდგომარეობა')}:</strong> ${l.renovation_status}</div>` : ''}
            ${l.view_type ? `<div><strong>${t('lf_view_type','ხედი')}:</strong> ${l.view_type}</div>` : ''}
            ${l.heating_type ? `<div><strong>${t('lf_heating_type','გათბობა')}:</strong> ${l.heating_type}</div>` : ''}
            ${l.hot_water_type ? `<div><strong>${t('lf_hot_water_type','ცხელი წყალი')}:</strong> ${l.hot_water_type}</div>` : ''}
            ${l.furniture_status ? `<div><strong>${t('lf_furniture_status','ავეჯი')}:</strong> ${l.furniture_status}</div>` : ''}
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:12px">
            ${l.has_elevator ? `<span style="background:var(--info-soft);color:#3730A3;padding:3px 9px;border-radius:6px;font-size:12px">${t('am_elevator','ლიფტი')}</span>` : ''}
            ${l.has_ac ? `<span style="background:var(--info-soft);color:#3730A3;padding:3px 9px;border-radius:6px;font-size:12px">${t('am_ac','კონდიციონერი')}</span>` : ''}
            ${l.has_internet ? `<span style="background:var(--info-soft);color:#3730A3;padding:3px 9px;border-radius:6px;font-size:12px">${t('am_internet','ინტერნეტი')}</span>` : ''}
            ${l.has_tv_cable ? `<span style="background:var(--info-soft);color:#3730A3;padding:3px 9px;border-radius:6px;font-size:12px">${t('am_tv','საკაბელო TV')}</span>` : ''}
            ${l.has_alarm ? `<span style="background:var(--info-soft);color:#3730A3;padding:3px 9px;border-radius:6px;font-size:12px">${t('am_alarm','სიგნალიზაცია')}</span>` : ''}
            ${l.has_storage ? `<span style="background:var(--info-soft);color:#3730A3;padding:3px 9px;border-radius:6px;font-size:12px">${t('am_storage','სათავსო')}</span>` : ''}
            ${l.has_fireplace ? `<span style="background:var(--info-soft);color:#3730A3;padding:3px 9px;border-radius:6px;font-size:12px">${t('am_fireplace','ბუხარი')}</span>` : ''}
            ${l.is_negotiable ? `<span style="background:var(--warning-soft);color:#92400E;padding:3px 9px;border-radius:6px;font-size:12px">${t('lf_negotiable','ფასი შეთანხმებადია')}</span>` : ''}
        </div>
        ${(l.video_url || l.virtual_tour_url) ? `<div style="display:flex;gap:10px;margin-top:10px;font-size:13px">
            ${l.video_url ? `<a href="${escHtml(l.video_url)}" target="_blank" style="color:var(--brand)"><i data-lucide="video" class="lucide-i"></i> ${t('lf_video_url','ვიდეო ტური')}</a>` : ''}
            ${l.virtual_tour_url ? `<a href="${escHtml(l.virtual_tour_url)}" target="_blank" style="color:var(--brand)"><i data-lucide="view" class="lucide-i"></i> ${t('lf_virtual_tour_url','3D ტური')}</a>` : ''}
        </div>` : ''}
        ${l.description ? `<div style="margin-top:14px;padding:12px;background:var(--surface-2);border-radius:8px;font-size:13px;color:var(--text);line-height:1.6">${escHtml(l.description)}</div>` : ''}
        ${l.land_communications ? (() => { try { const c = JSON.parse(l.land_communications); return c.length ? `<div style="margin-top:10px;font-size:13px"><strong>კომუნიკაციები:</strong> ${c.join(', ')}</div>` : ''; } catch(e){ return ''; } })() : ''}
        <div style="margin-top:16px;padding-top:16px;border-top:1px solid #eee;color:var(--text-muted);font-size:13px">
            დაემატა: ${formatDate(l.created_at)}
        </div>
        <div style="display:flex;gap:8px;margin-top:16px;flex-wrap:wrap">
            ${(typeof _canExport !== 'function' || _canExport()) ? `<button class="btn btn-secondary" style="flex:1;min-width:120px" onclick="downloadListingPDF('${l.id}')"><i data-lucide="file-text" class="lucide-i"></i> PDF</button>
            <button class="btn btn-primary" style="flex:1;min-width:160px;background:#25D366;border-color:#25D366" onclick="sendListingPDFViaWhatsApp('${l.id}')"><i data-lucide="send" class="lucide-i"></i> WhatsApp-ით გაგზავნა</button>` : ''}
        </div>
    `);
}

async function editAgent(id) {
    const { data: u } = await client.from('users').select('*').eq('id', id).single();
    if (!u) { showToast('აგენტი ვერ მოიძებნა', 'error'); return; }
    
    const isOwn = u.id === currentUser.id;
    const canChangeRole = currentUser.role === 'FOUNDER' && !isOwn;
    
    openModal('<i data-lucide="pencil" class="lucide-i"></i> აგენტის რედაქტირება', `
        ${isOwn ? '<div style="background:var(--info-soft);color:#1a6dc4;padding:10px;border-radius:8px;margin-bottom:16px;font-size:13px"><i data-lucide="lightbulb" class="lucide-i"></i> ეს შენი პროფილია</div>' : ''}
        <div class="form-row">
            <div class="form-group">
                <label class="form-label">სახელი <span class="req" style="color:#EF4444;font-weight:700">*</span></label>
                <input class="form-input" id="a-fname" value="${escHtml(u.first_name || '')}">
            </div>
            <div class="form-group">
                <label class="form-label">${t("f_lastname")}</label>
                <input class="form-input" id="a-lname" value="${escHtml(u.last_name || '')}">
            </div>
        </div>
        <div class="form-group">
            <label class="form-label">${t("f_email")}</label>
            <input class="form-input" type="email" value="${escHtml(u.email || '')}" disabled>
            <div style="font-size:11px;color:var(--text-muted);margin-top:4px">ემეილი ვერ შეიცვლება</div>
        </div>
        <div class="form-group">
            <label class="form-label">${t("f_phone")}</label>
            <input class="form-input" id="a-phone" value="${escHtml(u.phone || '')}">
        </div>
        <div class="form-row">
            <div class="form-group">
                <label class="form-label">${t('ef_role','როლი')} ${canChangeRole ? '' : t('ef_view_only','(მხოლოდ ნახვა)')}</label>
                <select class="form-select" id="a-role" ${canChangeRole ? '' : 'disabled'}>
                    <option value="FOUNDER" ${u.role === 'FOUNDER' ? 'selected' : ''}><i data-lucide="briefcase-business" class="lucide-i"></i> დამფუძნებელი</option>
                    <option value="MANAGER" ${u.role === 'MANAGER' ? 'selected' : ''}><i data-lucide="bar-chart-3" class="lucide-i"></i> მენეჯერი</option>
                    <option value="AGENT" ${u.role === 'AGENT' ? 'selected' : ''}><i data-lucide="home" class="lucide-i"></i> აგენტი</option>
                    <option value="BROKER" ${u.role === 'BROKER' ? 'selected' : ''}><i data-lucide="briefcase" class="lucide-i"></i> ბროკერი</option>
                    <option value="MARKETING" ${u.role === 'MARKETING' ? 'selected' : ''}><i data-lucide="megaphone" class="lucide-i"></i> მარკეტინგი</option>
                    <option value="LAWYER" ${u.role === 'LAWYER' ? 'selected' : ''}><i data-lucide="scale" class="lucide-i"></i> იურისტი</option>
                    <option value="ACCOUNTANT" ${u.role === 'ACCOUNTANT' ? 'selected' : ''}><i data-lucide="dollar-sign" class="lucide-i"></i> ბუღალტერი</option>
                </select>
            </div>
            <div class="form-group">
                <label class="form-label">${t("f_status")}</label>
                <select class="form-select" id="a-active" ${isOwn ? 'disabled' : ''}>
                    <option value="true" ${u.is_active ? 'selected' : ''}><i data-lucide="check-circle-2" class="lucide-i"></i> აქტიური</option>
                    <option value="false" ${!u.is_active ? 'selected' : ''}><i data-lucide="x" class="lucide-i"></i> გათიშული</option>
                </select>
            </div>
        </div>
        <div class="form-group">
            <label class="form-label">${t('ef_bio','ბიო')}</label>
            <textarea class="form-textarea" id="a-bio" rows="3">${u.bio || ''}</textarea>
        </div>
        <div class="form-group">
            <label class="form-label">${t('ef_license_no','ლიცენზიის ნომერი')}</label>
            <input class="form-input" id="a-license" value="${u.license_number || ''}">
        </div>
        <button class="btn btn-primary" onclick="updateAgent('${id}', ${canChangeRole}, ${isOwn})" style="width:100%"><i data-lucide="save" class="lucide-i"></i> ${t("btn_update")}</button>
    `);
}

async function updateAgent(id, canChangeRole, isOwn) {
    const fname = document.getElementById('a-fname').value.trim();
    if (!fname) { showToast('სახელი აუცილებელია', 'error'); return; }
    
    try {
        const updates = {
            first_name: fname,
            last_name: document.getElementById('a-lname').value.trim() || null,
            phone: document.getElementById('a-phone').value.trim() || null,
            bio: document.getElementById('a-bio').value.trim() || null,
            license_number: document.getElementById('a-license').value.trim() || null
        };
        
        if (canChangeRole) {
            updates.role = document.getElementById('a-role').value;
        }
        
        if (!isOwn) {
            updates.is_active = document.getElementById('a-active').value === 'true';
        }
        
        const { error } = await client.from('users').update(updates).eq('id', id);
        
        if (error) throw error;
        showToast('<i data-lucide="check-circle-2" class="lucide-i"></i> განახლდა');
        closeModal();
        loadAgents();
        
        // Update local current user if editing self
        if (isOwn) {
            Object.assign(currentUser, updates);
            setupUI();
        }
    } catch (e) {
        showToast('შეცდომა: ' + e.message, 'error');
    }
}

async function loadLeads() {
    const { data, error } = await client
        .from('leads')
        .select('*')
        .order('created_at', { ascending: false });
    
    const container = document.getElementById('leads-list');
    
    if (!data || data.length === 0) {
        container.innerHTML = `
            <div class="empty">
                <div class="empty-icon"><i data-lucide="inbox" class="lucide-i"></i></div>
                <div class="empty-title" data-i18n="empty_leads">ლიდები ჯერ არ გაქვს</div>
                <div class="empty-sub">${t("empty_leads_sub")}</div>
            </div>
        `;
        return;
    }
    
    container.innerHTML = `
        <table>
            <thead>
                <tr>
                    <th>#</th>
                    <th>${t("th_name")}</th>
                    <th>${t("th_phone")}</th>
                    <th>${t("th_email")}</th>
                    <th>${t("th_source")}</th>
                    <th>${t("th_status")}</th>
                    <th>${t("th_temp")}</th>
                    <th>${t("th_date")}</th>
                    <th></th>
                </tr>
            </thead>
            <tbody>
                ${data.map(l => `
                    <tr>
                        <td>${l.lead_number || '—'}</td>
                        <td><strong>${escHtml(l.full_name || '—')}</strong></td>
                        <td>${escHtml(l.phone || '—')}</td>
                        <td>${escHtml(l.email || '—')}</td>
                        <td>${escHtml(l.source)}</td>
                        <td><span class="badge badge-new">${l.status || 'NEW'}</span></td>
                        <td><span class="badge badge-${(l.temperature || 'cold').toLowerCase()}">${l.temperature || 'COLD'}</span></td>
                        <td>${formatDate(l.created_at)}</td>
                        <td>
                            <div class="action-buttons">
                                <button class="action-btn" onclick="openMsgModal('lead','${l.id}','${escHtml((l.phone||'').replace(/'/g,''))}','${escHtml((l.email||'').replace(/'/g,''))}','${escHtml((l.full_name||'').replace(/'/g,''))}')" title="შეტყობინება" style="color:#25D366"><i data-lucide="message-circle" class="lucide-i"></i></button>
                                <button class="action-btn edit" onclick="editLead('${l.id}')" title="რედაქტირება"><i data-lucide="pencil" class="lucide-i"></i></button>
                                <button class="action-btn delete" onclick="deleteRecord('leads', '${l.id}', '${escHtml((l.full_name || l.phone || 'ლიდი').replace(/'/g, ''))}')" title="წაშლა"><i data-lucide="trash-2" class="lucide-i"></i></button>
                            </div>
                        </td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
    if (window.lucide) try { window.lucide.createIcons(); } catch(e) {}
}

