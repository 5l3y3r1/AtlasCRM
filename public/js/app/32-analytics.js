// ═══════════════════════════════════════════════════════
// STATISTICS
//
// Everything on this page comes from GET /api/analytics. When a date range is
// set, the API also measures the equal-length window before it, so figures are
// shown as movement rather than as bare numbers.
// ═══════════════════════════════════════════════════════
let _analyticsData = null;
let _activePreset = null;

const _money = (n) => '$' + Number(n || 0).toLocaleString();
const _short = (n) => {
    const v = Number(n || 0);
    if (Math.abs(v) >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M';
    if (Math.abs(v) >= 1e3) return '$' + Math.round(v / 1e3) + 'k';
    return '$' + v;
};
function _escStat(v) { return escHtml(v); }   // renamed: `_esc` collided with 31-crm-extra.js

/* ─── Date range ──────────────────────────────────────────────────────── */

function analyticsSetPreset(days, el) {
    const to = new Date();
    const from = new Date(Date.now() - (days - 1) * 86400000);
    document.getElementById('an-from').value = days ? from.toISOString().slice(0, 10) : '';
    document.getElementById('an-to').value = days ? to.toISOString().slice(0, 10) : '';
    _activePreset = days;
    document.querySelectorAll('.range-preset').forEach(b => b.classList.toggle('active', b === el));
    loadAnalytics();
}

function analyticsClearRange(el) {
    document.getElementById('an-from').value = '';
    document.getElementById('an-to').value = '';
    _activePreset = null;
    document.querySelectorAll('.range-preset').forEach(b => b.classList.toggle('active', b === el));
    loadAnalytics();
}

/* ─── Load ────────────────────────────────────────────────────────────── */

async function loadAnalytics() {
    const body = document.getElementById('analytics-body');
    if (!body) return;
    const from = document.getElementById('an-from')?.value || '';
    const to = document.getElementById('an-to')?.value || '';

    body.innerHTML = analyticsSkeleton();
    try {
        const qs = new URLSearchParams();
        if (from) qs.set('from', from);
        if (to) qs.set('to', to);
        const r = await fetch('/api/analytics?' + qs.toString(), { credentials: 'include' });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || 'შეცდომა');
        _analyticsData = j.data;
        renderAnalytics(j.data);
    } catch (e) {
        body.innerHTML = `<div class="card" style="text-align:center;padding:40px;color:var(--danger)">
            სტატისტიკის ჩატვირთვა ვერ მოხერხდა: ${_escStat(e.message)}</div>`;
    }
}

function analyticsSkeleton() {
    const card = `<div class="stat-big"><div class="skeleton" style="width:70%;height:11px"></div>
        <div class="skeleton" style="width:50%;height:26px;margin-top:12px"></div>
        <div class="skeleton" style="width:40%;height:11px;margin-top:10px"></div></div>`;
    return `<div class="stat-hero">${card.repeat(4)}</div>
        <div class="card"><div class="skeleton" style="width:100%;height:200px"></div></div>`;
}

/* ─── Delta pill ──────────────────────────────────────────────────────── */

/**
 * Percentage movement against the previous window.
 * Returns '' when there is nothing to compare — showing "+100%" because the
 * baseline was zero would be noise dressed up as insight.
 */
function _delta(current, previous) {
    if (previous == null) return '';
    const cur = Number(current) || 0, prev = Number(previous) || 0;
    if (!prev) return cur ? `<span class="stat-delta up">ახალი</span>` : '';
    const pct = Math.round(((cur - prev) / prev) * 100);
    if (pct === 0) return `<span class="stat-delta flat">0%</span>`;
    const up = pct > 0;
    return `<span class="stat-delta ${up ? 'up' : 'down'}">${up ? '↑' : '↓'} ${Math.abs(pct)}%</span>`;
}

