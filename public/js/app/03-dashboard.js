// ═══════════════════════════════════════════════════════
// <i data-lucide="bar-chart-3" class="lucide-i"></i> DASHBOARD
// ═══════════════════════════════════════════════════════
async function loadDashboard() {
    showDashboardSkeletons();
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const STAGES = ['LEAD', 'QUALIFICATION', 'SHOWING', 'NEGOTIATION', 'CLOSED_WON'];

    // These nine counts are independent, so issue them together rather than
    // awaiting each in turn — it was nine sequential round trips on every load.
    const [listings, leads, deals, commissions, ...stageCounts] = await Promise.all([
        client.from('listings').select('*', { count: 'exact', head: true }).eq('status', 'ACTIVE'),
        client.from('leads').select('*', { count: 'exact', head: true }).gte('created_at', thirtyDaysAgo.toISOString()),
        client.from('deals').select('*', { count: 'exact', head: true }).not('current_stage', 'in', '(CLOSED_WON,CLOSED_LOST)'),
        client.from('commission_records').select('user_amount'),
        ...STAGES.map(st => client.from('deals').select('*', { count: 'exact', head: true }).eq('current_stage', st)),
    ]);

    // Two more panels, fetched in parallel with each other.
    const [sourceRows, statusRows] = await Promise.all([
        client.from('leads').select('source').gte('created_at', thirtyDaysAgo.toISOString()),
        client.from('listings').select('status'),
    ]);
    renderLeadSources(sourceRows.data || []);
    renderStatusDonut(statusRows.data || []);

    animateCount(document.getElementById('kpi-listings'), listings.count || 0);
    animateCount(document.getElementById('kpi-leads'), leads.count || 0);
    animateCount(document.getElementById('kpi-deals'), deals.count || 0);

    const total = (commissions.data || []).reduce((sum, c) => sum + Number(c.user_amount || 0), 0);
    animateCount(document.getElementById('kpi-commission'), total, { format: n => '$' + n.toLocaleString() });

    // Funnel: bar width is each stage's share of the busiest stage, so the
    // shape shows where deals are piling up. With an empty pipeline every bar
    // is zero-width rather than a misleading full bar.
    const counts = STAGES.map((st, i) => stageCounts[i].count || 0);
    const peak = Math.max(...counts, 0);
    STAGES.forEach((st, i) => {
        animateCount(document.getElementById('stage-' + st), counts[i], { duration: 700 });
        const bar = document.getElementById('bar-' + st);
        if (!bar) return;
        bar.style.width = '0%';   // reset so revisiting the page replays the growth
        const pct = peak > 0 ? Math.max((counts[i] / peak) * 100, counts[i] ? 4 : 0) : 0;
        animateNextFrame(() => { bar.style.width = pct + '%'; });
    });

    // Recent leads
    const { data: recentLeads } = await client
        .from('leads')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(5);
    
    if (recentLeads && recentLeads.length > 0) {
        const html = `
            <table>
                <thead>
                    <tr>
                        <th>${t('th_name')}</th>
                        <th>${t('th_phone')}</th>
                        <th>${t('th_source')}</th>
                        <th>${t('th_status')}</th>
                        <th>${t('th_date')}</th>
                    </tr>
                </thead>
                <tbody>
                    ${recentLeads.map(l => `
                        <tr>
                            <td><strong>${escapeHtmlSafe(l.full_name || '—')}</strong></td>
                            <td>${escapeHtmlSafe(l.phone || '—')}</td>
                            <td>${escapeHtmlSafe(l.source)}</td>
                            <td><span class="badge badge-${(l.temperature || 'cold').toLowerCase()}">${l.temperature || 'COLD'}</span></td>
                            <td>${formatDate(l.created_at)}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
        document.getElementById('recent-leads').innerHTML = html;
    }
    if (window.lucide) try { window.lucide.createIcons(); } catch(e) {}
}



