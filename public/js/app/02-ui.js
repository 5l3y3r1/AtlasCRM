// ═══════════════════════════════════════════════════════
// <i data-lucide="palette" class="lucide-i"></i> UI SETUP
// ═══════════════════════════════════════════════════════
function setupUI() {
    const fullName = currentUser.first_name + ' ' + (currentUser.last_name || '');
    const initials = (currentUser.first_name[0] || '') + (currentUser.last_name?.[0] || '');
    
    document.getElementById('user-name').textContent = fullName.trim();
    document.getElementById('user-role').textContent = roleNames[currentUser.role] || currentUser.role;
    document.getElementById('user-avatar').textContent = initials.toUpperCase();
    if (typeof renderUserAvatar === 'function') renderUserAvatar();
    
    // Brand corner: show the company the user belongs to
    const company = currentUser.companies || currentUser.company || null;
    const companyName = (company && company.name) || 'AtlasCRM';
    const brandEl = document.getElementById('brand-company-name');
    if (brandEl) brandEl.textContent = companyName;
    const brandSub = document.getElementById('brand-company-sub');
    if (brandSub) brandSub.textContent = 'AtlasCRM';
    // The uploaded logo replaces the generic tile beside the company name.
    if (typeof loadCompanyLogo === 'function') loadCompanyLogo();
    if (typeof refreshTaskBadge === 'function') refreshTaskBadge();
    document.title = companyName + ' — AtlasCRM';
    
    document.getElementById('dashboard-greeting').textContent = 
        getGreeting() + ', ' + currentUser.first_name + '!';
    
    // Nav visibility is controlled entirely by the permissions matrix via
    // applyPermissionsToNav() (called right after initPermissions). We no longer
    // hard-hide sections by role here, otherwise granted permissions wouldn't take effect.
    // Team menu still defaults to founder/manager but can be overridden by permissions.
    if (!['FOUNDER', 'MANAGER'].includes(currentUser.role) && !hasPermissionSafe('permissions', 'can_view')) {
        const navTeam = document.getElementById('nav-team');
        if (navTeam) navTeam.style.display = 'none';
    }
    // Show unread-alert badge on the AI Hunter nav (all roles).
    if (typeof updateAlertBadge === 'function') updateAlertBadge();
}

// Safe wrapper — permissions may not be loaded yet during setupUI
function hasPermissionSafe(resource, action) {
    try {
        if (!_permsLoaded) return false;
        return hasPermission(resource, action);
    } catch(e) { return false; }
}

const roleNames = {
    'FOUNDER': 'დამფუძნებელი',
    'MANAGER': 'მენეჯერი',
    'AGENT': 'აგენტი',
    'BROKER': 'ბროკერი',
    'MARKETING': 'მარკეტინგი',
    'LAWYER': 'იურისტი',
    'ACCOUNTANT': 'ბუღალტერი'
};

const propertyTypeNames = {
    'APARTMENT': 'ბინა', 'HOUSE': 'სახლი', 'COMMERCIAL': 'კომერციული',
    'LAND': 'მიწა', 'OFFICE': 'ოფისი', 'HOTEL': 'სასტუმრო',
    'GARAGE': 'გარაჟი', 'BASEMENT': 'სარდაფი', 'RESIDENTIAL': 'საცხოვრებელი'
};

// Live GEL per USD — refreshed from NBG via /api/rates/usd on load.
let GEL_PER_USD = 2.70;
let RATE_SOURCE = 'fallback';
async function loadExchangeRate() {
    try {
        const res = await fetch('/api/rates/usd', { credentials: 'include' });
        const j = await res.json();
        if (j && j.data && j.data.gel_per_usd) {
            GEL_PER_USD = Number(j.data.gel_per_usd);
            RATE_SOURCE = j.data.source || 'nbg';
        }
    } catch (e) { /* keep fallback */ }
}

