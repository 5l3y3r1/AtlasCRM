// ═══ Universal Excel import page (one workbook → owners + clients + properties) ═══
// Reuses TEMPLATE_ROWS / translateRowFromGeorgian / insertTranslatedRow from 20-excel.js
// so the field-mapping logic lives in exactly one place, not duplicated here.

const UNI_SHEETS = {
    leads:    { label: 'მფლობელები', table: 'leads',    aliases: ['მფლობელები', 'owners', 'owner', 'leads', 'ლიდები'] },
    clients:  { label: 'კლიენტები',  table: 'clients',  aliases: ['კლიენტები', 'clients', 'client'] },
    listings: { label: 'ობიექტები',  table: 'listings', aliases: ['ობიექტები', 'listings', 'properties', 'property'] },
};

function downloadUniversalTemplate() {
    const wb = XLSX.utils.book_new();
    for (const key of ['leads', 'clients', 'listings']) {
        const rows = TEMPLATE_ROWS[key];
        const ws = XLSX.utils.json_to_sheet(rows);
        ws['!cols'] = Object.keys(rows[0]).map(k => ({ wch: Math.max(k.length, 22) }));
        XLSX.utils.book_append_sheet(wb, ws, UNI_SHEETS[key].label);
    }
    XLSX.writeFile(wb, 'warm_universal_template.xlsx');
    showToast('<i data-lucide="check-circle-2" class="lucide-i"></i> უნივერსალური შაბლონი ჩამოიტვირთა');
}

let _uniParsed = null; // { leads: [rows], clients: [rows], listings: [rows] }

async function loadUniversalImportPage() {
    const page = document.getElementById('page-universal-import');
    if (!page) return;
    const canUse = typeof hasPermission === 'function' ? hasPermission('excel_import', 'can_create') : true;
    const body = document.getElementById('uni-import-body');
    _uniParsed = null;

    if (!canUse) {
        body.innerHTML = `<div class="card" style="padding:24px;text-align:center;color:var(--text-muted)">Excel იმპორტი გათიშულია თქვენი როლისთვის</div>`;
        return;
    }

    body.innerHTML = `
        <div class="card" style="padding:20px;margin-bottom:16px">
            <div style="background:var(--warning-soft);color:#a06800;padding:14px;border-radius:8px;margin-bottom:16px;font-size:13px">
                <i data-lucide="alert-triangle" class="lucide-i"></i> <strong>ინსტრუქცია:</strong>
                <ul style="margin:8px 0 0 20px;line-height:1.6">
                    <li>ჩამოტვირთე ერთიანი შაბლონი — მასში 3 ფურცელია: <strong>მფლობელები</strong>, <strong>კლიენტები</strong>, <strong>ობიექტები</strong></li>
                    <li>შეავსე რომელიც გჭირდება (შეგიძლია მხოლოდ ერთი, ორი ან სამივე ფურცელი)</li>
                    <li>ატვირთე ერთი ფაილი — თითოეული ფურცელი თავის ცხრილში ჩაიწერება ავტომატურად</li>
                </ul>
            </div>
            <button class="btn btn-secondary" style="width:100%;margin-bottom:14px" onclick="downloadUniversalTemplate()"><i data-lucide="clipboard-list" class="lucide-i"></i> ერთიანი შაბლონის ჩამოტვირთვა</button>

            <div class="photo-upload" id="uni-upload" style="cursor:pointer">
                <input type="file" id="uni-file" accept=".xlsx,.xls" style="display:none">
                <div class="photo-upload-icon"><i data-lucide="upload" class="lucide-i"></i></div>
                <div class="photo-upload-text">დააჭირე ან ჩააგდე Excel ფაილი</div>
                <div class="photo-upload-hint">.xlsx, .xls — ერთი ფაილი, რამდენიმე ფურცელი</div>
            </div>
        </div>
        <div id="uni-preview"></div>
    `;

    setTimeout(() => {
        const upload = document.getElementById('uni-upload');
        const input = document.getElementById('uni-file');
        if (!upload || !input) return;
        upload.addEventListener('click', () => input.click());
        upload.addEventListener('dragover', (e) => { e.preventDefault(); upload.classList.add('dragover'); });
        upload.addEventListener('dragleave', () => upload.classList.remove('dragover'));
        upload.addEventListener('drop', (e) => { e.preventDefault(); upload.classList.remove('dragover'); handleUniversalFile(e.dataTransfer.files[0]); });
        input.addEventListener('change', (e) => handleUniversalFile(e.target.files[0]));
        if (window.lucide) try { window.lucide.createIcons(); } catch (err) {}
    }, 50);
}