function _statBig(label, value, sub, accent, delta) {
    return `<div class="stat-big" style="--accent:${accent || 'var(--brand)'}">
        <div class="stat-big-label">${_escStat(label)}</div>
        <div class="stat-big-value" data-count-to="${value.raw != null ? value.raw : ''}"
             data-count-fmt="${value.fmt || 'plain'}">${value.text}</div>
        <div class="stat-big-foot">${delta || ''}${sub ? `<span class="stat-sub">${_escStat(sub)}</span>` : ''}</div>
    </div>`;
}

/* ─── Revenue trend (SVG, no charting library) ─────────────────────────── */

function _trendChart(points) {
    if (!points.length) {
        return `<div class="dash-empty">ჯერ არ არის დახურული გარიგებები</div>`;
    }
    const W = 760, H = 200, padL = 46, padR = 12, padT = 14, padB = 26;
    const innerW = W - padL - padR, innerH = H - padT - padB;
    const max = Math.max(...points.map(p => p.v), 1);
    // Round the top of the scale up so the axis labels are readable numbers.
    const step = Math.pow(10, Math.floor(Math.log10(max)));
    const top = Math.ceil(max / step) * step || 1;

    const x = i => padL + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
    const y = v => padT + innerH - (v / top) * innerH;

    const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
    const area = `${line} L${x(points.length - 1).toFixed(1)},${(padT + innerH).toFixed(1)} L${x(0).toFixed(1)},${(padT + innerH).toFixed(1)} Z`;

    const gridRows = 4;
    const grid = Array.from({ length: gridRows + 1 }, (_, i) => {
        const gv = (top / gridRows) * i;
        const gy = y(gv).toFixed(1);
        return `<line x1="${padL}" y1="${gy}" x2="${W - padR}" y2="${gy}"/>
                <text class="trend-ylabel" x="${padL - 8}" y="${+gy + 3}">${_short(gv)}</text>`;
    }).join('');

    // One label every other month once the series gets long, so they don't collide.
    const everyOther = points.length > 8;
    const xLabels = points.map((p, i) =>
        (everyOther && i % 2) ? '' :
        `<text class="trend-xlabel" x="${x(i).toFixed(1)}" y="${H - 6}">${_escStat(p.label)}</text>`).join('');

    const dots = points.map((p, i) =>
        `<circle class="trend-dot" cx="${x(i).toFixed(1)}" cy="${y(p.v).toFixed(1)}" r="4"></circle>`).join('');

    // Invisible full-height columns give each point a comfortable hover target.
    const hit = points.map((p, i) => {
        const w = innerW / Math.max(points.length - 1, 1);
        return `<rect class="trend-hit" x="${(x(i) - w / 2).toFixed(1)}" y="${padT}" width="${w.toFixed(1)}" height="${innerH}"
            data-label="${_escStat(p.label)}" data-value="${p.v}" data-count="${p.n || 0}"
            data-x="${x(i).toFixed(1)}" data-y="${y(p.v).toFixed(1)}"></rect>`;
    }).join('');

    return `<div class="trend">
        <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="შემოსავლის დინამიკა">
            <defs>
                <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%"   stop-color="var(--brand)" stop-opacity=".22"/>
                    <stop offset="100%" stop-color="var(--brand)" stop-opacity="0"/>
                </linearGradient>
            </defs>
            <g class="trend-grid">${grid}</g>
            <path class="trend-area" d="${area}"/>
            <path class="trend-line" d="${line}"/>
            ${dots}${xLabels}${hit}
        </svg>
        <div class="trend-tip" id="trend-tip"></div>
    </div>`;
}

