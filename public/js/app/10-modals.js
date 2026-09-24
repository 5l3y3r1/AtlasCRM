// ═══════════════════════════════════════════════════════
// <i data-lucide="pencil-line" class="lucide-i"></i> MODALS — Lead, Listing, Client, Deal, Agent
// ═══════════════════════════════════════════════════════
function openModalLoading(title) {
    openModal(title, '<div style="padding:40px;text-align:center;color:var(--text-muted)"><i data-lucide="loader" class="lucide-i" style="animation:spin 1s linear infinite"></i><div style="margin-top:10px">იტვირთება...</div></div>');
}

function openModal(title, html) {
    const overlay = document.getElementById('modal');
    if (!overlay) return;
    document.getElementById('modal-title').innerHTML = title;
    document.getElementById('modal-body').innerHTML = html;
    // Force display BEFORE class change so browser paints immediately
    overlay.style.cssText = 'display:flex !important';
    overlay.classList.add('show');
    document.body.style.overflow = 'hidden';
    // Force reflow so paint happens in this frame
    void overlay.offsetHeight;
    if (window.lucide) try { window.lucide.createIcons(); } catch(e) {}
}

function closeModal() {
    const overlay = document.getElementById('modal');
    overlay.classList.remove('show');
    overlay.style.cssText = 'display:none';
    document.body.style.overflow = '';
}

function openLeadModal() {
    openModal(t("mt_new_lead"), `
        <div class="form-row">
            <div class="form-group">
                <label class="form-label">${t('f_owner_name','მფლობელი')}</label>
                <input class="form-input" id="lead-name" placeholder="გიორგი მამარდაშვილი">
            </div>
            <div class="form-group">
                <label class="form-label">${t("f_phone")} <span class="req" style="color:#EF4444;font-weight:700">*</span></label>
                <input class="form-input" id="lead-phone" placeholder="+995 5XX XXX XXX">
            </div>
        </div>
        <div class="form-group">
            <label class="form-label">${t("f_email")}</label>
            <input class="form-input" id="lead-email" type="email">
        </div>
        <div class="form-row">
            <div class="form-group">
                <label class="form-label">${t("f_phone")} 2</label>
                <input class="form-input" id="lead-phone2" placeholder="+995 5XX XXX XXX">
            </div>
            <div class="form-group">
                <label class="form-label">${t("f_phone")} 3</label>
                <input class="form-input" id="lead-phone3" placeholder="+995 5XX XXX XXX">
            </div>
        </div>
        <div class="form-row">
            <div class="form-group">
                <label class="form-label">MyHome ID</label>
                <input class="form-input" id="lead-myhome" placeholder="მაგ: 17789495">
            </div>
            <div class="form-group">
                <label class="form-label">SS.GE ID</label>
                <input class="form-input" id="lead-ssge" placeholder="მაგ: 28764626">
            </div>
        </div>
        <div class="form-row">
            <div class="form-group">
                <label class="form-label">${t("f_source")} <span class="req" style="color:#EF4444;font-weight:700">*</span></label>
                <select class="form-select" id="lead-source">
                    <option value="FACEBOOK">Facebook</option>
                    <option value="INSTAGRAM">Instagram</option>
                    <option value="TIKTOK">TikTok</option>
                    <option value="MYHOME">myhome.ge</option>
                    <option value="SSGE">ss.ge</option>
                    <option value="COLD_CALL">${t("src_cold_call")}</option>
                    <option value="REFERRAL">${t("src_referral")}</option>
                    <option value="WEBSITE">${t("src_website")}</option>
                    <option value="WALK_IN">${t("src_walk_in")}</option>
                    <option value="OTHER">სხვა</option>
                </select>
            </div>
            <div class="form-group">
                <label class="form-label">${t("f_temp")}</label>
                <select class="form-select" id="lead-temp">
                    <option value="HOT"><i data-lucide="flame" class="lucide-i"></i> HOT</option>
                    <option value="WARM" selected><i data-lucide="sun" class="lucide-i"></i> WARM</option>
                    <option value="COLD"><i data-lucide="snowflake" class="lucide-i"></i> COLD</option>
                </select>
            </div>
        </div>
        <div class="form-group">
            <label class="form-label"><i data-lucide="megaphone" class="lucide-i"></i> კამპანია (ატრიბუცია)</label>
            <select class="form-select" id="lead-campaign"><option value="">— იტვირთება… —</option></select>
        </div>
        <div class="form-group">
            <label class="form-label">${t("f_notes")}</label>
            <textarea class="form-textarea" id="lead-msg" rows="3"></textarea>
        </div>
        <button class="btn btn-primary" onclick="saveLead()" style="width:100%"><i data-lucide="save" class="lucide-i"></i> ${t("btn_save")}</button>
    `);
    populateCampaignSelect('lead-campaign');
}

async function saveLead() {
    const name = document.getElementById('lead-name').value.trim();
    const phone = document.getElementById('lead-phone').value.trim();
    const phone2 = (document.getElementById('lead-phone2') || {}).value?.trim() || null;
    const phone3 = (document.getElementById('lead-phone3') || {}).value?.trim() || null;
    const myhome_id = (document.getElementById('lead-myhome') || {}).value?.trim() || null;
    const ssge_id = (document.getElementById('lead-ssge') || {}).value?.trim() || null;
    const email = document.getElementById('lead-email').value.trim();
    const source = document.getElementById('lead-source').value;
    const temp = document.getElementById('lead-temp').value;
    const msg = document.getElementById('lead-msg').value.trim();
    
    if (!phone) {
        showToast('ტელეფონი აუცილებელია', 'error');
        return;
    }
    
    try {
        const { error } = await client.from('leads').insert({
            company_id: currentUser.company_id,
            full_name: name || null,
            phone: phone,
            phone2: phone2,
            phone3: phone3,
            myhome_id: myhome_id,
            ssge_id: ssge_id,
            email: email || null,
            source: source,
            temperature: temp,
            inquiry_message: msg || null,
            campaign_id: (document.getElementById('lead-campaign') || {}).value || null,
            status: 'NEW'
        });
        
        if (error) throw error;
        
        showToast('<i data-lucide="check-circle-2" class="lucide-i"></i> ლიდი დაემატა!');
        closeModal();
        if (currentPage === 'leads') loadLeads();
        if (currentPage === 'dashboard') loadDashboard();
        
    } catch (e) {
        showToast('შეცდომა: ' + e.message, 'error');
    }
}