// Format a USD-stored price for display in the listing's chosen currency.
function displayListingPrice(usd, currency) {
    if (usd == null) return '—';
    const gel = Math.round(usd * GEL_PER_USD);
    const u = '$' + Number(usd).toLocaleString();
    const g = '₾' + gel.toLocaleString();
    if (currency === 'GEL') return g;
    if (currency === 'BOTH') return `${u} / ${g}`;
    return u;
}

// Live conversion hint under the price input.
function updatePriceConv() {
    const el = document.getElementById('lst-price-conv');
    const priceEl = document.getElementById('lst-price');
    const curEl = document.getElementById('lst-currency');
    if (!el || !priceEl || !curEl) return;
    const v = Number(priceEl.value);
    if (!v) { el.textContent = '≈ —'; return; }
    const tag = RATE_SOURCE === 'nbg' ? ` (NBG: ${GEL_PER_USD.toFixed(4)})` : ` (${GEL_PER_USD.toFixed(2)})`;
    if (curEl.value === 'GEL') el.textContent = `≈ $${Math.round(v / GEL_PER_USD).toLocaleString()} USD${tag}`;
    else el.textContent = `≈ ₾${Math.round(v * GEL_PER_USD).toLocaleString()} GEL${tag}`;
}

function toggleSourceUrl() {
    const src = document.getElementById('lst-source');
    const wrap = document.getElementById('lst-source-url-wrap');
    if (!src || !wrap) return;
    wrap.style.display = (src.value === 'MYHOME' || src.value === 'SSGE') ? 'block' : 'none';
}

function onCityChange() {
    // Clear address when city changes so suggestions re-scope.
    const a = document.getElementById('lst-address');
    if (a) a.value = '';
    const s = document.getElementById('addr-suggestions');
    if (s) s.style.display = 'none';
}

