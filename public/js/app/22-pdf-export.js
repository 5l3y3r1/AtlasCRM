// ═══════════════════════════════════════════════════════════════════════
// PDF EXPORT — Listing
// ═══════════════════════════════════════════════════════════════════════
// Lazy-load the html2pdf bundle (html2canvas + jsPDF) only when a PDF is requested.
// Tries jsDelivr first, then cdnjs as a fallback.
let _pdfLibsPromise = null;
function _loadPdfLibs() {
    if (window.html2canvas && window.jspdf?.jsPDF) return Promise.resolve();
    if (_pdfLibsPromise) return _pdfLibsPromise;
    const loadOne = (urls) => new Promise((resolve, reject) => {
        let i = 0;
        const next = () => {
            if (i >= urls.length) return reject(new Error('Library failed to load: ' + urls[0]));
            const s = document.createElement('script');
            s.src = urls[i++];
            s.onload  = () => resolve();
            s.onerror = next;
            document.head.appendChild(s);
        };
        next();
    });
    _pdfLibsPromise = (async () => {
        if (!window.html2canvas) await loadOne([
            'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
            'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js'
        ]);
        if (!window.jspdf?.jsPDF) await loadOne([
            'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
            'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js'
        ]);
        if (!window.html2canvas || !window.jspdf?.jsPDF) throw new Error('PDF libraries unavailable');
    })();
    return _pdfLibsPromise;
}

