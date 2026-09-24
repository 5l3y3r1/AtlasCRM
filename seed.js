'use strict';
/**
 * seed.js — Demo data for AtlasCRM.
 * Schema-aligned: uses bedrooms_total / living_area / current_stage /
 * primary_agent_id / buyer_agent_id / due_at / scheduled_at etc.
 */
const { nanoid } = require('nanoid');
const { db, genExtensionKey } = require('./db');
const { hashPassword } = require('./auth');

function id() { return nanoid(); }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function num(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function daysAgo(d) { const dt = new Date(); dt.setDate(dt.getDate()-d); return dt.toISOString(); }
function daysFromNow(d){ const dt = new Date(); dt.setDate(dt.getDate()+d); return dt.toISOString(); }

const existing = db.prepare("SELECT id FROM companies WHERE name = 'Prime Realty'").get();
if (existing) {
  console.log('Seed: Prime Realty already exists, skipping.');
  console.log('       To re-seed, run:  npm run reset');
  process.exit(0);
}

console.log('Seeding demo data...');

// ── Company ───────────────────────────────────────────────────────────
const companyId = id();
db.prepare(`INSERT INTO companies (id, name, email, phone, address)
            VALUES (?, ?, ?, ?, ?)`).run(
  companyId, 'Prime Realty', 'hello@prime.ge', '+995 32 200 1000',
  'რუსთაველის გამზ. 12, თბილისი'
);

// ── Founder + 3 agents ────────────────────────────────────────────────
const founder = id();
const ag1 = id(), ag2 = id(), ag3 = id();
const insertUser = db.prepare(`INSERT INTO users
  (id, auth_user_id, company_id, first_name, last_name, email, password_hash, phone, role, bio, extension_key)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
const pwd = hashPassword('warm123');
insertUser.run(founder, founder, companyId, 'ბესიკ', 'კავთარაძე',  'beso@prime.ge',   pwd, '+995 555 111 222', 'FOUNDER', 'სააგენტოს დამფუძნებელი, 15 წლის გამოცდილება ბაზარზე', genExtensionKey());
insertUser.run(ag1,     ag1,     companyId, 'ნინო',   'კვარაცხელია','nino@prime.ge',  pwd, '+995 555 333 444', 'AGENT',   'ვაკე-საბურთალოს რეგიონის ექსპერტი', genExtensionKey());
insertUser.run(ag2,     ag2,     companyId, 'გიორგი', 'მელაძე',    'giorgi@prime.ge', pwd, '+995 555 555 666', 'AGENT',   'ლუქს უძრავი ქონების სპეციალისტი', genExtensionKey());
insertUser.run(ag3,     ag3,     companyId, 'თამარ',  'ბერიძე',    'tamar@prime.ge',  pwd, '+995 555 777 888', 'MANAGER', 'სამხრეთ თბილისის მენეჯერი', genExtensionKey());

// ── Listings (12) ─────────────────────────────────────────────────────
const districts = ['ვაკე','საბურთალო','ვერა','ისანი','ნაძალადევი','მთაწმინდა','დიდუბე','სამგორი'];
const propTypes = ['APARTMENT','APARTMENT','APARTMENT','HOUSE','APARTMENT','COMMERCIAL','APARTMENT','APARTMENT','HOUSE','APARTMENT','APARTMENT','LAND'];
const titles = [
  'მზიანი 3-ოთახიანი ბინა ვაკეში','ლუქს პენტჰაუსი საბურთალოში',
  'ახლადგარემონტებული სტუდიო ვერაში','საოჯახო სახლი ბაღით ისანში',
  '2-ოთახიანი ბინა ნაძალადევში','სავაჭრო ფართი მთაწმინდაზე',
  'ფართო ბინა საბურთალოს გულში','ცენტრალური მდებარეობა — დიდუბე',
  'პრემიუმ კოტეჯი სამგორში','ვაკის პრესტიჟული მისამართი',
  'ეკონომიური ბინა ისანში','ვაკის სალაროს ბაღი',
];
const baseLat = 41.7151, baseLng = 44.7764;
const listings = [];
const listingCols = db.prepare(`PRAGMA table_info(listings)`).all().map(c => c.name);

for (let i = 0; i < 12; i++) {
  const lid = id();
  const district = districts[i % districts.length];
  const ptype    = propTypes[i];
  const ltype    = i % 5 === 0 ? 'RENT' : 'SALE';
  const price    = ltype === 'RENT'
    ? num(600, 3500)
    : ptype === 'COMMERCIAL' ? num(120000, 800000)
    : ptype === 'HOUSE'      ? num(180000, 750000)
    : ptype === 'LAND'       ? num(40000, 200000)
    : num(60000, 350000);
  const area = ptype === 'LAND' ? num(400, 2000)
             : ptype === 'HOUSE' ? num(120, 350)
             : num(35, 180);
  const beds = ptype === 'LAND' || ptype === 'COMMERCIAL' ? null : num(1, 5);
  const agent = pick([ag1, ag2, ag3]);

  const row = {
    id: lid,
    listing_key: `GEO-2026-${String(i+1).padStart(5,'0')}`,
    company_id: companyId, agent_id: agent,
    title: titles[i],
    description: `${titles[i]}. დეტალური აღწერა — დიდი ფანჯრები, ნათელი ოთახები, ხარისხიანი მოპირკეთება. ${district}-ის სასურველი მისამართი.`,
    listing_type: ltype, property_type: ptype, status: 'ACTIVE',
    list_price: price, price_per_sqm: area ? Math.round(price / area) : null,
    commission_pct: 3.0,
    bedrooms_total: beds, bathrooms: beds ? Math.max(1, beds - 1) : null,
    living_area: area, total_area: area,
    floor: num(1, 12), total_floors: num(5, 16), year_built: num(1990, 2024),
    region: 'თბილისი', city: 'თბილისი', district,
    address: `${district === 'ვაკე' ? 'ჭავჭავაძის გამზ' : 'რუსთაველის'}. ${num(1,200)}`,
    cadastral_code: `01.${num(10,25)}.${num(1,30)}.${num(100,999)}`,
    latitude:  baseLat + (Math.random() - 0.5) * 0.06,
    longitude: baseLng + (Math.random() - 0.5) * 0.08,
    amenities: JSON.stringify(pick([['balcony','elevator'],['parking','elevator'],['parking','garden'],['balcony','storage','elevator']])),
    created_at: daysAgo(num(1, 120)),
  };
  // Filter to columns that actually exist
  const keys = Object.keys(row).filter(k => listingCols.includes(k));
  const placeholders = keys.map(()=>'?').join(',');
  db.prepare(`INSERT INTO listings (${keys.join(',')}) VALUES (${placeholders})`).run(...keys.map(k => row[k]));
  listings.push(lid);
}

// ── Property images ────────────────────────────────────────────────────
const photo = (sig) => `https://images.unsplash.com/photo-${sig}?w=900&q=80&auto=format`;
const photos = [
  '1560448204-e02f11c3d0e2','1502672023488-70e25813eb80','1494526585095-c41746248156',
  '1605114558624-44d20fefe6e0','1583847268964-b28dc8f51f92','1567496898669-ee935f5f647a',
];
for (const lid of listings) {
  for (let k = 0; k < 3; k++) {
    db.prepare(`INSERT INTO property_images (id, listing_id, image_url, is_primary, sort_order)
                VALUES (?, ?, ?, ?, ?)`).run(id(), lid, photo(pick(photos)), k === 0 ? 1 : 0, k);
  }
}

// ── Helper: insert row honoring only existing columns ─────────────────
function insertRow(table, row) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
  const keys = Object.keys(row).filter(k => cols.includes(k));
  const placeholders = keys.map(()=>'?').join(',');
  db.prepare(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${placeholders})`).run(...keys.map(k => row[k]));
}

// ── Clients (5) ───────────────────────────────────────────────────────
const clients = [];
const clientNames = [
  ['ლევან','ჯაფარიძე','BUYER'],['ანა','გელაშვილი','SELLER'],
  ['დათო','ხურციძე','BUYER'],['ნუცა','ლომიძე','TENANT'],
  ['ვახტანგ','ჩხეიძე','LANDLORD']
];
clientNames.forEach((cn, i) => {
  const cid = id(); clients.push(cid);
  insertRow('clients', {
    id: cid,
    client_number: `CLI-2026-${String(i+1).padStart(5,'0')}`,
    company_id: companyId,
    primary_agent_id: pick([ag1, ag2, ag3]),
    agent_id: pick([ag1, ag2, ag3]),
    first_name: cn[0], last_name: cn[1],
    phone: `+995 555 ${num(100,999)} ${num(100,999)}`,
    email: `${cn[0].toLowerCase()}@gmail.com`,
    client_type: cn[2], status: 'ACTIVE',
    budget_min: num(40,80) * 1000, budget_max: num(120,300) * 1000,
    notes: `კლიენტი ეძებს ${pick(['ცენტრალურ','ცენტრთან ახლოს','შემოგარენში'])} მდებარეობას`,
    is_active: 1,
    created_at: daysAgo(num(5, 90)),
  });
});

// ── Leads (8) ─────────────────────────────────────────────────────────
const sources = ['FACEBOOK','INSTAGRAM','TIKTOK','MYHOME','SSGE','REFERRAL','WEBSITE','COLD_CALL'];
const temps = ['HOT','WARM','COLD'];
const statuses = ['NEW','CONTACTED','QUALIFIED','CONVERTED','LOST'];
const leadNames = [
  ['მაია','კიკალია'],['ბექა','კობახიძე'],['ლუკა','შარაბიძე'],
  ['სოფო','ცინცაძე'],['გიორგი','ცერცვაძე'],['ნათია','კოპალიანი'],
  ['ანდრო','დათუნაშვილი'],['ლანა','ჭელიძე'],
];
leadNames.forEach((ln, i) => {
  const status = i < 2 ? 'NEW' : statuses[i % statuses.length];
  insertRow('leads', {
    id: id(),
    lead_number: `LEAD-2026-${String(i+1).padStart(5,'0')}`,
    company_id: companyId,
    agent_id: status === 'NEW' ? null : pick([ag1, ag2, ag3]),
    source: sources[i % sources.length],
    full_name: `${ln[0]} ${ln[1]}`,
    phone: `+995 555 ${num(100,999)} ${num(100,999)}`,
    email: `${ln[0].toLowerCase()}@gmail.com`,
    inquiry: pick([
      'ვეძებ 2-ოთახიან ბინას ვაკეში 100,000$-მდე',
      'მაინტერესებს გასაქირავებელი ბინა საბურთალოზე',
      'ვყიდი ჩემს ბინას ისანში, რჩევა მჭირდება',
      'სავაჭრო ფართის ძიება ცენტრში',
      'ლუქს ბინა მთაწმინდაზე — გადახდისუნარიანი',
    ]),
    temperature: temps[i % 3], status,
    contacted_at: status === 'NEW' ? null : daysAgo(num(1, 30)),
    created_at: daysAgo(num(1, 14)),
  });
});

// ── Deals (6) ─────────────────────────────────────────────────────────
const stages = ['QUALIFICATION','SHOWING','NEGOTIATION','DEPOSIT','CLOSED_WON','CLOSED_LOST'];
for (let i = 0; i < 6; i++) {
  const stage = stages[i];
  const askingPrice = num(80000, 280000);
  const finalPrice  = stage === 'CLOSED_WON' ? Math.round(askingPrice * (0.92 + Math.random()*0.08)) : null;
  const value = finalPrice || askingPrice;
  const agent = pick([ag1, ag2, ag3]);
  insertRow('deals', {
    id: id(),
    deal_number: `DEAL-2026-${String(i+1).padStart(5,'0')}`,
    company_id: companyId,
    agent_id: agent, buyer_agent_id: agent, seller_agent_id: pick([ag1,ag2,ag3]),
    client_id: pick(clients), listing_id: pick(listings),
    title: `გარიგება #${i+1} — ${pick(districts)}`,
    deal_type: 'SALE',
    current_stage: stage, stage,
    asking_price: askingPrice, final_price: finalPrice, value,
    commission_amount: Math.round(value * 0.03), commission_percent: 3.0,
    deposit_amount: (stage === 'DEPOSIT' || stage === 'CLOSED_WON') ? Math.round(value * 0.1) : null,
    expected_close_date: daysFromNow(num(7, 60)),
    closed_at: (stage === 'CLOSED_WON' || stage === 'CLOSED_LOST') ? daysAgo(num(1, 30)) : null,
    created_at: daysAgo(num(5, 60)),
  });
}