function openListingModal() {
    openModal('+ ახალი ობიექტი', `
        <div class="form-group">
            <label class="form-label">${t('lf_title_optional','სათაური (არასავალდებულო)')}</label>
            <input class="form-input" id="lst-title" placeholder="3 ოთახიანი ბინა ვაკეში">
        </div>
        <div class="form-row">
            <div class="form-group">
                <label class="form-label">${t('lf_deal_type','გარიგების ტიპი')}</label>
                <select class="form-select" id="lst-deal">
                    <option value="SALE">იყიდება</option>
                    <option value="RENT">ქირავდება</option>
                    <option value="DAILY_RENT">დღიური ქირა</option>
                </select>
            </div>
            <div class="form-group">
                <label class="form-label">${t('lf_property_type','ქონების ტიპი')}</label>
                <select class="form-select" id="lst-type" onchange="onListingTypeChange()">
                    <option value="APARTMENT">ბინა</option>
                    <option value="HOUSE">კერძო სახლი</option>
                    <option value="COMMERCIAL">კომერციული</option>
                    <option value="LAND">მიწა</option>
                    <option value="OFFICE">ოფისი</option>
                    <option value="HOTEL">სასტუმრო</option>
                    <option value="GARAGE">გარაჟი / ავტოსადგომი</option>
                    <option value="BASEMENT">სარდაფი</option>
                </select>
            </div>
        </div>
        <div class="form-row">
            <div class="form-group">
                <label class="form-label">ფასი <span class="req" style="color:#EF4444;font-weight:700">*</span></label>
                <input class="form-input" id="lst-price" type="number" placeholder="0">
            </div>
            <div class="form-group">
                <label class="form-label">${t('lf_currency_input','ვალუტა (შესაყვანი)')}</label>
                <select class="form-select" id="lst-currency" onchange="updatePriceConv()">
                    <option value="USD">USD ($)</option>
                    <option value="GEL">GEL (₾)</option>
                </select>
            </div>
        </div>
        <div style="font-size:12px;color:var(--text-muted);margin:-6px 0 12px 2px" id="lst-price-conv">≈ —</div>
        <div class="form-group">
            <label class="form-label">${t('lf_display_currency','ჩვენების ვალუტა (რა გამოჩნდეს)')}</label>
            <select class="form-select" id="lst-display-currency">
                <option value="USD">USD ($)</option>
                <option value="GEL">GEL (₾)</option>
                <option value="BOTH">ორივე ($ და ₾)</option>
            </select>
        </div>
        <div class="form-row">
            <div class="form-group">
                <label class="form-label">${t("f_area")} (მ²)</label>
                <input class="form-input" id="lst-area" type="number">
            </div>
            <div class="form-group">
                <label class="form-label">${t('lf_rooms','ოთახები')}</label>
                <input class="form-input" id="lst-rooms" type="number">
            </div>
        </div>

        <!-- ── შენობა და მდგომარეობა ── -->
        <div style="font-weight:700;font-size:13px;color:var(--brand);margin:14px 0 8px;padding-bottom:6px;border-bottom:1px solid var(--border)">${t('sec_building','შენობა და მდგომარეობა')}</div>
        <div class="form-row">
            <div class="form-group">
                <label class="form-label">${t('lf_bathrooms','სველი წერტილები')}</label>
                <input class="form-input" id="lst-bathrooms" type="number" min="0">
            </div>
            <div class="form-group">
                <label class="form-label">${t('lf_balconies_count','აივნების რაოდენობა')}</label>
                <input class="form-input" id="lst-balconies" type="number" min="0">
            </div>
        </div>
        <div class="form-row">
            <div class="form-group">
                <label class="form-label">${t('lf_floor','სართული')}</label>
                <input class="form-input" id="lst-floor" type="number">
            </div>
            <div class="form-group">
                <label class="form-label">${t('lf_total_floors','სართულების რაოდენობა')}</label>
                <input class="form-input" id="lst-total-floors" type="number" min="0">
            </div>
        </div>
        <div class="form-row">
            <div class="form-group">
                <label class="form-label">${t('lf_year_built','აშენების წელი')}</label>
                <input class="form-input" id="lst-year-built" type="number" placeholder="2015">
            </div>
            <div class="form-group">
                <label class="form-label">${t('lf_ceiling_height','ჭერის სიმაღლე (მ)')}</label>
                <input class="form-input" id="lst-ceiling" type="number" step="0.1" placeholder="2.7">
            </div>
        </div>
        <div class="form-row">
            <div class="form-group">
                <label class="form-label">${t('lf_building_material','შენობის მასალა')}</label>
                <select class="form-select" id="lst-material">
                    <option value="">—</option>
                    <option value="BLOCK">${t('opt_block','ბლოკი')}</option>
                    <option value="BRICK">${t('opt_brick','აგური')}</option>
                    <option value="PANEL">${t('opt_panel','პანელური')}</option>
                    <option value="MONOLITH">${t('opt_monolith','მონოლითი')}</option>
                    <option value="WOOD">${t('opt_wood','ხის')}</option>
                    <option value="OTHER">${t('opt_other','სხვა')}</option>
                </select>
            </div>
            <div class="form-group">
                <label class="form-label">${t('lf_building_status','შენობის სტატუსი')}</label>
                <select class="form-select" id="lst-building-status">
                    <option value="">—</option>
                    <option value="NEW">${t('opt_new_building','ახალი აშენებული')}</option>
                    <option value="OLD">${t('opt_old_building','ძველი აშენებული')}</option>
                    <option value="UNDER_CONSTRUCTION">${t('opt_under_construction','მშენებარე')}</option>
                </select>
            </div>
        </div>
        <div class="form-group">
            <label class="form-label">${t('lf_renovation_status','მდგომარეობა / რემონტი')}</label>
            <select class="form-select" id="lst-renovation">
                <option value="">—</option>
                <option value="NEWLY_RENOVATED">${t('opt_newly_renovated','ახალი გარემონტებული')}</option>
                <option value="GOOD">${t('opt_good_condition','კარგ მდგომარეობაში')}</option>
                <option value="NEEDS_RENOVATION">${t('opt_needs_renovation','საჭიროებს რემონტს')}</option>
                <option value="BLACK_FRAME">${t('opt_black_frame','შავი კარკასი')}</option>
                <option value="WHITE_FRAME">${t('opt_white_frame','თეთრი კარკასი')}</option>
                <option value="GREEN_FRAME">${t('opt_green_frame','მწვანე კარკასი')}</option>
            </select>
        </div>
        <div class="form-group">
            <label class="form-label">${t('lf_view_type','ხედი')}</label>
            <select class="form-select" id="lst-view">
                <option value="">—</option>
                <option value="SEA">${t('opt_view_sea','ზღვაზე')}</option>
                <option value="MOUNTAIN">${t('opt_view_mountain','მთაზე')}</option>
                <option value="YARD">${t('opt_view_yard','ეზოში')}</option>
                <option value="STREET">${t('opt_view_street','ქუჩაზე')}</option>
                <option value="PARK">${t('opt_view_park','პარკზე')}</option>
                <option value="OTHER">${t('opt_other','სხვა')}</option>
            </select>
        </div>

        <!-- ── კომუნიკაციები და სისტემები ── -->
        <div style="font-weight:700;font-size:13px;color:var(--brand);margin:14px 0 8px;padding-bottom:6px;border-bottom:1px solid var(--border)">${t('sec_systems','კომუნიკაციები და სისტემები')}</div>
        <div class="form-row">
            <div class="form-group">
                <label class="form-label">${t('lf_heating_type','გათბობა')}</label>
                <select class="form-select" id="lst-heating">
                    <option value="">—</option>
                    <option value="CENTRAL">${t('opt_central','ცენტრალური')}</option>
                    <option value="INDIVIDUAL">${t('opt_individual','ინდივიდუალური')}</option>
                    <option value="FLOOR">${t('opt_floor_heating','იატაკის გათბობა')}</option>
                    <option value="NONE">${t('opt_none','არ არის')}</option>
                    <option value="OTHER">${t('opt_other','სხვა')}</option>
                </select>
            </div>
            <div class="form-group">
                <label class="form-label">${t('lf_hot_water_type','ცხელი წყალი')}</label>
                <select class="form-select" id="lst-hotwater">
                    <option value="">—</option>
                    <option value="CENTRAL">${t('opt_central','ცენტრალური')}</option>
                    <option value="BOILER">${t('opt_boiler','გამაცხელებელი / ავზი')}</option>
                    <option value="GAS_HEATER">${t('opt_gas_heater','გაზის გამაცხელებელი')}</option>
                    <option value="NONE">${t('opt_none','არ არის')}</option>
                </select>
            </div>
        </div>
        <div class="form-group">
            <label class="form-label">${t('lf_furniture_status','ავეჯი')}</label>
            <select class="form-select" id="lst-furniture">
                <option value="">—</option>
                <option value="FULL">${t('opt_full_furniture','სრულად ავეჯით')}</option>
                <option value="PARTIAL">${t('opt_partial_furniture','ნაწილობრივ')}</option>
                <option value="NONE">${t('opt_no_furniture','უავეჯოდ')}</option>
            </select>
        </div>

        <!-- ── კეთილმოწყობა ── -->
        <div style="font-weight:700;font-size:13px;color:var(--brand);margin:14px 0 8px;padding-bottom:6px;border-bottom:1px solid var(--border)">${t('sec_amenities','კეთილმოწყობა')}</div>
        <div style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:14px">
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:13px"><input type="checkbox" id="lst-elevator" style="accent-color:var(--brand)"> ${t('am_elevator','ლიფტი')}</label>
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:13px"><input type="checkbox" id="lst-ac" style="accent-color:var(--brand)"> ${t('am_ac','კონდიციონერი')}</label>
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:13px"><input type="checkbox" id="lst-internet" style="accent-color:var(--brand)"> ${t('am_internet','ინტერნეტი')}</label>
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:13px"><input type="checkbox" id="lst-tv" style="accent-color:var(--brand)"> ${t('am_tv','საკაბელო TV')}</label>
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:13px"><input type="checkbox" id="lst-alarm" style="accent-color:var(--brand)"> ${t('am_alarm','სიგნალიზაცია')}</label>
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:13px"><input type="checkbox" id="lst-storage" style="accent-color:var(--brand)"> ${t('am_storage','სათავსო')}</label>
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:13px"><input type="checkbox" id="lst-fireplace" style="accent-color:var(--brand)"> ${t('am_fireplace','ბუხარი')}</label>
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:13px"><input type="checkbox" id="lst-negotiable" style="accent-color:var(--brand)"> ${t('lf_negotiable','ფასი შეთანხმებადია')}</label>
        </div>

        <!-- ── მედია ── -->
        <div style="font-weight:700;font-size:13px;color:var(--brand);margin:14px 0 8px;padding-bottom:6px;border-bottom:1px solid var(--border)">${t('sec_media','მედია')}</div>
        <div class="form-row">
            <div class="form-group">
                <label class="form-label">${t('lf_video_url','ვიდეო ტური (ლინკი)')}</label>
                <input class="form-input" id="lst-video-url" placeholder="https://youtube.com/...">
            </div>
            <div class="form-group">
                <label class="form-label">${t('lf_virtual_tour_url','3D / ვირტუალური ტური (ლინკი)')}</label>
                <input class="form-input" id="lst-tour-url" placeholder="https://...">
            </div>
        </div>

        <!-- ── ექსკლუზიური + პარკინგი ── -->
        <div class="form-row" style="align-items:center;gap:16px;margin-bottom:4px">
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;font-weight:500">
                <input type="checkbox" id="lst-exclusive" style="width:16px;height:16px;accent-color:var(--brand)">
                <span style="color:var(--brand);font-weight:700">★ ექსკლუზიური</span>
            </label>
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;font-weight:500">
                <input type="checkbox" id="lst-parking-chk" style="width:16px;height:16px;accent-color:var(--brand)" onchange="document.getElementById('lst-parking-type-row').style.display=this.checked?'':'none'">
                <span>🚗 პარკინგი</span>
            </label>
        </div>
        <div class="form-group" id="lst-parking-type-row" style="display:none">
            <label class="form-label">${t('lf_parking_type','პარკინგის ტიპი')}</label>
            <select class="form-select" id="lst-parking-type">
                <option value="GARAGE">ავტოფარეხი (Garage)</option>
                <option value="COVERED">სახურავქვეშ (Covered)</option>
                <option value="OPEN">ღია (Open)</option>
                <option value="STREET">ქუჩის პარკინგი</option>
                <option value="OTHER">სხვა</option>
            </select>
        </div>

        <!-- ── კერძო სახლი ── -->
        <div id="lst-house-fields" style="display:none;border:1px solid #BFDBFE;border-radius:8px;padding:12px;margin-bottom:8px;background:var(--brand-soft)">
            <div style="font-weight:700;font-size:13px;color:var(--brand);margin-bottom:10px">🏡 კერძო სახლი</div>
            <div class="form-row">
                <div class="form-group">
                    <label class="form-label">${t('lf_land_area','მიწის ნაკვეთი (მ²)')}</label>
                    <input class="form-input" id="lst-land-area" type="number" placeholder="500">
                </div>
                <div class="form-group">
                    <label class="form-label">${t('lf_summer_house','სააგარაკე / საზაფხულო')}</label>
                    <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;margin-top:10px">
                        <input type="checkbox" id="lst-vacation" style="width:16px;height:16px;accent-color:var(--brand)">
                        <span>სააგარაკე სახლი</span>
                    </label>
                </div>
            </div>
            <div class="form-group">
                <label class="form-label">${t('lf_pool','აუზი')}</label>
                <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px">
                    <input type="checkbox" id="lst-pool" style="width:16px;height:16px;accent-color:var(--brand)">
                    <span>აუზი არის</span>
                </label>
            </div>
        </div>

        <!-- ── მიწა ── -->
        <div id="lst-land-fields" style="display:none;border:1px solid #D1FAE5;border-radius:8px;padding:12px;margin-bottom:8px;background:var(--success-soft)">
            <div style="font-weight:700;font-size:13px;color:#059669;margin-bottom:10px">🌿 მიწის ნაკვეთი</div>
            <div class="form-row">
                <div class="form-group">
                    <label class="form-label">მიწის ფართი (მ²) <span style="color:#EF4444;font-weight:700">*</span></label>
                    <input class="form-input" id="lst-land-area-land" type="number" placeholder="1000" oninput="calcLandPriceModal()">
                </div>
                <div class="form-group">
                    <label class="form-label">${t('lf_price_per_sqm','ფასი მ²-ზე ($)')}</label>
                    <input class="form-input" id="lst-land-psqm" readonly placeholder="ავტო" style="background:var(--surface-2)">
                </div>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label class="form-label">${t('lf_coefficient','კოეფიციენტი')}</label>
                    <select class="form-select" id="lst-land-coeff">
                        <option value="">—</option>
                        <option value="K1">K1</option>
                        <option value="K2">K2</option>
                        <option value="K3">K3</option>
                    </select>
                </div>
                <div class="form-group">
                    <label class="form-label">${t('lf_land_purpose','მიწის დანიშნულება')}</label>
                    <select class="form-select" id="lst-land-purpose">
                        <option value="">—</option>
                        <option value="AGRICULTURAL">სასოფლო-სამეურნეო</option>
                        <option value="RESIDENTIAL">საცხოვრებელი განაშენ.</option>
                        <option value="COMMERCIAL">კომერციული განაშენ.</option>
                        <option value="INDUSTRIAL">სამრეწველო</option>
                        <option value="RECREATIONAL">რეკრეაციული</option>
                        <option value="MIXED">შერეული</option>
                        <option value="FOREST">სატყეო ფონდი</option>
                        <option value="OTHER">სხვა</option>
                    </select>
                </div>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label class="form-label">${t('lf_functional_zone','ფუნქციური ზონა')}</label>
                    <select class="form-select" id="lst-func-zone">
                        <option value="">—</option>
                        <option value="A1">A1 — ინდ. საცხოვრებელი</option>
                        <option value="A2">A2 — მცირე სართ. მრავალბ.</option>
                        <option value="A3">A3 — საშ. სართ. მრავალბ.</option>
                        <option value="A4">A4 — მაღ. სართ. მრავალბ.</option>
                        <option value="B1">B1 — სასაზღვრო კომ.</option>
                        <option value="B2">B2 — ზოგადი კომ.</option>
                        <option value="B3">B3 — ცენტრ. კომ.</option>
                        <option value="C1">C1 — სამრეწველო</option>
                        <option value="OTHER">სხვა</option>
                    </select>
                </div>
                <div class="form-group">
                    <label class="form-label">${t('lf_road_type','გზის ტიპი')}</label>
                    <select class="form-select" id="lst-road-type">
                        <option value="">—</option>
                        <option value="ASPHALT">ასფალტი</option>
                        <option value="GRAVEL">სილა / ხრეში</option>
                        <option value="DIRT">მიწის გზა</option>
                        <option value="CONCRETE">ბეტონი</option>
                        <option value="OTHER">სხვა</option>
                    </select>
                </div>
            </div>
            <div class="form-group">
                <label class="form-label">${t('lf_utilities','კომუნიკაციები')}</label>
                <div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:6px">
                    <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:12px"><input type="checkbox" id="lc-elec" style="accent-color:var(--brand)"> ელექტრო</label>
                    <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:12px"><input type="checkbox" id="lc-water" style="accent-color:var(--brand)"> წყალი</label>
                    <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:12px"><input type="checkbox" id="lc-gas" style="accent-color:var(--brand)"> გაზი</label>
                    <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:12px"><input type="checkbox" id="lc-sewer" style="accent-color:var(--brand)"> კანალიზაცია</label>
                    <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:12px"><input type="checkbox" id="lc-inet" style="accent-color:var(--brand)"> ინტერნეტი</label>
                </div>
            </div>
        </div>

        <div class="form-row">
            <div class="form-group">
                <label class="form-label">${t('f_city','ქალაქი')}</label>
                <select class="form-select" id="lst-city" onchange="onCityChange()">
                    <option value="თბილისი">თბილისი</option>
                    <option value="ბათუმი">ბათუმი</option>
                    <option value="ქუთაისი">ქუთაისი</option>
                    <option value="რუსთავი">რუსთავი</option>
                    <option value="გორი">გორი</option>
                    <option value="ზუგდიდი">ზუგდიდი</option>
                    <option value="ფოთი">ფოთი</option>
                    <option value="თელავი">თელავი</option>
                </select>
            </div>
            <div class="form-group">
                <label class="form-label">${t("f_district")}</label>
                <input class="form-input" id="lst-district" placeholder="ვაკე">
            </div>
        </div>
        <div class="form-group" style="position:relative">
            <label class="form-label"><i data-lucide="map-pin" class="lucide-i"></i> მისამართი</label>
            <input class="form-input" id="lst-address" autocomplete="off" placeholder="აკრიფე მისამართი..." oninput="addrAutocomplete(this.value)">
            <div id="addr-suggestions" style="display:none;position:absolute;z-index:50;left:0;right:0;background:var(--surface);border:1px solid #e0e0e0;border-radius:8px;box-shadow:0 6px 20px rgba(0,0,0,.12);max-height:220px;overflow-y:auto;margin-top:2px"></div>
        </div>
        
        <div class="form-group">
            <label class="form-label"><i data-lucide="clipboard-list" class="lucide-i"></i> საკადასტრო კოდი (არასავალდებულო)</label>
            <input class="form-input" id="lst-cadastral" placeholder="01.10.05.001.001">
            <div style="font-size:11px;color:var(--text-muted);margin-top:4px">ფორმატი: 01.XX.XX.XXX.XXX</div>
        </div>

        <div class="form-group">
            <label class="form-label">${t('lf_description','აღწერა / კომენტარი')}</label>
            <textarea class="form-textarea" id="lst-description" rows="3" placeholder="დეტალური აღწერა, თავისებურებები..."></textarea>
        </div>

        <div style="border-top:1px solid #eee;margin:8px 0 14px;padding-top:14px">
            <div style="font-weight:600;margin-bottom:10px;font-size:14px"><i data-lucide="user" class="lucide-i"></i> მესაკუთრის კონტაქტი</div>
            <div class="form-row">
                <div class="form-group">
                    <label class="form-label">${t("f_name")}</label>
                    <input class="form-input" id="lst-owner-name" placeholder="მესაკუთრის სახელი">
                </div>
                <div class="form-group">
                    <label class="form-label">${t("f_phone")}</label>
                    <input class="form-input" id="lst-owner-phone" placeholder="+995 5XX XXX XXX">
                </div>
            </div>
            <div class="form-group">
                <label class="form-label">${t("f_email")}</label>
                <input class="form-input" id="lst-owner-email" type="email" placeholder="email@example.com">
            </div>
            <div style="font-size:11px;color:var(--text-muted);margin-top:-6px">ℹ️ მესაკუთრე ავტომატურად დაემატება ლიდებში</div>
        </div>

        <div class="form-row">
            <div class="form-group">
                <label class="form-label">${t("f_source")}</label>
                <select class="form-select" id="lst-source" onchange="toggleSourceUrl()">
                    <option value="">— პირდაპირი —</option>
                    <option value="MYHOME">myhome.ge</option>
                    <option value="SSGE">ss.ge</option>
                    <option value="FACEBOOK">Facebook</option>
                    <option value="OTHER">სხვა</option>
                </select>
            </div>
            <div class="form-group" id="lst-source-url-wrap" style="display:none">
                <label class="form-label">${t('lf_listing_url','განცხადების ლინკი')}</label>
                <input class="form-input" id="lst-source-url" placeholder="https://...">
            </div>
        </div>
        
        <div class="form-group">
            <label class="form-label"><i data-lucide="camera" class="lucide-i"></i> ფოტოები</label>
            <div class="photo-upload" id="photo-upload">
                <input type="file" id="photo-input" accept="image/*" multiple>
                <div class="photo-upload-icon"><i data-lucide="camera" class="lucide-i"></i></div>
                <div class="photo-upload-text">დააჭირე ან ჩააგდე ფოტოები</div>
                <div class="photo-upload-hint">JPG, PNG • მაქს. 10MB თითო</div>
            </div>
            <div class="photo-previews" id="photo-previews"></div>
        </div>
        
        <button class="btn btn-primary" onclick="saveListing()" style="width:100%"><i data-lucide="save" class="lucide-i"></i> ${t("btn_save")}</button>
    `);
    
    setupPhotoUpload();
}

