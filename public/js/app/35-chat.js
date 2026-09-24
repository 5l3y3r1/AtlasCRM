// ═══ Team chat (group channels + 1:1 private DMs) ═══
// REST is the single source of truth for reads/writes; WebSocket only pushes
// live updates to sockets already open, with a polling fallback if the socket
// drops (mirrors the resilience pattern used by the Inbox page's badge poll).

let _chatChannels = [];
let _chatActiveId = null;
let _chatMessages = [];           // messages currently loaded for the active channel
let _chatWs = null;
let _chatPollInterval = null;
let _chatTypingTimeout = null;
let _chatPendingAttach = null;    // {type:'reply', replyToId, label} or {type:'ref', refType, refId, refLabel}
let _chatEditingId = null;
const _chatSeenMessageIds = new Set(); // prevents double-append: REST response + our own WS push both deliver the same new message
const CHAT_EMOJIS = ['👍', '❤️', '😂', '🎉', '🔥', '👏', '😮', '✅'];
const CHAT_REF_ICON = { LEAD: '📥', DEAL: '💼', LISTING: '🏠', CLIENT: '👤', MEETING: '🤝' };
const CHAT_REF_KEY = { LEAD: 'ref_lead', DEAL: 'ref_deal', LISTING: 'ref_listing', CLIENT: 'ref_client', MEETING: 'ref_meeting' };

function _chatEsc(v) { return escHtml(v); }   // delegates to the canonical escaper

async function loadChatPage() {
    await _chatRenderChannelList();
    _chatConnectWs();
    if (!_chatPollInterval) _chatPollInterval = setInterval(_chatRenderChannelList, 20000);
    if (!_chatActiveId && _chatChannels.length) openChatChannel(_chatChannels[0].id);
}

async function _chatFetchChannels() {
    try {
        const r = await fetch('/api/chat/channels', { credentials: 'include' });
        const j = await r.json();
        _chatChannels = j.data || [];
    } catch (e) { _chatChannels = []; }
    return _chatChannels;
}

async function _chatRenderChannelList() {
    await _chatFetchChannels();
    _chatRenderChannelListFromState();
}