// ── Commission records ────────────────────────────────────────────────
db.prepare("SELECT id, asking_price, final_price, buyer_agent_id AS agent_id FROM deals WHERE current_stage = 'CLOSED_WON'")
  .all().forEach(d => {
    const amt = Math.round((d.final_price || d.asking_price) * 0.03);
    insertRow('commission_records', {
      id: id(), company_id: companyId, deal_id: d.id,
      user_id: d.agent_id, agent_id: d.agent_id,
      current_stage: 'CLOSED_WON',
      amount: amt, percent: 3.0, role: 'LISTING_AGENT',
      payment_status: 'PAID', status: 'PAID', is_paid: 1,
      paid_at: daysAgo(num(1, 20)),
    });
  });

// ── Financial transactions ───────────────────────────────────────────
db.prepare("SELECT id, asking_price, final_price, buyer_agent_id AS agent_id FROM deals WHERE current_stage IN ('CLOSED_WON','DEPOSIT')")
  .all().forEach((d, i) => {
    insertRow('financial_transactions', {
      id: id(), transaction_number: `TXN-2026-${String(i+1).padStart(5,'0')}`,
      company_id: companyId, agent_id: d.agent_id, deal_id: d.id,
      transaction_type: 'COMMISSION', type: 'COMMISSION', direction: 'IN',
      amount: Math.round((d.final_price || d.asking_price) * 0.03), currency: 'USD',
      description: 'საკომისიო შესრულებული გარიგებიდან',
      status: 'COMPLETED',
    });
  });