function onListingTypeChange() {
    const t = document.getElementById('lst-type')?.value;
    const hf = document.getElementById('lst-house-fields');
    const lf = document.getElementById('lst-land-fields');
    if (hf) hf.style.display = t === 'HOUSE' ? '' : 'none';
    if (lf) lf.style.display = t === 'LAND' ? '' : 'none';
}

function calcLandPriceModal() {
    const price = parseFloat(document.getElementById('lst-price')?.value) || 0;
    const area  = parseFloat(document.getElementById('lst-land-area-land')?.value) || 0;
    const el = document.getElementById('lst-land-psqm');
    if (el) el.value = (price > 0 && area > 0) ? (price / area).toFixed(1) : '';
}

async function saveListing() {
  try {
    const val = (id) => {
        const el = document.getElementById(id);
        if (!el) throw new Error('ველი ვერ მოიძებნა: #' + id);
        return el.value;
    };
    const title = val('lst-title').trim();
    const dealType = val('lst-deal');
    const price = val('lst-price');
    const inputCurrency = val('lst-currency');
    const displayCurrency = val('lst-display-currency');
    const area = val('lst-area');
    const rooms = val('lst-rooms');
    const city = val('lst-city');
    const district = val('lst-district').trim();
    const address = val('lst-address').trim();
    const cadastral = val('lst-cadastral').trim();
    const ownerName = val('lst-owner-name').trim();
    const ownerPhone = val('lst-owner-phone').trim();
    const ownerEmail = val('lst-owner-email').trim();
    const source = val('lst-source');
    const sourceUrl = val('lst-source-url').trim();
    const typeNames2 = (typeof propertyTypeNames === 'object' && propertyTypeNames) ? propertyTypeNames : {};
    const listingTypeVal = document.getElementById('lst-type')?.value || 'APARTMENT';
    
    if (!price) {
        showToast('ფასი აუცილებელია', 'error');
        return;
    }
    // Store list_price in USD canonically; convert if entered in GEL.
    const rate = (typeof GEL_PER_USD === 'number' && GEL_PER_USD) ? GEL_PER_USD : 2.70;
    const priceUSD = inputCurrency === 'GEL' ? Number(price) / rate : Number(price);
    const autoTitle = title || `${typeNames2[listingTypeVal] || listingTypeVal} ${district ? '— ' + district : ''}`.trim();
    const addrEl = document.getElementById('lst-address');
    const lat = addrEl && addrEl._lat ? Number(addrEl._lat) : null;
    const lng = addrEl && addrEl._lng ? Number(addrEl._lng) : null;
    
    // If owner contact provided, add them as a lead first and link it.
        let ownerLeadId = null;
        if (ownerName || ownerPhone) {
            const { data: leadRow, error: leadErr } = await client.from('leads').insert({
                company_id: currentUser.company_id,
                agent_id: currentUser.id,
                full_name: ownerName || null,
                phone: ownerPhone || null,
                email: ownerEmail || null,
                source: source || 'OTHER',
                temperature: 'WARM',
                status: 'NEW',
                inquiry_message: `მესაკუთრე — ${autoTitle}`
            }).select().single();
            if (leadErr) {
                console.error('Owner lead insert failed:', leadErr);
                showToast('მესაკუთრის ლიდად დამატება ვერ მოხერხდა: ' + (leadErr.message || ''), 'error');
            } else if (leadRow) {
                ownerLeadId = leadRow.id;
            }
        }
        
        const listingType = listingTypeVal;
        const isExclusive = document.getElementById('lst-exclusive')?.checked ? 1 : 0;
        const parkingChk = document.getElementById('lst-parking-chk')?.checked;
        const parkingType = parkingChk ? (document.getElementById('lst-parking-type')?.value || null) : null;
        const description = document.getElementById('lst-description')?.value.trim() || null;

        // House-specific
        const landAreaHouse = listingType === 'HOUSE' ? (parseFloat(document.getElementById('lst-land-area')?.value) || null) : null;
        const hasPool = listingType === 'HOUSE' ? (document.getElementById('lst-pool')?.checked ? 1 : 0) : 0;
        const isVacation = listingType === 'HOUSE' ? (document.getElementById('lst-vacation')?.checked ? 1 : 0) : 0;

        // Land-specific
        const landAreaLand = listingType === 'LAND' ? (parseFloat(document.getElementById('lst-land-area-land')?.value) || null) : null;
        const landCoeff = listingType === 'LAND' ? (document.getElementById('lst-land-coeff')?.value || null) : null;
        const landPurpose = listingType === 'LAND' ? (document.getElementById('lst-land-purpose')?.value || null) : null;
        const funcZone = listingType === 'LAND' ? (document.getElementById('lst-func-zone')?.value || null) : null;
        const roadType = listingType === 'LAND' ? (document.getElementById('lst-road-type')?.value || null) : null;
        const comms = listingType === 'LAND' ? ['elec','water','gas','sewer','inet'].filter(c => document.getElementById('lc-'+c)?.checked) : [];
        const finalLandArea = landAreaHouse || landAreaLand;

        // Comprehensive detail fields (building/systems/amenities/media) — apply to any type.
        const gV = (id) => document.getElementById(id)?.value || null;
        const gN = (id) => { const v = document.getElementById(id)?.value; return v ? Number(v) : null; };
        const gC = (id) => document.getElementById(id)?.checked ? 1 : 0;

        const { data, error } = await client.from('listings').insert({
            agent_id: currentUser.id,
            title: autoTitle,
            listing_type: dealType,
            property_type: listingType,
            list_price: Math.round(priceUSD),
            currency: displayCurrency,
            living_area: area ? Number(area) : null,
            bedrooms_total: rooms ? Number(rooms) : null,
            city: city || null,
            district: district || null,
            address: address || null,
            latitude: lat,
            longitude: lng,
            cadastral_code: cadastral || null,
            source: source || null,
            source_url: sourceUrl || null,
            owner_lead_id: ownerLeadId,
            status: 'ACTIVE',
            description,
            is_exclusive: isExclusive,
            parking_available: parkingChk ? 1 : 0,
            parking_type: parkingType,
            land_area: finalLandArea,
            has_pool: hasPool,
            is_vacation_home: isVacation,
            land_coefficient: landCoeff,
            land_purpose: landPurpose,
            functional_zone: funcZone,
            land_road_type: roadType,
            land_communications: comms.length ? JSON.stringify(comms) : null,
            price_per_sqm: (landAreaLand && priceUSD) ? Math.round(priceUSD / landAreaLand) : null,
            bathrooms: gN('lst-bathrooms'),
            total_area: gN('lst-area'),
            floor: gN('lst-floor'),
            total_floors: gN('lst-total-floors'),
            year_built: gN('lst-year-built'),
            ceiling_height: gN('lst-ceiling'),
            balconies_count: gN('lst-balconies'),
            building_material: gV('lst-material'),
            building_status: gV('lst-building-status'),
            renovation_status: gV('lst-renovation'),
            view_type: gV('lst-view'),
            heating_type: gV('lst-heating'),
            hot_water_type: gV('lst-hotwater'),
            furniture_status: gV('lst-furniture'),
            has_elevator: gC('lst-elevator'),
            has_ac: gC('lst-ac'),
            has_internet: gC('lst-internet'),
            has_tv_cable: gC('lst-tv'),
            has_alarm: gC('lst-alarm'),
            has_storage: gC('lst-storage'),
            has_fireplace: gC('lst-fireplace'),
            is_negotiable: gC('lst-negotiable'),
            video_url: (document.getElementById('lst-video-url')?.value || '').trim() || null,
            virtual_tour_url: (document.getElementById('lst-tour-url')?.value || '').trim() || null,
        }).select().single();
        
        if (error) throw error;
        
        showToast('<i data-lucide="check-circle-2" class="lucide-i"></i> ობიექტი დაემატა!' + (ownerLeadId ? ' მესაკუთრე ლიდებში დაემატა.' : ''));
        
        if (selectedPhotos.length > 0 && data) {
            await uploadPhotos(data.id);
        }
        
        closeModal();
        if (currentPage === 'listings') loadListings();
        if (currentPage === 'dashboard') loadDashboard();
        if (currentPage === 'map') refreshMapMarkers();
        
    } catch (e) {
        showToast('შეცდომა: ' + e.message, 'error');
    }
}