async function downloadListingPDF(id, opts = {}) {
    if (typeof hasPermission === 'function' && !hasPermission('pdf_export','can_create')) { if (typeof showToast==='function') showToast('ექსპორტი გათიშულია თქვენი როლისთვის', 'error'); return opts.returnBlob ? Promise.reject(new Error("export disabled")) : undefined; }
    if (!opts.returnBlob) showToast('<i data-lucide="loader" class="lucide-i"></i> PDF მზადდება...');
    try {
        const { data: l } = await client.from('listings').select('*, property_images(*)').eq('id', id).single();
        if (!l) throw new Error('ობიექტი ვერ მოიძებნა');

        // Fetch images as base64 data URLs so they embed in the PDF. Crucially, only embed
        // responses that are ACTUALLY images — a broken/expired photo URL often returns the
        // app's HTML page (a 404 fallback), and feeding that to the renderer as an "image"
        // breaks the whole PDF. So we verify the content type and skip anything that isn't an image.
        const photos = (l.property_images || []).slice(0, 6);
        const photoDataUrls = await Promise.all(photos.map(async p => {
            try {
                if (!p.image_url) return null;
                const ctrl = new AbortController();
                const timer = setTimeout(() => ctrl.abort(), 8000);
                let res;
                try { res = await fetch(p.image_url, { signal: ctrl.signal }); }
                finally { clearTimeout(timer); }
                if (!res.ok) return null;
                const blob = await res.blob();
                if (!blob.type || !blob.type.startsWith('image/')) return null; // not a real image → skip
                return await new Promise(resolve => {
                    const reader = new FileReader();
                    reader.onload  = () => resolve(reader.result);
                    reader.onerror = () => resolve(null);
                    reader.readAsDataURL(blob);
                });
            } catch(e) { return null; }
        }));
        const validPhotos = photoDataUrls.filter(Boolean);

        const photosHtml = validPhotos.length > 0
            ? `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:20px">${
                validPhotos.map(src =>
                    `<img src="${src}" style="width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:6px;display:block">`
                ).join('')
              }</div>`
            : '';

        let commsHtml = '';
        if (l.land_communications) {
            try {
                const c = JSON.parse(l.land_communications);
                if (c.length) commsHtml = `<div class="info-row"><span class="info-label">კომუნიკაციები:</span><span>${c.join(', ')}</span></div>`;
            } catch(e){}
        }

        const agent = currentUser ? `${currentUser.first_name || ''} ${currentUser.last_name || ''}`.trim() : '—';
        const agentPhone = currentUser?.phone || '—';

        const styleCss = `
  #wpdfRoot * { margin:0; padding:0; box-sizing:border-box; }
  #wpdfRoot { font-family:'Inter',Arial,sans-serif; color:#1a1a2e; background:#fff; padding:32px; font-size:13px; width:760px; }
  #wpdfRoot .header { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:24px; padding-bottom:16px; border-bottom:3px solid #1D4ED8; }
  #wpdfRoot .brand { font-size:22px; font-weight:800; color:#1D4ED8; }
  #wpdfRoot .id-badge { background:#1D4ED8; color:#fff; padding:4px 12px; border-radius:20px; font-weight:700; font-size:12px; }
  #wpdfRoot .exclusive-badge { background:#FEF3C7; color:#92400E; padding:4px 12px; border-radius:20px; font-weight:700; font-size:12px; margin-left:8px; }
  #wpdfRoot .price { font-size:28px; font-weight:800; color:#1D4ED8; margin-bottom:16px; }
  #wpdfRoot .info-grid { display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:20px; }
  #wpdfRoot .info-row { display:flex; gap:8px; padding:8px 12px; background:#f8f9fa; border-radius:6px; }
  #wpdfRoot .info-label { font-weight:600; color:#555; min-width:120px; flex-shrink:0; }
  #wpdfRoot .section-title { font-weight:700; font-size:14px; color:#1D4ED8; margin:16px 0 8px; border-bottom:1px solid #eee; padding-bottom:4px; }
  #wpdfRoot .description { padding:12px; background:#f8f9fa; border-radius:8px; line-height:1.7; color:#444; font-size:13px; }
  #wpdfRoot .agent-box { background:#EFF6FF; border:1px solid #BFDBFE; border-radius:8px; padding:14px; margin-top:20px; }
  #wpdfRoot .footer { margin-top:24px; padding-top:12px; border-top:1px solid #eee; color:#999; font-size:11px; display:flex; justify-content:space-between; }
`;
        const bodyMarkup = `
<div class="header">
  <div class="brand">AtlasCRM</div>
  <div>
    <span class="id-badge">${l.listing_number || l.listing_key || l.id?.slice(0,8)}</span>
    ${l.is_exclusive ? '<span class="exclusive-badge">★ ექსკლუზიური</span>' : ''}
  </div>
</div>

<h1 style="font-size:20px;font-weight:700;margin:12px 0 4px">${l.title || '—'}</h1>
<div style="color:#666;margin-bottom:6px">${[l.district, l.city, l.region].filter(Boolean).join(', ') || '—'}</div>
<div class="price">$${(l.list_price || 0).toLocaleString()}</div>

${photosHtml}

<div class="section-title">ძირითადი პარამეტრები</div>
<div class="info-grid">
  <div class="info-row"><span class="info-label">ობიექტის ID:</span><span>${l.listing_number || l.listing_key || '—'}</span></div>
  <div class="info-row"><span class="info-label">ტიპი:</span><span>${l.property_type || '—'}</span></div>
  <div class="info-row"><span class="info-label">ფასი:</span><span>$${(l.list_price || 0).toLocaleString()}</span></div>
  <div class="info-row"><span class="info-label">ფართი:</span><span>${(l.living_area || l.total_area) ? (l.living_area || l.total_area) + ' მ²' : '—'}</span></div>
  ${l.land_area ? `<div class="info-row"><span class="info-label">მიწის ფართი:</span><span>${l.land_area} მ²</span></div>` : ''}
  ${l.price_per_sqm ? `<div class="info-row"><span class="info-label">მ²-ის ფასი:</span><span>$${Math.round(l.price_per_sqm)}</span></div>` : ''}
  <div class="info-row"><span class="info-label">ოთახები:</span><span>${l.bedrooms_total || '—'}</span></div>
  <div class="info-row"><span class="info-label">სართული:</span><span>${l.floor ? l.floor + (l.total_floors ? '/' + l.total_floors : '') : '—'}</span></div>
  <div class="info-row"><span class="info-label">საკადასტრო კოდი:</span><span>${l.cadastral_code || '—'}</span></div>
  <div class="info-row"><span class="info-label">სტატუსი:</span><span>${l.status || '—'}</span></div>
  ${l.parking_available ? `<div class="info-row"><span class="info-label">პარკინგი:</span><span>${l.parking_type || 'კი'}</span></div>` : ''}
  ${l.has_pool ? `<div class="info-row"><span class="info-label">აუზი:</span><span>კი</span></div>` : ''}
  ${l.land_coefficient ? `<div class="info-row"><span class="info-label">კოეფიციენტი:</span><span>${l.land_coefficient}</span></div>` : ''}
  ${l.land_purpose ? `<div class="info-row"><span class="info-label">დანიშნულება:</span><span>${l.land_purpose}</span></div>` : ''}
  ${l.functional_zone ? `<div class="info-row"><span class="info-label">ფ. ზონა:</span><span>${l.functional_zone}</span></div>` : ''}
  ${l.land_road_type ? `<div class="info-row"><span class="info-label">გზა:</span><span>${l.land_road_type}</span></div>` : ''}
  ${commsHtml}
</div>

${l.description ? `<div class="section-title">აღწერა</div><div class="description">${l.description}</div>` : ''}

<div class="agent-box">
  <div style="font-weight:700;font-size:15px">👤 ${agent}</div>
  <div style="color:#666;margin-top:4px;font-size:12px">${agentPhone} • ${currentUser?.email || ''}</div>
  <div style="color:#888;margin-top:4px;font-size:11px">AtlasCRM</div>
</div>

<div class="footer">
  <span>AtlasCRM — Real Estate CRM</span>
  <span>დამატდა: ${l.created_at ? new Date(l.created_at).toLocaleDateString('ka-GE') : '—'}</span>
</div>
`;

        // Build the listing in a container whose styles are scoped to #wpdfRoot. It's hidden
        // by a 0×0 overflow:hidden holder (so nothing flashes on screen) while still keeping a
        // full layout box that html2canvas can capture. We call html2canvas directly and hand
        // the resulting image to jsPDF — this is far more reliable than the html2pdf wrapper.
        await _loadPdfLibs();

        const holder = document.createElement('div');
        holder.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;overflow:hidden;z-index:-1';
        const root = document.createElement('div');
        root.id = 'wpdfRoot';
        root.style.width = '760px';
        root.innerHTML = `<style>${styleCss}</style>${bodyMarkup}`;
        holder.appendChild(root);
        document.body.appendChild(holder);

        // Let fonts/layout settle (images are already embedded as base64) before rasterizing
        try { await document.fonts?.ready; } catch(e) {}
        await new Promise(r => setTimeout(r, 150));

        const fnameSafe = ('warm_' + (l.listing_number || l.listing_key || l.id?.slice(0,8) || 'listing'))
            .replace(/[^\w.-]+/g, '_');

        // Prefer the shared block-aware paginator (snaps page breaks to gaps
        // between blocks so nothing is cut mid-section). Fall back to a single
        // long-image slice if that helper isn't loaded for some reason.
        let blobResult = null;
        try {
            if (typeof _renderRootPaginated === 'function') {
                blobResult = await _renderRootPaginated(root, fnameSafe, { returnBlob: !!opts.returnBlob });
            } else {
                const canvas = await html2canvas(root, { scale: 2, useCORS: true, backgroundColor: '#ffffff', imageTimeout: 8000, logging: false });
                if (!canvas || !canvas.width || !canvas.height) throw new Error('Could not render the listing to an image');
                const { jsPDF } = window.jspdf;
                const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
                const pageW = pdf.internal.pageSize.getWidth();
                const pageH = pdf.internal.pageSize.getHeight();
                const margin = 8;
                const imgW = pageW - margin * 2;
                const imgH = canvas.height * imgW / canvas.width;
                const imgData = canvas.toDataURL('image/jpeg', 0.95);
                let heightLeft = imgH, pos = margin;
                pdf.addImage(imgData, 'JPEG', margin, pos, imgW, imgH);
                heightLeft -= (pageH - margin * 2);
                while (heightLeft > 0) {
                    pos = margin - (imgH - heightLeft);
                    pdf.addPage();
                    pdf.addImage(imgData, 'JPEG', margin, pos, imgW, imgH);
                    heightLeft -= (pageH - margin * 2);
                }
                if (opts.returnBlob) blobResult = { blob: pdf.output('blob'), filename: fnameSafe + '.pdf' };
                else pdf.save(fnameSafe + '.pdf');
            }
        } finally {
            holder.remove();
        }
        // Blob mode (used by "Send to WhatsApp"): hand the PDF back, no toast.
        if (opts.returnBlob) return blobResult;
        showToast('<i data-lucide="check-circle-2" class="lucide-i"></i> PDF ჩამოიტვირთა');
    } catch(e) {
        console.error('downloadListingPDF error:', e);
        showToast('PDF შეცდომა: ' + (e?.message || e), 'error');
        if (opts.returnBlob) throw e;
    }
}

