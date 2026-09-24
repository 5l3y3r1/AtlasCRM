// ═══════════════════════════════════════════════════════
// <i data-lucide="folder" class="lucide-i"></i> DEAL DOCUMENTS
// ═══════════════════════════════════════════════════════
async function loadDocuments() {
    const dealFilter = document.getElementById('doc-deal-filter')?.value;
    
    let query = client
        .from('deal_documents')
        .select('*, deals(title, deal_number), users!uploaded_by(first_name, last_name)')
        .order('created_at', { ascending: false });
    
    if (dealFilter) query = query.eq('deal_id', dealFilter);
    
    const { data } = await query;
    
    // Load deals for filter
    if (!document.getElementById('doc-deal-filter').dataset.loaded) {
        const { data: deals } = await client.from('deals').select('id, title, deal_number');
        const select = document.getElementById('doc-deal-filter');
        select.innerHTML = '<option value="" data-i18n="law_all_deals">ყველა გარიგება</option>' +
            (deals || []).map(d => `<option value="${d.id}">${d.deal_number || ''} — ${escHtml(d.title)}</option>`).join('');
        select.dataset.loaded = 'true';
        select.onchange = () => loadDocuments();
    }
    
    const container = document.getElementById('documents-list');
    
    if (!data || data.length === 0) {
        container.innerHTML = `
            <div class="empty">
                <div class="empty-icon"><i data-lucide="folder" class="lucide-i"></i></div>
                <div class="empty-title">${t("empty_docs")}</div>
                <div class="empty-sub">დააჭირე "<i data-lucide="send" class="lucide-i"></i> ფაილის ატვირთვა"</div>
            </div>
        `;
        return;
    }
    
    container.innerHTML = `
        <table>
            <thead>
                <tr>
                    <th>${t("th_file")}</th>
                    <th>${t("th_type")}</th>
                    <th>${t("th_deal")}</th>
                    <th>ვინ ატვირთა</th>
                    <th>${t("th_status")}</th>
                    <th>${t("th_date")}</th>
                    <th></th>
                </tr>
            </thead>
            <tbody>
                ${data.map(d => {
                    const ext = (d.file_url || '').split('.').pop()?.toLowerCase() || '';
                    const icon = getFileIcon(ext);
                    const isViewable = ['pdf', 'jpg', 'jpeg', 'png', 'gif'].includes(ext);
                    
                    return `
                    <tr>
                        <td>
                            <div style="display:flex;align-items:center;gap:8px">
                                <span style="font-size:20px">${icon}</span>
                                <div>
                                    <strong>${d.document_name || d.file_name || 'უსახელო'}</strong>
                                    <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase">${ext}</div>
                                </div>
                            </div>
                        </td>
                        <td>${getDocumentTypeName(d.document_type)}</td>
                        <td>${d.deals?.title || '—'}</td>
                        <td>${d.users?.first_name || ''} ${d.users?.last_name || ''}</td>
                        <td><span class="badge ${getDocStatusClass(d.status)}">${getDocStatusName(d.status)}</span></td>
                        <td>${formatDate(d.uploaded_at || d.created_at)}</td>
                        <td>
                            <div class="action-buttons">
                                ${d.file_url ? `<button class="action-btn view" onclick="previewDocument('${d.file_url}','${ext}','${(d.document_name||d.file_name||'document').replace(/'/g,'').replace(/`/g,'')}')" title="გადახედვა"><i data-lucide="eye" class="lucide-i"></i></button>` : ''}
                                ${d.file_url ? `<button class="action-btn edit" onclick="downloadFile('${d.file_url}', '${(d.document_name || 'document').replace(/'/g, '')}.${ext}')" title="ჩამოტვირთვა">⬇</button>` : ''}
                                ${d.status === 'UPLOADED' ? `<button class="action-btn view" onclick="verifyDocument('${d.id}', true)" title="დადასტურება"><i data-lucide="check" class="lucide-i"></i></button>` : ''}
                                <button class="action-btn delete" onclick="deleteRecord('deal_documents', '${d.id}', '${(d.document_name || 'დოკუმენტი').replace(/'/g, '')}')" title="წაშლა"><i data-lucide="trash-2" class="lucide-i"></i></button>
                            </div>
                        </td>
                    </tr>
                `}).join('')}
            </tbody>
        </table>
    `;
}

