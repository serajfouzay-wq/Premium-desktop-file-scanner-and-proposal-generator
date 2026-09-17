/*
 * Browser demo data.
 *
 * Cabinet is a desktop application: scanning, filing and export need the main
 * process and a real file system. When the bundle is served from the web there
 * is no main process at all, so rather than let every click fail, the same api
 * surface is answered from this fixture set.
 *
 * Nothing here runs in the desktop build.
 */
import { SAMPLE_DOCUMENT_HTML } from './sample-document';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export const DEMO_SETTINGS = {
  brand: {
    name: 'Northwind Industrial',
    tagline: 'Industrial systems and integration',
    address: '11 Dockside Way, Singapore',
    phone: '+65 6555 0100',
    email: 'studio@northwind.test',
    website: 'northwind.test',
    logo: null,
    accent: '#1F6E62',
    currency: '$',
    paymentDays: 30,
    defaultTerms: 'Payment due within 30 days of invoice date.',
  },
  ocr: {
    status: async () => ({ state: 'idle', installed: true, mode: 'fast', error: null }),
    warmUp: async () => onlyOnDesktop('Starting the recognition engine'),
  },

  library: { root: 'C:\\Users\\you\\Documents\\Cabinet Library' },
  filing: { mode: 'copy' },
  model: { apiKey: '', model: 'claude-opus-5', enabled: false },
};

const DOCS = [
  { id: 'd1', title: 'Meridian_Logistics_Sdn_Bhd_Proposal_2025-01-12.pdf', company: 'Meridian Logistics Sdn Bhd', doc_type: 'proposal', doc_date: '2025-01-12', confidentiality: 'shareable', origin: 'scanned', bytes: 284_113, created_at: '2026-02-02T09:12:00Z', preview: 'PROPOSAL\nPrepared for: Meridian Logistics Sdn Bhd\nOVERVIEW\nMeridian operates three distribution centres and asked us to review how goods move through them…' },
  { id: 'd2', title: 'Meridian_Logistics_Sdn_Bhd_Invoice_2025-03-14.pdf', company: 'Meridian Logistics Sdn Bhd', doc_type: 'invoice', doc_date: '2025-03-14', confidentiality: 'internal', origin: 'scanned', bytes: 91_220, created_at: '2026-02-02T09:12:04Z', preview: 'TAX INVOICE\nInvoice No: INV-2291\nBill To: Meridian Logistics Sdn Bhd\nAmount Due 8,904.00…' },
  { id: 'd3', title: 'Northwind_Studios_Ltd_Proposal_2025-05-02.docx', company: 'Northwind Studios Ltd', doc_type: 'proposal', doc_date: '2025-05-02', confidentiality: 'shareable', origin: 'scanned', bytes: 44_980, created_at: '2026-02-02T09:12:09Z', preview: 'PROPOSAL\nPrepared for: Northwind Studios Ltd\nSCOPE OF WORK\nA six month retainer covering brand direction, web design and production…' },
  { id: 'd4', title: 'Northwind_Studios_Ltd_Contract_2025-05-20.pdf', company: 'Northwind Studios Ltd', doc_type: 'contract', doc_date: '2025-05-20', confidentiality: 'internal', origin: 'scanned', bytes: 132_004, created_at: '2026-02-02T09:12:12Z', preview: 'MASTER SERVICES AGREEMENT\nThis Agreement is made between Northwind Studios Ltd and the Client…' },
  { id: 'd5', title: 'Halden_Group_Pte_Ltd_Purchase_Order_2025-02-08.xlsx', company: 'Halden Group Pte Ltd', doc_type: 'purchase_order', doc_date: '2025-02-08', confidentiality: 'internal', origin: 'scanned', bytes: 18_740, created_at: '2026-02-02T09:12:15Z', preview: 'Purchase Order,PO-8841\nClient,Halden Group Pte Ltd\nSite survey,1,4200,4200…' },
  { id: 'd6', title: 'Meridian_Logistics_Sdn_Bhd_Proposal_2026-02-11.html', company: 'Meridian Logistics Sdn Bhd', doc_type: 'proposal', doc_date: '2026-02-11', confidentiality: 'internal', origin: 'generated', bytes: 12_956, created_at: '2026-02-11T14:40:00Z', preview: 'Warehouse Automation Rollout — written in Cabinet.' },
];

const COMPANIES = [
  { name: 'Halden Group Pte Ltd', slug: 'Halden_Group_Pte_Ltd', documents: 1 },
  { name: 'Meridian Logistics Sdn Bhd', slug: 'Meridian_Logistics_Sdn_Bhd', documents: 3 },
  { name: 'Northwind Studios Ltd', slug: 'Northwind_Studios_Ltd', documents: 2 },
];

