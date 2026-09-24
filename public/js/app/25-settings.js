// ═══════════════════════════════════════════════════════════════════════
// SETTINGS MODAL
// ═══════════════════════════════════════════════════════════════════════
async function openSettings() {
    // Close user menu if open
    document.getElementById('user-menu')?.classList.remove('open');

    // Populate company fields
    if (currentUser?.company_id) {
        const { data: co } = await client.from('companies').select('*').eq('id', currentUser.company_id).single();
        if (co) {
            document.getElementById('set-company-name').value    = co.name    || '';
            document.getElementById('set-company-email').value   = co.email   || '';
            document.getElementById('set-company-phone').value   = co.phone   || '';
            document.getElementById('set-company-address').value = co.address || '';
            // Reuse the row we just fetched rather than querying again.
            if (typeof renderCompanyLogo === 'function') renderCompanyLogo(co.logo_url);
        }
    }
    // Populate account fields
    document.getElementById('set-first-name').value  = currentUser?.first_name || '';
    document.getElementById('set-last-name').value   = currentUser?.last_name  || '';
    document.getElementById('set-user-phone').value  = currentUser?.phone      || '';
    document.getElementById('set-current-password').value = '';
    document.getElementById('set-new-password').value     = '';
    document.getElementById('set-confirm-password').value = '';

    highlightLangBtns();
    highlightThemeBtns();
    switchSettingsTab('company');
    document.getElementById('settings-modal').style.display = 'flex';
    if (window.lucide) try { window.lucide.createIcons(); } catch(e) {}
}

function closeSettings() {
    document.getElementById('settings-modal').style.display = 'none';
}

function switchSettingsTab(tab) {
    ['company','account','appearance','integrations'].forEach(t => {
        const el2 = document.getElementById('settings-' + t);
        if (el2) el2.style.display = (t === tab) ? 'block' : 'none';
        const btn = document.getElementById('stab-' + t);
        if (btn) btn.classList.toggle('active', t === tab);
    });
    if (tab === 'integrations') loadIntegrationsTab();
    if (window.lucide) try { window.lucide.createIcons(); } catch(e) {}
}

async function saveCompanySettings() {
    const payload = {
        name:    document.getElementById('set-company-name').value.trim(),
        email:   document.getElementById('set-company-email').value.trim(),
        phone:   document.getElementById('set-company-phone').value.trim(),
        address: document.getElementById('set-company-address').value.trim(),
    };
    if (!payload.name) { showToast('კომპანიის სახელი აუცილებელია', 'error'); return; }
    const { error } = await client.from('companies').update(payload).eq('id', currentUser.company_id);
    if (error) { showToast('შეცდომა: ' + error.message, 'error'); return; }
    showToast('<i data-lucide="check-circle-2" class="lucide-i"></i> კომპანია განახლდა!');
}

async function saveAccountSettings() {
    const firstName = document.getElementById('set-first-name').value.trim();
    const lastName  = document.getElementById('set-last-name').value.trim();
    const phone     = document.getElementById('set-user-phone').value.trim();
    const curPass   = document.getElementById('set-current-password').value;
    const newPass   = document.getElementById('set-new-password').value;
    const confPass  = document.getElementById('set-confirm-password').value;

    if (!firstName) { showToast('სახელი აუცილებელია', 'error'); return; }

    const payload = { first_name: firstName, last_name: lastName, phone };

    // Password changes go through /api/auth/change-password — the server owns
    // the hashing and `password_hash` is not writable through the data API.
    if (newPass) {
        if (newPass.length < 8) { showToast('პაროლი მინ. 8 სიმბოლო', 'error'); return; }
        if (newPass !== confPass) { showToast('პაროლები არ ემთხვევა', 'error'); return; }
        if (!curPass) { showToast('შეიყვანეთ მიმდინარე პაროლი', 'error'); return; }
        const r = await fetch('/api/auth/change-password', {
            method: 'POST', headers: {'Content-Type':'application/json'},
            credentials: 'include',
            body: JSON.stringify({ current_password: curPass, password: newPass })
        });
        if (!r.ok) {
            const { error } = await r.json().catch(() => ({}));
            showToast(error || 'პაროლის შეცვლა ვერ მოხერხდა', 'error');
            return;
        }
    }

    const { error } = await client.from('users').update(payload).eq('id', currentUser.id);
    if (error) { showToast('შეცდომა: ' + error.message, 'error'); return; }

    // Update local currentUser
    currentUser.first_name = firstName;
    currentUser.last_name  = lastName;
    currentUser.phone      = phone;
    document.getElementById('set-current-password').value  = '';
    document.getElementById('set-new-password').value     = '';
    document.getElementById('set-confirm-password').value = '';
    showToast('<i data-lucide="check-circle-2" class="lucide-i"></i> ანგარიში განახლდა!');
}

function setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem('atlas_theme', theme); } catch(e) {}
    highlightThemeBtns();
}

function highlightThemeBtns() {
    const theme = document.documentElement.getAttribute('data-theme') || 'light';
    ['light','dark'].forEach(t => {
        const btn = document.getElementById('set-theme-' + t);
        if (!btn) return;
        btn.classList.toggle('btn-primary', theme === t);
        btn.classList.toggle('btn-secondary', theme !== t);
    });
}

function highlightLangBtns() {
    ['ka','en','ru'].forEach(lng => {
        const btn = document.getElementById('set-lang-' + lng);
        if (!btn) return;
        btn.classList.toggle('btn-primary', currentLang === lng);
        btn.classList.toggle('btn-secondary', currentLang !== lng);
    });
}

// Apply saved theme on load
(function applyTheme() {
    try {
        const saved = localStorage.getItem('atlas_theme') || localStorage.getItem('warm_theme');
        if (saved) document.documentElement.setAttribute('data-theme', saved);
    } catch(e) {}
})();


// ═══════════════════════════════════════════════════════
// COMPANY LOGO
// Replaces the generic icon beside the company name in the sidebar.
// ═══════════════════════════════════════════════════════

// Cached so the sidebar can re-render without another round trip.
let _companyLogoUrl = null;

/** Paint the sidebar tile and the settings preview from the current logo. */
function renderCompanyLogo(url) {
    if (url !== undefined) _companyLogoUrl = url || null;
    const name = (currentUser && (currentUser.companies?.name || currentUser.company_name)) || '';

    const tile = document.getElementById('brand-logo');
    if (tile) {
        if (_companyLogoUrl) {
            tile.innerHTML = `<img src="${_companyLogoUrl}" alt="">`;
            tile.classList.add('has-logo');
        } else {
            tile.innerHTML = '<svg viewBox="0 0 100 100" style="width:60%;height:60%" aria-label="AtlasCRM"><path d="M 29 74 L 50 25 L 71 74" fill="none" stroke="#fff" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/><line x1="37.5" y1="55" x2="62.5" y2="55" stroke="#fff" stroke-width="12" stroke-linecap="round"/></svg>';
            tile.classList.remove('has-logo');
        }
    }

    const preview = document.getElementById('company-logo-preview');
    if (preview) {
        preview.innerHTML = _companyLogoUrl
            ? `<img src="${_companyLogoUrl}" alt="">`
            : (typeof initialsOf === 'function' ? initialsOf(name) : '?');
    }
    const removeBtn = document.getElementById('company-logo-remove');
    if (removeBtn) removeBtn.style.display = _companyLogoUrl ? '' : 'none';
}

/** Read the stored logo for this company and render it. */
async function loadCompanyLogo() {
    if (!currentUser || !currentUser.company_id) return;
    try {
        const { data } = await client.from('companies').select('logo_url').eq('id', currentUser.company_id).single();
        renderCompanyLogo(data && data.logo_url);
    } catch (e) { /* sidebar keeps the fallback icon */ }
}

function pickCompanyLogo() {
    if (typeof pickImageFile !== 'function') return;
    pickImageFile('company-logo', uploadCompanyLogo);
}

async function uploadCompanyLogo(file) {
    try {
        showToast('იტვირთება...', 'info');
        const url = await uploadImageFile(file, { maxMB: 2 });
        const { error } = await client.from('companies').update({ logo_url: url }).eq('id', currentUser.company_id);
        if (error) throw error;
        renderCompanyLogo(url);
        showToast('<i data-lucide="check-circle-2" class="lucide-i"></i> ლოგო განახლდა');
        if (window.lucide) { try { window.lucide.createIcons(); } catch (e) {} }
    } catch (e) {
        showToast('შეცდომა: ' + (e.message || e), 'error');
    }
}

async function removeCompanyLogo() {
    try {
        const { error } = await client.from('companies').update({ logo_url: null }).eq('id', currentUser.company_id);
        if (error) throw error;
        renderCompanyLogo(null);
        showToast('ლოგო წაიშალა');
    } catch (e) {
        showToast('შეცდომა: ' + (e.message || e), 'error');
    }
}