function setupPhotoUpload() {
    selectedPhotos = [];
    
    const upload = document.getElementById('photo-upload');
    const input = document.getElementById('photo-input');
    if (!upload || !input) return;
    upload.addEventListener('click', () => input.click());
    
    upload.addEventListener('dragover', (e) => {
        e.preventDefault();
        upload.classList.add('dragover');
    });
    
    upload.addEventListener('dragleave', () => {
        upload.classList.remove('dragover');
    });
    
    upload.addEventListener('drop', (e) => {
        e.preventDefault();
        upload.classList.remove('dragover');
        handlePhotos(e.dataTransfer.files);
    });
    
    input.addEventListener('change', (e) => {
        handlePhotos(e.target.files);
    });
}

function handlePhotos(files) {
    Array.from(files).forEach(file => {
        if (!file.type.startsWith('image/')) {
            showToast('მხოლოდ ფოტოები', 'error');
            return;
        }
        
        if (file.size > 10 * 1024 * 1024) {
            showToast(`${file.name} ძალიან დიდია (max 10MB)`, 'error');
            return;
        }
        
        selectedPhotos.push(file);
        renderPhotoPreviews();
    });
}

function renderPhotoPreviews() {
    const container = document.getElementById('photo-previews');
    container.innerHTML = '';
    
    selectedPhotos.forEach((file, index) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const div = document.createElement('div');
            div.className = 'photo-preview';
            div.innerHTML = `
                <img src="${e.target.result}" alt="Preview">
                <button class="photo-preview-remove" onclick="removePhoto(${index})">×</button>
            `;
            container.appendChild(div);
        };
        reader.readAsDataURL(file);
    });
}