// Open WhatsApp Direct message window
function openWhatsAppDirect(phone, contactType) {
    if (!phone) {
        showToast('ტელეფონი ხელმისაწვდომი არ არის', 'error');
        return;
    }
    const cleanPhone = phone.replace(/[^0-9]/g, '');
    if (cleanPhone.length < 5) {
        showToast('ტელეფონი არ ჩანს სწორი', 'error');
        return;
    }
    
    // Open in new window
    const url = `https://wa.me/${cleanPhone}`;
    window.open(url, '_blank', 'width=1000,height=700');
    closeModal();
    showToast('<i data-lucide="phone" class="lucide-i"></i> WhatsApp Web გახსნა...');
}

// Test WhatsApp Web integration
function testWhatsAppIntegration() {
    const phone = document.getElementById('int-whatsapp-number')?.value.trim();
    if (!phone) {
        showToast('გთხოვთ, შეიყვანეთ თქვენი WhatsApp ნომერი', 'error');
        return;
    }
    const cleanPhone = phone.replace(/[^0-9]/g, '');
    if (cleanPhone.length < 5) {
        showToast('ნომერი არ ჩანს სწორი', 'error');
        return;
    }
    // Open WhatsApp Web with test message
    const testMsg = encodeURIComponent('Test message from AtlasCRM 📲');
    window.open(`https://wa.me/${cleanPhone}?text=${testMsg}`, '_blank', 'width=1000,height=700');
    showToast('WhatsApp Web გახსნა...');
}