function getFileIcon(ext) {
    const icons = {
        'pdf': '<i data-lucide="book" class="lucide-i"></i>',
        'doc': '<i data-lucide="book" class="lucide-i"></i>', 'docx': '<i data-lucide="book" class="lucide-i"></i>',
        'xls': '<i data-lucide="book" class="lucide-i"></i>', 'xlsx': '<i data-lucide="book" class="lucide-i"></i>',
        'jpg': '<i data-lucide="image" class="lucide-i"></i>', 'jpeg': '<i data-lucide="image" class="lucide-i"></i>', 'png': '<i data-lucide="image" class="lucide-i"></i>', 'gif': '<i data-lucide="image" class="lucide-i"></i>',
        'zip': '<i data-lucide="archive" class="lucide-i"></i>', 'rar': '<i data-lucide="archive" class="lucide-i"></i>',
        'txt': '<i data-lucide="file-text" class="lucide-i"></i>'
    };
    return icons[ext] || '<i data-lucide="file-text" class="lucide-i"></i>';
}

async function downloadFile(url, filename) {
    try {
        const response = await fetch(url);
        const blob = await response.blob();
        const blobUrl = URL.createObjectURL(blob);
        
        const link = document.createElement('a');
        link.href = blobUrl;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(blobUrl);
        
        showToast('⬇ ჩამოიტვირთა');
    } catch (e) {
        // Fallback - open in new tab
        window.open(url, '_blank');
    }
}

function getDocumentTypeName(t) {
    return {
        'CADASTRAL_EXTRACT': '<i data-lucide="landmark" class="lucide-i"></i> საკადასტრო ამონაწერი',
        'OWNERSHIP_PROOF': '<i data-lucide="key" class="lucide-i"></i> საკუთრების დამადასტურებელი',
        'ID_COPY': '🆔 ID ბარათი',
        'BANK_STATEMENT': '<i data-lucide="landmark" class="lucide-i"></i> ბანკის ცნობა',
        'TAX_CLEARANCE': '<i data-lucide="dollar-sign" class="lucide-i"></i> საგადასახადო ცნობა',
        'MORTGAGE_RELEASE': '<i data-lucide="scroll-text" class="lucide-i"></i> იპოთეკის გასვლა',
        'POWER_OF_ATTORNEY': '<i data-lucide="pen-line" class="lucide-i"></i> მინდობილობა',
        'OTHER': '<i data-lucide="file-text" class="lucide-i"></i> სხვა'
    }[t] || t;
}

function getDocStatusName(s) {
    return {
        'REQUIRED': '<i data-lucide="alert-circle" class="lucide-i"></i> საჭიროა',
        'UPLOADED': '<i data-lucide="send" class="lucide-i"></i> ატვირთული',
        'VERIFIED': '<i data-lucide="check-circle-2" class="lucide-i"></i> დადასტურებული',
        'REJECTED': '<i data-lucide="x" class="lucide-i"></i> უარყოფილი'
    }[s] || '<i data-lucide="send" class="lucide-i"></i> ატვირთული';
}

function getDocStatusClass(s) {
    if (s === 'VERIFIED') return 'badge-active';
    if (s === 'REJECTED') return '';
    if (s === 'UPLOADED' || !s) return 'badge-warm';
    return 'badge-new';
}

