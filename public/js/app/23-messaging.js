// ═══════════════════════════════════════════════════════
// SHARED MODAL WIDGETS: quick "send a message" modal (used from the
// message-circle button on lead/client rows) + the legacy integrations
// settings modal shell. Both #msg-modal and #msg-settings-modal live as
// static markup in warm.html; this file only supplies their behavior.
// ═══════════════════════════════════════════════════════

let _msgCtx = { type: null, id: null }; // which record the open composer is for

function openMsgModal(type, id, phone, email, name) {
    _msgCtx = { type, id };
    const title = document.getElementById('msg-modal-title');
    if (title) title.innerHTML = `<i data-lucide="send" class="lucide-i"></i> შეტყობინება — ${_esc ? _esc(name || '') : (name || '')}`;

    const phoneEl = document.getElementById('msg-to-phone');
    const emailEl = document.getElementById('msg-to-email');
    const subjEl  = document.getElementById('msg-subject');
    const bodyEl  = document.getElementById('msg-body');
    if (phoneEl) phoneEl.value = phone || '';
    if (emailEl) emailEl.value = email || '';
    if (subjEl)  subjEl.value  = '';
    if (bodyEl)  bodyEl.value  = '';

    // Default to whichever channel this contact actually has.
    switchMsgChannel(phone ? 'whatsapp' : 'email');

    const modal = document.getElementById('msg-modal');
    if (modal) modal.style.display = 'flex';
    if (window.lucide) try { window.lucide.createIcons(); } catch (e) {}
}

function closeMsgModal() {
    const modal = document.getElementById('msg-modal');
    if (modal) modal.style.display = 'none';
    _msgCtx = { type: null, id: null };
}

function switchMsgChannel(channel) {
    const waTab = document.getElementById('msg-tab-wa');
    const emailTab = document.getElementById('msg-tab-email');
    const waFields = document.getElementById('msg-wa-fields');
    const emailFields = document.getElementById('msg-email-fields');
    const isWa = channel === 'whatsapp';
    if (waTab) waTab.classList.toggle('active', isWa);
    if (emailTab) emailTab.classList.toggle('active', !isWa);
    if (waFields) waFields.style.display = isWa ? '' : 'none';
    if (emailFields) emailFields.style.display = isWa ? 'none' : '';
    const modal = document.getElementById('msg-modal');
    if (modal) modal.dataset.channel = channel;
}

const _MSG_TEMPLATES = {
    greeting: 'გამარჯობა! გმადლობთ ინტერესისთვის. როგორ შემიძლია დაგეხმაროთ?',
    showing:  'გამარჯობა! გვსურს შემოგთავაზოთ ობიექტის ჩვენება — მოგესალმებათ რომელი დრო იქნება მოსახერხებელი?',
    followup: 'გამარჯობა! ვამოწმებ, გაქვთ თუ არა კითხვები ბოლო შემოთავაზებასთან დაკავშირებით?',
};
function insertMsgTemplate(kind) {
    const bodyEl = document.getElementById('msg-body');
    if (!bodyEl) return;
    bodyEl.value = _MSG_TEMPLATES[kind] || '';
}

async function sendMessage() {
    const modal = document.getElementById('msg-modal');
    const channel = (modal && modal.dataset.channel) || 'whatsapp';
    const body = (document.getElementById('msg-body') || {}).value?.trim() || '';
    if (!body) { showToast('ტექსტი აუცილებელია', 'error'); return; }

    const payload = {
        channel,
        contact_type: _msgCtx.type,
        contact_id: _msgCtx.id,
        body,
    };
    if (channel === 'whatsapp') {
        payload.to_phone = (document.getElementById('msg-to-phone') || {}).value?.trim() || '';
        if (!payload.to_phone) { showToast('ტელეფონი აუცილებელია', 'error'); return; }
    } else {
        payload.to_email = (document.getElementById('msg-to-email') || {}).value?.trim() || '';
        payload.subject  = (document.getElementById('msg-subject') || {}).value?.trim() || '';
        if (!payload.to_email) { showToast('ელ. ფოსტა აუცილებელია', 'error'); return; }
    }

    const btn = document.getElementById('msg-send-btn');
    if (btn) { btn.disabled = true; }
    try {
        const res = await fetch('/api/messaging/send', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
            body: JSON.stringify(payload),
        });
        const j = await res.json();
        if (!res.ok) throw new Error(j.error || 'გაგზავნა ვერ მოხერხდა');

        // WhatsApp has no server-side push API here — the actual send happens
        // through the agent's own WhatsApp via a wa.me link (same approach as
        // the PDF-share button elsewhere in the app).
        if (channel === 'whatsapp') {
            const clean = payload.to_phone.replace(/[^0-9]/g, '');
            window.open(`https://wa.me/${clean}?text=${encodeURIComponent(body)}`, '_blank');
        }
        showToast('<i data-lucide="check-circle-2" class="lucide-i"></i> გაიგზავნა');
        closeMsgModal();
    } catch (e) {
        showToast('შეცდომა: ' + (e.message || e), 'error');
    } finally {
        if (btn) btn.disabled = false;
    }
}

// ── Legacy integrations modal shell (kept so saveIntegrations()'s success
// callback has something to close; the live Settings → Integrations tab is
// the primary way this gets configured now). ──
function openMsgSettings() {
    const modal = document.getElementById('msg-settings-modal');
    if (modal) modal.style.display = 'flex';
}
function closeMsgSettings() {
    const modal = document.getElementById('msg-settings-modal');
    if (modal) modal.style.display = 'none';
}