/* A scan the user did not actually run — one file deliberately lands in the
   review queue, because that is the behaviour worth showing. */
const SCANNED = [
  { path: 'C:\\Users\\you\\Downloads\\INV-2291.pdf', name: 'INV-2291.pdf', ext: 'pdf', bytes: 91_220, status: 'ready', company: 'Meridian Logistics Sdn Bhd', type: 'invoice', typeLabel: 'Invoice', folder: 'Invoices', confidence: 0.86, date: '2025-03-14', reason: '' },
  { path: 'C:\\Users\\you\\Downloads\\meridian proposal.pdf', name: 'meridian proposal.pdf', ext: 'pdf', bytes: 284_113, status: 'ready', company: 'Meridian Logistics Sdn Bhd', type: 'proposal', typeLabel: 'Proposal', folder: 'Proposals', confidence: 0.81, date: '2025-01-12', reason: '' },
  { path: 'C:\\Users\\you\\Downloads\\Northwind Studios - retainer.docx', name: 'Northwind Studios - retainer.docx', ext: 'docx', bytes: 44_980, status: 'ready', company: 'Northwind Studios Ltd', type: 'proposal', typeLabel: 'Proposal', folder: 'Proposals', confidence: 0.74, date: '2025-05-02', reason: '' },
  { path: 'C:\\Users\\you\\Downloads\\Halden_PO_8841.xlsx', name: 'Halden_PO_8841.xlsx', ext: 'xlsx', bytes: 18_740, status: 'ready', company: 'Halden Group Pte Ltd', type: 'purchase_order', typeLabel: 'Purchase Order', folder: 'Purchase Orders', confidence: 0.72, date: '2025-02-08', reason: '' },
  { path: 'C:\\Users\\you\\Downloads\\scan_0042.pdf', name: 'scan_0042.pdf', ext: 'pdf', bytes: 402_881, status: 'tagging', company: null, type: 'other', typeLabel: 'Other', folder: 'Unsorted', confidence: 0, date: null, imageOnly: true, thumbnail: null, reason: 'This is a scan with no readable text' },
  { path: 'C:\\Users\\you\\Downloads\\quote draft.pdf', name: 'quote draft.pdf', ext: 'pdf', bytes: 88_120, status: 'review', company: null, type: 'quotation', typeLabel: 'Quotation', folder: 'Quotations', confidence: 0.41, date: null, reason: "Couldn't work out which company this belongs to" },
];

const DEMO_TRACE = {
  searched: 31,
  counts: { own: 4, comparable: 1, keyword: 1 },
  hits: [
    { id: 'c1', title: 'Meridian_Logistics_Sdn_Bhd_Proposal_2025-01-12.pdf', company: 'Meridian Logistics Sdn Bhd', section: 'intro', heading: 'OVERVIEW', score: 0.4932, via: 'this client' },
    { id: 'c2', title: 'Meridian_Logistics_Sdn_Bhd_Proposal_2025-01-12.pdf', company: 'Meridian Logistics Sdn Bhd', section: 'scope', heading: 'SCOPE OF WORK', score: 0.1459, via: 'this client' },
    { id: 'c3', title: 'Meridian_Logistics_Sdn_Bhd_Proposal_2025-01-12.pdf', company: 'Meridian Logistics Sdn Bhd', section: 'deliverables', heading: 'DELIVERABLES', score: 0.0871, via: 'section coverage' },
    { id: 'c4', title: 'Meridian_Logistics_Sdn_Bhd_Proposal_2025-01-12.pdf', company: 'Meridian Logistics Sdn Bhd', section: 'timeline', heading: 'TIMELINE', score: 0.0644, via: 'section coverage' },
    { id: 'c5', title: 'Northwind_Studios_Ltd_Proposal_2025-05-02.docx', company: 'Northwind Studios Ltd', section: 'scope', heading: 'SCOPE OF WORK', score: 0.0410, via: 'comparable work' },
  ],
  excluded: ['4 pricing passages belonging to other clients', '11 passages not marked reusable'],
  checks: ['Removed a monetary figure from "Scope of work"'],
};