async function openDocumentUpload() {
    const { data: deals } = await client.from('deals').select('id, title, deal_number');
    
    openModal('<i data-lucide="send" class="lucide-i"></i> დოკუმენტის ატვირთვა', `
        <div class="form-group">
            <label class="form-label">გარიგება <span class="req" style="color:#EF4444;font-weight:700">*</span></label>
            <select class="form-select" id="doc-deal">
                <option value="">აირჩიე გარიგება...</option>
                ${(deals || []).map(d => `<option value="${d.id}">${d.deal_number || ''} — ${escHtml(d.title)}</option>`).join('')}
            </select>
        </div>
        <div class="form-row">
            <div class="form-group">
                <label class="form-label">დოკუმენტის ტიპი <span class="req" style="color:#EF4444;font-weight:700">*</span></label>
                <select class="form-select" id="doc-type">
                    <option value="CADASTRAL_EXTRACT"><i data-lucide="landmark" class="lucide-i"></i> საკადასტრო ამონაწერი</option>
                    <option value="OWNERSHIP_PROOF"><i data-lucide="key" class="lucide-i"></i> საკუთრების დამადასტურებელი</option>
                    <option value="ID_COPY">🆔 ID ბარათი</option>
                    <option value="BANK_STATEMENT"><i data-lucide="landmark" class="lucide-i"></i> ბანკის ცნობა</option>
                    <option value="TAX_CLEARANCE"><i data-lucide="dollar-sign" class="lucide-i"></i> საგადასახადო ცნობა</option>
                    <option value="MORTGAGE_RELEASE"><i data-lucide="scroll-text" class="lucide-i"></i> იპოთეკის გასვლა</option>
                    <option value="POWER_OF_ATTORNEY"><i data-lucide="pen-line" class="lucide-i"></i> მინდობილობა</option>
                    <option value="OTHER"><i data-lucide="file-text" class="lucide-i"></i> სხვა</option>
                </select>
            </div>
            <div class="form-group">
                <label class="form-label">${t("f_name")}</label>
                <input class="form-input" id="doc-name" placeholder="მაგ: გიორგის ID">
            </div>
        </div>
        
        <div class="form-group">
            <label class="form-label">ფაილი <span class="req" style="color:#EF4444;font-weight:700">*</span></label>
            <div class="photo-upload" id="doc-upload" style="cursor:pointer">
                <input type="file" id="doc-file-input" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" style="display:none">
                <div class="photo-upload-icon"><i data-lucide="folder" class="lucide-i"></i></div>
                <div class="photo-upload-text">დააჭირე ან ჩააგდე</div>
                <div class="photo-upload-hint" id="doc-file-name">PDF, DOC, DOCX, JPG, PNG • მაქს. 20MB</div>
            </div>
        </div>
        
        <button class="btn btn-primary" onclick="uploadDocument()" id="doc-upload-btn" style="width:100%"><i data-lucide="send" class="lucide-i"></i> ატვირთვა</button>
    `);
    
    setTimeout(() => {
        const upload = document.getElementById('doc-upload');
        const input = document.getElementById('doc-file-input');
        
        upload.addEventListener('click', () => input.click());
        upload.addEventListener('dragover', (e) => { e.preventDefault(); upload.classList.add('dragover'); });
        upload.addEventListener('dragleave', () => upload.classList.remove('dragover'));
        upload.addEventListener('drop', (e) => {
            e.preventDefault();
            upload.classList.remove('dragover');
            const file = e.dataTransfer.files[0];
            if (file) handleDocumentFile(file);
        });
        input.addEventListener('change', (e) => {
            if (e.target.files[0]) handleDocumentFile(e.target.files[0]);
        });
    }, 100);
}

let selectedDocumentFile = null;

function handleDocumentFile(file) {
    if (file.size > 20 * 1024 * 1024) {
        showToast('ფაილი ძალიან დიდია (max 20MB)', 'error');
        return;
    }
    
    selectedDocumentFile = file;
    document.getElementById('doc-file-name').innerHTML = '<i data-lucide="check-circle-2" class="lucide-i"></i> ' + file.name + ' (' + (file.size / 1024).toFixed(0) + ' KB)';
    
    // Auto-fill name if empty
    const nameInput = document.getElementById('doc-name');
    if (!nameInput.value) {
        nameInput.value = file.name.replace(/\.[^.]+$/, '');
    }
}

