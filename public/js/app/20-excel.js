// ═══════════════════════════════════════════════════════
// <i data-lucide="inbox" class="lucide-i"></i> EXCEL EXPORT
// ═══════════════════════════════════════════════════════
async function exportData(table) {
    if (typeof hasPermission === 'function' && !hasPermission('export_data','can_create')) { if (typeof showToast==='function') showToast('ექსპორტი გათიშულია თქვენი როლისთვის', 'error'); return; }
    const { data, error } = await client.from(table).select('*');
    
    if (error || !data || data.length === 0) {
        showToast('მონაცემები არ არის ექსპორტისთვის', 'error');
        return;
    }
    
    // Translate to Georgian columns
    const translatedData = data.map(row => translateRowToGeorgian(table, row));
    
    // Create workbook
    const ws = XLSX.utils.json_to_sheet(translatedData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, getTableName(table));
    
    // Auto-width columns
    const colWidths = Object.keys(translatedData[0] || {}).map(k => ({ wch: Math.max(k.length, 15) }));
    ws['!cols'] = colWidths;
    
    // Download — filename includes date + time so repeated exports don't collide
    const stamp = new Date().toISOString().slice(0, 16).replace('T', '_').replace(/:/g, '-');
    const fileName = `warm_${table}_${stamp}.xlsx`;
    XLSX.writeFile(wb, fileName);
    
    showToast(`<i data-lucide="check-circle-2" class="lucide-i"></i> ${data.length} ჩანაწერი ექსპორტირდა`);
}

// ═══════════════════════════════════════════════════════
// <i data-lucide="clipboard-list" class="lucide-i"></i> EXCEL TEMPLATE DOWNLOAD
// ═══════════════════════════════════════════════════════
// Shared by the single-table template download AND the universal (multi-sheet)
// template — one definition per table, reused everywhere so they never drift apart.
const TEMPLATE_ROWS = {
    leads: [
        {
            'ზზზზ': '',
            'MyHome': '17789495',
            'მეპატრონე': '555123456 გიორგი',
            'თანხა': '550$',
            'დაკლება/თან': '50$',
            'გარიგების ტიპი': 'გაყიდვა',
            'უბანი': 'ვაკე',
            'მისამართი': 'ჭავჭავაძის გამზ. 10',
            'სახლის ტიპი': 'ბინა',
            'ოთახი': '2',
            'საძინებელი': '1',
            'სართული': '5',
            'SS.GE': '28764626',
            'კომენტარი': 'დარეკვა ხვალ',
            'DK': ''
        }
    ],
    clients: [
        {
            'სახელი': 'გიორგი',
            'გვარი': 'მელაძე',
            'ტელეფონი': '+995 5XX XXX XXX',
            'ემეილი': 'example@email.com',
            'ბიუჯეტი_მინ': 100000,
            'ბიუჯეტი_მაქს': 200000
        }
    ],
    listings: [
        {
            'სათაური': 'მაგ: 3 ოთახიანი ბინა ვაკეში',
            'ტიპი': 'RESIDENTIAL / COMMERCIAL / LAND',
            'ფასი_USD': 150000,
            'ფართი_მ2': 80,
            'ოთახები': 3,
            'უბანი': 'ვაკე',
            'სტატუსი': 'ACTIVE / PENDING / SOLD'
        }
    ]
};

function downloadTemplate(table) {
    if (!TEMPLATE_ROWS[table]) {
        showToast('შაბლონი არ არის', 'error');
        return;
    }
    
    const ws = XLSX.utils.json_to_sheet(TEMPLATE_ROWS[table]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, getTableName(table));
    
    const colWidths = Object.keys(TEMPLATE_ROWS[table][0]).map(k => ({ wch: Math.max(k.length, 25) }));
    ws['!cols'] = colWidths;
    
    XLSX.writeFile(wb, `warm_template_${table}.xlsx`);
    showToast('<i data-lucide="check-circle-2" class="lucide-i"></i> შაბლონი ჩამოიტვირთა');
}

// ═══════════════════════════════════════════════════════
// <i data-lucide="send" class="lucide-i"></i> EXCEL IMPORT
// ═══════════════════════════════════════════════════════
function openImportModal(table) {
    // Gated by the "Excel იმპორტი" permission (➕ create toggle in Permissions).
    if (typeof hasPermission === 'function' && !hasPermission('excel_import', 'can_create')) {
        if (typeof showToast === 'function') showToast('Excel იმპორტი გათიშულია თქვენი როლისთვის', 'error');
        return;
    }
    const labels = {
        leads: 'ლიდების',
        clients: 'კლიენტების',
        listings: 'ობიექტების'
    };
    
    openModal(`<i data-lucide="send" class="lucide-i"></i> ${labels[table]} Import`, `
        <div style="background:#fffae5;color:#a06800;padding:14px;border-radius:8px;margin-bottom:16px;font-size:13px">
            <i data-lucide="alert-triangle" class="lucide-i"></i> <strong>ინსტრუქცია:</strong>
            <ul style="margin:8px 0 0 20px;line-height:1.6">
                <li>ჯერ ჩამოტვირთე "შაბლონი" ღილაკით</li>
                <li>შეავსე Excel-ი მონაცემებით</li>
                <li>ატვირთე აქ — ჩაიწერება ბაზაში</li>
            </ul>
        </div>
        
        <div class="photo-upload" id="excel-upload" style="cursor:pointer">
            <input type="file" id="excel-file" accept=".xlsx,.xls,.csv" style="display:none">
            <div class="photo-upload-icon"><i data-lucide="bar-chart-3" class="lucide-i"></i></div>
            <div class="photo-upload-text">დააჭირე ან ჩააგდე Excel ფაილი</div>
            <div class="photo-upload-hint">.xlsx, .xls, .csv ფორმატები</div>
        </div>
        
        <div id="import-preview" style="margin-top:16px;display:none">
            <div style="font-weight:600;margin-bottom:8px"><i data-lucide="bar-chart-3" class="lucide-i"></i> პრევიუ:</div>
            <div id="import-preview-content" style="background:var(--surface-2);border-radius:8px;padding:12px;max-height:200px;overflow-y:auto;font-size:12px"></div>
            <button class="btn btn-primary" id="import-confirm" onclick="importData('${table}')" style="width:100%;margin-top:12px;display:none"><i data-lucide="save" class="lucide-i"></i> ჩაწერე ბაზაში</button>
        </div>
    `);
    
    setTimeout(() => {
        const upload = document.getElementById('excel-upload');
        const input = document.getElementById('excel-file');
        
        upload.addEventListener('click', () => input.click());
        upload.addEventListener('dragover', (e) => { e.preventDefault(); upload.classList.add('dragover'); });
        upload.addEventListener('dragleave', () => upload.classList.remove('dragover'));
        upload.addEventListener('drop', (e) => {
            e.preventDefault();
            upload.classList.remove('dragover');
            handleExcelFile(e.dataTransfer.files[0], table);
        });
        input.addEventListener('change', (e) => handleExcelFile(e.target.files[0], table));
    }, 100);
}

