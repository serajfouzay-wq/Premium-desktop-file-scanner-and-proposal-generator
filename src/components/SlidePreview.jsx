import React from 'react';
import { money as fmtMoney } from '../lib/pricing-shared';

/*
 * A preview of the deck the exporter will write.
 *
 * It mirrors deck.js slide for slide, from the same proposal object and the
 * same pricing figures, so what is on screen is what lands in the .pptx. It is
 * not a renderer of the file itself — the two are kept in step by using one
 * source of data, not by one reading the other.
 */

const money = (n) => fmtMoney(n, 'RM ');
const AR = 16 / 9;

const Slide = ({ children, dark, accent, label }) => (
  <figure className="m-0">
    <div
      className="relative overflow-hidden rounded-lg border border-rule shadow-card"
      style={{ aspectRatio: String(AR), background: dark ? '#12191C' : '#FFFFFF' }}
    >
      {children}
    </div>
    {label && <figcaption className="mt-1.5 text-[10.5px] uppercase tracking-[.14em] text-ink-faint">{label}</figcaption>}
  </figure>
);

/* Percentages throughout, so a slide keeps its proportions at any width — the
   deck is laid out in inches and this has to survive being shown small. */
/* `style` is spread last: the activity cards position their plates in normal
   flow, and a hardcoded `position: absolute` here silently collapsed them. */
const Plate = ({ image, label, accent, style }) => (
  <div style={{ position: 'absolute', overflow: 'hidden', background: '#F6F5F1', border: '1px solid #DEDBD1', ...style }}>
    {image ? (
      <img src={`file://${image}`} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
    ) : (
      <div style={{
        position: 'absolute', inset: 0, display: 'grid', placeItems: 'center',
        color: '#8A959A', fontSize: '1.4cqw', letterSpacing: '.14em', textTransform: 'uppercase',
      }}>{label || 'Photograph'}</div>
    )}
    {accent && <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '0.5%', background: accent }} />}
  </div>
);

const firstImage = (subject) => {
  const imgs = (subject && subject.images) || [];
  return imgs.length ? imgs[0].path : null;
};

