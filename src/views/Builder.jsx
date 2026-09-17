import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Card, Empty, Icon, Spinner, useToast } from '../components/ui';
import { api } from '../lib/api';
import { money as fmtMoney } from '../lib/pricing-shared';
import SlidePreview from '../components/SlidePreview';

/*
 * The five-step builder.
 *
 * Nothing is generated here: every figure comes back from the pricing engine
 * in the main process, so what the screen shows is what the deck will say.
 */

const STEPS = [
  { id: 1, label: 'Type' },
  { id: 2, label: 'Destination' },
  { id: 3, label: 'Details' },
  { id: 4, label: 'Review' },
  { id: 5, label: 'Export' },
];

const money = (n) => fmtMoney(n, 'RM ');

export default function Builder({ settings }) {
  const toast = useToast();
  const [step, setStep] = useState(1);
  const [catalog, setCatalog] = useState({ templates: [], locations: [], hotels: [], mcs: [], activities: [], logistics: [] });
  const [loading, setLoading] = useState(true);
  const [quote, setQuote] = useState(null);
  const [warnings, setWarnings] = useState([]);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);

  const [sel, setSel] = useState({
    templateId: null, locationId: null,
    client: '', title: '', dates: '',
    pax: 50, nights: 2, days: 3,
    hotelId: null, roomId: null, mcId: null,
    activityIds: [], logisticsIds: [],
    rates: { serviceChargePct: 10, taxPct: 8, marginPct: 0 },
  });
  const set = (patch) => setSel((s) => ({ ...s, ...patch }));

  useEffect(() => {
    (async () => {
      try {
        const [templates, locations, mcs, activities, logistics] = await Promise.all([
          api.catalog.templates(), api.catalog.locations(), api.catalog.mcs(),
          api.catalog.activities(), api.catalog.logistics(),
        ]);
        setCatalog((c) => ({ ...c, templates, locations, mcs, activities, logistics }));
      } catch (err) { toast(err.message, 'error'); }
      setLoading(false);
    })();
  }, [toast]);

  useEffect(() => {
    if (!sel.locationId) return;
    api.catalog.hotels(sel.locationId)
      .then((hotels) => setCatalog((c) => ({ ...c, hotels })))
      .catch((err) => toast(err.message, 'error'));
  }, [sel.locationId, toast]);

  // Every change re-prices from the engine — the screen never does its own sums.
  useEffect(() => {
    let live = true;
    api.catalog.quote(sel).then((r) => {
      if (!live) return;
      setQuote(r.quote); setWarnings(r.warnings);
    }).catch(() => {});
    return () => { live = false; };
  }, [sel]);

  useEffect(() => {
    if (step < 4) return;
    api.catalog.preview(sel).then(setPreview).catch((err) => toast(err.message, 'error'));
  }, [step, sel, toast]);

  const template = catalog.templates.find((t) => t.id === sel.templateId);
  const hotel = catalog.hotels.find((h) => h.id === sel.hotelId);
  const canAdvance = useMemo(() => ({
    1: !!sel.templateId, 2: !!sel.locationId, 3: !!sel.client && sel.pax > 0, 4: true, 5: true,
  }), [sel]);

  async function exportDeck() {
    setBusy(true);
    try {
      const out = await api.catalog.exportDeck(sel);
      if (out) toast(`Deck saved to ${out.path} — ${out.slides} slides`, 'good');
    } catch (err) { toast(err.message, 'error'); }
    setBusy(false);
  }

  if (loading) {
    return <div className="flex items-center gap-2 px-8 pt-10 text-[13px] text-ink-soft"><Spinner /> Opening the catalog…</div>;
  }

  return (
    <div className="mx-auto max-w-[1240px] px-8 pb-16 pt-9">
      <header className="mb-6">
        <p className="text-[11px] font-semibold uppercase tracking-[.16em] text-ink-faint">Proposal builder</p>
        <h1 className="mt-1.5 text-[27px] font-bold tracking-[-.025em]">
          {template ? template.name : 'Build a proposal deck'}
        </h1>
      </header>

      <ol className="mb-7 flex flex-wrap items-center gap-1">
        {STEPS.map((s, i) => {
          const done = step > s.id;
          const here = step === s.id;
          return (
            <li key={s.id} className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => (s.id < step || canAdvance[step]) && setStep(s.id)}
                className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-[12.5px] font-semibold transition
                  ${here ? 'bg-ink text-paper-raised' : done ? 'text-ledger hover:bg-ledger-wash' : 'text-ink-faint'}`}
              >
                <span className={`flex h-4.5 w-4.5 items-center justify-center rounded-full text-[10px]
                  ${here ? 'bg-brass text-slate-950' : done ? 'bg-ledger text-white' : 'bg-paper-sunk'}`}
                  style={{ width: 18, height: 18 }}
                >
                  {done ? <Icon name="check" size={10} /> : s.id}
                </span>
                {s.label}
              </button>
              {i < STEPS.length - 1 && <span className="h-px w-4 bg-rule" />}
            </li>
          );
        })}
      </ol>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0">
          {step === 1 && (
            <div className="grid gap-4 sm:grid-cols-3">
              {catalog.templates.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => { set({ templateId: t.id }); setStep(2); }}
                  className={`card group flex h-full flex-col p-0 text-left transition hover:shadow-lift
                    ${sel.templateId === t.id ? 'ring-2 ring-ledger' : ''}`}
                >
                  <div className="h-24 rounded-t-xl" style={{ background: `linear-gradient(135deg, ${t.accent}, ${t.accent}CC)` }} />
                  <div className="flex flex-1 flex-col p-4">
                    <h3 className="text-[15px] font-semibold">{t.name}</h3>
                    <p className="mt-1.5 flex-1 text-[12.5px] leading-relaxed text-ink-soft">{t.blurb}</p>
                    <span className="mt-3 inline-flex items-center gap-1 text-[12px] font-semibold text-ledger">
                      Choose <Icon name="arrow" size={13} />
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}

          {step === 2 && (
            <div className="grid gap-3 sm:grid-cols-2">
              {catalog.locations.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => { set({ locationId: l.id, hotelId: null, roomId: null }); setStep(3); }}
                  className={`card p-4 text-left transition hover:shadow-lift ${sel.locationId === l.id ? 'ring-2 ring-ledger' : ''}`}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <h3 className="text-[15px] font-semibold">{l.name}</h3>
                    <span className="chip">{l.region}</span>
                  </div>
                  <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-soft">{l.blurb}</p>
                </button>
              ))}
            </div>
          )}

          {step === 3 && (
            <div className="space-y-5">
              <Card title="The event" bodyClass="grid gap-3 p-5 sm:grid-cols-2">
                <Field label="Client name" value={sel.client} onChange={(v) => set({ client: v })} className="sm:col-span-2" placeholder="Meridian Logistics Sdn Bhd" />
                <Field label="Event title" value={sel.title} onChange={(v) => set({ title: v })} className="sm:col-span-2" placeholder="Annual Team Offsite 2026" />
                <Field label="Dates" value={sel.dates} onChange={(v) => set({ dates: v })} placeholder="14 – 16 March 2026" />
                <Field label="Attending (pax)" type="number" value={sel.pax} onChange={(v) => set({ pax: Number(v) || 0 })} />
                <Field label="Nights" type="number" value={sel.nights} onChange={(v) => set({ nights: Number(v) || 0 })} />
                <Field label="Event days" type="number" value={sel.days} onChange={(v) => set({ days: Number(v) || 1 })} />
              </Card>

              <Card title="Hotel" note={`${catalog.hotels.length} in this destination`} bodyClass="p-0">
                <ul className="divide-y divide-rule">
                  {catalog.hotels.map((h) => (
                    <li key={h.id} className="p-4">
                      <label className="flex cursor-pointer items-start gap-3">
                        <input type="radio" name="hotel" className="mt-1 h-4 w-4 accent-[#1F6E62]"
                          checked={sel.hotelId === h.id}
                          onChange={() => set({ hotelId: h.id, roomId: (h.rooms[0] || {}).id || null })} />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-baseline gap-2">
                            <span className="text-[14px] font-semibold">{h.name}</span>
                            <span className="text-[11px] text-brass">{'★'.repeat(h.star_rating || 0)}</span>
                          </span>
                          <span className="mt-0.5 block text-[11.5px] text-ink-faint">{h.address}</span>
                        </span>
                      </label>
                      {sel.hotelId === h.id && (
                        <div className="ml-7 mt-3 flex flex-wrap gap-2">
                          {h.rooms.map((r) => (
                            <button key={r.id} type="button" onClick={() => set({ roomId: r.id })}
                              className={`rounded-lg border px-3 py-2 text-left text-[12px] transition
                                ${sel.roomId === r.id ? 'border-ledger bg-ledger-wash' : 'border-rule hover:border-rule-strong'}`}>
                              <span className="block font-semibold">{r.tier}</span>
                              <span className="text-ink-faint">{money(r.nightly_rate)} · sleeps {r.occupancy}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </Card>

              <Card title="Host" bodyClass="p-0">
                <ul className="divide-y divide-rule">
                  {catalog.mcs.map((m) => (
                    <li key={m.id}>
                      <label className="flex cursor-pointer items-start gap-3 p-4">
                        <input type="radio" name="mc" className="mt-1 h-4 w-4 accent-[#1F6E62]"
                          checked={sel.mcId === m.id} onChange={() => set({ mcId: m.id })} />
                        <span className="min-w-0 flex-1">
                          <span className="text-[14px] font-semibold">{m.name}</span>
                          <span className="mt-0.5 block text-[12px] text-ink-soft">{m.headline}</span>
                          <span className="mt-1 block text-[11.5px] text-ink-faint">{m.languages} · {m.years} years</span>
                        </span>
                        <span className="shrink-0 text-[12.5px] font-semibold">{money(m.day_rate)}<span className="block text-[10.5px] font-normal text-ink-faint">per day</span></span>
                      </label>
                    </li>
                  ))}
                </ul>
              </Card>

              <Picker title="Activities" items={catalog.activities} selected={sel.activityIds}
                onToggle={(id) => set({ activityIds: toggle(sel.activityIds, id) })}
                describe={(a) => `${a.summary}`}
                priceOf={(a) => (a.rate_type === 'per_head' ? `${money(a.rate)} / person` : `${money(a.rate)} flat`)} />

              <Picker title="Production and logistics" items={catalog.logistics} selected={sel.logisticsIds}
                onToggle={(id) => set({ logisticsIds: toggle(sel.logisticsIds, id) })}
                describe={(l) => l.spec}
                priceOf={(l) => `${money(l.rate)} ${l.rate_type === 'per_day' ? '/ day' : l.rate_type === 'per_head' ? '/ person' : 'flat'}`} />

              <Card title="Charges" note="Applied to every line" bodyClass="grid gap-3 p-5 sm:grid-cols-3">
                <Field label="Margin %" type="number" value={sel.rates.marginPct} onChange={(v) => set({ rates: { ...sel.rates, marginPct: Number(v) || 0 } })} />
                <Field label="Service charge %" type="number" value={sel.rates.serviceChargePct} onChange={(v) => set({ rates: { ...sel.rates, serviceChargePct: Number(v) || 0 } })} />
                <Field label="Tax %" type="number" value={sel.rates.taxPct} onChange={(v) => set({ rates: { ...sel.rates, taxPct: Number(v) || 0 } })} />
              </Card>
            </div>
          )}

          {step >= 4 && (
            preview
              ? <SlidePreview proposal={preview} brand={(settings && settings.brand) || {}} />
              : <div className="flex items-center gap-2 text-[13px] text-ink-soft"><Spinner /> Laying out the slides…</div>
          )}
        </div>

        <aside className="space-y-4">
          <Card title="Running total" bodyClass="p-4">
            {quote ? (
              <>
                <div className="mb-3 border-b border-rule pb-3">
                  <div className="text-[26px] font-bold tracking-[-.02em] text-ledger">{money(quote.total)}</div>
                  <div className="mt-1 text-[11.5px] text-ink-faint">{money(quote.perPax)} per person · {quote.pax} pax</div>
                </div>
                <dl className="space-y-1.5 text-[12px]">
                  {quote.groups.map((g) => (
                    <div key={g.name} className="flex justify-between gap-2">
                      <dt className="text-ink-soft">{g.name}</dt>
                      <dd className="tabular-nums">{money(g.subtotal)}</dd>
                    </div>
                  ))}
                  <div className="!mt-2.5 flex justify-between gap-2 border-t border-rule pt-2.5 font-semibold">
                    <dt>Subtotal</dt><dd className="tabular-nums">{money(quote.subtotal)}</dd>
                  </div>
                  {quote.margin > 0 && (
                    <div className="flex justify-between gap-2"><dt className="text-ink-soft">Margin {quote.marginPct}%</dt><dd className="tabular-nums">{money(quote.margin)}</dd></div>
                  )}
                  <div className="flex justify-between gap-2"><dt className="text-ink-soft">Service {quote.serviceChargePct}%</dt><dd className="tabular-nums">{money(quote.serviceCharge)}</dd></div>
                  <div className="flex justify-between gap-2"><dt className="text-ink-soft">Tax {quote.taxPct}%</dt><dd className="tabular-nums">{money(quote.tax)}</dd></div>
                </dl>
              </>
            ) : <p className="text-[12.5px] text-ink-faint">Choose items to see the total.</p>}
          </Card>

          {warnings.length > 0 && (
            <Card title="Worth checking" bodyClass="p-4">
              <ul className="space-y-1.5 text-[12px] leading-relaxed text-brass-deep">
                {warnings.map((w) => <li key={w}>· {w}</li>)}
              </ul>
            </Card>
          )}

          <div className="flex gap-2">
            {step > 1 && <Button icon="back" onClick={() => setStep(step - 1)}>Back</Button>}
            {step < 4 && <Button tone="accent" className="flex-1" disabled={!canAdvance[step]} onClick={() => setStep(step + 1)}>Continue</Button>}
            {step >= 4 && (
              <Button tone="brass" className="flex-1" icon={busy ? undefined : 'download'} disabled={busy || !sel.client} onClick={exportDeck}>
                {busy ? <><Spinner /> Building…</> : 'Export PowerPoint'}
              </Button>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

const toggle = (list, id) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

const Field = ({ label, value, onChange, type = 'text', className = '', placeholder }) => (
  <label className={`block ${className}`}>
    <span className="label">{label}</span>
    <input className="field" type={type} value={value == null ? '' : value} placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)} />
  </label>
);

const Picker = ({ title, items, selected, onToggle, describe, priceOf }) => (
  <Card title={title} note={`${selected.length} selected`} bodyClass="p-0">
    {items.length === 0 ? <Empty icon="folder" title="Nothing in the catalog yet" /> : (
      <ul className="divide-y divide-rule">
        {items.map((it) => (
          <li key={it.id}>
            <label className="flex cursor-pointer items-start gap-3 p-4">
              <input type="checkbox" className="mt-1 h-4 w-4 accent-[#1F6E62]"
                checked={selected.includes(it.id)} onChange={() => onToggle(it.id)} />
              <span className="min-w-0 flex-1">
                <span className="text-[14px] font-semibold">{it.name}</span>
                <span className="mt-0.5 block text-[12px] leading-relaxed text-ink-soft">{describe(it)}</span>
              </span>
              <span className="shrink-0 text-[12.5px] font-semibold">{priceOf(it)}</span>
            </label>
          </li>
        ))}
      </ul>
    )}
  </Card>
);