function _uniMatchSheet(sheetName) {
    const norm = String(sheetName || '').trim().toLowerCase();
    for (const key of Object.keys(UNI_SHEETS)) {
        if (UNI_SHEETS[key].aliases.some(a => a.toLowerCase() === norm)) return key;
    }
    return null;
}

function handleUniversalFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const data = new Uint8Array(e.target.result);
            const wb = XLSX.read(data, { type: 'array' });
            _uniParsed = { leads: [], clients: [], listings: [] };
            const foundNames = { leads: [], clients: [], listings: [] };
            const unmatched = [];

            wb.SheetNames.forEach(name => {
                const key = _uniMatchSheet(name);
                const rows = XLSX.utils.sheet_to_json(wb.Sheets[name]);
                if (key) { _uniParsed[key] = _uniParsed[key].concat(rows); foundNames[key].push(name); }
                else if (rows.length) unmatched.push(name);
            });

            const preview = document.getElementById('uni-preview');
            const total = _uniParsed.leads.length + _uniParsed.clients.length + _uniParsed.listings.length;
            if (!total) {
                preview.innerHTML = `<div class="card" style="padding:16px;color:#dc2626">ვერცერთი ცნობილი ფურცელი ვერ მოიძებნა (მფლობელები / კლიენტები / ობიექტები). ფურცლის სახელები ფაილში: ${wb.SheetNames.join(', ')}</div>`;
                return;
            }
            preview.innerHTML = `
                <div class="card" style="padding:18px">
                    <div style="font-weight:700;margin-bottom:12px">ნაპოვნია ფაილში:</div>
                    ${['leads', 'clients', 'listings'].map(k => `
                        <div style="display:flex;justify-content:space-between;padding:10px 14px;background:var(--bg-hover,#f9f9fb);border-radius:8px;margin-bottom:8px">
                            <span>${UNI_SHEETS[k].label}${foundNames[k].length ? ` <span style="color:var(--text-muted);font-size:12px">(${foundNames[k].join(', ')})</span>` : ''}</span>
                            <strong style="color:${_uniParsed[k].length ? '#16a34a' : '#9ca3af'}">${_uniParsed[k].length ? _uniParsed[k].length + ' ჩანაწერი' : 'არ არის'}</strong>
                        </div>`).join('')}
                    ${unmatched.length ? `<div style="color:#a06800;font-size:12px;margin-top:6px">გამოტოვებული ფურცლები (ვერ ამოვიცანი): ${unmatched.join(', ')}</div>` : ''}
                    <button class="btn btn-primary" id="uni-confirm" onclick="importUniversalData()" style="width:100%;margin-top:14px"><i data-lucide="save" class="lucide-i"></i> ჩაწერე ბაზაში (${total})</button>
                </div>
            `;
            if (window.lucide) try { window.lucide.createIcons(); } catch (err) {}
        } catch (err) {
            showToast('ფაილის წაკითხვის შეცდომა', 'error');
            console.error(err);
        }
    };
    reader.readAsArrayBuffer(file);
}

async function importUniversalData() {
    if (!_uniParsed) return;
    if (typeof hasPermission === 'function' && !hasPermission('excel_import', 'can_create')) {
        if (typeof showToast === 'function') showToast('Excel იმპორტი გათიშულია', 'error');
        return;
    }
    const btn = document.getElementById('uni-confirm');
    if (btn) { btn.disabled = true; btn.textContent = 'მუშავდება...'; }

    const results = {};
    for (const key of ['leads', 'clients', 'listings']) {
        const rows = _uniParsed[key] || [];
        let ok = 0, fail = 0;
        for (const row of rows) {
            try {
                const { error } = await insertTranslatedRow(UNI_SHEETS[key].table, row);
                error ? fail++ : ok++;
            } catch (e) { fail++; }
        }
        results[key] = { ok, fail, total: rows.length };
    }

    const summary = ['leads', 'clients', 'listings']
        .filter(k => results[k].total > 0)
        .map(k => `${UNI_SHEETS[k].label}: ${results[k].ok}${results[k].fail ? ' (' + results[k].fail + ' შეცდომა)' : ''}`)
        .join(' · ');
    showToast(`<i data-lucide="check-circle-2" class="lucide-i"></i> იმპორტი დასრულდა — ${summary}`);

    _uniParsed = null;
    document.getElementById('uni-preview').innerHTML =
        `<div class="card" style="padding:16px;color:#16a34a;font-weight:600">დასრულდა: ${summary || 'ჩანაწერი არ ყოფილა'}</div>`;
}
