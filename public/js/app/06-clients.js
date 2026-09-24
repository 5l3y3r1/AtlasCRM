// ═══════════════════════════════════════════════════════
// <i data-lucide="users" class="lucide-i"></i> CLIENTS
// ═══════════════════════════════════════════════════════
async function loadClients() {
    const { data } = await client
        .from('clients')
        .select('*')
        .order('created_at', { ascending: false });
    
    const container = document.getElementById('clients-list');
    
    if (!data || data.length === 0) {
        container.innerHTML = `
            <div class="empty">
                <div class="empty-icon"><i data-lucide="users" class="lucide-i"></i></div>
                <div class="empty-title">${t("empty_clients")}</div>
                <div class="empty-sub">${t("empty_clients_sub")}</div>
            </div>
        `;
        return;
    }
    
    container.innerHTML = `
        <table>
            <thead>
                <tr><th>#</th><th>${t("th_name")}</th><th>${t("th_phone")}</th><th>${t("th_email")}</th><th>${t("th_type")}</th><th>${t("th_budget")}</th><th></th></tr>
            </thead>
            <tbody>
                ${data.map(c => `
                    <tr>
                        <td>${c.client_number || '—'}</td>
                        <td><strong>${escHtml(c.first_name)} ${escHtml(c.last_name || '')}</strong></td>
                        <td>${escHtml(c.phone || '—')}</td>
                        <td>${escHtml(c.email || '—')}</td>
                        <td>${Array.isArray(c.client_type) ? c.client_type.join(', ') : (c.client_type || '—')}</td>
                        <td>${c.budget_max ? '$' + c.budget_max.toLocaleString() : '—'}</td>
                        <td>
                            <div class="action-buttons">
                                <button class="action-btn" onclick="openMsgModal('client','${c.id}','${escHtml((c.phone||'').replace(/'/g,''))}','${escHtml((c.email||'').replace(/'/g,''))}','${escHtml((c.first_name+' '+(c.last_name||'')).trim().replace(/'/g,''))}')" title="შეტყობინება" style="color:#25D366"><i data-lucide="message-circle" class="lucide-i"></i></button>
                                <button class="action-btn edit" onclick="editClient('${c.id}')" title="რედაქტირება"><i data-lucide="pencil" class="lucide-i"></i></button>
                                <button class="action-btn delete" onclick="deleteRecord('clients', '${c.id}', '${escHtml((c.first_name + ' ' + (c.last_name || '')).replace(/'/g, ''))}')" title="წაშლა"><i data-lucide="trash-2" class="lucide-i"></i></button>
                            </div>
                        </td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
    if (window.lucide) try { window.lucide.createIcons(); } catch(e) {}
}