function removePhoto(index) {
    selectedPhotos.splice(index, 1);
    renderPhotoPreviews();
}

// Resize a photo and return a compressed JPEG data URL. Respects EXIF orientation when
// the browser supports it, so phone photos don't come out rotated.
async function _resizeToDataUrl(file, maxDim = 1280, quality = 0.72) {
    let bmp;
    try {
        bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch(e) {
        bmp = await new Promise((resolve, reject) => {
            const img = new Image();
            const url = URL.createObjectURL(file);
            img.onload  = () => { URL.revokeObjectURL(url); resolve(img); };
            img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image decode failed')); };
            img.src = url;
        });
    }
    let w = bmp.width, h = bmp.height;
    if (w > maxDim || h > maxDim) {
        if (w >= h) { h = Math.round(h * maxDim / w); w = maxDim; }
        else        { w = Math.round(w * maxDim / h); h = maxDim; }
    }
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    canvas.getContext('2d').drawImage(bmp, 0, 0, w, h);
    if (bmp.close) bmp.close();
    return canvas.toDataURL('image/jpeg', quality);
}

// Check whether a URL actually serves an image (not a 404 / HTML fallback page).
async function _urlIsImage(url) {
    try {
        if (!url) return false;
        if (url.startsWith('data:image/')) return true;
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 6000);
        let res;
        try { res = await fetch(url, { signal: ctrl.signal }); }
        finally { clearTimeout(t); }
        if (!res.ok) return false;
        const ct = res.headers.get('content-type') || '';
        return ct.startsWith('image/');
    } catch(e) { return false; }
}