// Show guide modal for WhatsApp
function showWhatsAppGuide() {
    openModal('WhatsApp Web კონფიგურაცია', `
        <div style="padding:16px;font-size:14px;line-height:1.7">
            <h4 style="margin-top:0;color:var(--brand)">რა არის WhatsApp Web?</h4>
            <p>WhatsApp Web არის თქვენი პირადი WhatsApp-ის ვებ-ვერსია. ის დებულებას ადტებს თქვენ პირად ნომერზე.</p>
            
            <h4 style="color:var(--brand)">მოთხოვნები:</h4>
            <ul style="margin:8px 0;padding-left:20px">
                <li>აქტიური WhatsApp მეসენჯერი თქვენს ტელეფონზე</li>
                <li>ის ფაქტი რომ თქვენ გაქვთ WhatsApp ჩამატებული (ნებისმიერი რეგისტრაციის მეთოდი)</li>
                <li>ვებ-ბრაუზერი</li>
            </ul>
            
            <h4 style="color:var(--brand)">როგორ დააკონფიგურირო?</h4>
            <ol style="margin:8px 0;padding-left:20px">
                <li><strong>აქ შეიყვანეთ თქვენი ნომერი</strong> (ზუსტი, რომელზეც გაქვთ WhatsApp)</li>
                <li><strong>"Test WhatsApp Web" დააჭირეთ</strong> — გახსნება WhatsApp Web ახალ ფანჯარაში</li>
                <li><strong>თუ აღნიშვულია "სკანირება QR კოდი"</strong>, სკანირება თქვენი ფონით</li>
                <li><strong>დაელოდეთ ფაქტორს რომ გახსნება</strong> — დასრულდა!</li>
                <li><strong>"Save" დააჭირეთ</strong></li>
            </ol>
            
            <h4 style="color:var(--brand)">თუ რაიმე კითხვა გაქვთ:</h4>
            <p style="color:#666">მხოლოდ ელ-ფოსტის საშუალებით უპასუხოთ მხარდამჭერი ჯგუფს</p>
            
            <div style="padding:12px;background:#EFF6FF;border-radius:8px;margin-top:16px;font-size:13px;color:#666">
                <strong>⚠️ კონფიდენციალურობა:</strong> თქვენი ნომერი არის ჩაშენებული საჯაროდ (ბმულები, აქციები). ელოდეთ საკუთარი რესპონსივობის ელოდეთ.
            </div>
        </div>
    `);
}

async function saveIntegrations() {
    const g = ids => { for (const id of ids) { const el = document.getElementById(id); if (el) return el.value.trim() || null; } return null; };
    const gn = ids => { for (const id of ids) { const el = document.getElementById(id); if (el) return parseInt(el.value) || 587; } return 587; };
    const payload = {
        whatsapp_number:      g(['int-whatsapp-number','ms-whatsapp-number']),
        whatsapp_template:    g(['int-whatsapp-template','ms-whatsapp-template']),
        smtp_host:            g(['int-smtp-host','ms-smtp-host']),
        smtp_port:            gn(['int-smtp-port','ms-smtp-port']),
        smtp_user:            g(['int-smtp-user','ms-smtp-user']),
        smtp_pass:            g(['int-smtp-pass','ms-smtp-pass']),
        smtp_from:            g(['int-smtp-from','ms-smtp-from']),
        smtp_from_name:       g(['int-smtp-from-name','ms-smtp-from-name']),
        meta_access_token:    g(['int-meta-token']),
        meta_ad_account_id:   g(['int-meta-account']),
        tiktok_access_token:  g(['int-tiktok-token']),
        tiktok_advertiser_id: g(['int-tiktok-advertiser']),
    };
    try {
        const res = await fetch('/api/messaging/integrations', { method:'POST', credentials:'include', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload) });
        const json = await res.json();
        if (json.error) throw new Error(json.error);
        showToast('<i data-lucide="check-circle-2" class="lucide-i"></i> შენახულია!');
        closeMsgSettings();
    } catch(e) { showToast('შეცდომა: ' + e.message, 'error'); }
}