let importedRows = [];

function handleExcelFile(file, table) {
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const data = new Uint8Array(e.target.result);
            const wb = XLSX.read(data, { type: 'array' });
            const ws = wb.Sheets[wb.SheetNames[0]];
            const rows = XLSX.utils.sheet_to_json(ws);
            
            if (rows.length === 0) {
                showToast('ფაილი ცარიელია', 'error');
                return;
            }
            
            importedRows = rows;
            
            // Preview
            const preview = document.getElementById('import-preview');
            const content = document.getElementById('import-preview-content');
            const confirmBtn = document.getElementById('import-confirm');
            
            const previewRows = rows.slice(0, 5);
            const headers = Object.keys(previewRows[0]);
            
            content.innerHTML = `
                <div style="margin-bottom:8px"><strong><i data-lucide="bar-chart-3" class="lucide-i"></i> ${rows.length} ჩანაწერი</strong></div>
                <table style="width:100%;font-size:11px;border-collapse:collapse">
                    <thead>
                        <tr>${headers.map(h => `<th style="padding:4px;background:#fff;border:1px solid #e5e5e7;text-align:left">${h}</th>`).join('')}</tr>
                    </thead>
                    <tbody>
                        ${previewRows.map(r => `<tr>${headers.map(h => `<td style="padding:4px;border:1px solid #e5e5e7">${r[h] || ''}</td>`).join('')}</tr>`).join('')}
                    </tbody>
                </table>
                ${rows.length > 5 ? `<div style="margin-top:8px;color:#888">... და კიდევ ${rows.length - 5} ჩანაწერი</div>` : ''}
            `;
            
            preview.style.display = 'block';
            confirmBtn.style.display = 'block';
            
        } catch (err) {
            showToast('ფაილის წაკითხვის შეცდომა', 'error');
            console.error(err);
        }
    };
    reader.readAsArrayBuffer(file);
}

// Shared by the single-table import (importData) and the universal multi-sheet
// import (importUniversalData) — translates one raw Excel row into the right
// table's shape, attributes it to the current user, and inserts it.
async function insertTranslatedRow(table, row) {
    const dbRow = translateRowFromGeorgian(table, row);
    if (table === 'leads' || table === 'clients') {
        dbRow.company_id = currentUser.company_id;
    }
    if (table === 'leads') {
        dbRow.agent_id = currentUser.id;
        dbRow.created_by_id = currentUser.id;
    }
    if (table === 'listings') {
        dbRow.agent_id = currentUser.id;
    }
    if (table === 'clients') {
        dbRow.primary_agent_id = currentUser.id;
    }
    return client.from(table).insert(dbRow);
}

async function importData(table) {
    if (importedRows.length === 0) return;
    if (typeof hasPermission === 'function' && !hasPermission('excel_import', 'can_create')) {
        if (typeof showToast === 'function') showToast('Excel იმპორტი გათიშულია', 'error');
        return;
    }
    
    const btn = document.getElementById('import-confirm');
    btn.disabled = true;
    btn.textContent = 'მუშავდება...';
    
    let successCount = 0;
    let errorCount = 0;
    const errors = [];
    
    for (const row of importedRows) {
        try {
            const { error } = await insertTranslatedRow(table, row);
            if (error) {
                errorCount++;
                errors.push(error.message);
            } else {
                successCount++;
            }
        } catch (e) {
            errorCount++;
            errors.push(e.message);
        }
    }
    
    if (successCount > 0) {
        showToast(`<i data-lucide="check-circle-2" class="lucide-i"></i> ${successCount} ჩანაწერი დაემატა` + (errorCount ? ` (${errorCount} შეცდომა)` : ''));
    } else {
        showToast(`<i data-lucide="x" class="lucide-i"></i> შეცდომა: ${errors[0] || 'ყველა ჩანაწერი ვერ ჩაიწერა'}`, 'error');
    }
    
    closeModal();
    importedRows = [];
    
    // Reload current page
    if (currentPage === 'leads') loadLeads();
    if (currentPage === 'clients') loadClients();
    if (currentPage === 'listings') loadListings();
}