async function uploadPhotos(listingId, markFirstPrimary = true) {
    if (selectedPhotos.length === 0) return;

    showToast(`<i data-lucide="send" class="lucide-i"></i> ${selectedPhotos.length} ფოტო იტვირთება...`, 'info');

    let successCount = 0;

    for (let i = 0; i < selectedPhotos.length; i++) {
        const file = selectedPhotos[i];
        let imageUrl = null;

        // 1) Try the storage bucket first. Only use its public URL if that URL actually
        //    serves an image — on this setup it often returns the app's HTML page instead,
        //    which is why uploaded photos "disappeared" after a reload.
        try {
            const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
            const fileName = `${listingId}/${Date.now()}_${i}.${ext}`;
            const { data: uploadData, error: uploadError } = await client.storage
                .from('listings')
                .upload(fileName, file, { cacheControl: '3600', upsert: false });
            if (uploadError) {
                console.error('Upload error:', uploadError);
            } else if (uploadData && uploadData.path) {
                const { data: urlData } = client.storage.from('listings').getPublicUrl(uploadData.path);
                const candidate = urlData && urlData.publicUrl;
                if (candidate && await _urlIsImage(candidate)) imageUrl = candidate;
            }
        } catch (e) {
            console.error('Storage upload failed:', e);
        }

        // 2) Fallback: embed a compressed copy of the image in the database so it ALWAYS
        //    loads — in the listing, the thumbnails, and the PDF — regardless of storage.
        if (!imageUrl) {
            try { imageUrl = await _resizeToDataUrl(file, 1280, 0.72); }
            catch (e) { console.error('Image resize failed:', e); }
        }
        if (!imageUrl) continue;

        const { error: dbError } = await client.from('property_images').insert({
            listing_id: listingId,
            image_url: imageUrl,
            is_primary: (markFirstPrimary && i === 0),
            display_order: i,
            uploaded_by: currentUser.id
        });

        if (!dbError) successCount++;
        else console.error('property_images insert error:', dbError);
    }

    if (successCount > 0) {
        showToast(`<i data-lucide="check-circle-2" class="lucide-i"></i> ${successCount} ფოტო ატვირთულია`);
    } else {
        showToast('ფოტოს ატვირთვა ვერ მოხერხდა', 'error');
    }
}

const _CLI_SEC = (t) => `<div style="font-weight:700;font-size:13px;color:var(--brand);margin:18px 0 10px;padding-bottom:6px;border-bottom:1px solid var(--border)">${t}</div>`;
const _cliGenderOpts = (v='') => ['','კაცი','ქალი','სხვა'].map(o=>`<option value="${o}" ${o===v?'selected':''}>${o||'—'}</option>`).join('');
const _cliContactOpts = (v='') => [['','—'],['PHONE','ტელეფონი'],['EMAIL','ელფოსტა'],['WHATSAPP','WhatsApp'],['TELEGRAM','Telegram'],['SMS','SMS']].map(([k,l])=>`<option value="${k}" ${k===v?'selected':''}>${l}</option>`).join('');
const _cliPropTypeOpts = (v='') => [['','—'],['APARTMENT','ბინა'],['HOUSE','სახლი'],['COMMERCIAL','კომერციული'],['LAND','მიწა'],['COTTAGE','აგარაკი'],['HOTEL','სასტუმრო']].map(([k,l])=>`<option value="${k}" ${k===v?'selected':''}>${l}</option>`).join('');
const _cliFinanceOpts = (v='') => [['','—'],['CASH','ქეში'],['MORTGAGE','იპოთეკა'],['INSTALLMENT','განვადება'],['MIXED','შერეული']].map(([k,l])=>`<option value="${k}" ${k===v?'selected':''}>${l}</option>`).join('');
const _cliTypeOpts = (v='') => [['','—'],['BUYER','მყიდველი'],['SELLER','გამყიდველი'],['TENANT','დამქირავებელი'],['LANDLORD','მეპატრონე'],['INVESTOR','ინვესტორი']].map(([k,l])=>`<option value="${k}" ${k===v?'selected':''}>${l}</option>`).join('');
const _cliStatusOpts = (v='ACTIVE') => [['ACTIVE','აქტიური'],['INACTIVE','არააქტიური'],['LEAD','ლიდი'],['CLOSED','დახურული']].map(([k,l])=>`<option value="${k}" ${k===v?'selected':''}>${l}</option>`).join('');
const _cliPriorityOpts = (v='') => [['','—'],['LOW','დაბალი'],['MEDIUM','საშუალო'],['HIGH','მაღალი'],['URGENT','გადაუდებელი']].map(([k,l])=>`<option value="${k}" ${k===v?'selected':''}>${l}</option>`).join('');
const _cliSourceOpts = (v='') => [['','—'],['WEBSITE','ვებსაიტი'],['REFERRAL','რეკომენდაცია'],['SOCIAL','სოც. ქსელი'],['PORTAL','პორტალი'],['WALK_IN','ვიზიტი'],['CALL','ზარი'],['OTHER','სხვა']].map(([k,l])=>`<option value="${k}" ${k===v?'selected':''}>${l}</option>`).join('');

