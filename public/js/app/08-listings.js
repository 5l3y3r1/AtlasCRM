// ═══════════════════════════════════════════════════════
// <i data-lucide="home" class="lucide-i"></i> LISTINGS
// ═══════════════════════════════════════════════════════
async function loadListings() {
    const [listingsRes, usersRes] = await Promise.all([
        client.from('listings')
            .select('*, property_images(image_url, is_primary)')
            .order('created_at', { ascending: false }),
        client.from('users').select('id, first_name, last_name, phone').eq('company_id', currentUser.company_id)
    ]);
    _allListings = listingsRes.data || [];
    _listingUserMap = {};
    _listingUserPhoneMap = {};
    (usersRes.data || []).forEach(u => {
        _listingUserMap[u.id] = `${u.first_name} ${u.last_name || ''}`.trim();
        _listingUserPhoneMap[u.id] = u.phone || '';
    });

    // Populate agent filter dropdown
    const agentSel = document.getElementById('lf-agent');
    if (agentSel) {
        const cur = agentSel.value;
        agentSel.innerHTML = '<option value="">' + t('all_agents','ყველა აგენტი') + '</option>' +
            (usersRes.data || []).map(u => `<option value="${u.id}">${escHtml(u.first_name)} ${escHtml(u.last_name || '')}</option>`).join('');
        agentSel.value = cur;
    }

    // Default scope: managers/founders see the whole agency; agents see their own first.
    if (_listingScope === null) {
        _listingScope = ['FOUNDER', 'MANAGER', 'OWNER', 'ADMIN'].includes(currentUser.role) ? 'agency' : 'my';
    }
    _syncScopeButtons();

    applyListingFilters();
}
let _listingUserMap = {};
let _listingUserPhoneMap = {};
let _listingScope = null;   // 'my' | 'agency'

function _syncScopeButtons() {
    [['lf-scope-my', 'my'], ['lf-scope-all', 'agency']].forEach(([id, val]) => {
        const b = document.getElementById(id);
        if (!b) return;
        const on = _listingScope === val;
        b.style.background = on ? 'var(--brand)' : 'transparent';
        b.style.color = on ? '#fff' : 'var(--text-muted)';
    });
}

// Toggle between the agent's own properties and all agency properties.
function setListingScope(scope) {
    _listingScope = scope;
    _syncScopeButtons();
    applyListingFilters();
}

function toggleAdvancedFilters() {
    const adv = document.getElementById('lf-advanced');
    const btn = document.getElementById('lf-toggle-btn');
    if (!adv) return;
    const show = adv.style.display === 'none';
    adv.style.display = show ? '' : 'none';
    if (btn) btn.classList.toggle('btn-primary', show);
}