// ── Tasks (8) ─────────────────────────────────────────────────────────
const taskTitles = [
  'დაუკავშირდი მაია კიკალიას — ცხელი ლიდი',
  'მოამზადე ხელშეკრულება ლევანის გარიგებისთვის',
  'დააფიქსირე ჩვენება ვაკის ბინაზე',
  'გაგზავნე ფასების ანალიზი კლიენტისთვის',
  'შეასწორე ფოტოები ლისტინგზე #5',
  'მოამზადე საკომისიოს გადარიცხვა',
  'ცხელი ლიდი — დარეკე დღესვე',
  'ნახე ახალი მესაკუთრის განცხადებები',
];
const priorities = ['URGENT','HIGH','MEDIUM','MEDIUM','LOW','HIGH','URGENT','MEDIUM'];
taskTitles.forEach((tt, i) => {
  insertRow('tasks', {
    id: id(), company_id: companyId,
    created_by: founder, agent_id: founder,
    assigned_to: pick([ag1, ag2, ag3, founder]),
    task_type: pick(['CALL','MEETING','EMAIL','PAPERWORK','SHOWING','OTHER']),
    title: tt,
    description: 'დეტალური აღწერა შესასრულებელი ამოცანის შესახებ',
    due_at: daysFromNow(num(0, 14)),
    due_date: daysFromNow(num(0, 14)),
    priority: priorities[i],
    status: i < 3 ? 'PENDING' : (i < 6 ? 'IN_PROGRESS' : 'COMPLETED'),
    created_at: daysAgo(num(1, 10)),
  });
});