function _clientFormBody(c = {}) {
  // Escapes once, fully. It used to escape only quotes, so `<` and `&` went
  // through raw; wrapping the call site instead would double-escape and show
  // a literal &quot; in the field.
  const v = (k) => c[k] != null ? escHtml(c[k]) : '';
  return `
    ${_CLI_SEC(t('sec_basic_info','ძირითადი ინფორმაცია'))}
    <div class="form-row">
      <div class="form-group"><label class="form-label">სახელი <span style="color:#EF4444">*</span></label><input class="form-input" id="cli-fname" value="${v('first_name')}"></div>
      <div class="form-group"><label class="form-label">${t('f_lastname','გვარი')}</label><input class="form-input" id="cli-lname" value="${v('last_name')}"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">${t('f_nationality','მოქალაქეობა')}</label><input class="form-input" id="cli-nationality" value="${v('nationality')}"></div>
      <div class="form-group"><label class="form-label">${t('cf_personal_id_full','პირადი ნომერი / პასპორტი')}</label><input class="form-input" id="cli-pid" value="${v('personal_id')}"></div>
    </div>

    ${_CLI_SEC(t('sec_contact','კონტაქტი'))}
    <div class="form-row">
      <div class="form-group"><label class="form-label">ტელეფონი <span style="color:#EF4444">*</span></label><input class="form-input" id="cli-phone" value="${v('phone')}"></div>
      <div class="form-group"><label class="form-label">${t('cf_phone2_label','დამატებითი ტელეფონი')}</label><input class="form-input" id="cli-phone2" value="${v('phone2')}"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">${t('f_email','ელფოსტა')}</label><input class="form-input" id="cli-email" type="email" value="${v('email')}"></div>
      <div class="form-group"><label class="form-label">${t('f_pref_contact','სასურველი კონტაქტი')}</label><select class="form-select" id="cli-pref-contact">${_cliContactOpts(c.preferred_contact)}</select></div>
    </div>

    ${_CLI_SEC(t('sec_looking_for','რას ეძებს კლიენტი'))}
    <div class="form-group"><label class="form-label">${t('cf_looking_for_full','მოთხოვნა / რას ეძებს')}</label><textarea class="form-input" id="cli-looking" rows="2" placeholder="მაგ: 2-3 ოთახიანი ბინა ვაკეში, აივნით, 120კ-მდე">${c.looking_for ? String(c.looking_for).replace(/</g,'&lt;') : ''}</textarea></div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">${t('f_pref_type','სასურველი ტიპი')}</label><select class="form-select" id="cli-pref-type">${_cliPropTypeOpts(c.preferred_property_type)}</select></div>
      <div class="form-group"><label class="form-label">${t('f_pref_location','სასურველი ლოკაცია')}</label><input class="form-input" id="cli-pref-loc" value="${v('preferred_location')}"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">${t('cf_budget_min','ბიუჯეტი min ($)')}</label><input class="form-input" id="cli-bmin" type="number" value="${v('budget_min')}"></div>
      <div class="form-group"><label class="form-label">${t('cf_budget_max','ბიუჯეტი max ($)')}</label><input class="form-input" id="cli-bmax" type="number" value="${v('budget_max')}"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">${t('f_financing','დაფინანსება')}</label><select class="form-select" id="cli-finance">${_cliFinanceOpts(c.financing_method)}</select></div>
      <div class="form-group"><label class="form-label">${t('cf_mortgage_status','იპოთეკის სტატუსი')}</label><input class="form-input" id="cli-mortgage" value="${v('mortgage_status')}" placeholder="მაგ: წინასწარ დამტკიცებული"></div>
    </div>

    ${_CLI_SEC(t('sec_address','მისამართი'))}
    <div class="form-row">
      <div class="form-group"><label class="form-label">${t('f_country','ქვეყანა')}</label><input class="form-input" id="cli-country" value="${v('country')}"></div>
      <div class="form-group"><label class="form-label">${t('f_city','ქალაქი')}</label><input class="form-input" id="cli-city" value="${v('city')}"></div>
    </div>
    <div class="form-group"><label class="form-label">${t('f_street','ქუჩა')}</label><input class="form-input" id="cli-street" value="${v('street')}"></div>

    ${_CLI_SEC('CRM')}
    <div class="form-row">
      <div class="form-group"><label class="form-label">${t('f_type','ტიპი')}</label><select class="form-select" id="cli-type">${_cliTypeOpts(c.client_type)}</select></div>
      <div class="form-group"><label class="form-label">${t('f_status','სტატუსი')}</label><select class="form-select" id="cli-status">${_cliStatusOpts(c.status || 'ACTIVE')}</select></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">${t('th_source','წყარო')}</label><select class="form-select" id="cli-source">${_cliSourceOpts(c.lead_source)}</select></div>
      <div class="form-group"><label class="form-label">${t('f_priority','პრიორიტეტი')}</label><select class="form-select" id="cli-priority">${_cliPriorityOpts(c.priority)}</select></div>
    </div>
    <div class="form-group"><label class="form-label">${t('cf_tags_hint','ტეგები (მძიმით)')}</label><input class="form-input" id="cli-tags" value="${v('tags')}" placeholder="VIP, ვაკე, სასწრაფო"></div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">${t('f_last_contact','ბოლო კონტაქტი')}</label><input class="form-input" id="cli-lastcontact" type="date" value="${v('last_contact_date')?String(c.last_contact_date).slice(0,10):''}"></div>
      <div class="form-group"><label class="form-label">${t('th_followup','შემდეგი კონტაქტი')}</label><input class="form-input" id="cli-followup" type="date" value="${v('follow_up_date')?String(c.follow_up_date).slice(0,10):''}"></div>
    </div>
    <div class="form-group"><label class="form-label">${t('fu_note','Follow-up შენიშვნა')}</label><input class="form-input" id="cli-followup-note" value="${v('follow_up_note')}"></div>
    <div class="form-group"><label class="form-label">${t('f_notes','შენიშვნები')}</label><textarea class="form-input" id="cli-notes" rows="2">${c.notes ? String(c.notes).replace(/</g,'&lt;') : ''}</textarea></div>
    <div class="form-group"><label class="form-label">${t('cf_internal_comment','შიდა კომენტარი (მხოლოდ გუნდისთვის)')}</label><textarea class="form-input" id="cli-internal" rows="2">${c.internal_comments ? String(c.internal_comments).replace(/</g,'&lt;') : ''}</textarea></div>
  `;
}

function _readClientForm() {
  const g = (id) => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };
  const n = (id) => { const x = g(id); return x ? Number(x) : null; };
  return {
    first_name: g('cli-fname'), last_name: g('cli-lname') || null,
    nationality: g('cli-nationality') || null,
    personal_id: g('cli-pid') || null, phone: g('cli-phone'), phone2: g('cli-phone2') || null,
    email: g('cli-email') || null, preferred_contact: g('cli-pref-contact') || null,
    looking_for: g('cli-looking') || null, preferred_property_type: g('cli-pref-type') || null,
    preferred_location: g('cli-pref-loc') || null, budget_min: n('cli-bmin'), budget_max: n('cli-bmax'),
    financing_method: g('cli-finance') || null, mortgage_status: g('cli-mortgage') || null,
    country: g('cli-country') || null, city: g('cli-city') || null,
    street: g('cli-street') || null,
    client_type: g('cli-type') || null, status: g('cli-status') || 'ACTIVE',
    lead_source: g('cli-source') || null, priority: g('cli-priority') || null, tags: g('cli-tags') || null,
    last_contact_date: g('cli-lastcontact') || null, follow_up_date: g('cli-followup') || null,
    follow_up_note: g('cli-followup-note') || null, notes: g('cli-notes') || null,
    internal_comments: g('cli-internal') || null,
  };
}

function openClientModal() {
    openModal(t("mt_new_client"), `
      <div style="max-height:65vh;overflow-y:auto;padding-right:6px">${_clientFormBody({})}</div>
      <button class="btn btn-primary" onclick="saveClient()" style="width:100%;margin-top:14px"><i data-lucide="save" class="lucide-i"></i> ${t("btn_save")}</button>
    `);
    if (window.lucide) try { window.lucide.createIcons(); } catch(e) {}
}

async function saveClient() {
    const data = _readClientForm();
    if (!data.first_name || !data.phone) {
        showToast('სახელი და ტელეფონი აუცილებელია', 'error');
        return;
    }
    try {
        const { error } = await client.from('clients').insert({
            company_id: currentUser.company_id,
            primary_agent_id: currentUser.id,
            ...data
        });
        
        if (error) throw error;
        showToast('<i data-lucide="check-circle-2" class="lucide-i"></i> კლიენტი დაემატა!');
        closeModal();
        if (currentPage === 'clients') loadClients();
    } catch (e) {
        showToast('შეცდომა: ' + e.message, 'error');
    }
}