function clearListingFilters() {
    ['lf-search','lf-price-min','lf-price-max','lf-ppsqm-min','lf-ppsqm-max','lf-area-min','lf-area-max',
     'lf-total-min','lf-total-max','lf-bed-min','lf-bed-max','lf-bath-min','lf-bath-max','lf-floor-min','lf-floor-max',
     'lf-tfloor-min','lf-tfloor-max','lf-year-min','lf-year-max','lf-region','lf-city','lf-district','lf-cadastral',
     'lf-comm-min','lf-comm-max'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    ['lf-listing-type','lf-property-type','lf-agent','lf-has-coords','lf-has-photos','lf-material','lf-building-status','lf-renovation','lf-heating','lf-furniture','lf-view'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    ['lf-am-elevator','lf-am-ac','lf-am-internet','lf-am-storage','lf-am-fireplace','lf-negotiable'].forEach(id => { const el = document.getElementById(id); if (el) el.checked = false; });
    const st = document.getElementById('lf-status'); if (st) st.value = 'ACTIVE';
    const so = document.getElementById('lf-sort'); if (so) so.value = 'newest';
    applyListingFilters();
}

function applyListingFilters() {
    const g  = id => (document.getElementById(id)?.value || '').trim();
    const gn = id => { const v = document.getElementById(id)?.value; return v === '' || v == null ? null : Number(v); };

    const search    = g('lf-search').toLowerCase();
    const lType     = g('lf-listing-type');
    const pType     = g('lf-property-type');
    const status    = g('lf-status');
    const priceMin  = gn('lf-price-min'),  priceMax  = gn('lf-price-max');
    const ppsqmMin  = gn('lf-ppsqm-min'),  ppsqmMax  = gn('lf-ppsqm-max');
    const areaMin   = gn('lf-area-min'),   areaMax   = gn('lf-area-max');
    const totalMin  = gn('lf-total-min'),  totalMax  = gn('lf-total-max');
    const bedMin    = gn('lf-bed-min'),    bedMax    = gn('lf-bed-max');
    const bathMin   = gn('lf-bath-min'),   bathMax   = gn('lf-bath-max');
    const floorMin  = gn('lf-floor-min'),  floorMax  = gn('lf-floor-max');
    const tfloorMin = gn('lf-tfloor-min'), tfloorMax = gn('lf-tfloor-max');
    const yearMin   = gn('lf-year-min'),   yearMax   = gn('lf-year-max');
    const commMin   = gn('lf-comm-min'),   commMax   = gn('lf-comm-max');
    const region    = g('lf-region').toLowerCase();
    const city      = g('lf-city').toLowerCase();
    const district  = g('lf-district').toLowerCase();
    const cadastral = g('lf-cadastral').toLowerCase();
    const agent     = g('lf-agent');
    const hasCoords = g('lf-has-coords');
    const hasPhotos = g('lf-has-photos');
    const material  = g('lf-material');
    const bldStatus = g('lf-building-status');
    const renovation = g('lf-renovation');
    const heating   = g('lf-heating');
    const furniture = g('lf-furniture');
    const view      = g('lf-view');
    const amElevator  = document.getElementById('lf-am-elevator')?.checked;
    const amAc        = document.getElementById('lf-am-ac')?.checked;
    const amInternet  = document.getElementById('lf-am-internet')?.checked;
    const amStorage   = document.getElementById('lf-am-storage')?.checked;
    const amFireplace = document.getElementById('lf-am-fireplace')?.checked;
    const negotiable  = document.getElementById('lf-negotiable')?.checked;
    const sort      = g('lf-sort') || 'newest';

    const between = (val, min, max) => {
        if (min != null && (val == null || Number(val) < min)) return false;
        if (max != null && (val == null || Number(val) > max)) return false;
        return true;
    };

    let filtered = _allListings.filter(l => {
        // Scope: "my" = only the agent's own properties; "agency" = all company properties.
        if (_listingScope === 'my') {
            const own = l.agent_id ? l.agent_id === currentUser.id : l.created_by_id === currentUser.id;
            if (!own) return false;
        }
        if (search) {
            const hay = `${l.title||''} ${l.address||''} ${l.description||''} ${l.cadastral_code||''} ${l.district||''} ${l.city||''}`.toLowerCase();
            if (!hay.includes(search)) return false;
        }
        if (lType  && l.listing_type  !== lType)  return false;
        if (pType  && l.property_type !== pType)  return false;
        if (status && l.status        !== status) return false;
        if (!between(l.list_price,     priceMin,  priceMax))  return false;
        if (!between(l.price_per_sqm,  ppsqmMin,  ppsqmMax))  return false;
        if (!between(l.living_area,    areaMin,   areaMax))   return false;
        if (!between(l.total_area,     totalMin,  totalMax))  return false;
        if (!between(l.bedrooms_total, bedMin,    bedMax))    return false;
        if (!between(l.bathrooms,      bathMin,   bathMax))   return false;
        if (!between(l.floor,          floorMin,  floorMax))  return false;
        if (!between(l.total_floors,   tfloorMin, tfloorMax)) return false;
        if (!between(l.year_built,     yearMin,   yearMax))   return false;
        if (!between(l.commission_pct, commMin,   commMax))   return false;
        if (region    && !(l.region   || '').toLowerCase().includes(region))    return false;
        if (city      && !(l.city     || '').toLowerCase().includes(city))      return false;
        if (district  && !(l.district || '').toLowerCase().includes(district))  return false;
        if (cadastral && !(l.cadastral_code || '').toLowerCase().includes(cadastral)) return false;
        if (agent     && l.agent_id !== agent && l.created_by_id !== agent)      return false;
        if (hasCoords === 'yes' && !(l.latitude && l.longitude)) return false;
        if (hasCoords === 'no'  &&  (l.latitude && l.longitude)) return false;
        const photoCount = (l.property_images || []).length;
        if (hasPhotos === 'yes' && photoCount === 0) return false;
        if (hasPhotos === 'no'  && photoCount  >  0) return false;
        if (material   && l.building_material  !== material)   return false;
        if (bldStatus  && l.building_status    !== bldStatus)  return false;
        if (renovation && l.renovation_status  !== renovation) return false;
        if (heating    && l.heating_type       !== heating)    return false;
        if (furniture  && l.furniture_status   !== furniture)  return false;
        if (view       && l.view_type          !== view)       return false;
        if (amElevator  && !l.has_elevator)  return false;
        if (amAc        && !l.has_ac)        return false;
        if (amInternet  && !l.has_internet)  return false;
        if (amStorage   && !l.has_storage)   return false;
        if (amFireplace && !l.has_fireplace) return false;
        if (negotiable  && !l.is_negotiable) return false;
        return true;
    });

    // Sort
    filtered.sort((a, b) => {
        switch (sort) {
            case 'oldest':     return new Date(a.created_at) - new Date(b.created_at);
            case 'price-asc':  return (a.list_price||0) - (b.list_price||0);
            case 'price-desc': return (b.list_price||0) - (a.list_price||0);
            case 'area-asc':   return (a.living_area||a.total_area||0) - (b.living_area||b.total_area||0);
            case 'area-desc':  return (b.living_area||b.total_area||0) - (a.living_area||a.total_area||0);
            default:           return new Date(b.created_at) - new Date(a.created_at);
        }
    });

    // Update count
    const countEl = document.getElementById('lf-count');
    if (countEl) countEl.textContent = `${filtered.length} / ${_allListings.length}`;

    renderListingsTable(filtered);
}

function renderListingsTable(data) {
    const userMap = _listingUserMap;
    const userPhoneMap = _listingUserPhoneMap;
    const isManager = ['FOUNDER', 'MANAGER'].includes(currentUser.role);
    const container = document.getElementById('listings-list');
    if (!container) return;

    if (!data || data.length === 0) {
        container.innerHTML = `
            <div class="empty">
                <div class="empty-icon"><i data-lucide="search-x" class="lucide-i"></i></div>
                <div class="empty-title">${t('empty_listings_filter','ფილტრის შესაბამისი ობიექტი არ მოიძებნა')}</div>
                <div class="empty-sub">${t('empty_listings_filter_sub','სცადე ფილტრების შეცვლა ან გასუფთავება')}</div>
            </div>`;
        if (window.lucide) try { window.lucide.createIcons(); } catch(e) {}
        return;
    }

    container.innerHTML = `
        <table>
            <thead>
                <tr><th>ID</th><th>${t('th_photo','ფოტო')}</th><th>${t("th_title")}</th><th>${t("th_type")}</th><th>${t("th_price")}</th><th>${t("th_area")}</th><th>${t("th_district")}</th><th>${t("th_uploader")}</th><th>${t("th_status")}</th><th></th></tr>
            </thead>
            <tbody>
                ${data.map(l => {
                    const photos = l.property_images || [];
                    const primaryPhoto = photos.find(p => p.is_primary) || photos[0];
                    const photoHtml = primaryPhoto
                        ? `<img src="${primaryPhoto.image_url}" class="listing-thumb" alt="" onerror="this.outerHTML='<div class=\\'listing-thumb-placeholder\\'><svg width=20 height=20 viewBox=\\'0 0 24 24\\' fill=none stroke=currentColor stroke-width=2><path d=\\'M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z\\'/></svg></div>'">`
                        : `<div class="listing-thumb-placeholder"><i data-lucide="home" class="lucide-i"></i></div>`;
                    const uploader = userMap[l.created_by_id] || userMap[l.agent_id] || '—';
                    const assignee = l.agent_id ? (userMap[l.agent_id] || '—') : null;
                    // Agents may VIEW agency properties but only EDIT/DELETE their OWN.
                    // Managers/founders retain full access.
                    const isOwn = l.agent_id ? l.agent_id === currentUser.id
                                             : l.created_by_id === currentUser.id;
                    const canWrite = isManager || isOwn;
                    const canDelete = isManager || isOwn;

                    return `
                        <tr>
                            <td><span style="font-size:11px;font-weight:700;color:var(--brand);white-space:nowrap">${l.listing_number || l.listing_key || '—'}</span></td>
                            <td>${photoHtml}</td>
                            <td><strong>${escHtml(l.title || '—')}</strong></td>
                            <td>${propertyTypeNames[l.property_type] || l.property_type}</td>
                            <td>${displayListingPrice(l.list_price, l.currency)}</td>
                            <td>${l.living_area ? l.living_area + ' მ²' : (l.total_area ? l.total_area + ' მ²' : '—')}</td>
                            <td>${escHtml(l.district || '—')}</td>
                            <td>
                                <span style="font-size:12px;color:var(--text-muted)"><i data-lucide="user" class="lucide-i"></i> ${uploader}${assignee && assignee !== uploader ? ` <span style="color:var(--text-muted)">→ ${assignee}</span>` : ''}</span>
                                ${(() => { const p = userPhoneMap[l.agent_id || l.created_by_id]; return p ? `<a href="https://wa.me/${p.replace(/[^0-9]/g,'')}" target="_blank" title="WhatsApp" style="display:inline-flex;align-items:center;margin-left:4px;color:#25D366"><svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a.518.518 0 0 0-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.127.558 4.122 1.532 5.849L.054 23.454a.5.5 0 0 0 .492.593l5.763-1.512A11.94 11.94 0 0 0 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-1.907 0-3.693-.513-5.232-1.41l-.374-.222-3.882 1.018 1.037-3.792-.244-.389A9.955 9.955 0 0 1 2 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z"/></svg></a>` : ''; })()}
                            </td>
                            <td><span class="badge badge-active">${l.status}</span></td>
                            <td>
                                <div class="action-buttons">
                                    <button class="action-btn view" data-act="view-listing" data-id="${l.id}" title="${t('action_view','ნახვა')}"><i data-lucide="eye" class="lucide-i"></i></button>
                                    <button class="action-btn" data-act="pdf-listing" data-id="${l.id}" title="${t('action_download_pdf','PDF გადმოწერა')}" style="color:#6366f1"><i data-lucide="file-down" class="lucide-i"></i></button>
                                    ${(l.latitude && l.longitude) ? `<button class="action-btn" data-act="map-listing" data-id="${l.id}" data-lat="${l.latitude}" data-lng="${l.longitude}" title="${t('action_view_map','რუკაზე ნახვა')}" style="color:var(--brand)"><i data-lucide="map-pin" class="lucide-i"></i></button>` : ''}
                                    ${canWrite ? `<button class="action-btn edit" data-act="edit-listing" data-id="${l.id}" title="${t('action_edit','რედაქტირება')}"><i data-lucide="pencil" class="lucide-i"></i></button>` : ''}
                                    ${isManager ? `<button class="action-btn" data-act="reassign-listing" data-id="${l.id}" data-agent="${l.agent_id || ''}" title="${t('action_reassign','აგენტზე მინიჭება')}"><i data-lucide="user-cog" class="lucide-i"></i></button>` : ''}
                                    ${canDelete ? `<button class="action-btn delete" data-act="delete-listing" data-id="${l.id}" data-name="${escHtml((l.title || t('fallback_listing','ობიექტი')).replace(/\"/g,'').replace(/'/g, ''))}" title="${t('action_delete','წაშლა')}"><i data-lucide="trash-2" class="lucide-i"></i></button>` : ''}
                                </div>
                            </td>
                        </tr>
                    `;
                }).join('')}
            </tbody>
        </table>
    `;
    if (window.lucide) try { window.lucide.createIcons(); } catch(e) {}
}

// Delegated handler for listings action buttons (robust against re-renders)
document.addEventListener('click', function(e) {
    const btn = e.target.closest('#listings-list [data-act]');
    if (!btn) return;
    e.preventDefault();
    const act = btn.dataset.act;
    const id  = btn.dataset.id;
    if (act === 'view-listing')     viewListing(id);
    else if (act === 'pdf-listing')      downloadListingPDF(id);
    else if (act === 'edit-listing')     editListing(id);
    else if (act === 'map-listing')      viewListingOnMap(id, parseFloat(btn.dataset.lat), parseFloat(btn.dataset.lng));
    else if (act === 'reassign-listing') reassignListing(id, btn.dataset.agent || '');
    else if (act === 'delete-listing')   deleteRecord('listings', id, btn.dataset.name || t('fallback_listing','ობიექტი'));
});

// Jump to the Map tab and fly to a specific listing's coordinates.
function viewListingOnMap(listingId, lat, lng) {
    navigateTo('map');
    // Wait for map to initialise if needed, then fly to marker
    const fly = () => {
        if (!mapInstance) { setTimeout(fly, 300); return; }
        mapInstance.flyTo({ center: [Number(lng), Number(lat)], zoom: 16, speed: 1.4 });
        // Open the popup on the matching marker
        setTimeout(() => {
            const match = mapMarkers.find(m => {
                const ll = m.getLngLat();
                return Math.abs(ll.lat - Number(lat)) < 0.0001 && Math.abs(ll.lng - Number(lng)) < 0.0001;
            });
            if (match) match.getPopup()?.addTo(mapInstance);
        }, 900);
    };
    fly();
}

// Manager/founder: assign or reassign a listing to an agent.
async function reassignListing(listingId, currentAgentId) {
    const { data: users } = await client.from('users')
        .select('id, first_name, last_name, role')
        .eq('company_id', currentUser.company_id);
    const opts = (users || []).map(u =>
        `<option value="${u.id}" ${u.id === currentAgentId ? 'selected' : ''}>${escHtml(u.first_name)} ${escHtml(u.last_name || '')} (${roleNames[u.role] || u.role})</option>`
    ).join('');
    openModal(t('action_reassign','აგენტზე მინიჭება'), `
        <div class="form-group">
            <label class="form-label">${t('choose_agent','აირჩიე აგენტი')}</label>
            <select class="form-select" id="reassign-agent">${opts}</select>
        </div>
        <button class="btn btn-primary" style="width:100%" onclick="saveReassignListing('${listingId}')"><i data-lucide="save" class="lucide-i"></i> ${t('btn_assign','მინიჭება')}</button>
    `);
}
async function saveReassignListing(listingId) {
    const agentId = document.getElementById('reassign-agent').value;
    const { error } = await client.from('listings').update({ agent_id: agentId }).eq('id', listingId);
    if (error) { showToast(t('err_prefix','შეცდომა') + ': ' + error.message, 'error'); return; }
    showToast('<i data-lucide="check-circle-2" class="lucide-i"></i> ' + t('listing_reassigned','ობიექტი მიენიჭა აგენტს'));
    closeModal();
    loadListings();
}

