// ═══════════════════════════════════════════════════════
// <i data-lucide="rocket" class="lucide-i"></i> INIT
// ═══════════════════════════════════════════════════════

/* Loader safety-net: hide loader on any unhandled init error */
function __showErrBanner(label, msg) {
    try {
        let b = document.getElementById('__err-banner');
        if (!b) {
            b = document.createElement('div');
            b.id = '__err-banner';
            b.style.cssText = 'position:fixed;bottom:0;left:0;right:0;background:#dc2626;color:#fff;padding:10px 16px;font:13px/1.4 monospace;z-index:99999;max-height:40vh;overflow:auto;white-space:pre-wrap';
            b.onclick = () => b.remove();
            document.body.appendChild(b);
        }
        b.textContent = '⚠ ' + label + ': ' + msg + '\n(tap to dismiss)';
    } catch {}
}
window.addEventListener('error', function (e) {
    try {
        const l = document.getElementById('loader'); if (l) l.classList.add('hidden');
        const a = document.getElementById('app');    if (a) a.style.display = 'flex';
        console.error('[init error]', e.message);
        __showErrBanner('JS Error', e.message + ' @ ' + (e.filename||'').split('/').pop() + ':' + e.lineno);
    } catch {}
});
window.addEventListener('unhandledrejection', function (e) {
    try {
        const l = document.getElementById('loader'); if (l) l.classList.add('hidden');
        const a = document.getElementById('app');    if (a) a.style.display = 'flex';
        console.error('[init reject]', e.reason && e.reason.message || e.reason);
        __showErrBanner('Promise', (e.reason && e.reason.message) || String(e.reason));
    } catch {}
});

window.addEventListener('load', async () => {
    if (typeof window.supabase === 'undefined') {
        document.getElementById('loader').innerHTML = '<div style="text-align:center"><div style="font-size:80px"><i data-lucide="alert-triangle" class="lucide-i"></i></div><div style="font-size:18px;margin-top:16px">ბიბლიოთეკა ვერ ჩაიტვირთა</div></div>';
        return;
    }
    
    client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    
    // Auth check
    const { data: { session } } = await client.auth.getSession();
    
    if (!session) {
        window.location.href = 'warm_login.html';
        return;
    }
    
    // Get user profile
    const { data: userData, error } = await client
        .from('users')
        .select('*, companies(*)')
        .eq('auth_user_id', session.user.id)
        .single();
    
    if (error || !userData) {
        showToast('მომხმარებლის პროფილი ვერ მოიძებნა', 'error');
        await client.auth.signOut();
        setTimeout(() => { window.location.href = 'warm_login.html'; }, 1500);
        return;
    }
    
    currentUser = userData;

    // extension_key is deliberately excluded from the generic /api/data/users
    // endpoint (used just above, under the hood, by the Supabase-shim query)
    // so that listing teammates never exposes each other's keys — but that
    // also hides it from this, your OWN profile fetch. Backfill it here from
    // the dedicated self-only endpoint, which does return it.
    try {
        const meRes = await fetch('/api/auth/me', { credentials: 'include' });
        if (meRes.ok) {
            const meBody = await meRes.json();
            if (meBody?.data?.extension_key) currentUser.extension_key = meBody.data.extension_key;
        }
    } catch (e) { /* non-fatal — worst case the Extension page shows blank until a regenerate */ }

    setupUI();
    setupEvents();
    applyLang();
    await loadExchangeRate();
    await initPermissions();
    
    // Load initial page
    await loadDashboard();
    
    // Check notifications every 30 seconds
    checkNotifications();
    setInterval(checkNotifications, 30000);
    
    // Show app
    document.getElementById('loader').classList.add('hidden');
    document.getElementById('app').style.display = 'flex';
});