// ═══════════════════════════════════════════════════════
// Lead sources — where the last 30 days of leads came from
// ═══════════════════════════════════════════════════════
function renderLeadSources(rows) {
    const el = document.getElementById('lead-sources');
    if (!el) return;
    if (!rows.length) {
        el.innerHTML = `<div class="dash-empty">${t('no_leads_30d') || 'ბოლო 30 დღეში ლიდები არ არის'}</div>`;
        return;
    }

    const counts = {};
    for (const r of rows) {
        const key = r.source || 'OTHER';
        counts[key] = (counts[key] || 0) + 1;
    }
    // Biggest first, capped at six rows — a long tail of one-offs is noise.
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    const top = sorted.slice(0, 6);
    const restTotal = sorted.slice(6).reduce((n, [, v]) => n + v, 0);
    if (restTotal) top.push(['სხვა', restTotal]);

    const total = rows.length;
    const peak = Math.max(...top.map(([, v]) => v), 1);

    // Width is applied on a later frame, not in this markup: a transition only
    // runs when the value CHANGES after layout, so baking the final width into
    // the HTML would make the bars appear fully grown.
    el.innerHTML = top.map(([name, n]) => {
        const pct = Math.round((n / total) * 100);
        return `<div class="srcbar">
            <span class="srcbar-label" title="${escapeHtmlSafe(name)}">${escapeHtmlSafe(name)}</span>
            <span class="srcbar-track"><span class="srcbar-fill" data-w="${(n / peak) * 100}"></span></span>
            <span class="srcbar-val">${n} <span>· ${pct}%</span></span>
        </div>`;
    }).join('');
    animateNextFrame(() => {
        el.querySelectorAll('.srcbar-fill').forEach((f, i) => {
            f.style.transitionDelay = (i * 60) + 'ms';
            f.style.width = f.dataset.w + '%';
        });
    });
}

// ═══════════════════════════════════════════════════════
// Listings by status — SVG donut, no charting library
// ═══════════════════════════════════════════════════════
const STATUS_COLORS = {
    ACTIVE:   '#10B981',
    PENDING:  '#F59E0B',
    RESERVED: '#8B5CF6',
    SOLD:     '#1D4ED8',
    RENTED:   '#0891B2',
    DRAFT:    '#94A3B8',
    ARCHIVED: '#CBD5E1',
    INACTIVE: '#CBD5E1',
};

function renderStatusDonut(rows) {
    const segEl = document.getElementById('donut-segments');
    const legendEl = document.getElementById('status-legend');
    const totalEl = document.getElementById('donut-total');
    if (!segEl || !legendEl) return;

    const counts = {};
    for (const r of rows) {
        const key = r.status || 'DRAFT';
        counts[key] = (counts[key] || 0) + 1;
    }
    const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    const total = rows.length;

    if (!total) {
        if (totalEl) totalEl.textContent = '0';
        segEl.innerHTML = '';
        legendEl.innerHTML = `<div class="dash-empty">${t('no_listings') || 'ობიექტები არ არის'}</div>`;
        return;
    }

    // r=15.9155 makes the circumference exactly 100, so a segment's dash length
    // is its percentage directly — no arc maths, and it scales with the viewBox.
    let offset = 0;
    segEl.innerHTML = entries.map(([status, n]) => {
        const pct = (n / total) * 100;
        const color = STATUS_COLORS[status] || '#94A3B8';
        // Starts as "0 100" — a zero-length arc — and grows to its real share.
        const seg = `<circle class="donut-seg" cx="21" cy="21" r="15.9155"
            stroke="${color}" stroke-dasharray="0 100"
            data-dash="${pct} ${100 - pct}"
            stroke-dashoffset="${-offset}"></circle>`;
        offset += pct;
        return seg;
    }).join('');
    animateNextFrame(() => {
        segEl.querySelectorAll('.donut-seg').forEach((c, i) => {
            c.style.transitionDelay = (i * 110) + 'ms';
            c.setAttribute('stroke-dasharray', c.dataset.dash);
        });
    });

    if (totalEl) animateCount(totalEl, total, { duration: 800 });

    legendEl.innerHTML = entries.map(([status, n]) => `
        <div class="legend-row">
            <span class="legend-dot" style="background:${STATUS_COLORS[status] || '#94A3B8'}"></span>
            <span class="legend-name">${escapeHtmlSafe(status)}</span>
            <span class="legend-val">${n}</span>
        </div>`).join('');
}

// Status and source values come from the database; escape before interpolating.
function escapeHtmlSafe(v) { return escHtml(v); }   // delegates to the canonical escaper


/**
 * Placeholder bars while the panels wait on their queries. An empty card reads
 * as "there is no data"; a shimmer reads as "this is still loading" — which is
 * the truthful signal during the round trip.
 */
function showDashboardSkeletons() {
    const src = document.getElementById('lead-sources');
    if (src && !src.children.length) {
        src.innerHTML = Array.from({ length: 5 }, (_, i) => `
            <div class="srcbar">
                <span class="skeleton" style="width:78px;height:11px"></span>
                <span class="srcbar-track"><span class="skeleton" style="display:block;height:100%;width:${70 - i * 11}%"></span></span>
                <span class="skeleton" style="width:38px;height:11px"></span>
            </div>`).join('');
    }
    const legend = document.getElementById('status-legend');
    if (legend && !legend.children.length) {
        legend.innerHTML = Array.from({ length: 3 }, () =>
            `<div class="legend-row"><span class="skeleton" style="width:100%;height:12px"></span></div>`).join('');
    }
}
