// ═══════════════════════════════════════════════════════
// <i data-lucide="map" class="lucide-i"></i> MAP — Hybrid Mapbox + Cadastral + Street View
// ═══════════════════════════════════════════════════════
let mapMarkers = [];
let mapStyleSatellite = false;
let selectedPhotos = [];

async function loadMap() {
    // Setup tabs first
    setupMapTabs();
    
    if (mapInstance) {
        setTimeout(() => mapInstance.resize(), 200);
        await refreshMapMarkers();
        return;
    }
    
    mapboxgl.accessToken = MAPBOX_TOKEN;
    
    mapInstance = new mapboxgl.Map({
        container: 'map-container',
        style: 'mapbox://styles/mapbox/streets-v12',
        center: [44.7833, 41.7167], // თბილისი
        zoom: 11
    });
    
    mapInstance.addControl(new mapboxgl.NavigationControl(), 'top-right');
    mapInstance.addControl(new mapboxgl.FullscreenControl(), 'top-right');
    mapInstance.addControl(new mapboxgl.GeolocateControl({
        positionOptions: { enableHighAccuracy: true },
        trackUserLocation: true
    }), 'top-right');
    
    // Style toggle
    document.getElementById('map-style-toggle').addEventListener('click', () => {
        mapStyleSatellite = !mapStyleSatellite;
        const btn = document.getElementById('map-style-toggle');
        
        if (mapStyleSatellite) {
            mapInstance.setStyle('mapbox://styles/mapbox/satellite-streets-v12');
            btn.innerHTML = '<i data-lucide="map" class="lucide-i"></i> Streets';
        } else {
            mapInstance.setStyle('mapbox://styles/mapbox/streets-v12');
            btn.innerHTML = '<i data-lucide="satellite" class="lucide-i"></i> Satellite';
        }
        
        // Re-add markers after style change
        mapInstance.once('styledata', () => {
            setTimeout(() => refreshMapMarkers(), 300);
        });
    });
    
    mapInstance.on('load', async () => {
        await refreshMapMarkers();
    });
}