// ── Showings (5) ──────────────────────────────────────────────────────
for (let i = 0; i < 5; i++) {
  const when = i < 2 ? daysFromNow(num(1, 10)) : daysAgo(num(1, 14));
  insertRow('showings', {
    id: id(), company_id: companyId,
    listing_id: pick(listings), agent_id: pick([ag1,ag2,ag3]),
    client_id: pick(clients),
    scheduled_at: when, showing_date: when,
    duration_minutes: 60,
    agent_notes: pick([
      'კლიენტმა ბინა მოიწონა, აპირებს დაბრუნებას',
      'ეჭვი ფასზე, შემოგვთავაზა შემცირება',
      'ბინა მისცეს დადებითი შეფასება',
      'სხვა ლოკაცია სურს, გადავიდა სხვა ბინაზე',
      'მზადაა გარიგებაზე',
    ]),
    notes: 'showing notes',
    status: i < 2 ? 'SCHEDULED' : 'COMPLETED',
    rating: i >= 2 ? num(3, 5) : null,
    interest_level: i >= 2 ? pick(['HIGH','MEDIUM','LOW']) : null,
    created_at: daysAgo(num(1, 20)),
  });
}

// ── Marketing campaigns (4) ───────────────────────────────────────────
const campaigns = [
  ['ვაკის ბინების კამპანია — ზაფხული 2026', 'FACEBOOK', 1500, 1180, 'ACTIVE',  47, 12.5],
  ['Instagram Reels — ლუქს ბინები',         'INSTAGRAM',2200, 2200, 'ENDED',   89, 18.2],
  ['TikTok ცოცხალი ჩვენებები',             'TIKTOK',   800,  340, 'ACTIVE',  31, 9.7],
  ['Google Ads — საბურთალო',              'GOOGLE_ADS',3200,1900, 'ACTIVE', 124, 22.0],
];
campaigns.forEach((c, i) => {
  insertRow('marketing_campaigns', {
    id: id(), company_id: companyId,
    agent_id: founder, created_by: founder,
    name: c[0], campaign_type: 'LEAD_GEN', platform: c[1], channel: c[1],
    budget_amount: c[2], budget: c[2], spent: c[3],
    status: c[4],
    start_date: daysAgo(num(20, 90)),
    end_date: c[4] === 'ENDED' ? daysAgo(num(1, 15)) : daysFromNow(num(10, 60)),
    leads_generated: c[5], conversion_rate: c[6],
    roi: 1.0 + Math.random() * 2,
    currency: 'USD',
    created_at: daysAgo(num(30, 100)),
  });
});