async function uploadDocument() {
    const dealId = document.getElementById('doc-deal').value;
    if (!dealId) { showToast('აირჩიე გარიგება', 'error'); return; }
    if (!selectedDocumentFile) { showToast('აირჩიე ფაილი', 'error'); return; }
    
    const btn = document.getElementById('doc-upload-btn');
    btn.disabled = true;
    btn.textContent = 'იტვირთება...';
    
    try {
        const docType = document.getElementById('doc-type').value;
        const docName = document.getElementById('doc-name').value.trim() || selectedDocumentFile.name;
        
        const ext = selectedDocumentFile.name.split('.').pop().toLowerCase();
        const fileName = `${dealId}/${Date.now()}_${docType}.${ext}`;
        
        const { data: uploadData, error: uploadError } = await client.storage
            .from('documents')
            .upload(fileName, selectedDocumentFile);
        
        if (uploadError) throw uploadError;
        
        const fileUrl = uploadData?.path;
        if (!fileUrl) throw new Error('Upload returned no path');
        
        const { error } = await client.from('deal_documents').insert({
            deal_id: dealId,
            document_type: docType,
            document_name: docName,
            file_name: selectedDocumentFile.name,
            file_url: fileUrl,
            size_bytes: selectedDocumentFile.size,
            status: 'UPLOADED',
            uploaded_by: currentUser.id
        });
        
        if (error) throw error;
        
        showToast('<i data-lucide="check-circle-2" class="lucide-i"></i> დოკუმენტი ატვირთულია');
        selectedDocumentFile = null;
        closeModal();
        loadDocuments();
    } catch (e) {
        showToast('შეცდომა: ' + e.message, 'error');
        btn.disabled = false;
        btn.innerHTML = '<i data-lucide="send" class="lucide-i"></i> ატვირთვა';
    }
}

async function verifyDocument(id, approved) {
    try {
        const { error } = await client.from('deal_documents').update({
            status: approved ? 'VERIFIED' : 'REJECTED',
            verified_by: currentUser.id,
            verified_at: new Date().toISOString()
        }).eq('id', id);
        
        if (error) throw error;
        showToast(approved ? '<i data-lucide="check-circle-2" class="lucide-i"></i> დადასტურდა' : '<i data-lucide="x" class="lucide-i"></i> უარყოფილია');
        loadDocuments();
    } catch (e) {
        showToast('შეცდომა: ' + e.message, 'error');
    }
}

function setupLawyerTabs() {
    document.querySelectorAll('.tab-lawyer').forEach(tab => {
        tab.onclick = () => switchLawyerTab(tab.dataset.lawyertab);
    });
}

function switchLawyerTab(name) {
    document.querySelectorAll('.tab-lawyer').forEach(t => {
        t.classList.remove('active');
        t.style.background = 'transparent';
        t.style.color = '#666';
        t.style.boxShadow = 'none';
    });
    
    const activeTab = document.querySelector(`.tab-lawyer[data-lawyertab="${name}"]`);
    if (activeTab) {
        activeTab.classList.add('active');
        activeTab.style.background = 'white';
        activeTab.style.color = 'var(--brand)';
        activeTab.style.boxShadow = '0 2px 6px rgba(0,0,0,0.08)';
    }
    
    document.getElementById('lawyer-tab-contracts').style.display = name === 'contracts' ? 'block' : 'none';
    document.getElementById('lawyer-tab-documents').style.display = name === 'documents' ? 'block' : 'none';
    
    if (name === 'documents') loadDocuments();
    if (name === 'contracts') loadContracts();
}