async function openDealModal() {
    const isManager = ['FOUNDER', 'MANAGER'].includes(currentUser.role);
    const [listingsRes, clientsRes, usersRes, leadsRes] = await Promise.all([
        client.from('listings').select('id, title, list_price, currency').eq('company_id', currentUser.company_id),
        client.from('clients').select('id, first_name, last_name, client_type').eq('company_id', currentUser.company_id),
        client.from('users').select('id, first_name, last_name, role').eq('company_id', currentUser.company_id),
        client.from('leads').select('id, full_name, phone').order('created_at', { ascending: false }).limit(1000)
    ]);
    const listings = listingsRes.data || [];
    const clients = clientsRes.data || [];
    const users = usersRes.data || [];
    const leads = leadsRes.data || [];

    const listingOpts = '<option value="">— აირჩიე ობიექტი —</option>' + listings.map(l => `<option value="${l.id}">${escHtml(l.title || 'ობიექტი')}</option>`).join('');
    const clientOpts = '<option value="">— აირჩიე —</option>' + clients.map(c => `<option value="${c.id}">${escHtml(c.first_name)} ${escHtml(c.last_name || '')}</option>`).join('');
    // Property owner = a lead/owner (NOT a client). This was the Deals bug.
    const ownerOpts = '<option value="">— აირჩიე მესაკუთრე —</option>' + leads.map(l => `<option value="${l.id}">${escHtml((l.full_name || 'მფლობელი'))}${l.phone ? ' — ' + l.phone : ''}</option>`).join('');
    const agentOpts = users.map(u => `<option value="${u.id}" ${u.id === currentUser.id ? 'selected' : ''}>${escHtml(u.first_name)} ${escHtml(u.last_name || '')} (${roleNames[u.role] || u.role})</option>`).join('');

    openModal(t("mt_new_deal"), `
        <div class="form-group">
            <label class="form-label">${t("f_title")}</label>
            <input class="form-input" id="d-title" placeholder="ავტომატური თუ ცარიელია">
        </div>
        <div class="form-row">
            <div class="form-group">
                <label class="form-label">${t("f_type")}</label>
                <select class="form-select" id="d-type">
                    <option value="SALE">გაყიდვა</option>
                    <option value="RENT">ქირა</option>
                </select>
            </div>
            <div class="form-group">
                <label class="form-label">${t("f_stage")}</label>
                <select class="form-select" id="d-stage">
                    <option value="LEAD">ლიდი</option>
                    <option value="NEGOTIATION">მოლაპარაკება</option>
                    <option value="CONTRACT">ხელშეკრულება</option>
                    <option value="CLOSED">დახურული</option>
                </select>
            </div>
        </div>
        <div class="form-group">
            <label class="form-label"><i data-lucide="home" class="lucide-i"></i> რომელი ობიექტი</label>
            <select class="form-select" id="d-listing">${listingOpts}</select>
        </div>
        <div class="form-row">
            <div class="form-group">
                <label class="form-label"><i data-lucide="user" class="lucide-i"></i> კლიენტი (მყიდველი)</label>
                <select class="form-select" id="d-client">${clientOpts}</select>
            </div>
            <div class="form-group">
                <label class="form-label"><i data-lucide="key" class="lucide-i"></i> მესაკუთრე (გამყიდველი)</label>
                <select class="form-select" id="d-owner">${ownerOpts}</select>
            </div>
        </div>
        <div class="form-row">
            <div class="form-group">
                <label class="form-label">${t("f_price")}</label>
                <input class="form-input" id="d-price" type="number">
            </div>
            <div class="form-group">
                <label class="form-label">${t("f_currency")}</label>
                <select class="form-select" id="d-currency">
                    <option value="USD">USD ($)</option>
                    <option value="GEL">GEL (₾)</option>
                </select>
            </div>
        </div>
        <div class="form-group">
            <label class="form-label"><i data-lucide="user-check" class="lucide-i"></i> პასუხისმგებელი აგენტი</label>
            <select class="form-select" id="d-agent" ${isManager ? '' : 'disabled'}>${agentOpts}</select>
            ${isManager ? '' : '<div style="font-size:11px;color:var(--text-muted);margin-top:4px">მხოლოდ მენეჯერს შეუძლია სხვა აგენტზე მინიჭება</div>'}
        </div>
        <div class="form-group">
            <label class="form-label"><i data-lucide="megaphone" class="lucide-i"></i> კამპანია (შემოსავლის ატრიბუცია)</label>
            <select class="form-select" id="d-campaign"><option value="">— იტვირთება… —</option></select>
        </div>
        <div class="form-group">
            <label class="form-label">${t('lf_note_singular','შენიშვნა')}</label>
            <textarea class="form-textarea" id="d-notes" rows="2"></textarea>
        </div>
        <button class="btn btn-primary" onclick="saveDeal()" style="width:100%"><i data-lucide="save" class="lucide-i"></i> ${t("btn_save")}</button>
    `);
    populateCampaignSelect('d-campaign');
}

async function saveDeal() {
    const title = document.getElementById('d-title').value.trim();
    const type = document.getElementById('d-type').value;
    const stage = document.getElementById('d-stage').value;
    const listingId = document.getElementById('d-listing').value;
    const clientId = document.getElementById('d-client').value;
    const ownerId = document.getElementById('d-owner').value;
    const price = document.getElementById('d-price').value;
    const currency = document.getElementById('d-currency').value;
    const notes = document.getElementById('d-notes').value.trim();
    const agentId = document.getElementById('d-agent').value || currentUser.id;
    
    const priceUSD = price ? (currency === 'GEL' ? Number(price) / GEL_PER_USD : Number(price)) : null;
    const autoTitle = title || 'გარიგება ' + new Date().toLocaleDateString();
    
    try {
        const { error } = await client.from('deals').insert({
            company_id: currentUser.company_id,
            buyer_agent_id: agentId,
            seller_agent_id: agentId,
            client_id: clientId || null,
            owner_id: ownerId || null,
            listing_id: listingId || null,
            title: autoTitle,
            deal_type: type,
            current_stage: stage,
            asking_price: priceUSD ? Math.round(priceUSD) : null,
            currency: currency,
            campaign_id: (document.getElementById('d-campaign') || {}).value || null,
            notes: notes || null
        });
        
        if (error) throw error;
        showToast('<i data-lucide="check-circle-2" class="lucide-i"></i> გარიგება დაემატა!');
        closeModal();
        if (currentPage === 'deals') loadDeals();
    } catch (e) {
        showToast('შეცდომა: ' + e.message, 'error');
    }
}

function openAgentModal() {
    openModal(t("mt_new_agent"), `
        <div style="background:var(--warning-soft);color:#a06800;padding:12px;border-radius:8px;margin-bottom:16px;font-size:13px">
            ℹ️ შენ შექმნი დროებით პაროლს და გადასცემ აგენტს. ის შემდეგ შემოვა სისტემაში.
        </div>
        <div class="form-row">
            <div class="form-group">
                <label class="form-label">სახელი <span class="req" style="color:#EF4444;font-weight:700">*</span></label>
                <input class="form-input" id="a-fname" placeholder="სახელი">
            </div>
            <div class="form-group">
                <label class="form-label">${t("f_lastname")}</label>
                <input class="form-input" id="a-lname" placeholder="გვარი">
            </div>
        </div>
        <div class="form-group">
            <label class="form-label">ემეილი <span class="req" style="color:#EF4444;font-weight:700">*</span></label>
            <input class="form-input" id="a-email" type="email" placeholder="email@example.com">
        </div>
        <div class="form-group">
            <label class="form-label">${t("f_phone")}</label>
            <input class="form-input" id="a-phone" placeholder="+995 5XX XXX XXX">
        </div>
        <div class="form-row">
            <div class="form-group">
                <label class="form-label">როლი <span class="req" style="color:#EF4444;font-weight:700">*</span></label>
                <select class="form-select" id="a-role">
                    <option value="AGENT"><i data-lucide="home" class="lucide-i"></i> აგენტი</option>
                    <option value="MANAGER"><i data-lucide="bar-chart-3" class="lucide-i"></i> მენეჯერი</option>
                    <option value="MARKETING"><i data-lucide="megaphone" class="lucide-i"></i> მარკეტინგი</option>
                    <option value="LAWYER"><i data-lucide="scale" class="lucide-i"></i> იურისტი</option>
                    <option value="ACCOUNTANT"><i data-lucide="dollar-sign" class="lucide-i"></i> ბუღალტერი</option>
                </select>
            </div>
            <div class="form-group">
                <label class="form-label">დროებითი პაროლი <span class="req" style="color:#EF4444;font-weight:700">*</span></label>
                <input class="form-input" id="a-password" type="text" value="warm2026" placeholder="მინ. 6 სიმბოლო">
            </div>
        </div>
        <div style="background:var(--info-soft);color:#1a6dc4;padding:10px;border-radius:8px;margin-bottom:16px;font-size:13px">
            <i data-lucide="lightbulb" class="lucide-i"></i> შემდეგი: გადასცემე აგენტს ემეილი + პაროლი → ის შემოვა AtlasCRM-ზე
        </div>
        <button class="btn btn-primary" onclick="saveAgent()" style="width:100%"><i data-lucide="save" class="lucide-i"></i> აგენტის შექმნა</button>
    `);
}

async function saveAgent() {
    const fname = document.getElementById('a-fname').value.trim();
    const lname = document.getElementById('a-lname').value.trim();
    const email = document.getElementById('a-email').value.trim();
    const phone = document.getElementById('a-phone').value.trim();
    const role = document.getElementById('a-role').value;
    const password = document.getElementById('a-password').value;
    
    if (!fname || !email || !password) {
        showToast('შეავსე სავალდებულო ველები', 'error');
        return;
    }
    
    if (password.length < 6) {
        showToast('პაროლი მინ. 6 სიმბოლო', 'error');
        return;
    }
    
    try {
        const r = await fetch('/api/auth/create-agent', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
                email, password, first_name: fname, last_name: lname || null,
                phone: phone || null, role
            })
        });
        const j = await r.json();
        if (!r.ok) {
            let msg = j.error || 'შეცდომა';
            if (msg.includes('already exists')) msg = 'ეს ემეილი უკვე გამოყენებულია';
            throw new Error(msg);
        }

        showToast('<i data-lucide="check-circle-2" class="lucide-i"></i> აგენტი დაემატა!', 'success');
        closeModal();
        if (typeof loadAgents === 'function') loadAgents();

    } catch (e) {
        showToast('შეცდომა: ' + e.message, 'error');
    }
}

