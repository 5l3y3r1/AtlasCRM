// ═══════════════════════════════════════════════════════
// <i data-lucide="refresh-cw" class="lucide-i"></i> TRANSLATION HELPERS
// ═══════════════════════════════════════════════════════
function getTableName(table) {
    const names = {
        leads: 'ლიდები',
        clients: 'კლიენტები',
        deals: 'გარიგებები',
        listings: 'ობიექტები',
        agents: 'აგენტები',
        users: 'მომხმარებლები'
    };
    return names[table] || table;
}

function translateRowToGeorgian(table, row) {
    if (table === 'leads') {
        return {
            'ნომერი': row.lead_number,
            'სახელი': row.full_name,
            'ტელეფონი': row.phone,
            'ტელეფონი 2': row.phone2,
            'ტელეფონი 3': row.phone3,
            'ემეილი': row.email,
            'წყარო': row.source,
            'სიმხურვალე': row.temperature,
            'სტატუსი': row.status,
            'შეტყობინება': row.inquiry_message,
            'თარიღი': row.created_at
        };
    }
    if (table === 'clients') {
        return {
            'ნომერი': row.client_number,
            'სახელი': row.first_name,
            'გვარი': row.last_name,
            'ტელეფონი': row.phone,
            'ემეილი': row.email,
            'ბიუჯეტი_მინ': row.budget_min,
            'ბიუჯეტი_მაქს': row.budget_max,
            'სტატუსი': row.status,
            'თარიღი': row.created_at
        };
    }
    if (table === 'listings') {
        return {
            'ნომერი': row.listing_number || row.listing_key,
            'სათაური': row.title,
            'ტიპი': row.property_type,
            'ფასი_USD': row.list_price,
            'ფართი_მ2': row.living_area,
            'ოთახები': row.bedrooms_total,
            'უბანი': row.district,
            'სტატუსი': row.status,
            'თარიღი': row.created_at
        };
    }
    if (table === 'deals') {
        return {
            'ნომერი': row.deal_number,
            'სათაური': row.title,
            'ტიპი': row.deal_type,
            'ეტაპი': row.current_stage,
            'სავარაუდო_ფასი': row.asking_price,
            'საბოლოო_ფასი': row.final_price,
            'თარიღი': row.created_at
        };
    }
    return row;
}

function translateRowFromGeorgian(table, row) {
    if (table === 'leads') {
        // Supports the new owner-list format (MyHome/SS.GE/მეპატრონე/...) and the old template.
        const owner = String(row['მეპატრონე'] || '').trim();
        const phoneMatch = owner.match(/(\+?\d[\d\s\-]{5,}\d)/);
        const extractedPhone = phoneMatch ? phoneMatch[1].replace(/[\s\-]/g, '') : null;
        const nameFromOwner = owner.replace(/(\+?\d[\d\s\-]{5,}\d)/, '').replace(/^[\s\-–—]+|[\s\-–—]+$/g, '').trim();
        const parts = [];
        const add = (label, key) => { if (row[key] != null && String(row[key]).trim() !== '') parts.push(label + ': ' + row[key]); };
        add('ფასი', 'თანხა'); add('დაკლება', 'დაკლება/თან'); add('გარიგება', 'გარიგების ტიპი');
        add('უბანი', 'უბანი'); add('მისამართი', 'მისამართი'); add('სახლ. ტიპი', 'სახლის ტიპი');
        add('ოთახი', 'ოთახი'); add('საძინებელი', 'საძინებელი'); add('სართული', 'სართული');
        if (row['კომენტარი'] != null && String(row['კომენტარი']).trim() !== '') parts.push(String(row['კომენტარი']));
        const mh = row['MyHome']; const ss = row['SS.GE'];
        return {
            full_name: (row['სახელი_და_გვარი'] || row['სახელი'] || nameFromOwner || owner || 'უცნობი მფლობელი'),
            phone: (row['ტელეფონი'] ? String(row['ტელეფონი']) : extractedPhone),
            email: row['ემეილი'] || null,
            myhome_id: (mh != null && String(mh).trim() !== '') ? String(mh).trim() : null,
            ssge_id: (ss != null && String(ss).trim() !== '') ? String(ss).trim() : null,
            source: row['წყარო'] || (mh ? 'MYHOME' : (ss ? 'SSGE' : 'OTHER')),
            temperature: row['სიმხურვალე'] || 'WARM',
            inquiry_message: row['შეტყობინება'] || (parts.length ? parts.join(' | ') : null),
            status: 'NEW'
        };
    }
    if (table === 'clients') {
        return {
            first_name: row['სახელი'] || 'უცნობი',
            last_name: row['გვარი'] || null,
            phone: row['ტელეფონი'] ? String(row['ტელეფონი']) : null,
            email: row['ემეილი'] || null,
            budget_min: row['ბიუჯეტი_მინ'] ? Number(row['ბიუჯეტი_მინ']) : null,
            budget_max: row['ბიუჯეტი_მაქს'] ? Number(row['ბიუჯეტი_მაქს']) : null,
            status: 'ACTIVE'
        };
    }
    if (table === 'listings') {
        return {
            title: row['სათაური'] || 'უცნობი',
            property_type: row['ტიპი'] || 'RESIDENTIAL',
            list_price: row['ფასი_USD'] ? Number(row['ფასი_USD']) : null,
            living_area: row['ფართი_მ2'] ? Number(row['ფართი_მ2']) : null,
            bedrooms_total: row['ოთახები'] ? Number(row['ოთახები']) : null,
            district: row['უბანი'] || null,
            status: row['სტატუსი'] && row['სტატუსი'].includes('ACTIVE') ? 'ACTIVE' : 'ACTIVE'
        };
    }
    return row;
}