async function refreshMapMarkers() {
    if (!mapInstance) return;

    // Clear old markers
    mapMarkers.forEach(m => m.remove());
    mapMarkers = [];

    // Get filters
    const typeFilter = document.getElementById('map-filter-type')?.value;
    const priceMin = document.getElementById('map-filter-price-min')?.value;
    const priceMax = document.getElementById('map-filter-price-max')?.value;
    const roomsFilter = document.getElementById('map-filter-rooms')?.value;
    const districtFilter = document.getElementById('map-filter-district')?.value;

    // Build query — fetch ALL active listings (with and without coords)
    const [listingsRes, usersRes] = await Promise.all([
        (async () => {
            let query = client
                .from('listings')
                .select('*, property_images(image_url, is_primary)')
                .eq('status', 'ACTIVE');

            if (typeFilter) query = query.eq('property_type', typeFilter);
            if (priceMin) query = query.gte('list_price', Number(priceMin));
            if (priceMax) query = query.lte('list_price', Number(priceMax));
            if (roomsFilter) {
                if (roomsFilter === '4') {
                    query = query.gte('bedrooms_total', 4);
                } else {
                    query = query.eq('bedrooms_total', Number(roomsFilter));
                }
            }
            if (districtFilter) query = query.ilike('district', `%${districtFilter}%`);

            return await query;
        })(),
        client.from('users').select('id, first_name, last_name').eq('company_id', currentUser.company_id)
    ]);

    let listings = listingsRes.data || [];
    const userMap = {};
    (usersRes.data || []).forEach(u => { userMap[u.id] = `${escHtml(u.first_name)} ${escHtml(u.last_name || '')}`.trim(); });

    const stats = document.getElementById('map-stats');

    if (!listings.length) {
        stats.innerHTML = '<i data-lucide="map-pin" class="lucide-i"></i> ფილტრის შესაბამისი ობიექტი არ არის';
        return;
    }

    // ── Geocode listings that have no coordinates ──────────────────────
    const noCoords = listings.filter(l => !l.latitude || !l.longitude);
    if (noCoords.length) {
        stats.innerHTML = `<i data-lucide="loader" class="lucide-i"></i> მისამართების geocoding… (${noCoords.length})`;
        await Promise.all(noCoords.map(async (listing) => {
            const parts = [
                listing.street_address,
                listing.district,
                listing.city,
                'საქართველო'
            ].filter(Boolean);
            if (!parts.length) return;
            try {
                const query = encodeURIComponent(parts.join(', '));
                const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${query}.json?access_token=${mapboxgl.accessToken}&country=ge&limit=1`;
                const res = await fetch(url);
                const json = await res.json();
                if (json.features && json.features.length) {
                    const [lng, lat] = json.features[0].center;
                    listing.latitude  = lat;
                    listing.longitude = lng;
                    // Save back to DB so we don't geocode again next time
                    client.from('listings').update({ latitude: lat, longitude: lng }).eq('id', listing.id).then(() => {});
                }
            } catch(e) { /* skip failed geocodes */ }
        }));
    }

    // Only show listings that now have coordinates
    listings = listings.filter(l => l.latitude && l.longitude);
    
    // Calculate stats
    const totalValue = listings.reduce((sum, l) => sum + Number(l.list_price || 0), 0);
    const avgPrice = totalValue / listings.length;
    
    stats.innerHTML = `
        <i data-lucide="bar-chart-3" class="lucide-i"></i> <strong>${listings.length} ობიექტი</strong> • 
        საშუალო: <strong>$${Math.round(avgPrice).toLocaleString()}</strong> • 
        ჯამი: <strong>$${totalValue.toLocaleString()}</strong>
    `;
    
    // Add markers
    const bounds = new mapboxgl.LngLatBounds();

    // ── Group listings that share an address ────────────────────────────
    // Multiple units in the same building geocode to the same point (or
    // near enough — 5 decimal places is ~1m), so placing one marker per
    // listing stacks them exactly on top of each other: only the last one
    // drawn is visible or clickable. Same-coordinate listings are combined
    // into a single marker with a list popup instead.
    const addressGroups = new Map();
    listings.forEach(listing => {
        const key = Number(listing.latitude).toFixed(5) + ',' + Number(listing.longitude).toFixed(5);
        if (!addressGroups.has(key)) addressGroups.set(key, []);
        addressGroups.get(key).push(listing);
    });

    const priceColor = (price) => {
        let color = '#34c759'; // green - cheap
        if (price > 100000) color = '#F59E0B';
        if (price > 200000) color = 'var(--brand)';
        if (price > 500000) color = '#ff3b30';
        return color;
    };

    const formatPriceLabel = (price) => {
        if (price > 1000000) return '$' + (price / 1000000).toFixed(1) + 'M';
        if (price > 1000) return '$' + Math.round(price / 1000) + 'K';
        return '$' + (price || 0).toLocaleString();
    };

    addressGroups.forEach(group => {
        const lat = Number(group[0].latitude);
        const lng = Number(group[0].longitude);
        const streetViewUrl = `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lng}`;

        let el, popupHtml;

        if (group.length === 1) {
            const listing = group[0];
            const color = priceColor(listing.list_price || 0);

            el = document.createElement('div');
            el.style.cssText = `
                background: ${color};
                color: white;
                padding: 6px 10px;
                border-radius: 8px;
                font-size: 12px;
                font-weight: 700;
                cursor: pointer;
                box-shadow: 0 2px 8px rgba(0,0,0,0.25);
                white-space: nowrap;
                border: 2px solid white;
            `;
            el.textContent = formatPriceLabel(listing.list_price || 0);

            // Photo
            const photos = listing.property_images || [];
            const primaryPhoto = photos.find(p => p.is_primary) || photos[0];
            const photoHtml = primaryPhoto
                ? `<img src="${primaryPhoto.image_url}" style="width:100%;height:120px;object-fit:cover;border-radius:8px;margin-bottom:8px">`
                : '';

            // Cadastral link (e-mta.gov.ge)
            const cadastralHtml = listing.cadastral_code
                ? `<a href="https://e-mta.gov.ge/?code=${escHtml(listing.cadastral_code)}" target="_blank" style="color:#4285f4;font-size:12px;text-decoration:none"><i data-lucide="clipboard-list" class="lucide-i"></i> ${escHtml(listing.cadastral_code)}</a>`
                : '';

            popupHtml = `
                <div style="min-width:240px">
                    ${photoHtml}
                    <div style="font-weight:700;font-size:14px;margin-bottom:4px;color:var(--text)">${escHtml(listing.title || 'ობიექტი')}</div>
                    <div style="color:var(--brand);font-weight:700;font-size:18px;margin-bottom:6px">$${(listing.list_price || 0).toLocaleString()}</div>
                    <div style="font-size:12px;color:var(--text-muted);line-height:1.5">
                        <i data-lucide="bed-double" class="lucide-i"></i> ${listing.bedrooms_total || '?'} ოთახი •
                        <i data-lucide="ruler" class="lucide-i"></i> ${listing.living_area ? Math.round(Number(listing.living_area)) + ' მ²' : (listing.total_area ? Math.round(Number(listing.total_area)) + ' მ²' : '—')} •
                        <i data-lucide="map-pin" class="lucide-i"></i> ${escHtml(listing.district || '—')}
                    </div>
                    ${cadastralHtml ? '<div style="margin-top:6px">' + cadastralHtml + '</div>' : ''}
                    <div style="font-size:12px;color:var(--text-muted);margin-top:6px;line-height:1.4">
                        <i data-lucide="user" class="lucide-i"></i> ${userMap[listing.created_by_id] || userMap[listing.agent_id] || '—'}
                    </div>
                    <div style="display:flex;gap:6px;margin-top:10px">
                        <a href="${streetViewUrl}" target="_blank" style="flex:1;padding:6px;background:#4285f4;color:white;text-align:center;border-radius:6px;font-size:11px;text-decoration:none;font-weight:600"><i data-lucide="globe" class="lucide-i"></i> Street View</a>
                        <button onclick="viewListing('${listing.id}')" style="flex:1;padding:6px;background:var(--brand);color:white;border:none;border-radius:6px;font-size:11px;cursor:pointer;font-weight:600"><i data-lucide="clipboard-list" class="lucide-i"></i> დეტალები</button>
                    </div>
                </div>
            `;
        } else {
            // Same-address group: one "stacked" marker showing the count,
            // popup lists every listing so none of them stay hidden.
            el = document.createElement('div');
            el.className = 'map-marker-group';
            el.textContent = String(group.length);

            const rows = group.map(listing => {
                const photos = listing.property_images || [];
                const thumb = photos.find(p => p.is_primary) || photos[0];
                const thumbHtml = thumb
                    ? `<img src="${thumb.image_url}" style="width:44px;height:44px;object-fit:cover;border-radius:6px;flex:none">`
                    : `<div style="width:44px;height:44px;border-radius:6px;flex:none;background:var(--surface-2);display:flex;align-items:center;justify-content:center;color:var(--text-subtle)"><i data-lucide="home" class="lucide-i"></i></div>`;
                return `
                    <div onclick="viewListing('${listing.id}')" style="display:flex;align-items:center;gap:10px;padding:6px;border-radius:8px;cursor:pointer;transition:background .12s" onmouseover="this.style.background='var(--surface-2)'" onmouseout="this.style.background='transparent'">
                        ${thumbHtml}
                        <div style="min-width:0;flex:1">
                            <div style="font-size:12.5px;font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(listing.title || 'ობიექტი')}</div>
                            <div style="font-size:12px;color:var(--brand);font-weight:700">$${(listing.list_price || 0).toLocaleString()} • ${listing.bedrooms_total || '?'} ოთახი</div>
                        </div>
                    </div>`;
            }).join('');

            popupHtml = `
                <div style="min-width:260px;max-width:280px">
                    <div style="font-weight:700;font-size:13px;margin-bottom:8px;color:var(--text);display:flex;align-items:center;gap:6px">
                        <i data-lucide="layers" class="lucide-i"></i> ${group.length} ობიექტი ამ მისამართზე
                    </div>
                    <div style="max-height:260px;overflow-y:auto;display:flex;flex-direction:column;gap:2px">
                        ${rows}
                    </div>
                    <div style="margin-top:8px">
                        <a href="${streetViewUrl}" target="_blank" style="display:flex;align-items:center;justify-content:center;gap:6px;padding:6px;background:#4285f4;color:white;text-align:center;border-radius:6px;font-size:11px;text-decoration:none;font-weight:600"><i data-lucide="globe" class="lucide-i"></i> Street View</a>
                    </div>
                </div>
            `;
        }

        const popup = new mapboxgl.Popup({ offset: 25, maxWidth: '280px' }).setHTML(popupHtml);
        // Popup content is only attached to the document once it's opened,
        // so icons inside it have to be (re)rendered on that event rather
        // than right after setHTML.
        popup.on('open', () => { if (window.lucide) try { window.lucide.createIcons(); } catch(e) {} });

        const marker = new mapboxgl.Marker(el)
            .setLngLat([lng, lat])
            .setPopup(popup)
            .addTo(mapInstance);

        mapMarkers.push(marker);
        bounds.extend([lng, lat]);
    });

    // Fit bounds if many markers
    if (mapMarkers.length > 1) {
        mapInstance.fitBounds(bounds, { padding: 80, maxZoom: 14 });
    }
}

function applyMapFilters() {
    refreshMapMarkers();
}

function setupMapTabs() {
    document.querySelectorAll('.tab-map').forEach(tab => {
        tab.onclick = () => switchMapTab(tab.dataset.maptab);
    });
}

function switchMapTab(name) {
    document.querySelectorAll('.tab-map').forEach(t => {
        t.classList.remove('active');
        t.style.background = 'transparent';
        t.style.color = '#666';
        t.style.boxShadow = 'none';
    });
    
    const activeTab = document.querySelector(`.tab-map[data-maptab="${name}"]`);
    if (activeTab) {
        activeTab.classList.add('active');
        activeTab.style.background = 'white';
        activeTab.style.color = 'var(--brand)';
        activeTab.style.boxShadow = '0 2px 6px rgba(0,0,0,0.08)';
    }
    
    document.getElementById('map-tab-ours').style.display = name === 'ours' ? 'block' : 'none';
    document.getElementById('map-tab-public').style.display = name === 'public' ? 'block' : 'none';
    
    if (name === 'ours' && mapInstance) {
        setTimeout(() => mapInstance.resize(), 200);
    }
}