// ── Preview modal, shared by Documents and Contracts. Referenced by the
// existing loadDocuments() rows above but never actually defined anywhere in
// this codebase — clicking "view" on a document has always thrown a
// ReferenceError until now. ─────────────────────────────────────────────
function previewDocument(url, ext, name) {
    const isImage = /^(jpg|jpeg|png|gif|webp)$/i.test(ext || '');
    const isPdf   = /^pdf$/i.test(ext || '');
    const body = isImage
        ? `<div style="text-align:center"><img src="${url}" style="max-width:100%;max-height:70vh;border-radius:8px"></div>`
        : isPdf
            ? `<iframe src="${url}" style="width:100%;height:70vh;border:none;border-radius:8px"></iframe>`
            : `<div class="empty"><div class="empty-icon"><i data-lucide="file" class="lucide-i"></i></div><div class="empty-title">გადახედვა მიუწვდომელია</div><div class="empty-sub">ეს ფაილის ტიპი არ არის მხარდაჭერილი გადახედვისთვის</div></div>`;
    openModal(escHtml(name || 'დოკუმენტი'), `
        ${body}
        <div style="margin-top:14px;display:flex;gap:8px">
            <a href="${url}" target="_blank" class="btn btn-secondary" style="flex:1;text-align:center;text-decoration:none"><i data-lucide="external-link" class="lucide-i"></i> ახალ ჩანართში გახსნა</a>
            <button class="btn btn-secondary" onclick="closeModal()">დახურვა</button>
        </div>
    `);
    if (window.lucide) try { window.lucide.createIcons(); } catch(e){}
}

// ═══════════════════════════════════════════════════════════════════════
// CONTRACTS — per-deal checklist: DRAFT → SENT → SIGNED (+ file once signed)
// ═══════════════════════════════════════════════════════════════════════

function getContractTypeName(t) {
    return { SALE: 'ნასყიდობა', RENT: 'იჯარა', EXCLUSIVITY: 'ექსკლუზივი', OTHER: 'სხვა' }[t] || (t || 'სხვა');
}
function getContractStatusName(s) {
    return {
        DRAFT:  '<i data-lucide="file-edit" class="lucide-i"></i> დრაფტი',
        SENT:   '<i data-lucide="send" class="lucide-i"></i> გაგზავნილი',
        SIGNED: '<i data-lucide="check-circle-2" class="lucide-i"></i> ხელმოწერილი',
    }[s] || '<i data-lucide="file-edit" class="lucide-i"></i> დრაფტი';
}
function getContractStatusClass(s) {
    if (s === 'SIGNED') return 'badge-active';
    if (s === 'SENT') return 'badge-warm';
    return 'badge-new';
}

async function loadContracts() {
    const filterEl = document.getElementById('contract-deal-filter');
    if (filterEl && !filterEl.dataset.loaded) {
        const { data: deals } = await client.from('deals').select('id, title, deal_number');
        filterEl.innerHTML = '<option value="">ყველა გარიგება</option>' +
            (deals || []).map(d => `<option value="${d.id}">${d.deal_number || ''} — ${escHtml(d.title)}</option>`).join('');
        filterEl.dataset.loaded = 'true';
        filterEl.onchange = () => loadContracts();
    }

    let query = client.from('contracts').select('*, deals(title, deal_number)').order('created_at', { ascending: false });
    if (filterEl?.value) query = query.eq('deal_id', filterEl.value);
    const { data } = await query;

    const container = document.getElementById('contracts-list');
    if (!container) return;

    if (!data || data.length === 0) {
        container.innerHTML = `
            <div class="empty">
                <div class="empty-icon"><i data-lucide="file-signature" class="lucide-i"></i></div>
                <div class="empty-title">ხელშეკრულებები არ არის</div>
                <div class="empty-sub">დააჭირე „+ ახალი ხელშეკრულება"</div>
            </div>`;
        if (window.lucide) try { window.lucide.createIcons(); } catch(e){}
        return;
    }

    container.innerHTML = `
        <table class="data-table">
            <thead><tr><th>№</th><th>სათაური</th><th>ტიპი</th><th>გარიგება</th><th>სტატუსი</th><th>თარიღი</th><th></th></tr></thead>
            <tbody>
                ${data.map(c => {
                    const safeTitle = (c.title || 'ხელშეკრულება').replace(/'/g, '');
                    return `
                    <tr>
                        <td style="font-family:monospace;font-size:12px">${c.contract_number || '—'}</td>
                        <td><strong>${escHtml(c.title || '')}</strong></td>
                        <td>${getContractTypeName(c.contract_type)}</td>
                        <td>${c.deals ? escHtml(c.deals.title) : '—'}</td>
                        <td><span class="badge ${getContractStatusClass(c.status)}">${getContractStatusName(c.status)}</span></td>
                        <td>${c.status === 'SIGNED' && c.signed_at ? formatDate(c.signed_at) : formatDate(c.created_at)}</td>
                        <td>
                            <div class="action-buttons">
                                ${c.pdf_url ? `<button class="action-btn view" onclick="previewDocument('${c.pdf_url}','pdf','${safeTitle}')" title="გადახედვა"><i data-lucide="eye" class="lucide-i"></i></button>` : ''}
                                ${c.status === 'DRAFT' ? `<button class="action-btn edit" onclick="markContractSent('${c.id}')" title="გაგზავნილად მონიშვნა"><i data-lucide="send" class="lucide-i"></i></button>` : ''}
                                ${c.status !== 'SIGNED' ? `<button class="action-btn view" onclick="openSignContract('${c.id}')" title="ხელმოწერილად მონიშვნა"><i data-lucide="check-circle-2" class="lucide-i"></i></button>` : ''}
                                <button class="action-btn delete" onclick="deleteRecord('contracts', '${c.id}', '${safeTitle}')" title="წაშლა"><i data-lucide="trash-2" class="lucide-i"></i></button>
                            </div>
                        </td>
                    </tr>`;
                }).join('')}
            </tbody>
        </table>`;
    if (window.lucide) try { window.lucide.createIcons(); } catch(e){}
}