const DEMO_SECTIONS = [
  { heading: 'Executive summary', body: "This proposal sets out a fixed-price programme to automate inbound handling and rebuild pick paths across Meridian's three distribution centres.\n\nMeridian operates three distribution centres and asked us to review how goods move through them. The programme is phased so that each site continues trading while work is underway.", source_ids: ['c1'], citations: ['Meridian_Logistics_Sdn_Bhd_Proposal_2025-01-12.pdf'] },
  { heading: 'Scope of work', body: 'We will survey each site, model the current flow, and specify the conveyor and scanning equipment needed. The work covers mechanical layout, control wiring schedules, and the integration points with the existing warehouse management system. Commissioning and operator training are included at each site.', source_ids: ['c2'], citations: ['Meridian_Logistics_Sdn_Bhd_Proposal_2025-01-12.pdf'] },
  { heading: 'Deliverables', body: 'A layout pack per site, an equipment schedule, an integration specification, and a commissioning report signed off by the site manager.', source_ids: ['c3'], citations: ['Meridian_Logistics_Sdn_Bhd_Proposal_2025-01-12.pdf'] },
  { heading: 'Our approach', body: 'Each site is treated as its own mini-project with a single point of contact. We work from the constraints the floor actually has rather than the drawings, which is why the survey phase comes first and why nothing is ordered until it is signed off.', source_ids: [], citations: [] },
  { heading: 'Timeline', body: 'Phase 1 survey runs four weeks from kickoff. Phase 2 installation runs a further eight weeks per site, scheduled to avoid the peak season.', source_ids: ['c4'], citations: ['Meridian_Logistics_Sdn_Bhd_Proposal_2025-01-12.pdf'] },
];

const onlyOnDesktop = (what) => {
  throw new Error(`${what} needs the desktop app — this is the web preview. Download the installer from the Releases page.`);
};

const DEMO_CATALOG = {
  templates: [
    { id: 'tpl_team', name: 'Team Building Proposal', blurb: 'A day or multi-day programme built around activities, with accommodation and a host.', accent: '#1F6E62' },
    { id: 'tpl_gala', name: 'Annual Gala Dinner', blurb: 'An evening production: venue, host, entertainment, staging and the full run of show.', accent: '#7E5B13' },
    { id: 'tpl_conf', name: 'Corporate Conference', blurb: 'Plenary and breakout programme with stage, accommodation and delegate logistics.', accent: '#2C5A78' },
  ],
  locations: [
    { id: 'loc_kl', name: 'Kuala Lumpur', region: 'Klang Valley', blurb: 'The capital, and the easiest arrival point for mixed-origin delegates.', images: [] },
    { id: 'loc_penang', name: 'Penang', region: 'Northern Corridor', blurb: 'Heritage streets, food, and beach resorts within half an hour of each other.', images: [] },
    { id: 'loc_langkawi', name: 'Langkawi', region: 'Northern Corridor', blurb: 'Island resorts and duty-free, suited to longer incentive programmes.', images: [] },
    { id: 'loc_genting', name: 'Genting Highlands', region: 'Klang Valley', blurb: 'Cool highland air an hour from the capital, with large indoor venues.', images: [] },
    { id: 'loc_melaka', name: 'Melaka', region: 'Southern Corridor', blurb: 'A compact heritage city, strong for short conferences and gala dinners.', images: [] },
  ],
  hotels: [
    { id: 'htl_kl_grand', location_id: 'loc_kl', name: 'The Grand Bintang, Kuala Lumpur', star_rating: 5, address: 'Jalan Sultan Ismail', amenities: 'Pillarless ballroom for 600\nEight breakout rooms\nRooftop pool deck', images: [],
      rooms: [{ id: 'rm_1', tier: 'Deluxe King', occupancy: 2, nightly_rate: 420 }, { id: 'rm_2', tier: 'Club Twin', occupancy: 2, nightly_rate: 560 }] },
    { id: 'htl_kl_horizon', location_id: 'loc_kl', name: 'Horizon Suites KLCC', star_rating: 4, address: 'Jalan Pinang', amenities: 'Ballroom for 320\nExecutive lounge', images: [],
      rooms: [{ id: 'rm_4', tier: 'Superior Twin', occupancy: 2, nightly_rate: 280 }] },
  ],
  mcs: [
    { id: 'mc_1', name: 'Farah Nordin', headline: 'Bilingual corporate host and moderator', bio: 'Fifteen years hosting annual dinners and product launches across the region.', languages: 'English, Bahasa Malaysia, Mandarin', years: 15, day_rate: 4800, images: [] },
    { id: 'mc_4', name: 'Hafiz Rahman', headline: 'Team building facilitator and emcee', bio: 'Runs the floor for large team building days and doubles as the day host.', languages: 'English, Bahasa Malaysia', years: 8, day_rate: 3200, images: [] },
  ],
  activities: [
    { id: 'act_1', name: 'Amazing Race: Heritage Trail', category: 'team building', summary: 'Teams work through checkpoints across the old town.', duration_mins: 240, pax_min: 20, pax_max: 200, rate_type: 'per_head', rate: 185, indoor: 0, images: [] },
    { id: 'act_3', name: 'Culinary Face-Off', category: 'team building', summary: 'Teams cook a set menu against the clock, judged by a local chef.', duration_mins: 180, pax_min: 16, pax_max: 80, rate_type: 'per_head', rate: 210, indoor: 1, images: [] },
    { id: 'act_6', name: 'Awards Night Production', category: 'gala', summary: 'Full evening production with run sheet, stage cues and rehearsal.', duration_mins: 300, pax_min: 50, pax_max: 600, rate_type: 'flat', rate: 18500, indoor: 1, images: [] },
  ],
  logistics: [
    { id: 'log_2', name: 'Compact PA and Microphones', category: 'audio', spec: '4kW system, four wireless handhelds', rate_type: 'per_day', rate: 2400 },
    { id: 'log_6', name: 'Coach Transfer, 44-seat', category: 'transport', spec: 'Airport and venue transfers', rate_type: 'per_day', rate: 1250 },
  ],
};