function _chatRenderChannelListFromState() {
    const list = document.getElementById('chat-channel-list');
    if (!list) return;
    const totalUnread = _chatChannels.reduce((s, c) => s + (c.unread || 0), 0);
    updateChatBadge(totalUnread);

    list.innerHTML = _chatChannels.map(c => {
        const active = c.id === _chatActiveId;
        const icon = c.is_dm ? '<i data-lucide="user" class="lucide-i"></i>' : '<i data-lucide="hash" class="lucide-i"></i>';
        const preview = c.last_message
            ? _chatEsc((c.last_message.sender_name ? c.last_message.sender_name.split(' ')[0] + ': ' : '') + (c.last_message.content || (c.last_message.attachment_url ? '📷 სურათი' : ''))).slice(0, 45)
            : '';
        return `<div onclick="openChatChannel('${c.id}')" style="padding:10px 14px;cursor:pointer;display:flex;align-items:center;gap:8px;${active ? 'background:var(--brand);color:#fff' : ''}">
            <span style="flex:none;opacity:.8">${icon}</span>
            <div style="min-width:0;flex:1">
                <div style="font-weight:600;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${_chatEsc(c.name || 'Chat')}${c.is_dm && c.other_online ? ' <span style="color:#16a34a">●</span>' : ''}</div>
                ${preview ? `<div style="font-size:11px;${active ? 'color:rgba(255,255,255,.8)' : 'color:var(--text-muted)'};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${preview}</div>` : ''}
            </div>
            ${c.unread > 0 ? `<span style="background:${active ? '#fff' : '#dc2626'};color:${active ? 'var(--brand)' : '#fff'};border-radius:20px;padding:1px 7px;font-size:11px;font-weight:700;flex:none">${c.unread}</span>` : ''}
        </div>`;
    }).join('') || `<div style="padding:20px;color:var(--text-muted);font-size:13px;text-align:center">${t('chat_no_channel','აირჩიე არხი ან საუბარი')}</div>`;
    if (window.lucide) try { window.lucide.createIcons(); } catch (e) {}
}

// Live presence: patch just the affected DM's online-dot from a WS 'presence'
// event, instead of waiting for the next 20s poll to re-fetch everything.
function _chatApplyPresence(userId, isOnline) {
    let changed = false;
    for (const c of _chatChannels) {
        if (c.is_dm && c.other_user_id === userId) { c.other_online = isOnline; changed = true; }
    }
    if (changed) _chatRenderChannelListFromState();
}

async function openChatChannel(id) {
    _chatActiveId = id;
    _chatPendingAttach = null;
    _chatEditingId = null;
    _chatSeenMessageIds.clear();
    await _chatRenderChannelList();
    const c = _chatChannels.find(x => x.id === id);
    const header = document.getElementById('chat-header');
    const inputBar = document.getElementById('chat-input-bar');
    if (header) {
        header.innerHTML = c ? `
            <span style="flex:1">${c.is_dm ? '<i data-lucide="user" class="lucide-i"></i>' : '<i data-lucide="hash" class="lucide-i"></i>'} ${_chatEsc(c.name || '')}</span>
            ${!c.is_dm ? `<button class="btn btn-secondary" style="padding:5px 9px;font-size:12px" onclick="openChatMembersModal()"><i data-lucide="users" class="lucide-i"></i> ${t('chat_members','წევრები')}</button>` : ''}
        ` : '';
        header.style.display = 'flex';
        header.style.justifyContent = 'space-between';
        header.style.alignItems = 'center';
    }
    if (inputBar) inputBar.style.display = 'flex';
    _chatClearAttachBar();
    if (window.lucide) try { window.lucide.createIcons(); } catch (e) {}

    const box = document.getElementById('chat-messages');
    box.innerHTML = `<div style="text-align:center;color:var(--text-muted);padding:20px">...</div>`;
    try {
        const r = await fetch(`/api/chat/channels/${id}/messages?limit=50`, { credentials: 'include' });
        const j = await r.json();
        _chatMessages = j.data || [];
        _chatMessages.forEach(m => _chatSeenMessageIds.add(m.id));
        _chatRenderAll();
        if (_chatMessages.length) markChatRead(id, _chatMessages[_chatMessages.length - 1].id);
    } catch (e) {
        box.innerHTML = `<div style="color:#dc2626;padding:20px">${_chatEsc(e.message)}</div>`;
    }
}

// ── full re-render of the message pane from _chatMessages (day separators + grouping) ──
function _chatRenderAll() {
    const box = document.getElementById('chat-messages');
    if (!box) return;
    let html = '';
    let lastDay = '', lastSender = null, lastTime = 0;
    _chatMessages.forEach(m => {
        const d = new Date(m.created_at.includes('T') || m.created_at.includes('Z') ? m.created_at : m.created_at.replace(' ', 'T') + 'Z');
        const dayKey = d.toLocaleDateString([], { year: 'numeric', month: 'long', day: 'numeric' });
        if (dayKey !== lastDay) {
            html += `<div style="text-align:center;font-size:12px;color:var(--text-muted);margin:10px 0;font-weight:600">${_chatEsc(dayKey)}</div>`;
            lastDay = dayKey; lastSender = null;
        }
        const grouped = (m.sender_id === lastSender) && (d.getTime() - lastTime < 5 * 60 * 1000);
        lastSender = m.sender_id; lastTime = d.getTime();
        html += _chatBubble(m, grouped);
    });
    box.innerHTML = html || `<div style="text-align:center;color:var(--text-muted);margin:auto;padding:40px">ჯერ არცერთი შეტყობინება. დაწერე პირველი! 👋</div>`;
    box.scrollTop = box.scrollHeight;
    if (window.lucide) try { window.lucide.createIcons(); } catch (e) {}
}

function _chatTime(ts) {
    if (!ts) return '';
    try { const d = new Date(ts.includes('T') || ts.includes('Z') ? ts : ts.replace(' ', 'T') + 'Z'); return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
    catch (e) { return ''; }
}

function _chatReactionsGrouped(m) {
    const grouped = {};
    (m.reactions || []).forEach(r => {
        grouped[r.emoji] = grouped[r.emoji] || { emoji: r.emoji, count: 0, mine: false };
        grouped[r.emoji].count++;
        if (r.user_id === currentUser.id) grouped[r.emoji].mine = true;
    });
    return Object.values(grouped);
}

function _chatBubble(m, grouped) {
    const mine = m.sender_id === currentUser.id;
    if (m.deleted_at) {
        return `<div style="display:flex;flex-direction:column;align-items:${mine ? 'flex-end' : 'flex-start'};margin-bottom:2px" data-mid="${m.id}">
            <div style="max-width:70%;padding:8px 12px;border-radius:14px;background:var(--bg-hover,#f1f5f9);color:var(--text-muted);font-size:13px;font-style:italic">🚫 ${t('chat_deleted_msg','შეტყობინება წაშლილია')}</div>
        </div>`;
    }
    const imageHtml = m.attachment_url
        ? `<img src="${m.attachment_url}" onclick="window.open('${m.attachment_url}','_blank')" style="max-width:240px;max-height:240px;border-radius:10px;cursor:pointer;display:block;${m.content ? 'margin-bottom:6px' : ''}">`
        : '';
    const textHtml = m.content ? _chatEsc(m.content) + (m.edited_at ? ` <span style="font-size:10px;opacity:.6">${t('chat_edited_tag','(რედაქტ.)')}</span>` : '') : '';

    const replyHtml = m.reply_preview
        ? `<div style="font-size:11px;padding:4px 8px;border-left:2px solid ${mine ? 'rgba(255,255,255,.6)' : 'var(--brand)'};margin-bottom:4px;opacity:.85"><b>${_chatEsc(m.reply_preview.sender_name || '')}</b>: ${_chatEsc((m.reply_preview.content || '📎').slice(0, 60))}</div>`
        : '';

    let refHtml = '';
    if (m.ref_type && m.ref_id) {
        const icon = CHAT_REF_ICON[m.ref_type] || '📎';
        const tname = t(CHAT_REF_KEY[m.ref_type] || '', m.ref_type);
        refHtml = `<div onclick="openChatRef('${m.ref_type}','${m.ref_id}')" style="display:flex;gap:8px;align-items:center;background:rgba(0,0,0,.06);border-radius:8px;padding:8px 10px;margin-top:6px;cursor:pointer">
            <span style="font-size:18px">${icon}</span>
            <div style="min-width:0"><div style="font-size:10px;opacity:.7">${_chatEsc(tname)}</div><div style="font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${_chatEsc(m.ref_label || '')}</div></div>
        </div>`;
    }

    const rx = _chatReactionsGrouped(m);
    const rxHtml = rx.length ? `<div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:5px">${rx.map(r =>
        `<span onclick="toggleChatReaction('${m.id}','${r.emoji}')" style="cursor:pointer;background:${r.mine ? 'var(--brand)' : 'var(--bg-hover,#f1f5f9)'};color:${r.mine ? '#fff' : 'var(--text)'};border-radius:10px;padding:1px 7px;font-size:12px;display:inline-flex;gap:3px;align-items:center">${r.emoji}<span style="font-size:10px">${r.count}</span></span>`
    ).join('')}</div>` : '';

    const actions = `<div class="chat-msg-actions" style="display:none;gap:2px;position:absolute;top:-14px;${mine ? 'left:8px' : 'right:8px'};background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:2px">
        <button onclick="showChatEmojiPicker(event,'${m.id}')" title="${t('chat_react','რეაქცია')}" style="border:none;background:none;cursor:pointer;padding:3px 5px">😊</button>
        <button onclick="startChatReply('${m.id}')" title="${t('chat_reply','პასუხი')}" style="border:none;background:none;cursor:pointer;padding:3px 5px">↩️</button>
        ${mine ? `<button onclick="startChatEdit('${m.id}')" title="${t('chat_edit','რედაქტირება')}" style="border:none;background:none;cursor:pointer;padding:3px 5px">✏️</button>` : ''}
        ${mine ? `<button onclick="deleteChatMessage('${m.id}')" title="${t('chat_delete','წაშლა')}" style="border:none;background:none;cursor:pointer;padding:3px 5px">🗑️</button>` : ''}
    </div>`;

    return `<div style="position:relative;display:flex;flex-direction:column;align-items:${mine ? 'flex-end' : 'flex-start'};margin-bottom:${grouped ? '2px' : '10px'}" data-mid="${m.id}" onmouseenter="this.querySelector('.chat-msg-actions').style.display='flex'" onmouseleave="this.querySelector('.chat-msg-actions').style.display='none'">
        ${actions}
        ${!mine && !grouped ? `<div style="font-size:11px;color:var(--text-muted);margin-bottom:2px;margin-left:4px">${_chatEsc(m.sender_name || '')}</div>` : ''}
        <div style="max-width:70%;padding:${imageHtml && !textHtml ? '6px' : '8px 12px'};border-radius:14px;background:${mine ? 'var(--brand)' : 'var(--bg-hover,#f1f5f9)'};color:${mine ? '#fff' : 'var(--text)'};font-size:14px;line-height:1.4;white-space:pre-wrap;word-break:break-word">${replyHtml}${imageHtml}${textHtml}${refHtml}${rxHtml}</div>
        <div style="font-size:10px;color:var(--text-muted);margin-top:2px;${mine ? 'margin-right:4px' : 'margin-left:4px'}">${_chatTime(m.created_at)}</div>
    </div>`;
}

function _chatFindMessage(id) { return _chatMessages.find(m => m.id === id); }

async function sendChatMessage() {
    const input = document.getElementById('chat-input');
    const content = (input.value || '').trim();
    if (!_chatActiveId) return;

    // Editing an existing message?
    if (_chatEditingId) {
        if (!content) return;
        const id = _chatEditingId;
        try {
            const r = await fetch(`/api/chat/channels/${_chatActiveId}/messages/${id}`, {
                method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
                body: JSON.stringify({ content }),
            });
            const j = await r.json();
            if (!r.ok) throw new Error(j.error || 'შეცდომა');
            const idx = _chatMessages.findIndex(m => m.id === id);
            if (idx >= 0) _chatMessages[idx] = j.data;
            _chatRenderAll();
        } catch (e) { showToast('შეცდომა: ' + (e.message || e), 'error'); }
        input.value = '';
        _chatClearAttachBar();
        return;
    }

    if (!content) return;
    input.value = '';
    const payload = { content };
    if (_chatPendingAttach?.type === 'reply') payload.replyToId = _chatPendingAttach.replyToId;
    if (_chatPendingAttach?.type === 'ref') { payload.refType = _chatPendingAttach.refType; payload.refId = _chatPendingAttach.refId; payload.refLabel = _chatPendingAttach.refLabel; }
    _chatClearAttachBar();

    try {
        const r = await fetch(`/api/chat/channels/${_chatActiveId}/messages`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
            body: JSON.stringify(payload),
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || 'შეცდომა');
        if (!_chatSeenMessageIds.has(j.data.id)) { _chatSeenMessageIds.add(j.data.id); _chatMessages.push(j.data); _chatRenderAll(); }
        markChatRead(_chatActiveId, j.data.id);
        _chatRenderChannelList();
    } catch (e) {
        showToast('შეცდომა: ' + (e.message || e), 'error');
    }
}

async function sendChatImage(input) {
    const file = input.files && input.files[0];
    if (!file || !_chatActiveId) return;
    const okTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];
    if (!okTypes.includes(file.type)) { showToast('მხოლოდ JPG, PNG, WEBP ან GIF', 'error'); input.value = ''; return; }
    if (file.size > 10 * 1024 * 1024) { showToast('ფაილი ძალიან დიდია (მაქს. 10MB)', 'error'); input.value = ''; return; }

    try {
        const fd = new FormData();
        fd.append('files', file);
        const up = await fetch('/api/upload', { method: 'POST', body: fd, credentials: 'include' });
        const upJson = await up.json();
        if (!up.ok || !upJson.data || !upJson.data[0]) throw new Error(upJson.error || 'ატვირთვა ვერ მოხერხდა');
        const attachmentUrl = upJson.data[0].url;

        const r = await fetch(`/api/chat/channels/${_chatActiveId}/messages`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
            body: JSON.stringify({ content: '', attachmentUrl }),
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || 'შეცდომა');
        if (!_chatSeenMessageIds.has(j.data.id)) { _chatSeenMessageIds.add(j.data.id); _chatMessages.push(j.data); _chatRenderAll(); }
        markChatRead(_chatActiveId, j.data.id);
        _chatRenderChannelList();
    } catch (e) {
        showToast('შეცდომა: ' + (e.message || e), 'error');
    } finally {
        input.value = '';
    }
}

// ── reply ──
function startChatReply(id) {
    const m = _chatFindMessage(id);
    if (!m) return;
    _chatEditingId = null;
    _chatPendingAttach = { type: 'reply', replyToId: id, label: `${m.sender_name || ''}: ${(m.content || '📎').slice(0, 40)}` };
    _chatShowAttachBar(`↩️ ${t('chat_replying_to','პასუხი')} — ${_chatPendingAttach.label}`);
    document.getElementById('chat-input').focus();
}

// ── edit ──
function startChatEdit(id) {
    const m = _chatFindMessage(id);
    if (!m || m.sender_id !== currentUser.id) return;
    _chatPendingAttach = null;
    _chatEditingId = id;
    const input = document.getElementById('chat-input');
    input.value = m.content || '';
    input.focus();
    _chatShowAttachBar(`✏️ ${t('chat_editing','რედაქტირება — Enter შესანახად')}`);
}

// ── delete ──
async function deleteChatMessage(id) {
    if (!confirm('წავშალო შეტყობინება?')) return;
    try {
        const r = await fetch(`/api/chat/channels/${_chatActiveId}/messages/${id}`, { method: 'DELETE', credentials: 'include' });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || 'შეცდომა');
        const idx = _chatMessages.findIndex(m => m.id === id);
        if (idx >= 0) { _chatMessages[idx].deleted_at = new Date().toISOString(); _chatMessages[idx].content = null; _chatMessages[idx].attachment_url = null; }
        _chatRenderAll();
        _chatRenderChannelList();
    } catch (e) { showToast('შეცდომა: ' + (e.message || e), 'error'); }
}

// ── reactions ──
let _chatEmojiPopEl = null;
function showChatEmojiPicker(ev, msgId) {
    ev.stopPropagation();
    closeChatEmojiPop();
    const row = ev.target.closest('[data-mid]');
    const pop = document.createElement('div');
    pop.style.cssText = 'position:absolute;top:-38px;left:0;background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:4px 6px;display:flex;gap:2px;z-index:10;box-shadow:0 4px 12px rgba(0,0,0,.12)';
    pop.innerHTML = CHAT_EMOJIS.map(e => `<button onclick="toggleChatReaction('${msgId}','${e}')" style="border:none;background:none;cursor:pointer;font-size:16px;padding:2px 4px">${e}</button>`).join('');
    row.style.position = 'relative';
    row.appendChild(pop);
    _chatEmojiPopEl = pop;
    setTimeout(() => document.addEventListener('click', closeChatEmojiPop, { once: true }), 10);
}
function closeChatEmojiPop() { if (_chatEmojiPopEl) { _chatEmojiPopEl.remove(); _chatEmojiPopEl = null; } }

async function toggleChatReaction(msgId, emoji) {
    closeChatEmojiPop();
    try {
        const r = await fetch(`/api/chat/channels/${_chatActiveId}/messages/${msgId}/reactions`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
            body: JSON.stringify({ emoji }),
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || 'შეცდომა');
        const idx = _chatMessages.findIndex(m => m.id === msgId);
        if (idx >= 0) { _chatMessages[idx].reactions = j.data.reactions; _chatRenderAll(); }
    } catch (e) { showToast('შეცდომა: ' + (e.message || e), 'error'); }
}

// ── attach bar (shared by reply / ref-attach / edit modes) ──
function _chatShowAttachBar(text) {
    let bar = document.getElementById('chat-attach-bar');
    if (!bar) {
        bar = document.createElement('div');
        bar.id = 'chat-attach-bar';
        bar.style.cssText = 'padding:6px 14px;background:var(--bg-hover,#EFF6FF);border-top:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;font-size:12px';
        const inputBar = document.getElementById('chat-input-bar');
        inputBar.parentNode.insertBefore(bar, inputBar);
    }
    bar.style.display = 'flex';
    bar.innerHTML = `<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${_chatEsc(text)}</span><button onclick="_chatClearAttachBar()" style="border:none;background:none;cursor:pointer;font-size:14px;color:var(--text-muted)">✕</button>`;
}
function _chatClearAttachBar() {
    _chatPendingAttach = null;
    _chatEditingId = null;
    const bar = document.getElementById('chat-attach-bar');
    if (bar) bar.style.display = 'none';
    const input = document.getElementById('chat-input');
    if (input && _chatEditingId === null) { /* keep any text the user typed for a plain message */ }
}

// ── attach a CRM record (lead/deal/listing/client) to the next message ──
async function openChatRefPicker() {
    openModal('📎 ' + t('chat_attach_record', 'ჩანაწერის მიბმა'), `
        <div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap">
            <button class="btn btn-secondary chat-ref-tab active" data-rt="DEAL" onclick="switchChatRefTab('DEAL')">💼 <span data-i18n="ref_deal">გარიგება</span></button>
            <button class="btn btn-secondary chat-ref-tab" data-rt="LISTING" onclick="switchChatRefTab('LISTING')">🏠 <span data-i18n="ref_listing">ობიექტი</span></button>
            <button class="btn btn-secondary chat-ref-tab" data-rt="MEETING" onclick="switchChatRefTab('MEETING')">🤝 <span data-i18n="ref_meeting">შეხვედრა</span></button>
        </div>
        <div id="chat-ref-search-panel">
            <input class="form-input" id="chat-ref-search" placeholder="${t('chat_search','ძებნა...')}" oninput="_chatRefSearch()" style="margin-bottom:10px">
            <div id="chat-ref-list" style="max-height:320px;overflow-y:auto"></div>
        </div>
        <div id="chat-meeting-panel" style="display:none;max-height:60vh;overflow-y:auto"></div>
    `);
    if (window.lucide) try { window.lucide.createIcons(); } catch (e) {}
    window._chatRefTab = 'DEAL';
    await _chatRefSearch();
}
function switchChatRefTab(type) {
    window._chatRefTab = type;
    document.querySelectorAll('.chat-ref-tab').forEach(b => b.classList.toggle('active', b.dataset.rt === type));
    const searchPanel = document.getElementById('chat-ref-search-panel');
    const meetingPanel = document.getElementById('chat-meeting-panel');
    if (type === 'MEETING') {
        searchPanel.style.display = 'none';
        meetingPanel.style.display = 'block';
        _chatRenderMeetingForm();
    } else {
        searchPanel.style.display = 'block';
        meetingPanel.style.display = 'none';
        document.getElementById('chat-ref-search').value = '';
        _chatRefSearch();
    }
}
async function _chatRefSearch() {
    const type = window._chatRefTab || 'DEAL';
    const q = document.getElementById('chat-ref-search')?.value || '';
    const list = document.getElementById('chat-ref-list');
    list.innerHTML = '<div style="color:var(--text-muted);text-align:center;padding:16px">...</div>';
    try {
        const r = await fetch(`/api/chat/ref-search?type=${type}&q=${encodeURIComponent(q)}`, { credentials: 'include' });
        const j = await r.json();
        const rows = j.data || [];
        const icon = CHAT_REF_ICON[type];
        list.innerHTML = rows.length ? rows.map(row => {
            const label = _chatRefLabel(type, row);
            return `<div onclick='pickChatRef(${JSON.stringify(type)}, ${JSON.stringify(row.id)}, ${JSON.stringify(label)})' style="display:flex;align-items:center;gap:10px;padding:8px 10px;cursor:pointer;border-radius:8px" onmouseover="this.style.background='var(--bg-hover,#f1f5f9)'" onmouseout="this.style.background='none'">
                <span style="font-size:18px">${icon}</span><span style="font-size:13px">${_chatEsc(label)}</span>
            </div>`;
        }).join('') : `<div style="color:var(--text-muted);text-align:center;padding:16px">${t('chat_no_results','ვერ მოიძებნა')}</div>`;
    } catch (e) { list.innerHTML = `<div style="color:#dc2626;padding:16px">${_chatEsc(e.message)}</div>`; }
}
function _chatMeetGenCaseId() {
    const d = new Date();
    const stamp = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
    return `CASE-${stamp}-${Math.floor(Math.random()*900+100)}`;
}

async function _chatRenderMeetingForm(existing) {
    const panel = document.getElementById('chat-meeting-panel');
    if (!panel) return;
    const m = existing || {};
    let teammates = [];
    try { const r = await fetch('/api/chat/teammates', { credentials: 'include' }); teammates = (await r.json()).data || []; } catch (e) {}
    const agent2Opts = '<option value="">' + t('meet_second_agent_pick','აირჩიე მეორე აგენტი') + '</option>' +
        teammates.map(u => `<option value="${u.id}" ${m.secondary_agent_id === u.id ? 'selected' : ''}>${_chatEsc((u.first_name||'')+' '+(u.last_name||''))}</option>`).join('');
    const hasSecond = !!m.secondary_agent_id;
    const caseId = m.case_number || _chatMeetGenCaseId();

    panel.innerHTML = `
        <div class="form-group">
            <label class="form-label">${t('meet_subject','თემა')}</label>
            <div class="form-row">
                <select class="form-select" id="mf-prop-type">
                    <option value="">${t('meet_prop_type','ტიპი აირჩიეთ')}</option>
                    <option value="COMMERCIAL" ${m.property_type==='COMMERCIAL'?'selected':''}>${t('meet_commercial','კომერციული')}</option>
                    <option value="RESIDENTIAL" ${m.property_type==='RESIDENTIAL'?'selected':''}>${t('meet_residential','საცხოვრებელი')}</option>
                    <option value="LAND" ${m.property_type==='LAND'?'selected':''}>${t('meet_land','მიწა')}</option>
                </select>
                <select class="form-select" id="mf-deal-type">
                    <option value="">${t('meet_deal_type','გარიგება აირჩიეთ')}</option>
                    <option value="BUY" ${m.deal_type==='BUY'?'selected':''}>${t('meet_buy','ყიდვა')}</option>
                    <option value="SELL" ${m.deal_type==='SELL'?'selected':''}>${t('meet_sell','გაყიდვა')}</option>
                </select>
            </div>
        </div>
        <div class="form-group">
            <label class="form-label">${t('meet_address','მისამართი')}</label>
            <input class="form-input" id="mf-address" value="${_chatEsc(m.address||'')}">
        </div>
        <div class="form-row">
            <div class="form-group">
                <label class="form-label">${t('meet_owner','მეპატრონე')}</label>
                <input class="form-input" id="mf-owner-name" placeholder="${t('meet_name','სახელი')}" value="${_chatEsc(m.owner_name||'')}" style="margin-bottom:8px">
                <input class="form-input" id="mf-owner-phone" placeholder="${t('meet_mobile','მობილური')}" value="${_chatEsc(m.owner_phone||'')}">
            </div>
            <div class="form-group">
                <label class="form-label">${t('meet_client','მომართველი კლიენტი')}</label>
                <input class="form-input" id="mf-client-name" placeholder="${t('meet_name','სახელი')}" value="${_chatEsc(m.client_name||'')}" style="margin-bottom:8px">
                <input class="form-input" id="mf-client-phone" placeholder="${t('meet_mobile','მობილური')}" value="${_chatEsc(m.client_phone||'')}">
            </div>
        </div>
        <div class="form-row">
            <div class="form-group">
                <label class="form-label">${t('meet_price','ფასი')}</label>
                <input class="form-input" id="mf-price" type="number" placeholder="₾" value="${m.price||''}">
            </div>
            <div class="form-group">
                <label class="form-label">${t('meet_cooperation','თანამშრომლობა')}</label>
                <input class="form-input" id="mf-cooperation" placeholder="${t('meet_cooperation_ph','თავად ჩაწერეთ')}" value="${_chatEsc(m.cooperation||'')}">
            </div>
        </div>
        <div class="form-row">
            <div class="form-group">
                <label class="form-label">${t('meet_term','ვადა')} <span style="color:var(--text-muted);font-size:11px">${t('meet_term_hint','(მინ. 12 თვე)')}</span></label>
                <input class="form-input" id="mf-term" type="number" min="12" value="${m.term_months||12}">
            </div>
            <div class="form-group">
                <label class="form-label">${t('meet_time','შეხვედრის დრო')}</label>
                <input class="form-input" id="mf-time" type="datetime-local" value="${m.meeting_time ? String(m.meeting_time).slice(0,16).replace(' ','T') : ''}">
            </div>
        </div>
        <div class="form-row">
            <div class="form-group">
                <label class="form-label">${t('meet_case','ქეისი')}</label>
                <input class="form-input" id="mf-case" value="${_chatEsc(caseId)}" readonly>
                <div style="font-size:11px;color:var(--text-muted);margin-top:3px">${t('meet_case_auto','ავტომატურად გენერირებული ნომერი')}</div>
            </div>
            <div class="form-group">
                <label class="form-label">${t('meet_me','მე (პასუხისმგებელი აგენტი)')}</label>
                <input class="form-input" value="${_chatEsc((currentUser.first_name||'')+' '+(currentUser.last_name||''))}" readonly style="margin-bottom:8px">
                <select class="form-select" id="mf-agent-role">
                    <option value="">${t('meet_my_role','ჩემი როლი აირჩიეთ')}</option>
                    <option value="BUYER_AGENT" ${m.primary_agent_role==='BUYER_AGENT'?'selected':''}>${t('meet_role_buyer','მყიდველის/დამქირავებლის აგენტი')}</option>
                    <option value="SELLER_AGENT" ${m.primary_agent_role==='SELLER_AGENT'?'selected':''}>${t('meet_role_seller','გამყიდველის/გამქირავებლის აგენტი')}</option>
                    <option value="TRANSLATOR" ${m.primary_agent_role==='TRANSLATOR'?'selected':''}>${t('meet_role_translator','თარჯიმანი/შემსრულებელი')}</option>
                </select>
            </div>
        </div>
        <div class="form-group">
            <label style="display:flex;gap:8px;align-items:center;cursor:pointer">
                <input type="checkbox" id="mf-has-second" ${hasSecond?'checked':''} onchange="document.getElementById('mf-second-fields').style.display=this.checked?'block':'none'">
                ${t('meet_second_agent','მეორე აგენტიც მონაწილეობს')}
            </label>
            <div id="mf-second-fields" style="display:${hasSecond?'block':'none'};margin-top:10px">
                <select class="form-select" id="mf-agent2" style="margin-bottom:8px">${agent2Opts}</select>
                <select class="form-select" id="mf-agent2-role">
                    <option value="">${t('meet_role_pick','როლი აირჩიეთ')}</option>
                    <option value="BUYER_AGENT" ${m.secondary_agent_role==='BUYER_AGENT'?'selected':''}>${t('meet_role_buyer','მყიდველის/დამქირავებლის აგენტი')}</option>
                    <option value="SELLER_AGENT" ${m.secondary_agent_role==='SELLER_AGENT'?'selected':''}>${t('meet_role_seller','გამყიდველის/გამქირავებლის აგენტი')}</option>
                    <option value="TRANSLATOR" ${m.secondary_agent_role==='TRANSLATOR'?'selected':''}>${t('meet_role_translator','თარჯიმანი/შემსრულებელი')}</option>
                </select>
            </div>
        </div>
        <button class="btn btn-primary" style="width:100%" onclick="${existing ? `submitChatMeeting('${existing.id}')` : 'submitChatMeeting()'}"><i data-lucide="save" class="lucide-i"></i> ${existing ? t('meet_update','განახლება') : t('meet_save','შენახვა')}</button>
    `;
    if (window.lucide) try { window.lucide.createIcons(); } catch (e) {}
}

function _chatMeetingPayload() {
    return {
        propertyType: document.getElementById('mf-prop-type').value,
        dealType: document.getElementById('mf-deal-type').value,
        address: document.getElementById('mf-address').value,
        ownerName: document.getElementById('mf-owner-name').value,
        ownerPhone: document.getElementById('mf-owner-phone').value,
        clientName: document.getElementById('mf-client-name').value,
        clientPhone: document.getElementById('mf-client-phone').value,
        price: document.getElementById('mf-price').value,
        cooperation: document.getElementById('mf-cooperation').value,
        termMonths: document.getElementById('mf-term').value,
        meetingTime: document.getElementById('mf-time').value,
        agentRole: document.getElementById('mf-agent-role').value,
        secondAgentId: document.getElementById('mf-has-second').checked ? (document.getElementById('mf-agent2').value || null) : null,
        secondAgentRole: document.getElementById('mf-has-second').checked ? document.getElementById('mf-agent2-role').value : null,
    };
}

async function submitChatMeeting(existingId) {
    const payload = _chatMeetingPayload();
    if (!payload.address) { showToast(t('meet_address','მისამართი') + ' აუცილებელია', 'error'); return; }
    try {
        const url = existingId ? `/api/meetings/${existingId}` : '/api/meetings';
        const r = await fetch(url, {
            method: existingId ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
            body: JSON.stringify(payload),
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || 'შეცდომა');

        if (existingId) {
            showToast(t('meet_update','განახლება') + ' ✓', 'success');
            closeModal();
        } else {
            pickChatRef('MEETING', j.data.id, j.data.label || payload.address);
        }
    } catch (e) { showToast('შეცდომა: ' + (e.message || e), 'error'); }
}

// Reopen an already-sent meeting ref for viewing/editing.
async function openChatMeetingEditor(id) {
    try {
        const r = await fetch(`/api/meetings/${id}`, { credentials: 'include' });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || 'შეცდომა');
        openModal('🤝 ' + t('meet_edit', 'შეხვედრის რედაქტირება'), `<div id="chat-meeting-panel" style="max-height:65vh;overflow-y:auto"></div>`);
        await _chatRenderMeetingForm(j.data);
    } catch (e) { showToast('შეცდომა: ' + (e.message || e), 'error'); }
}
function _chatRefLabel(type, r) {
    if (type === 'DEAL') return (r.title || r.deal_number || 'გარიგება') + (r.asking_price ? ' — $' + Number(r.asking_price).toLocaleString() : '');
    return (r.title || 'ობიექტი') + (r.list_price ? ' — $' + Number(r.list_price).toLocaleString() : '');
}
function pickChatRef(type, id, label) {
    _chatEditingId = null;
    _chatPendingAttach = { type: 'ref', refType: type, refId: id, refLabel: label };
    closeModal();
    _chatShowAttachBar(`${CHAT_REF_ICON[type]} ${label}`);
    document.getElementById('chat-input').focus();
}
function openChatRef(type, id) {
    if (type === 'MEETING') { openChatMeetingEditor(id); return; }
    const map = { LEAD: 'leads', DEAL: 'deals', LISTING: 'listings', CLIENT: 'clients' };
    const page = map[type];
    if (!page) return;
    navigateTo(page);
    setTimeout(() => {
        try {
            if (type === 'LEAD' && typeof editLead === 'function') editLead(id);
            else if (type === 'DEAL' && typeof editDeal === 'function') editDeal(id);
            else if (type === 'LISTING' && typeof viewListing === 'function') viewListing(id);
            else if (type === 'CLIENT' && typeof editClient === 'function') editClient(id);
        } catch (e) {}
    }, 400);
}

// ── member management ──
async function openChatMembersModal() {
    if (!_chatActiveId) return;
    try {
        const r = await fetch(`/api/chat/channels/${_chatActiveId}/members`, { credentials: 'include' });
        const j = await r.json();
        const members = j.data || [];
        const canManage = !!j.canManage;
        const teammatesR = await fetch('/api/chat/teammates', { credentials: 'include' });
        const teammates = (await teammatesR.json()).data || [];
        const memberIds = new Set(members.map(m => m.user_id));
        const outList = teammates.filter(u => !memberIds.has(u.id));

        openModal('👥 ' + t('chat_members_title', 'არხის წევრები'), `
            ${!canManage ? `<div style="background:var(--bg-hover,#f7f7f8);color:var(--text-muted);font-size:12px;padding:8px 10px;border-radius:8px;margin-bottom:12px">${t('chat_admin_only','წევრების მართვა მხოლოდ ადმინს შეუძლია')}</div>` : ''}
            <div style="font-weight:700;font-size:13px;color:var(--text-muted);margin-bottom:8px">${t('chat_members','წევრები')} (${members.length})</div>
            <div style="max-height:220px;overflow-y:auto;margin-bottom:16px">
                ${members.map(u => `
                    <div style="display:flex;align-items:center;gap:8px;padding:8px 4px">
                        <div style="width:32px;height:32px;border-radius:50%;background:var(--bg-hover,#f1f5f9);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:12px">${_chatEsc(((u.first_name||'')[0]||'')+((u.last_name||'')[0]||''))}</div>
                        <div style="flex:1;min-width:0"><div style="font-weight:600;font-size:13px">${_chatEsc((u.first_name||'')+' '+(u.last_name||''))} ${u.role==='owner'?'👑':(u.role==='admin'?'⭐':'')}</div></div>
                        ${(canManage && u.user_id !== currentUser.id && u.role !== 'owner') ? `<button onclick="removeChatMember('${u.user_id}')" style="border:none;background:none;cursor:pointer;color:#dc2626">✕</button>` : ''}
                    </div>`).join('')}
            </div>
            ${(canManage && outList.length) ? `
            <div style="font-weight:700;font-size:13px;color:var(--text-muted);margin-bottom:8px">${t('chat_add','დამატება')}</div>
            <div style="max-height:180px;overflow-y:auto">
                ${outList.map(u => `
                    <div onclick="addChatMember('${u.id}')" style="display:flex;align-items:center;gap:8px;padding:8px 4px;cursor:pointer">
                        <div style="width:32px;height:32px;border-radius:50%;background:var(--bg-hover,#f1f5f9);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:12px">${_chatEsc(((u.first_name||'')[0]||'')+((u.last_name||'')[0]||''))}</div>
                        <div style="flex:1;font-size:13px">${_chatEsc((u.first_name||'')+' '+(u.last_name||''))}</div>
                        <span style="color:var(--brand);font-weight:700">＋</span>
                    </div>`).join('')}
            </div>` : ''}
        `);
    } catch (e) { showToast('შეცდომა: ' + (e.message || e), 'error'); }
}
async function addChatMember(userId) {
    try {
        const r = await fetch(`/api/chat/channels/${_chatActiveId}/members`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
            body: JSON.stringify({ userId }),
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || 'შეცდომა');
        openChatMembersModal();
    } catch (e) { showToast('შეცდომა: ' + (e.message || e), 'error'); }
}
async function removeChatMember(userId) {
    try {
        const r = await fetch(`/api/chat/channels/${_chatActiveId}/members/${userId}`, { method: 'DELETE', credentials: 'include' });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || 'შეცდომა');
        openChatMembersModal();
    } catch (e) { showToast('შეცდომა: ' + (e.message || e), 'error'); }
}

async function markChatRead(channelId, lastReadMessageId) {
    try {
        await fetch('/api/chat/read', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
            body: JSON.stringify({ channelId, lastReadMessageId }),
        });
    } catch (e) {}
}

function updateChatBadge(n) {
    const badge = document.getElementById('chat-nav-badge');
    if (!badge) return;
    if (n > 0) { badge.style.display = 'inline-block'; badge.textContent = n; }
    else badge.style.display = 'none';
}

// ── WebSocket: real-time push, with silent fallback to the 20s poll above ──
function _chatConnectWs() {
    if (_chatWs && (_chatWs.readyState === WebSocket.OPEN || _chatWs.readyState === WebSocket.CONNECTING)) return;
    try {
        const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
        _chatWs = new WebSocket(`${proto}//${location.host}/ws/chat`);
        _chatWs.onmessage = (evt) => {
            try {
                const data = JSON.parse(evt.data);
                if (data.type === 'message:new') {
                    if (data.channelId === _chatActiveId && !_chatSeenMessageIds.has(data.message.id)) {
                        _chatSeenMessageIds.add(data.message.id);
                        _chatMessages.push(data.message);
                        _chatRenderAll();
                        markChatRead(_chatActiveId, data.message.id);
                    }
                    _chatRenderChannelList();
                } else if (data.type === 'message:edited' && data.channelId === _chatActiveId) {
                    const idx = _chatMessages.findIndex(m => m.id === data.message.id);
                    if (idx >= 0) { _chatMessages[idx] = data.message; _chatRenderAll(); }
                } else if (data.type === 'message:deleted' && data.channelId === _chatActiveId) {
                    const idx = _chatMessages.findIndex(m => m.id === data.messageId);
                    if (idx >= 0) { _chatMessages[idx].deleted_at = new Date().toISOString(); _chatMessages[idx].content = null; _chatMessages[idx].attachment_url = null; _chatRenderAll(); }
                } else if (data.type === 'reaction:changed' && data.channelId === _chatActiveId) {
                    const idx = _chatMessages.findIndex(m => m.id === data.messageId);
                    if (idx >= 0) { _chatMessages[idx].reactions = data.reactions; _chatRenderAll(); }
                } else if (data.type === 'presence') {
                    _chatApplyPresence(data.userId, data.status === 'online');
                } else if (data.type === 'typing' && data.channelId === _chatActiveId && data.userId !== currentUser.id) {
                    _chatShowTyping(data.isTyping);
                }
            } catch (e) {}
        };
        _chatWs.onclose = () => { setTimeout(_chatConnectWs, 4000); };
        _chatWs.onerror = () => {};
    } catch (e) { /* falls back to polling silently */ }
}