/** Draw the line on, then wire the hover readout. */
function _activateTrend(root) {
    const path = root.querySelector('.trend-line');
    const area = root.querySelector('.trend-area');
    if (path && !prefersReducedMotion()) {
        try {
            const len = path.getTotalLength();
            path.style.strokeDasharray = len;
            path.style.strokeDashoffset = len;
            if (area) area.style.opacity = '0';
            animateNextFrame(() => {
                path.style.transition = 'stroke-dashoffset 1.1s cubic-bezier(.4,0,.2,1)';
                path.style.strokeDashoffset = '0';
                if (area) { area.style.transition = 'opacity .8s ease-out .35s'; area.style.opacity = '1'; }
            });
        } catch (e) { /* getTotalLength can throw on a detached node */ }
    }

    const tip = root.querySelector('#trend-tip');
    const wrap = root.querySelector('.trend');
    if (!tip || !wrap) return;
    root.querySelectorAll('.trend-hit').forEach(r => {
        r.addEventListener('mouseenter', () => {
            const box = wrap.getBoundingClientRect();
            const svg = wrap.querySelector('svg').getBoundingClientRect();
            // The viewBox is scaled to the container, so map SVG units to pixels.
            const sx = svg.width / 760, sy = svg.height / 200;
            tip.innerHTML = `${_escStat(r.dataset.label)}<br>${_money(r.dataset.value)} · ${r.dataset.count} გარიგება`;
            tip.style.left = (parseFloat(r.dataset.x) * sx + (svg.left - box.left)) + 'px';
            tip.style.top = (parseFloat(r.dataset.y) * sy + (svg.top - box.top)) + 'px';
            tip.classList.add('show');
        });
        r.addEventListener('mouseleave', () => tip.classList.remove('show'));
    });
}

/* ─── Ranked bar list ─────────────────────────────────────────────────── */

function _rankList(items, labelKey, valKey, fmt, total) {
    if (!items || !items.length) return `<div class="dash-empty">მონაცემები არ არის</div>`;
    const peak = Math.max(...items.map(i => Number(i[valKey]) || 0), 1);
    return `<div class="rank-list">` + items.map(i => {
        const v = Number(i[valKey]) || 0;
        const pct = total ? Math.round((v / total) * 100) : null;
        return `<div class="rank-item">
            <span class="rank-name" title="${_escStat(i[labelKey])}">${_escStat(i[labelKey] || '—')}</span>
            <span class="rank-track"><span class="rank-fill" data-w="${(v / peak) * 100}"></span></span>
            <span class="rank-val">${fmt ? fmt(v) : v}${pct != null ? ` <em>· ${pct}%</em>` : ''}</span>
        </div>`;
    }).join('') + `</div>`;
}

/* ─── Render ──────────────────────────────────────────────────────────── */