// ═══════════════════════════════════════════════════════
// <i data-lucide="log-out" class="lucide-i"></i> LOGOUT
// ═══════════════════════════════════════════════════════
async function logout() {
    await client.auth.signOut();
    window.location.href = 'warm_login.html';
}

// ═══════════════════════════════════════════════════════
// <i data-lucide="wrench" class="lucide-i"></i> HELPERS
// ═══════════════════════════════════════════════════════
function formatDate(dateStr) {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    return d.toLocaleDateString('ka-GE', { year: 'numeric', month: 'short', day: 'numeric' });
}


// ───────────────────────────────────────────────────────────────
//  LUCIDE ICON BOOTSTRAP  (production design system)
// ───────────────────────────────────────────────────────────────
let __lucideObserver = null;
/**
 * The app's one HTML escaper.
 *
 * Seven modules each had their own, and they had drifted: two were named
 * `_esc` (the later-loading, weaker one silently replaced the other for the
 * whole app), and two escaped only & < > — leaving quotes live, which is
 * exactly what breaks out of an attribute like onclick="fn('...')".
 * Every local helper now delegates here so there is one behaviour.
 */
function escHtml(v) {
    return String(v == null ? '' : v)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Date + time in the user's locale. Lived in the tasks module, but showings and
 * notifications call it too — it belongs with the other shared formatters.
 */
function formatDateTime(dateStr) {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    if (isNaN(d)) return '—';
    return d.toLocaleString('ka-GE', {
        year: 'numeric', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit',
    });
}

function renderLucide() {
    if (window.lucide && typeof window.lucide.createIcons === 'function') {
        try { window.lucide.createIcons(); } catch (e) {}
    }
}
// Run on initial DOM ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderLucide);
} else { renderLucide(); }
// NOTE: We intentionally do NOT use a global MutationObserver here.
// createIcons() injects <svg> nodes, which would retrigger the observer in an
// infinite loop that pegs the main thread and freezes all click handlers.
// Instead, every render function calls lucide.createIcons() explicitly after
// it updates the DOM.

document.addEventListener('click', function (e) {
    const tgl = e.target.closest('#mobile-menu-toggle');
    const bd  = e.target.closest('#sidebar-backdrop');
    if (tgl) {
        document.querySelector('.sidebar').classList.add('open');
        document.getElementById('sidebar-backdrop').classList.add('show');
    } else if (bd) {
        document.querySelector('.sidebar').classList.remove('open');
        document.getElementById('sidebar-backdrop').classList.remove('show');
    }
});

function showToast(msg, type) {
    const toast = document.getElementById('toast');
    toast.innerHTML = msg;
    toast.className = 'toast show ' + (type || 'success');
    if (window.lucide && typeof window.lucide.createIcons === 'function') {
        try { window.lucide.createIcons(); } catch {}
    }
    setTimeout(() => toast.classList.remove('show'), 3000);
}

// ═══════════════════════════════════════════════════════════════════════
// INTEGRATIONS (Settings tab + standalone save)
// ═══════════════════════════════════════════════════════════════════════
async function loadIntegrationsTab() {
    try {
        const res = await fetch('/api/messaging/integrations', { credentials: 'include' });
        const { data } = await res.json();
        if (!data) return;
        const s = (id, v) => { const el = document.getElementById(id); if (el && v) el.value = v; };
        s('int-whatsapp-number',  data.whatsapp_number);
        s('int-whatsapp-template', data.whatsapp_template);
        s('int-smtp-host',       data.smtp_host);
        s('int-smtp-port',       data.smtp_port);
        s('int-smtp-user',       data.smtp_user);
        s('int-smtp-pass',       data.smtp_pass);
        s('int-smtp-from',       data.smtp_from);
        s('int-smtp-from-name',  data.smtp_from_name);
        s('int-meta-token',      data.meta_access_token);
        s('int-meta-account',    data.meta_ad_account_id);
        s('int-tiktok-token',    data.tiktok_access_token);
        s('int-tiktok-advertiser', data.tiktok_advertiser_id);
    } catch(e) {}
}


// ═══════════════════════════════════════════════════════
// IMAGE UPLOAD — shared by the profile picture and the company logo
// ═══════════════════════════════════════════════════════