let _chatTypingClearTimer = null;
function _chatShowTyping(isTyping) {
    const el = document.getElementById('chat-typing-indicator');
    if (!el) return;
    if (isTyping) {
        el.textContent = t('chat_typing', 'წერს...');
        clearTimeout(_chatTypingClearTimer);
        _chatTypingClearTimer = setTimeout(() => { el.textContent = ''; }, 3000);
    } else {
        el.textContent = '';
    }
}

function notifyTyping() {
    if (!_chatWs || _chatWs.readyState !== WebSocket.OPEN || !_chatActiveId) return;
    clearTimeout(_chatTypingTimeout);
    try { _chatWs.send(JSON.stringify({ type: 'typing', channelId: _chatActiveId, isTyping: true })); } catch (e) {}
    _chatTypingTimeout = setTimeout(() => {
        try { _chatWs.send(JSON.stringify({ type: 'typing', channelId: _chatActiveId, isTyping: false })); } catch (e) {}
    }, 2000);
}

// ── New channel / new DM modals ──
async function openNewChannelModal() {
    let teammates = [];
    try { const r = await fetch('/api/chat/teammates', { credentials: 'include' }); teammates = (await r.json()).data || []; } catch (e) {}
    const checks = teammates.map(u => `<label style="display:flex;gap:8px;align-items:center;padding:4px 0;cursor:pointer"><input type="checkbox" class="chat-new-member" value="${u.id}"> ${_chatEsc((u.first_name || '') + ' ' + (u.last_name || ''))}</label>`).join('');
    openModal('<i data-lucide="hash" class="lucide-i"></i> ' + t('chat_new_channel', 'ახალი არხი'), `
        <div class="form-group"><label class="form-label">${t('chat_channel_name', 'არხის სახელი')}</label><input class="form-input" id="chat-new-channel-name" placeholder="მაგ: გაყიდვების გუნდი"></div>
        <div class="form-group">
            <label class="form-label">${t('chat_members', 'წევრები')}</label>
            <div style="max-height:180px;overflow-y:auto;border:1px solid var(--border);border-radius:8px;padding:8px">${checks || '<span style="color:var(--text-muted)">—</span>'}</div>
        </div>
        <button class="btn btn-primary" style="width:100%" onclick="createChatChannel()"><i data-lucide="check" class="lucide-i"></i> ${t('chat_create', 'შექმნა')}</button>
    `);
    if (window.lucide) try { window.lucide.createIcons(); } catch (e) {}
}