async function openAddContract() {
    const { data: deals } = await client.from('deals').select('id, title, deal_number');
    openModal('<i data-lucide="file-signature" class="lucide-i"></i> ახალი ხელშეკრულება', `
        <div class="form-group">
            <label class="form-label">გარიგება <span class="req" style="color:#EF4444;font-weight:700">*</span></label>
            <select class="form-select" id="contract-deal">
                <option value="">აირჩიე გარიგება...</option>
                ${(deals || []).map(d => `<option value="${d.id}">${d.deal_number || ''} — ${escHtml(d.title)}</option>`).join('')}
            </select>
        </div>
        <div class="form-row">
            <div class="form-group">
                <label class="form-label">ტიპი</label>
                <select class="form-select" id="contract-type">
                    <option value="SALE">ნასყიდობა</option>
                    <option value="RENT">იჯარა</option>
                    <option value="EXCLUSIVITY">ექსკლუზივი</option>
                    <option value="OTHER">სხვა</option>
                </select>
            </div>
            <div class="form-group">
                <label class="form-label">სათაური</label>
                <input class="form-input" id="contract-title" placeholder="მაგ: ნასყიდობის ხელშეკრულება">
            </div>
        </div>
        <div class="form-group">
            <label class="form-label">ღირებულება</label>
            <input class="form-input" id="contract-value" type="number" placeholder="მაგ: 150000">
        </div>
        <button class="btn btn-primary" onclick="createContract()" id="contract-create-btn" style="width:100%"><i data-lucide="plus" class="lucide-i"></i> შექმნა</button>
    `);
}

async function createContract() {
    const dealId = document.getElementById('contract-deal').value;
    if (!dealId) { showToast('აირჩიე გარიგება', 'error'); return; }

    const btn = document.getElementById('contract-create-btn');
    btn.disabled = true;

    try {
        const contractType = document.getElementById('contract-type').value;
        const title = document.getElementById('contract-title').value.trim() || getContractTypeName(contractType) + ' ხელშეკრულება';
        const value = document.getElementById('contract-value').value;

        const { error } = await client.from('contracts').insert({
            deal_id: dealId,
            agent_id: currentUser.id,
            contract_type: contractType,
            title,
            contract_value: value ? Number(value) : null,
            currency: 'USD',
            status: 'DRAFT',
        });
        if (error) throw error;

        showToast('<i data-lucide="check-circle-2" class="lucide-i"></i> ხელშეკრულება შეიქმნა');
        closeModal();
        loadContracts();
    } catch (e) {
        showToast('შეცდომა: ' + e.message, 'error');
        btn.disabled = false;
    }
}

