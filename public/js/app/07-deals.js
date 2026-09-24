// ═══════════════════════════════════════════════════════
// <i data-lucide="briefcase" class="lucide-i"></i> DEALS
// ═══════════════════════════════════════════════════════
async function loadDeals() {
    const { data } = await client
        .from('deals')
        .select('*')
        .order('created_at', { ascending: false });
    
    const container = document.getElementById('deals-list');
    
    if (!data || data.length === 0) {
        container.innerHTML = `
            <div class="empty">
                <div class="empty-icon"><i data-lucide="briefcase" class="lucide-i"></i></div>
                <div class="empty-title">${t("empty_deals")}</div>
            </div>
        `;
        return;
    }
    
    container.innerHTML = `
        <table>
            <thead>
                <tr><th>#</th><th>${t("th_title")}</th><th>${t("th_type")}</th><th>${t("th_stage")}</th><th>${t("th_price")}</th><th>${t("th_date")}</th><th></th></tr>
            </thead>
            <tbody>
                ${data.map(d => `
                    <tr>
                        <td>${d.deal_number || '—'}</td>
                        <td><strong>${escHtml(d.title || '—')}</strong></td>
                        <td>${d.deal_type}</td>
                        <td><span class="badge badge-active">${d.current_stage}</span></td>
                        <td>${d.asking_price ? '$' + d.asking_price.toLocaleString() : '—'}</td>
                        <td>${formatDate(d.created_at)}</td>
                        <td>
                            <div class="action-buttons">
                                <button class="action-btn edit" onclick="editDeal('${d.id}')" title="${t('action_edit','რედაქტირება')}"><i data-lucide="pencil" class="lucide-i"></i></button>
                                <button class="action-btn delete" onclick="deleteRecord('deals', '${d.id}', '${escHtml((d.title || t('fallback_deal','გარიგება')).replace(/'/g, ''))}')" title="${t('action_delete','წაშლა')}"><i data-lucide="trash-2" class="lucide-i"></i></button>
                            </div>
                        </td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
    if (window.lucide) try { window.lucide.createIcons(); } catch(e) {}
}