// ── Contract templates (3) ────────────────────────────────────────────
const tpl1 = id(), tpl2 = id(), tpl3 = id();
[
  [tpl1, 'სტანდარტული გასაყიდი ხელშეკრულება', 'SALE',
   'ხელშეკრულება ნომერი {NUMBER}\nთარიღი: {DATE}\nმყიდველი: {CLIENT}\nფასი: {PRICE}\n\nმუხლი 1. გარიგების საგანი...'],
  [tpl2, 'საიჯარო ხელშეკრულება', 'RENT',
   'საიჯარო ხელშეკრულება {NUMBER}\nმეიჯარე: {LANDLORD}\nმოიჯარე: {CLIENT}\nთვიური ქირა: {RENT}\nმუხლი 1...'],
  [tpl3, 'ექსკლუზიური წარმომადგენლობა', 'EXCLUSIVITY',
   'ექსკლუზიური წარმომადგენლობის ხელშეკრულება {NUMBER}\n\nსააგენტო: Prime Realty\nმესაკუთრე: {OWNER}\nობიექტი: {LISTING}\nვადა: {DURATION}'],
].forEach(([tid, name, cat, content]) => {
  insertRow('contract_templates', {
    id: tid, company_id: companyId, name, category: cat, content,
    is_active: 1,
  });
});

// ── Contracts (2) ─────────────────────────────────────────────────────
db.prepare("SELECT id, client_id, buyer_agent_id AS agent_id FROM deals WHERE current_stage IN ('NEGOTIATION','DEPOSIT')")
  .all().slice(0, 2).forEach((d, i) => {
    insertRow('contracts', {
      id: id(), contract_number: `CNT-2026-${String(i+1).padStart(5,'0')}`,
      company_id: companyId, deal_id: d.id,
      client_id: d.client_id, agent_id: d.agent_id, template_id: tpl1,
      contract_type: 'SALE', title: `ხელშეკრულება #${i+1}`,
      contract_value: num(120000, 250000), currency: 'USD',
      final_content: `ხელშეკრულების სრული ტექსტი.\n\n- მუხლი 1: საგანი\n- მუხლი 2: ფასი\n- მუხლი 3: ვადები`,
      content: `ხელშეკრულების ტექსტი იხსნება ცალკე ფანჯარაში`,
      status: i === 0 ? 'SENT' : 'DRAFT',
      valid_from: daysAgo(num(1,5)), valid_until: daysFromNow(num(30,90)),
      created_at: daysAgo(num(3, 15)),
    });
  });