function renderAnalytics(d) {
    const body = document.getElementById('analytics-body');
    if (!body) return;
    const s = d.sales, c = d.clients, p = d.properties, l = d.leads, prev = d.prev;
    const monthLabel = (ym) => ym ? ym.slice(5) + '/' + ym.slice(2, 4) : '';
    const trend = (s.monthly || []).map(m => ({ label: monthLabel(m.ym), v: Number(m.v) || 0, n: m.n }));
    const clientsTrend = (c.monthly || []).map(m => ({ label: monthLabel(m.ym), n: Number(m.n) || 0 }));

    const periodNote = d.range.from || d.range.to ? rangeLabel() : 'ყველა დრო';
    const cmpNote = d.range.previous ? `წინა პერიოდთან შედარებით` : '';

    body.innerHTML = `
        <div class="stat-hero">
            ${_statBig('შემოსავალი', { raw: s.revenue, fmt: 'money', text: _money(s.revenue) },
                periodNote, 'var(--success)', _delta(s.revenue, prev && prev.revenue))}
            ${_statBig('დახურული გარიგებები', { raw: s.dealsClosed, fmt: 'plain', text: s.dealsClosed },
                `${s.dealsOpen} მიმდინარე`, 'var(--brand)', _delta(s.dealsClosed, prev && prev.dealsClosed))}
            ${_statBig('საკომისიო', { raw: s.commission, fmt: 'money', text: _money(s.commission) },
                cmpNote, 'var(--warning)', _delta(s.commission, prev && prev.commission))}
            ${_statBig('ახალი ლიდები', { raw: s.newLeads, fmt: 'plain', text: s.newLeads },
                `${l.conversionRate}% კონვერსია`, 'var(--info)', _delta(s.newLeads, prev && prev.newLeads))}
        </div>

        <div class="mini-strip">
            <div class="mini-stat"><div class="mini-stat-label">საშუალო გარიგება</div>
                <div class="mini-stat-value">${_money(s.avgDealSize)}</div></div>
            <div class="mini-stat"><div class="mini-stat-label">მოგების მაჩვენებელი</div>
                <div class="mini-stat-value">${s.winRate}%</div></div>
            <div class="mini-stat"><div class="mini-stat-label">დახურვის დრო</div>
                <div class="mini-stat-value">${s.avgDaysToClose != null ? s.avgDaysToClose + ' დღე' : '—'}</div></div>
            <div class="mini-stat"><div class="mini-stat-label">წაგებული</div>
                <div class="mini-stat-value">${s.dealsLost}</div></div>
            <div class="mini-stat"><div class="mini-stat-label">აქტიური კლიენტები</div>
                <div class="mini-stat-value">${c.activeClients}</div></div>
            <div class="mini-stat"><div class="mini-stat-label">საშ. ფასი (აქტიური)</div>
                <div class="mini-stat-value">${_money(p.avgPrice)}</div></div>
        </div>

        <div class="card">
            <div class="card-header">
                <div>
                    <div class="card-title">შემოსავლის დინამიკა</div>
                    <div style="font-size:13px;color:var(--text-muted);margin-top:4px">ბოლო 12 თვე · დახურული გარიგებები</div>
                </div>
            </div>
            ${_trendChart(trend)}
        </div>

        <div class="stat-section">ლიდები</div>
        <div class="dash-row">
            <div class="card">
                <div class="card-header"><div class="card-title">წყაროები</div></div>
                ${_rankList(l.bySource || [], 'k', 'n', null, l.newLeads || null)}
            </div>
            <div class="card">
                <div class="card-header"><div class="card-title">სიმხურვალე</div></div>
                ${_rankList(l.byTemperature || [], 'k', 'n', null, l.newLeads || null)}
            </div>
        </div>

        <div class="stat-section">ობიექტები</div>
        <div class="dash-row">
            <div class="card">
                <div class="card-header"><div class="card-title">ტიპები</div></div>
                ${_rankList(p.types || [], 'k', 'n', null, p.total || null)}
            </div>
            <div class="card">
                <div class="card-header"><div class="card-title">რაიონები</div></div>
                ${_rankList(p.byDistrict || [], 'k', 'n', null, p.total || null)}
            </div>
        </div>

        <div class="stat-section">კლიენტები</div>
        <div class="card">
            <div class="card-header"><div class="card-title">ახალი კლიენტები თვეში</div></div>
            ${_rankList(clientsTrend, 'label', 'n')}
        </div>

        <div class="stat-section">აგენტების შედეგები</div>
        <div class="card">
            ${_board(d.agents || [])}
        </div>
    `;

    _activateTrend(body);

    // Bars grow on the frame after layout — see animateNextFrame.
    animateNextFrame(() => {
        body.querySelectorAll('.rank-fill, .board-bar span').forEach((f, i) => {
            f.style.transitionDelay = Math.min(i * 35, 500) + 'ms';
            f.style.width = f.dataset.w + '%';
        });
    });

    // Count the headline figures up from zero.
    body.querySelectorAll('[data-count-to]').forEach(el => {
        const target = Number(el.dataset.countTo);
        if (!isFinite(target)) return;
        const money = el.dataset.countFmt === 'money';
        animateCount(el, target, { duration: 950, format: n => money ? _money(n) : n.toLocaleString() });
    });

    if (window.lucide) { try { window.lucide.createIcons(); } catch (e) {} }
}

