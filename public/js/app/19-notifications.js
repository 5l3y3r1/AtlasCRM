// ═══════════════════════════════════════════════════════
// <i data-lucide="bell" class="lucide-i"></i> NOTIFICATIONS
// ═══════════════════════════════════════════════════════
async function loadNotifications() {
    const { data } = await client
        .from('notifications')
        .select('*')
        .eq('user_id', currentUser.id)
        .order('created_at', { ascending: false })
        .limit(50);
    
    const container = document.getElementById('notifications-list');
    
    if (!data || data.length === 0) {
        container.innerHTML = `
            <div class="empty">
                <div class="empty-icon"><i data-lucide="bell" class="lucide-i"></i></div>
                <div class="empty-title">შეტყობინებები ჯერ არ არის</div>
            </div>
        `;
        updateNotificationBadge(0);
        return;
    }
    
    // Field names are the table's own: type / title / message / link.
    // This block previously read notification_type / body / action_url, none of
    // which exist, so every notification rendered blank with a dead link.
    const esc = escHtml;   // the app's one escaper

    container.innerHTML = `
        <div style="display:grid;gap:10px">
            ${data.map(n => `
                <div class="notif-row${n.is_read ? '' : ' unread'}${URGENT_NOTIFICATION_TYPES.has(n.type) ? ' notif-urgent' : ''}" onclick="handleNotificationClick('${esc(n.id)}', '${esc(n.link || '')}')">
                    <div class="notif-icon">${getNotificationIcon(n.type)}</div>
                    <div style="flex:1;min-width:0">
                        <div class="notif-title">${esc(n.title)}</div>
                        ${n.message ? `<div class="notif-body">${esc(n.message)}</div>` : ''}
                        <div class="notif-time">${formatDateTime(n.created_at)}</div>
                    </div>
                    ${!n.is_read ? '<span class="notif-dot"></span>' : ''}
                </div>
            `).join('')}
        </div>
    `;
    
    const unread = data.filter(n => !n.is_read).length;
    updateNotificationBadge(unread);
}

function getNotificationIcon(type) {
    return {
        'NEW_LEAD': '<i data-lucide="inbox" class="lucide-i"></i>',
        'LEAD_ASSIGNED': '<i data-lucide="user" class="lucide-i"></i>',
        'NEW_MESSAGE': '<i data-lucide="message-circle" class="lucide-i"></i>',
        'TASK_DUE': '<i data-lucide="alarm-clock" class="lucide-i"></i>',
        'DEAL_STAGE_CHANGED': '<i data-lucide="briefcase" class="lucide-i"></i>',
        'COMMISSION_EARNED': '<i data-lucide="dollar-sign" class="lucide-i"></i>',
        'SHOWING_REMINDER': '<i data-lucide="calendar" class="lucide-i"></i>',
        'PROPERTY_MATCH': '<i data-lucide="target" class="lucide-i"></i>',
        // The task lifecycle, each stage distinguishable at a glance: handed to
        // you, moved off you, deadline today, deadline missed, closed out.
        'TASK_ASSIGNED': '<i data-lucide="clipboard-check" class="lucide-i"></i>',
        'TASK_REASSIGNED': '<i data-lucide="user-round-x" class="lucide-i"></i>',
        'TASK_OVERDUE': '<i data-lucide="alert-triangle" class="lucide-i"></i>',
        'TASK_COMPLETED': '<i data-lucide="check-circle-2" class="lucide-i"></i>',
        'TASK_CANCELLED': '<i data-lucide="x-circle" class="lucide-i"></i>'
    }[type] || '<i data-lucide="bell" class="lucide-i"></i>';
}

// A missed deadline should not look like every other line in the list.
const URGENT_NOTIFICATION_TYPES = new Set(['TASK_OVERDUE']);

async function handleNotificationClick(id, url) {
    await client.from('notifications').update({ is_read: true }).eq('id', id);
    // "#tasks" means an in-app page, not a URL — a full navigation would reload
    // the whole SPA just to land on a tab it can already switch to.
    if (url && url.startsWith('#')) {
        const page = url.slice(1);
        if (typeof navigateTo === 'function') { await navigateTo(page); }
    } else if (url) {
        window.location.href = url;
    }
    checkNotifications();
    if (typeof refreshTaskBadge === 'function') refreshTaskBadge();
}

async function markAllNotificationsRead() {
    await client.from('notifications').update({ is_read: true })
        .eq('user_id', currentUser.id)
        .eq('is_read', false);
    showToast('<i data-lucide="check-circle-2" class="lucide-i"></i> ყველა წაკითხულია');
    loadNotifications();
}

function updateNotificationBadge(count) {
    const badge = document.getElementById('notif-count');
    if (count > 0) {
        badge.textContent = count > 9 ? '9+' : count;
        badge.style.display = 'inline-block';
    } else {
        badge.style.display = 'none';
    }
}

// Check unread notifications periodically
async function checkNotifications() {
    if (!currentUser || !client) return;
    
    const { count } = await client
        .from('notifications')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', currentUser.id)
        .eq('is_read', false);
    
    updateNotificationBadge(count || 0);
}