// ── AI hunting profiles + external listings + alerts ──────────────────
const hp1 = id(), hp2 = id();
insertRow('agent_hunting_profiles', {
  id: hp1, company_id: companyId, agent_id: ag1, name: 'ვაკის ბინები 80-150K',
  regions: '["თბილისი"]', districts: '["ვაკე","ვერა"]',
  property_types: '["APARTMENT"]', listing_types: '["SALE"]', deal_type: 'SALE',
  price_min: 80000, price_max: 150000, min_price: 80000, max_price: 150000,
  min_bedrooms: 2, max_bedrooms: 3, is_active: 1, match_count: 23,
});
insertRow('agent_hunting_profiles', {
  id: hp2, company_id: companyId, agent_id: ag2, name: 'მესაკუთრე უძრავი — საბურთალო',
  regions: '["თბილისი"]', districts: '["საბურთალო"]',
  property_types: '["APARTMENT","HOUSE"]', listing_types: '["SALE","RENT"]', deal_type: 'ANY',
  price_min: 60000, price_max: 300000, min_price: 60000, max_price: 300000,
  is_active: 1, match_count: 8,
});

const ext = [];
for (let i = 0; i < 6; i++) {
  const eid = id(); ext.push(eid);
  insertRow('external_listings', {
    id: eid, source: pick(['MYHOME','SSGE']),
    external_id: `ext-${i}`,
    external_url: `https://${pick(['myhome.ge','ss.ge'])}/listing/${num(100000,999999)}`,
    title: `მესაკუთრის განცხადება — ${pick(districts)}`,
    list_price: num(50000, 200000),
    bedrooms: num(1, 4), area_sqm: num(40, 150),
    region: 'თბილისი', city: 'თბილისი', district: pick(districts),
    owner_phone: `+995 555 ${num(100,999)} ${num(100,999)}`,
    is_owner: i < 4 ? 1 : 0, contacted: i < 2 ? 1 : 0,
  });
}
ext.slice(0, 3).forEach((eid, i) => {
  insertRow('property_alerts', {
    id: id(), company_id: companyId, profile_id: i === 0 ? hp1 : hp2,
    external_listing_id: eid,
    match_score: 0.6 + Math.random() * 0.4,
    status: i === 0 ? 'NEW' : 'VIEWED',
  });
});

// ── Notifications ─────────────────────────────────────────────────────
const notifs = [
  ['ახალი ცხელი ლიდი — მაია კიკალია', 'INFO'],
  ['გარიგება #DEAL-2026-00005 დაიხურა წარმატებით', 'SUCCESS'],
  ['საკომისიო $4,200 ჩაიბარა', 'SUCCESS'],
  ['Property match — საბურთალოს ბინა myhome.ge-ზე', 'INFO'],
];
notifs.forEach(n => {
  insertRow('notifications', {
    id: id(), user_id: founder, type: n[1], title: n[0], message: '', is_read: 0,
  });
});

// Checkpoint WAL so data survives unclean shutdown
try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch {}

const counts = {};
['companies','users','leads','clients','listings','property_images','deals','tasks',
 'showings','financial_transactions','commission_records','contracts',
 'contract_templates','marketing_campaigns','notifications',
 'agent_hunting_profiles','external_listings','property_alerts'].forEach(t => {
  counts[t] = db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
});

console.log('\n✓ Seed complete.\n');
console.log('  Company:  Prime Realty');
console.log('  Login:    beso@prime.ge / warm123');
console.log('  Agents:   nino@prime.ge, giorgi@prime.ge, tamar@prime.ge (same password)\n');
console.log('  Row counts:');
for (const [t, n] of Object.entries(counts)) console.log(`    ${t.padEnd(28)} ${n}`);