// Mapbox address autocomplete scoped to the chosen city.
let _addrTimer = null;
// Each city: { c: [lng,lat] center, bbox: [minLng,minLat,maxLng,maxLat] }.
// bbox hard-restricts Mapbox results to the city area (proximity alone does NOT).
const CITY_GEO = {
    'თბილისი': { c: [44.7866, 41.7151], bbox: [44.62, 41.62, 45.02, 41.83] },
    'ბათუმი':  { c: [41.6168, 41.6460], bbox: [41.58, 41.58, 41.68, 41.70] },
    'ქუთაისი': { c: [42.6954, 42.2679], bbox: [42.63, 42.22, 42.75, 42.31] },
    'რუსთავი': { c: [44.9930, 41.5495], bbox: [44.93, 41.51, 45.06, 41.59] },
    'გორი':    { c: [44.1130, 41.9847], bbox: [44.05, 41.95, 44.17, 42.02] },
    'ზუგდიდი': { c: [41.8709, 42.5088], bbox: [41.82, 42.47, 41.92, 42.55] },
    'ფოთი':    { c: [41.6730, 42.1465], bbox: [41.62, 42.11, 41.72, 42.18] },
    'თელავი':  { c: [45.4731, 41.9197], bbox: [45.42, 41.89, 45.52, 41.95] },
};
function addrAutocomplete(q) {
    const box = document.getElementById('addr-suggestions');
    if (!box) return;
    clearTimeout(_addrTimer);
    if (!q || q.length < 3) { box.style.display = 'none'; return; }
    _addrTimer = setTimeout(async () => {
        const cityEl = document.getElementById('lst-city');
        const city = cityEl ? cityEl.value : '';
        const geo = CITY_GEO[city];
        const query = encodeURIComponent(q.trim());
        // bbox HARD-restricts to the city; proximity just biases ranking within it.
        const bbox = geo ? `&bbox=${geo.bbox.join(',')}` : '';
        const proximity = geo ? `&proximity=${geo.c[0]},${geo.c[1]}` : '';
        // Valid Mapbox types: country, region, place, district, locality,
        // postcode, neighborhood, address. ("street" is NOT valid → 422.)
        const urls = [
            `https://api.mapbox.com/geocoding/v5/mapbox.places/${query}.json?access_token=${MAPBOX_TOKEN}&country=ge&limit=8&language=ka&autocomplete=true&types=address,locality,neighborhood${bbox}${proximity}`,
            `https://api.mapbox.com/search/geocode/v6/forward?q=${query}&access_token=${MAPBOX_TOKEN}&country=ge&limit=8&language=ka&autocomplete=true&types=address${bbox}${proximity}`
        ];
        let feats = [];
        for (const url of urls) {
            try {
                const res = await fetch(url);
                if (!res.ok) { console.warn('Mapbox geocode HTTP', res.status, url); continue; }
                const json = await res.json();
                const raw = json.features || [];
                feats = raw.map(f => {
                    // v5: f.place_name is the full readable address. Prefer it.
                    if (f.place_name) {
                        return {
                            place_name: f.place_name,
                            center: f.center || (f.geometry && f.geometry.coordinates) || [],
                            context_text: (f.context || []).map(c => c.text).join(' ')
                        };
                    }
                    // v6: build the full address; full_address > name + place context.
                    const p = f.properties || {};
                    let name = p.full_address || p.place_formatted || '';
                    if (!name && p.name) {
                        // p.name alone may be generic; append context for usefulness.
                        const ctx = p.context || {};
                        const place = (ctx.place && ctx.place.name) || (ctx.locality && ctx.locality.name) || '';
                        name = place ? `${p.name}, ${place}` : p.name;
                    }
                    return {
                        place_name: name,
                        center: (f.geometry && f.geometry.coordinates) || [],
                        context_text: JSON.stringify(p.context || {})
                    };
                }).filter(f => f.center.length === 2 && f.place_name);
                if (feats.length) break;
            } catch (e) { console.warn('Mapbox geocode error', e); }
        }
        // City filter: keep results in the city box OR whose name mentions the city.
        if (city && geo) {
            const [minLng, minLat, maxLng, maxLat] = geo.bbox;
            const filtered = feats.filter(f => {
                const [lng, lat] = f.center;
                const inBox = lng >= minLng && lng <= maxLng && lat >= minLat && lat <= maxLat;
                const nameMatch = (f.place_name || '').includes(city) || (f.context_text || '').includes(city);
                return inBox || nameMatch;
            });
            // Only apply if it leaves something; never wipe all results to empty.
            if (filtered.length) feats = filtered;
        }
        if (!feats.length) { box.style.display = 'none'; return; }
        box.innerHTML = feats.map(f =>
            `<div onclick="pickAddress(this)" data-addr="${escHtml(f.place_name||'')}" data-lng="${f.center[0]}" data-lat="${f.center[1]}" style="padding:10px 12px;cursor:pointer;border-bottom:1px solid #f0f0f0;font-size:13px" onmouseover="this.style.background='#f7f7f7'" onmouseout="this.style.background='#fff'">${escHtml(f.place_name || '')}</div>`
        ).join('');
        box.style.display = 'block';
    }, 300);
}
function pickAddress(el) {
    const inp = document.getElementById('lst-address');
    // data-addr is "Street [+ numbered lane], City, Country" — keep everything
    // before the first comma (this preserves parts like "II შესახვევი").
    const full = el.getAttribute('data-addr') || '';
    const streetPart = full.split(',')[0].trim();
    if (inp) inp.value = streetPart;
    inp._lat = el.getAttribute('data-lat');
    inp._lng = el.getAttribute('data-lng');
    const box = document.getElementById('addr-suggestions');
    if (box) box.style.display = 'none';
}

function getGreeting() {
    const hour = new Date().getHours();
    if (hour < 12) return t('greet_morning', 'დილა მშვიდობისა');
    if (hour < 18) return t('greet_day', 'მოგესალმები');
    return t('greet_evening', 'საღამო მშვიდობისა');
}