/* The browser preview runs the real pricing rules, so the totals it shows are
   the totals the desktop app would produce from the same choices. */
function demoQuote(sel) {
  const find = (list, id) => list.find((x) => x.id === id) || null;
  const hotel = find(DEMO_CATALOG.hotels, sel.hotelId);
  const room = hotel ? (hotel.rooms.find((r) => r.id === sel.roomId) || null) : null;
  const resolved = {
    pax: sel.pax, nights: sel.nights, days: sel.days, roomsOverride: sel.roomsOverride,
    hotel, room,
    mc: find(DEMO_CATALOG.mcs, sel.mcId),
    activities: (sel.activityIds || []).map((id) => find(DEMO_CATALOG.activities, id)).filter(Boolean),
    logistics: (sel.logisticsIds || []).map((id) => find(DEMO_CATALOG.logistics, id)).filter(Boolean),
    custom: sel.custom || [],
  };
  return { resolved, hotel, room };
}

export const demo = {
  info: async () => ({ version: '1.0.0', platform: 'web', electron: '—', storage: { engine: 'demo', note: null }, userData: '—' }),
  openPath: async () => onlyOnDesktop('Opening files'),
  revealPath: async () => onlyOnDesktop('Revealing files'),

  settings: {
    get: async () => DEMO_SETTINGS,
    update: async (patch) => ({ ...DEMO_SETTINGS, ...patch }),
    chooseLibraryRoot: async () => onlyOnDesktop('Choosing a folder'),
    pickImage: async () => onlyOnDesktop('Choosing an image'),
  },

  scan: {
    chooseFolder: async () => ['C:\\Users\\you\\Downloads'],
    chooseFiles: async () => ['C:\\Users\\you\\Downloads'],
    start: async (_roots, emit) => {
      emit({ phase: 'discovering', found: 0, current: 'Looking through folders…' });
      await wait(420);
      emit({ phase: 'discovering', found: SCANNED.length, current: 'C:\\Users\\you\\Downloads' });
      await wait(260);
      for (let i = 0; i < SCANNED.length; i++) {
        emit({ phase: 'reading', total: SCANNED.length, done: i, current: SCANNED[i].name });
        await wait(360);
      }
      emit({ phase: 'done', total: SCANNED.length, done: SCANNED.length });
      return {
        files: SCANNED.map((f) => ({ ...f })),
        skipped: { system: 3, unsupported: 12, empty: 1, oversized: 0 },
        unsupported: [], cancelled: false,
      };
    },
    cancel: async () => true,
    fileOne: async (file) => ({ relative: `${file.company}\\${file.folder}\\${file.name}`, action: 'copied' }),
    fileAll: async (files) => files.map((f) => ({ relative: `${f.company}\\${f.folder}\\${f.name}`, action: 'copied' })),
  },

  library: {
    companies: async () => COMPANIES,
    documents: async (company) => (company ? DOCS.filter((d) => d.company === company) : DOCS),
    document: async (id) => {
      const d = DOCS.find((x) => x.id === id);
      return { ...d, body: `${d.preview}\n\n(The web preview shows the first lines only. The desktop app holds the full extracted text.)` };
    },
    tree: async () => [],
    stats: async () => ({
      companies: COMPANIES.length,
      documents: DOCS.length,
      chunks: 31,
      proposals: DOCS.filter((d) => d.origin === 'generated').length,
      byType: [
        { doc_type: 'proposal', n: 3 }, { doc_type: 'invoice', n: 1 },
        { doc_type: 'contract', n: 1 }, { doc_type: 'purchase_order', n: 1 },
      ],
      recent: DOCS.slice().reverse().slice(0, 6),
      root: DEMO_SETTINGS.library.root,
    }),
    setConfidentiality: async (id, level) => ({ id, confidentiality: level }),
    remove: async () => true,
  },

  catalog: {
    templates: async () => DEMO_CATALOG.templates,
    locations: async () => DEMO_CATALOG.locations,
    hotels: async (locationId) => (locationId ? DEMO_CATALOG.hotels.filter((h) => h.location_id === locationId) : DEMO_CATALOG.hotels),
    mcs: async () => DEMO_CATALOG.mcs,
    activities: async (c) => (c ? DEMO_CATALOG.activities.filter((a) => a.category === c) : DEMO_CATALOG.activities),
    logistics: async () => DEMO_CATALOG.logistics,
    quote: async (sel) => {
      const { calculate, validate } = await import('./pricing-shared');
      const { resolved } = demoQuote(sel);
      return { quote: calculate(resolved, sel.rates || {}), warnings: validate(resolved) };
    },
    preview: async (sel) => {
      const { calculate } = await import('./pricing-shared');
      const { resolved, hotel, room } = demoQuote(sel);
      const template = DEMO_CATALOG.templates.find((t) => t.id === sel.templateId);
      const location = DEMO_CATALOG.locations.find((l) => l.id === sel.locationId) || null;
      const occ = room ? Math.max(1, room.occupancy || 2) : 2;
      return {
        title: sel.title || 'Event Proposal', client: sel.client || '[Client name]',
        dates: sel.dates || '', templateName: template ? template.name : 'Proposal',
        accent: template ? template.accent : '#1F6E62',
        pax: resolved.pax, nights: resolved.nights, location, locationImages: null,
        hotel, room, roomCount: Math.ceil((resolved.pax || 0) / occ),
        mc: resolved.mc, activities: resolved.activities, logistics: resolved.logistics,
        quote: calculate(resolved, sel.rates || {}),
        slidePlan: ['cover', 'credentials', 'destination', 'hotel', 'mc', 'activities', 'logistics', 'investment', 'terms', 'closing'],
      };
    },
    exportDeck: async () => onlyOnDesktop('Exporting a PowerPoint deck'),
  },

  studio: {
    generate: async (prompt, emit) => {
      for (const stage of ['intent', 'client', 'retrieve', 'draft', 'check']) {
        emit({ stage, state: 'running' });
        await wait(430);
        emit({ stage, state: 'done' });
      }
      return {
        draft: {
          title: 'Warehouse Automation Rollout',
          subtitle: 'A twelve week programme to automate inbound handling across three distribution centres.',
          company: 'Meridian Logistics Sdn Bhd',
          sections: DEMO_SECTIONS.map((s) => ({ ...s })),
          terms: 'Payment due within 30 days of invoice date. Liability is limited to the value of this contract. Governing law is that of Malaysia.',
          assumptions: ['Site access outside trading hours to be confirmed with the client.'],
          phases: [
            { when: 'Weeks 1-4', what: 'Survey and modelling' },
            { when: 'Weeks 5-9', what: 'Installation' },
            { when: 'Weeks 10-12', what: 'Commissioning' },
          ],
        },
        intent: { summary: prompt, type: 'proposal', client: 'Meridian Logistics', duration: '12 week', billing: 'fixed-price', missing: [] },
        entity: { company: 'Meridian Logistics Sdn Bhd', status: 'matched' },
        usedModel: false,
        modelError: null,
        trace: DEMO_TRACE,
        lineItems: [
          { description: 'Site survey and flow modelling', qty: 3, unit: 'site', unitPrice: null, basis: 'from Meridian_Logistics_Sdn_Bhd_Proposal_2025-01-12.pdf' },
          { description: 'Equipment specification', qty: 1, unit: 'phase', unitPrice: null, basis: '' },
          { description: 'Installation and commissioning', qty: 3, unit: 'site', unitPrice: null, basis: '' },
        ],
      };
    },
    // A genuine render from the real template, produced at build time.
    preview: async () => SAMPLE_DOCUMENT_HTML,
    exportAs: async () => onlyOnDesktop('Exporting to PDF or Word'),
    saveToLibrary: async () => onlyOnDesktop('Saving to the library'),
  },
};
