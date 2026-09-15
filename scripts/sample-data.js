'use strict';
/* One definition of the demo content, shared by the sample-document builder
   and (mirrored) by the browser demo layer. */

const DEMO_BRAND = {
  name: 'Northwind Industrial',
  address: '11 Dockside Way, Singapore',
  phone: '+65 6555 0100',
  email: 'studio@northwind.test',
  website: 'northwind.test',
  currency: '$',
  accent: '#1F6E62',
};

const DEMO_DRAFT = {
  kicker: 'Proposal',
  title: 'Warehouse Automation Rollout',
  company: 'Meridian Logistics Sdn Bhd',
  subtitle: 'A twelve week programme to automate inbound handling across three distribution centres.',
  date: '2026-02-11T00:00:00.000Z',
  sections: [
    {
      heading: 'Executive summary',
      body: 'This proposal sets out a fixed-price programme to automate inbound handling and rebuild pick paths across Meridian\'s three distribution centres.\n\nMeridian operates three distribution centres and asked us to review how goods move through them. The programme is phased so that each site continues trading while work is underway.',
      citations: ['Meridian_Logistics_Proposal_2025-01-12.pdf'],
    },
    {
      heading: 'Scope of work',
      body: 'We will survey each site, model the current flow, and specify the conveyor and scanning equipment needed. The work covers mechanical layout, control wiring schedules, and the integration points with the existing warehouse management system. Commissioning and operator training are included at each site.',
      citations: ['Meridian_Logistics_Proposal_2025-01-12.pdf'],
    },
    {
      heading: 'Deliverables',
      body: 'A layout pack per site, an equipment schedule, an integration specification, and a commissioning report signed off by the site manager.',
      citations: [],
    },
    {
      heading: 'Our approach',
      body: 'Each site is treated as its own mini-project with a single point of contact. We work from the constraints the floor actually has rather than the drawings, which is why the survey phase comes first and why nothing is ordered until it is signed off.',
      citations: [],
    },
    {
      heading: 'Timeline',
      body: 'Phase 1 survey runs four weeks from kickoff. Phase 2 installation runs a further eight weeks per site, scheduled to avoid the peak season.',
      citations: ['Meridian_Logistics_Proposal_2025-01-12.pdf'],
    },
  ],
  phases: [
    { when: 'Weeks 1-4', what: 'Survey and modelling' },
    { when: 'Weeks 5-9', what: 'Installation' },
    { when: 'Weeks 10-12', what: 'Commissioning' },
  ],
  terms: 'Payment due within 30 days of invoice date. Liability is limited to the value of this contract. Governing law is that of Malaysia.',
  assumptions: [
    'Site access outside trading hours to be confirmed with the client.',
    'Existing WMS API documentation to be provided at kickoff.',
  ],
};

const DEMO_ITEMS = [
  { description: 'Site survey and flow modelling', qty: 3, unit: 'site', unitPrice: 8000, basis: 'from Meridian_Logistics_Proposal_2025-01-12.pdf' },
  { description: 'Equipment specification', qty: 1, unit: 'phase', unitPrice: 24000, basis: '' },
  { description: 'Installation and commissioning', qty: 3, unit: 'site', unitPrice: 62500, basis: '' },
];

module.exports = { DEMO_BRAND, DEMO_DRAFT, DEMO_ITEMS };