// ═══════════════════════════════════════════════════════
// <i data-lucide="target" class="lucide-i"></i> EVENTS
// ═══════════════════════════════════════════════════════
function setupEvents() {
    // Navigation
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', () => {
            const page = item.dataset.page;
            if (page) navigateTo(page);
            // Close sidebar on mobile after navigating
            if (window.innerWidth <= 768) {
                document.querySelector('.sidebar')?.classList.remove('open');
                document.getElementById('sidebar-backdrop')?.classList.remove('show');
            }
        });
    });
    
    // Page links
    document.querySelectorAll('[data-page-link]').forEach(el => {
        el.addEventListener('click', () => navigateTo(el.dataset.pageLink));
    });
    
    // User menu
    document.getElementById('user-box').addEventListener('click', (e) => {
        e.stopPropagation();
        document.getElementById('user-menu').classList.toggle('show');
    });
    
    document.addEventListener('click', () => {
        document.getElementById('user-menu').classList.remove('show');
    });
    
    document.getElementById('logout-btn').addEventListener('click', logout);
    document.getElementById('profile-btn').addEventListener('click', () => navigateTo('profile'));
    document.getElementById('settings-btn').addEventListener('click', openSettings);
    
    // Modal close
    document.getElementById('modal').addEventListener('click', (e) => {
        if (e.target.id === 'modal') closeModal();
    });
    
    // Confirm dialog OK button
    document.getElementById('confirm-ok').addEventListener('click', () => {
        if (confirmCallback) confirmCallback();
        closeConfirm();
    });
    
    // Confirm dialog overlay click
    document.getElementById('confirm').addEventListener('click', (e) => {
        if (e.target.id === 'confirm') closeConfirm();
    });
}


async function navigateTo(page) {
    // Permission gate
    const gatedPages = {dashboard:'dashboard',analytics:'analytics',map:'map',leads:'leads','universal-import':'excel_import',clients:'clients',deals:'deals',listings:'listings',tasks:'tasks',showings:'showings',marketing:'marketing',agents:'agents',ai:'ai',permissions:'permissions'};
    if (page === 'lawyer') {
        if (!hasPermission('documents', 'can_view') && !hasPermission('contracts', 'can_view')) {
            showToast('წვდომა შეზღუდულია', 'error');
            return;
        }
    } else if (gatedPages[page] && !hasPermission(gatedPages[page], 'can_view')) {
        showToast('წვდომა შეზღუდულია', 'error');
        return;
    }

    currentPage = page;
    
    // Update active state
    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
    document.querySelector(`[data-page="${page}"]`)?.classList.add('active');
    
    // Show page
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById('page-' + page)?.classList.add('active');
    
    // Load page data
    if (page === 'dashboard') await loadDashboard();
    if (page === 'leads') await loadLeads();
    if (page === 'clients') await loadClients();
    if (page === 'deals') await loadDeals();
    if (page === 'listings') await loadListings();
    if (page === 'agents') await loadAgents();
    if (page === 'teams') await loadTeams();
    if (page === 'map') await loadMap();
    if (page === 'tasks') await loadTasks();
    if (page === 'showings') await loadShowings();
    if (page === 'marketing') await loadMarketing();
    if (page === 'notifications') await loadNotifications();
    if (page === 'profile') await loadProfile();
    if (page === 'analytics') await loadAnalytics();
    if (page === 'chat') await loadChatPage();
    if (page === 'universal-import') await loadUniversalImportPage();
    if (page === 'permissions') await loadPermissions();
    if (page === 'extension') { if (typeof fillExtensionPage === 'function') fillExtensionPage(); }
    if (page === 'lawyer') {
        if (typeof setupLawyerTabs === 'function') setupLawyerTabs();
        const defaultTab = hasPermissionSafe('contracts', 'can_view') ? 'contracts' : 'documents';
        if (typeof switchLawyerTab === 'function') switchLawyerTab(defaultTab);
    }

    // Render any icons injected by the page's load function
    if (window.lucide) try { window.lucide.createIcons(); } catch(e) {}
}