export default function SlidePreview({ proposal: p, brand }) {
  const accent = p.accent || brand.accent || '#1F6E62';
  const host = brand.name || 'Your company';
  const q = p.quote;
  const plan = p.slidePlan || [];

  const slides = [];
  const add = (label, node, dark) => slides.push({ label, node, dark });

  if (plan.includes('cover')) {
    add('Cover', (
      <>
        <div style={{ position: 'absolute', inset: 0, background: '#12191C' }} />
        <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '42%', background: accent }} />
        <div style={{ position: 'absolute', left: '4.7%', top: '7%', color: '#fff', fontWeight: 700, fontSize: '2.2cqw' }}>{host}</div>
        <div style={{ position: 'absolute', left: '4.7%', top: '31%', color: '#fff', opacity: .75, fontSize: '1.5cqw', letterSpacing: '.28em', fontWeight: 600 }}>
          {String(p.templateName || 'Proposal').toUpperCase()}
        </div>
        <div style={{ position: 'absolute', left: '4.7%', top: '37%', width: '33%', color: '#fff', fontFamily: 'Georgia, serif', fontWeight: 700, fontSize: '4.6cqw', lineHeight: 1.05 }}>
          {p.title}
        </div>
        <div style={{ position: 'absolute', left: '4.7%', bottom: '8%', width: '33%', color: '#fff' }}>
          {[['PREPARED FOR', p.client], ['DATES', p.dates || 'To be confirmed'], ['ATTENDING', `${p.pax} guests`]].map(([k, v]) => (
            <div key={k} style={{ marginBottom: '2.4%' }}>
              <div style={{ fontSize: '1.05cqw', letterSpacing: '.18em', opacity: .55 }}>{k}</div>
              <div style={{ fontSize: '1.7cqw', fontWeight: 700 }}>{v}</div>
            </div>
          ))}
        </div>
      </>
    ), true);
  }

  const Chrome = ({ kicker, title, children }) => (
    <>
      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '1.2%', background: accent }} />
      <div style={{ position: 'absolute', left: '4.7%', top: '6%', color: accent, fontSize: '1.2cqw', fontWeight: 700, letterSpacing: '.24em' }}>
        {String(kicker).toUpperCase()}
      </div>
      <div style={{ position: 'absolute', left: '4.7%', top: '10%', right: '4.7%', fontFamily: 'Georgia, serif', fontWeight: 700, fontSize: '3.5cqw', color: '#12191C' }}>
        {title}
      </div>
      <div style={{ position: 'absolute', left: '4.7%', right: '4.7%', top: '19%', height: 1, background: '#DEDBD1' }} />
      {children}
      <div style={{ position: 'absolute', left: '4.7%', bottom: '4%', fontSize: '1.05cqw', color: '#8A959A' }}>{host} · {p.client}</div>
    </>
  );

  if (plan.includes('destination') && p.location) {
    add('Destination', (
      <Chrome kicker="Destination" title={p.location.name}>
        <Plate image={firstImage(p.locationImages)} label={p.location.name} accent={accent}
          style={{ left: '4.7%', top: '25%', width: '53%', height: '57%' }} />
        <div style={{ position: 'absolute', left: '60%', top: '25%', width: '35%' }}>
          <div style={{ color: accent, fontSize: '1.2cqw', fontWeight: 700, letterSpacing: '.18em' }}>{p.location.region}</div>
          <div style={{ marginTop: '4%', color: '#4A565B', fontSize: '1.5cqw', lineHeight: 1.45 }}>{p.location.blurb}</div>
        </div>
      </Chrome>
    ));
  }

  if (plan.includes('hotel') && p.hotel) {
    const imgs = (p.hotel.images || []);
    add('Accommodation', (
      <Chrome kicker="Accommodation" title={p.hotel.name}>
        <Plate image={imgs[0] && imgs[0].path} label="Hotel" accent={accent} style={{ left: '4.7%', top: '25%', width: '44%', height: '45%' }} />
        <Plate image={imgs[1] && imgs[1].path} label="Room" accent={accent} style={{ left: '4.7%', top: '71%', width: '21.4%', height: '21%' }} />
        <Plate image={imgs[2] && imgs[2].path} label="Room" accent={accent} style={{ left: '27.3%', top: '71%', width: '21.4%', height: '21%' }} />
        <div style={{ position: 'absolute', left: '51.5%', top: '25%', width: '43.8%' }}>
          <div style={{ color: '#8A959A', fontSize: '1.15cqw' }}>{'★'.repeat(p.hotel.star_rating || 0)} {p.hotel.address}</div>
          {p.room && (
            <div style={{ marginTop: '3%', background: '#F6F5F1', border: '1px solid #DEDBD1', padding: '3% 4%', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: '1.8cqw' }}>{p.room.tier}</div>
                <div style={{ color: '#4A565B', fontSize: '1.2cqw' }}>Sleeps {p.room.occupancy} · {p.roomCount} rooms · {p.nights} nights</div>
              </div>
              <div style={{ color: accent, fontWeight: 700, fontSize: '2cqw' }}>{money(p.room.nightly_rate)}</div>
            </div>
          )}
          <ul style={{ margin: '4% 0 0', paddingLeft: '4%', color: '#4A565B', fontSize: '1.35cqw', lineHeight: 1.6 }}>
            {String(p.hotel.amenities || '').split('\n').filter(Boolean).map((a) => <li key={a}>{a}</li>)}
          </ul>
        </div>
      </Chrome>
    ));
  }

  if (plan.includes('mc') && p.mc) {
    add('Host', (
      <Chrome kicker="Your host" title={p.mc.name}>
        <Plate image={firstImage(p.mc)} label={p.mc.name} accent={accent} style={{ left: '4.7%', top: '25%', width: '30%', height: '61%' }} />
        <div style={{ position: 'absolute', left: '38.5%', top: '25%', width: '56%' }}>
          <div style={{ color: accent, fontWeight: 700, fontSize: '1.8cqw' }}>{p.mc.headline}</div>
          <div style={{ marginTop: '3%', color: '#4A565B', fontSize: '1.5cqw', lineHeight: 1.45 }}>{p.mc.bio}</div>
          <div style={{ marginTop: '5%', display: 'flex', flexWrap: 'wrap', gap: '2%' }}>
            {[`${p.mc.years} years hosting`, ...String(p.mc.languages || '').split(',').map((l) => l.trim()).filter(Boolean)].map((b) => (
              <span key={b} style={{ background: '#F6F5F1', border: '1px solid #DEDBD1', borderRadius: 99, padding: '1% 3%', fontSize: '1.2cqw', color: '#4A565B' }}>{b}</span>
            ))}
          </div>
          <div style={{ marginTop: '5%', fontWeight: 700, fontSize: '1.5cqw' }}>{money(p.mc.day_rate)} per day</div>
        </div>
      </Chrome>
    ));
  }

  if (plan.includes('activities') && (p.activities || []).length) {
    for (let i = 0; i < p.activities.length; i += 3) {
      const page = p.activities.slice(i, i + 3);
      add('Activities', (
        <Chrome kicker="Activities" title={i === 0 ? 'The programme' : 'The programme, continued'}>
          {page.map((a, j) => (
            <div key={a.id} style={{ position: 'absolute', left: `${4.7 + j * 30.9}%`, top: '25%', width: '28.9%' }}>
              <Plate image={firstImage(a)} label={a.name} accent={accent} style={{ position: 'relative', width: '100%', height: 0, paddingBottom: '56%' }} />
              <div style={{ marginTop: '6%', fontWeight: 700, fontSize: '1.7cqw' }}>{a.name}</div>
              <div style={{ marginTop: '3%', color: '#4A565B', fontSize: '1.2cqw', lineHeight: 1.4 }}>{a.summary}</div>
              <div style={{ marginTop: '4%', color: accent, fontWeight: 700, fontSize: '1.3cqw' }}>
                {a.rate_type === 'per_head' ? `${money(a.rate)} per person` : `${money(a.rate)} for the group`}
              </div>
            </div>
          ))}
        </Chrome>
      ));
    }
  }

  if (plan.includes('investment') && q) {
    add('Investment', (
      <Chrome kicker="Costs" title="Investment">
        <table style={{ position: 'absolute', left: '4.7%', top: '24%', width: '62%', borderCollapse: 'collapse', fontSize: '1.15cqw' }}>
          <tbody>
            {q.groups.map((g) => (
              <React.Fragment key={g.name}>
                <tr style={{ background: '#F6F5F1' }}>
                  <td style={{ padding: '0.6% 1%', fontWeight: 700, color: accent, letterSpacing: '.1em' }}>{g.name.toUpperCase()}</td>
                  <td /><td style={{ textAlign: 'right', padding: '0.6% 1%', fontWeight: 700 }}>{money(g.subtotal)}</td>
                </tr>
                {g.lines.map((l) => (
                  <tr key={l.description} style={{ borderBottom: '1px solid #DEDBD1' }}>
                    <td style={{ padding: '0.6% 1%' }}>{l.description}</td>
                    <td style={{ padding: '0.6% 1%', textAlign: 'right', color: '#8A959A' }}>{l.qty} {l.unit}</td>
                    <td style={{ padding: '0.6% 1%', textAlign: 'right' }}>{money(l.amount)}</td>
                  </tr>
                ))}
              </React.Fragment>
            ))}
          </tbody>
        </table>
        <div style={{ position: 'absolute', right: '4.7%', top: '24%', width: '25%', background: '#F6F5F1', border: '1px solid #DEDBD1', padding: '3%' }}>
          {[['Subtotal', q.subtotal], ...(q.margin ? [[`Margin ${q.marginPct}%`, q.margin]] : []),
            [`Service ${q.serviceChargePct}%`, q.serviceCharge], [`Tax ${q.taxPct}%`, q.tax]].map(([k, v]) => (
            <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '1.15cqw', marginBottom: '4%' }}>
              <span style={{ color: '#4A565B' }}>{k}</span><span>{money(v)}</span>
            </div>
          ))}
          <div style={{ borderTop: '2px solid #12191C', marginTop: '6%', paddingTop: '6%' }}>
            <div style={{ fontSize: '1.05cqw', letterSpacing: '.18em', fontWeight: 700 }}>TOTAL</div>
            <div style={{ color: accent, fontWeight: 700, fontSize: '2.6cqw', textAlign: 'right' }}>{money(q.total)}</div>
            <div style={{ color: '#8A959A', fontSize: '1.05cqw', textAlign: 'right' }}>{money(q.perPax)} per person</div>
          </div>
        </div>
      </Chrome>
    ));
  }

  if (plan.includes('closing')) {
    add('Closing', (
      <>
        <div style={{ position: 'absolute', inset: 0, background: '#12191C' }} />
        <div style={{ position: 'absolute', left: 0, top: 0, right: 0, height: '3%', background: accent }} />
        <div style={{ position: 'absolute', left: '4.7%', top: '33%', width: '72%', color: '#fff', fontFamily: 'Georgia, serif', fontWeight: 700, fontSize: '4cqw' }}>
          We would be glad to run this for you.
        </div>
        <div style={{ position: 'absolute', left: '4.7%', top: '50%', color: '#fff', opacity: .65, fontSize: '1.7cqw' }}>Prepared for {p.client}</div>
      </>
    ), true);
  }

  return (
    <div>
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-[15px] font-semibold">Deck preview</h2>
        <span className="text-[12px] text-ink-faint">{slides.length} of {plan.length} slides shown · the export adds credentials and terms</span>
      </div>
      <div className="grid gap-5 sm:grid-cols-2" style={{ containerType: 'inline-size' }}>
        {slides.map((s, i) => (
          <div key={i} style={{ containerType: 'inline-size' }}>
            <Slide dark={s.dark} accent={accent} label={s.label}>{s.node}</Slide>
          </div>
        ))}
      </div>
    </div>
  );
}