function _board(agents) {
    if (!agents.length) return `<div class="dash-empty">აგენტები არ არის</div>`;
    const peak = Math.max(...agents.map(a => Number(a.revenue) || 0), 1);
    return `<div class="board">` + agents.map((a, i) => {
        const name = ((a.first_name || '') + ' ' + (a.last_name || '')).trim() || '—';
        const initials = typeof initialsOf === 'function' ? initialsOf(name) : '?';
        const rev = Number(a.revenue) || 0;
        return `<div class="board-row">
            <span class="board-rank">${i + 1}</span>
            <span class="board-who">
                <span class="board-avatar">${a.avatar_url
                    ? `<img src="${_escStat(a.avatar_url)}" alt="">` : _escStat(initials)}</span>
                <span style="min-width:0">
                    <span class="board-name">${_escStat(name)}</span>
                    <span class="board-role">${_escStat(a.role || '')} · ${a.listings || 0} ობიექტი</span>
                </span>
            </span>
            <span class="board-bar"><span data-w="${(rev / peak) * 100}"></span></span>
            <span class="board-money">${_money(rev)}<small>${a.closed || 0} დახურული</small></span>
        </div>`;
    }).join('') + `</div>`;
}

function rangeLabel() {
    const f = document.getElementById('an-from')?.value, t = document.getElementById('an-to')?.value;
    if (f && t) return f + ' → ' + t;
    if (f) return f + '-დან';
    if (t) return t + '-მდე';
    return 'ყველა დრო';
}

/* ─── Export ──────────────────────────────────────────────────────────── */

function analyticsExportExcel() {
    if (!_analyticsData) return;
    const d = _analyticsData;
    const rows = [
        ['პერიოდი', rangeLabel()],
        [],
        ['მაჩვენებელი', 'მნიშვნელობა'],
        ['შემოსავალი', d.sales.revenue],
        ['საკომისიო', d.sales.commission],
        ['დახურული გარიგებები', d.sales.dealsClosed],
        ['წაგებული გარიგებები', d.sales.dealsLost],
        ['მიმდინარე გარიგებები', d.sales.dealsOpen],
        ['საშუალო გარიგება', d.sales.avgDealSize],
        ['მოგების მაჩვენებელი %', d.sales.winRate],
        ['დახურვის საშ. დრო (დღე)', d.sales.avgDaysToClose == null ? '' : d.sales.avgDaysToClose],
        [],
        ['ახალი ლიდები', d.leads.newLeads],
        ['კონვერტირებული ლიდები', d.leads.converted],
        ['ლიდების კონვერსია %', d.leads.conversionRate],
        ['ახალი კლიენტები', d.clients.newClients],
        ['აქტიური კლიენტები', d.clients.activeClients],
        ['სულ კლიენტები', d.clients.totalClients],
        [],
        ['სულ ობიექტი', d.properties.total],
        ['აქტიური', d.properties.active],
        ['გაყიდული', d.properties.sold],
        ['გაქირავებული', d.properties.rented],
        ['საშ. ფასი (აქტიური)', d.properties.avgPrice],
        [],
        ['ლიდის წყარო', 'რაოდენობა'],
        ...(d.leads.bySource || []).map(x => [x.k, x.n]),
        [],
        ['ობიექტის ტიპი', 'რაოდენობა'],
        ...(d.properties.types || []).map(x => [x.k, x.n]),
        [],
        ['აგენტი', 'როლი', 'დახურული', 'ობიექტები', 'შემოსავალი', 'საკომისიო'],
        ...(d.agents || []).map(a => [
            ((a.first_name || '') + ' ' + (a.last_name || '')).trim(),
            a.role || '', a.closed || 0, a.listings || 0, a.revenue || 0, a.commission || 0,
        ]),
    ];
    // Prefix cells that Excel would otherwise evaluate as a formula.
    const cell = (c) => {
        let v = String(c == null ? '' : c);
        if (/^[=+\-@\t\r]/.test(v)) v = '\t' + v;
        return '"' + v.replace(/"/g, '""') + '"';
    };
    const csv = rows.map(r => r.map(cell).join(',')).join('\r\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `statistics-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function analyticsExportPDF() {
    window.print();
}