async function markContractSent(id) {
    showConfirm('გაგზავნა', 'ხელშეკრულება მონიშნულია როგორც გაგზავნილი?', async () => {
        const { error } = await client.from('contracts').update({ status: 'SENT' }).eq('id', id);
        if (error) { showToast('შეცდომა: ' + error.message, 'error'); return; }
        showToast('<i data-lucide="send" class="lucide-i"></i> გაგზავნილია');
        loadContracts();
    });
}

let selectedContractFile = null;
let signingContractId = null;

function openSignContract(id) {
    signingContractId = id;
    selectedContractFile = null;
    openModal('<i data-lucide="check-circle-2" class="lucide-i"></i> ხელმოწერილად მონიშვნა', `
        <div class="form-group">
            <label class="form-label">ხელმოწერილი ფაილი (არასავალდებულო)</label>
            <div class="photo-upload" id="contract-sign-upload" style="cursor:pointer">
                <input type="file" id="contract-sign-file-input" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" style="display:none">
                <div class="photo-upload-icon"><i data-lucide="folder" class="lucide-i"></i></div>
                <div class="photo-upload-text">დააჭირე ან ჩააგდე</div>
                <div class="photo-upload-hint" id="contract-sign-file-name">PDF, DOC, DOCX, JPG, PNG • მაქს. 20MB</div>
            </div>
        </div>
        <button class="btn btn-primary" onclick="confirmSignContract()" id="contract-sign-btn" style="width:100%"><i data-lucide="check-circle-2" class="lucide-i"></i> ხელმოწერილად მონიშვნა</button>
    `);
    setTimeout(() => {
        const upload = document.getElementById('contract-sign-upload');
        const input = document.getElementById('contract-sign-file-input');
        if (!upload || !input) return;
        upload.addEventListener('click', () => input.click());
        upload.addEventListener('dragover', (e) => { e.preventDefault(); upload.classList.add('dragover'); });
        upload.addEventListener('dragleave', () => upload.classList.remove('dragover'));
        upload.addEventListener('drop', (e) => {
            e.preventDefault();
            upload.classList.remove('dragover');
            const file = e.dataTransfer.files[0];
            if (file) handleContractSignFile(file);
        });
        input.addEventListener('change', (e) => {
            if (e.target.files[0]) handleContractSignFile(e.target.files[0]);
        });
    }, 100);
}

function handleContractSignFile(file) {
    if (file.size > 20 * 1024 * 1024) { showToast('ფაილი ძალიან დიდია (max 20MB)', 'error'); return; }
    selectedContractFile = file;
    document.getElementById('contract-sign-file-name').innerHTML = '<i data-lucide="check-circle-2" class="lucide-i"></i> ' + file.name;
}

async function confirmSignContract() {
    const btn = document.getElementById('contract-sign-btn');
    btn.disabled = true;
    try {
        const patch = { status: 'SIGNED', signed_at: new Date().toISOString() };
        if (selectedContractFile) {
            const ext = selectedContractFile.name.split('.').pop().toLowerCase();
            const { data: uploadData, error: uploadError } = await client.storage
                .from('documents')
                .upload(`contracts/${signingContractId}_${Date.now()}.${ext}`, selectedContractFile);
            if (uploadError) throw uploadError;
            if (uploadData?.path) patch.pdf_url = uploadData.path;
        }
        const { error } = await client.from('contracts').update(patch).eq('id', signingContractId);
        if (error) throw error;

        showToast('<i data-lucide="check-circle-2" class="lucide-i"></i> ხელმოწერილია');
        selectedContractFile = null;
        closeModal();
        loadContracts();
    } catch (e) {
        showToast('შეცდომა: ' + e.message, 'error');
        btn.disabled = false;
    }
}