async function createChatChannel() {
    const name = (document.getElementById('chat-new-channel-name').value || '').trim();
    if (!name) { showToast(t('chat_channel_name', 'არხის სახელი') + ' აუცილებელია', 'error'); return; }
    const memberIds = Array.from(document.querySelectorAll('.chat-new-member:checked')).map(c => c.value);
    try {
        const r = await fetch('/api/chat/channels', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
            body: JSON.stringify({ name, memberIds }),
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || 'შეცდომა');
        closeModal();
        await _chatRenderChannelList();
        openChatChannel(j.data.id);
    } catch (e) { showToast('შეცდომა: ' + (e.message || e), 'error'); }
}

async function openNewDmModal() {
    let teammates = [];
    try { const r = await fetch('/api/chat/teammates', { credentials: 'include' }); teammates = (await r.json()).data || []; } catch (e) {}
    const opts = teammates.map(u => `<option value="${u.id}">${_chatEsc((u.first_name || '') + ' ' + (u.last_name || ''))}</option>`).join('');
    openModal('<i data-lucide="user-plus" class="lucide-i"></i> ' + t('chat_new_dm', 'პირადი მიმოწერა'), `
        <div class="form-group">
            <label class="form-label">${t('chat_select_teammate', 'აირჩიე თანამშრომელი')}</label>
            <select class="form-select" id="chat-new-dm-user">${opts || '<option>—</option>'}</select>
        </div>
        <button class="btn btn-primary" style="width:100%" onclick="startChatDm()"><i data-lucide="send" class="lucide-i"></i> ${t('chat_start', 'დაწყება')}</button>
    `);
}

async function startChatDm() {
    const withUserId = document.getElementById('chat-new-dm-user').value;
    if (!withUserId) return;
    try {
        const r = await fetch('/api/chat/dm', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
            body: JSON.stringify({ withUserId }),
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || 'შეცდომა');
        closeModal();
        await _chatRenderChannelList();
        openChatChannel(j.data.id);
    } catch (e) { showToast('შეცდომა: ' + (e.message || e), 'error'); }
}

// Poll the unread badge even when not on the chat page (mirrors the Inbox badge poll).
if (!window._chatBadgeInterval) {
    window._chatBadgeInterval = setInterval(async () => {
        if (!window.currentUser) return;
        try {
            const r = await fetch('/api/chat/unread', { credentials: 'include' });
            const j = await r.json();
            updateChatBadge((j.data && j.data.unread) || 0);
        } catch (e) {}
    }, 25000);
    setTimeout(() => { if (window.currentUser) fetch('/api/chat/unread', { credentials: 'include' }).then(r => r.json()).then(j => updateChatBadge((j.data && j.data.unread) || 0)).catch(() => {}); }, 3000);
}