// Creates (once) a hidden file input and opens the picker. `onPick` receives the
// chosen File. One input per key, so the profile picker and the logo picker
// don't overwrite each other's handler.
function pickImageFile(key, onPick) {
    const id = 'imgpick-' + key;
    let inp = document.getElementById(id);
    if (!inp) {
        inp = document.createElement('input');
        inp.type = 'file';
        inp.id = id;
        inp.accept = 'image/jpeg,image/jpg,image/png,image/webp,image/svg+xml';
        inp.style.display = 'none';
        document.body.appendChild(inp);
    }
    inp.onchange = () => {
        const file = inp.files && inp.files[0];
        inp.value = '';                 // so re-picking the same file still fires
        if (file) onPick(file);
    };
    inp.click();
}

/**
 * Validate and upload one image. Resolves to the server-relative URL.
 *
 * The URL is kept relative on purpose: storing location.origin bakes the
 * hostname into the database, so every image 404s the day the app moves to a
 * custom domain or is opened over a different origin.
 */
async function uploadImageFile(file, { maxMB = 5 } = {}) {
    const OK = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/svg+xml'];
    if (!OK.includes(file.type)) throw new Error('მხოლოდ JPG, PNG, WEBP ან SVG');
    if (file.size > maxMB * 1024 * 1024) throw new Error(`ფაილი ძალიან დიდია (მაქს. ${maxMB}MB)`);

    const fd = new FormData();
    fd.append('files', file);
    const r = await fetch('/api/upload', { method: 'POST', body: fd, credentials: 'include' });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.data || !j.data[0]) throw new Error(j.error || 'ატვირთვა ვერ მოხერხდა');
    return j.data[0].url;
}

// Two initials for an avatar/logo placeholder, e.g. "Prime Realty" -> "PR".
function initialsOf(text) {
    const parts = String(text || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    return ((parts[0][0] || '') + (parts[1]?.[0] || '')).toUpperCase();
}

// ═══════════════════════════════════════════════════════
// MOTION
// ═══════════════════════════════════════════════════════

/** Honours the OS "reduce motion" setting. Checked live, not cached, so
 *  changing the system preference takes effect without a reload. */
function prefersReducedMotion() {
    try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
    catch (e) { return false; }
}

/**
 * Count an element from 0 up to `target`.
 * `format` turns the running number into display text, so the same helper
 * drives a plain count and a currency figure.
 */
function animateCount(el, target, { duration = 900, format } = {}) {
    if (!el) return;
    const fmt = format || (n => n.toLocaleString());
    const value = Number(target) || 0;

    // requestAnimationFrame is paused in a background tab, so an animated count
    // started while hidden would sit at its start value until the tab is focused.
    // Nothing is watching it animate anyway — just show the final number.
    if (prefersReducedMotion() || !value || document.hidden) { el.textContent = fmt(value); return; }

    // Cancel any count still running on this element, otherwise navigating
    // back to the page mid-animation leaves two loops fighting over it.
    if (el._countRaf) cancelAnimationFrame(el._countRaf);

    const start = performance.now();
    const step = (now) => {
        const p = Math.min((now - start) / duration, 1);
        const eased = 1 - Math.pow(1 - p, 3);      // easeOutCubic
        el.textContent = fmt(Math.round(value * eased));
        if (p < 1) el._countRaf = requestAnimationFrame(step);
        else el._countRaf = null;
    };
    el._countRaf = requestAnimationFrame(step);
}

/**
 * Run `apply` on the next frame, after the browser has laid the element out
 * at its starting value. Setting a final width in the same tick the element
 * is created skips the transition entirely — the value is simply there.
 */
function animateNextFrame(apply) {
    // Same reasoning as animateCount: with no frames coming, apply immediately
    // so bars and arcs aren't left at zero.
    if (prefersReducedMotion() || document.hidden) { apply(); return; }
    requestAnimationFrame(() => requestAnimationFrame(apply));
}

/** Stagger table rows by tagging each with its index for the CSS delay. */
function staggerRows(container) {
    if (!container) return;
    container.querySelectorAll('tbody tr').forEach((tr, i) => {
        tr.style.setProperty('--row-i', Math.min(i, 20));
    });
}

/**
 * Tag freshly-rendered table rows with their index so the CSS stagger applies.
 *
 * Ten different modules build tables by assigning innerHTML; rather than edit
 * each one (and every future one), watch the content area and tag whatever
 * appears. Rows are only touched once, and the index is capped so a long table
 * doesn't turn into a multi-second cascade.
 */
(function autoStaggerTableRows() {
    const MAX_STAGGER = 20;

    function tag(root) {
        for (const tbody of root.querySelectorAll('tbody')) {
            const rows = tbody.rows;
            if (!rows.length || rows[0].style.getPropertyValue('--row-i')) continue;
            for (let i = 0; i < rows.length; i++) {
                rows[i].style.setProperty('--row-i', Math.min(i, MAX_STAGGER));
            }
        }
    }

    function start() {
        const main = document.querySelector('main') || document.body;
        if (!main) return;
        let queued = false;
        const observer = new MutationObserver(() => {
            if (queued) return;
            queued = true;
            // Coalesce a burst of mutations from one innerHTML assignment into
            // a single pass on the next frame.
            requestAnimationFrame(() => { queued = false; tag(main); });
        });
        observer.observe(main, { childList: true, subtree: true });
        tag(main);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
})();
