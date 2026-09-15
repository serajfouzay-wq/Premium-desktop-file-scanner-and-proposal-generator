import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Card, Icon, Spinner, useEscape, useToast } from '../components/ui';
import { api, isDesktop } from '../lib/api';
import { money, plural } from '../lib/format';

const STAGES = [
  ['intent', 'Understanding the request'],
  ['client', 'Identifying the client'],
  ['retrieve', 'Finding relevant past work'],
  ['draft', 'Drafting'],
  ['check', 'Checking'],
];

const EXAMPLES = [
  'Write a fixed-price proposal for Meridian Logistics covering a 12 week warehouse automation rollout',
  'Draft a retainer proposal for Northwind Studios for 6 months of brand and web design support',
  'Prepare a statement of work for Halden Group covering discovery, build and a 3 month support period',
];

export default function Studio({ settings, go }) {
  const toast = useToast();
  const [prompt, setPrompt] = useState('');
  const [stage, setStage] = useState({});
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [items, setItems] = useState([]);
  const [assets, setAssets] = useState({ clientLogo: null, hero: null, plates: {} });
  const [preview, setPreview] = useState(null);
  const [showPreview, setShowPreview] = useState(false);

  const brand = (settings && settings.brand) || {};
  const currency = brand.currency || '$';

  useEffect(() => api.studio.onStage(({ stage: s, state }) => {
    setStage((prev) => ({ ...prev, [s]: state }));
  }), []);

  const unpriced = useMemo(
    () => items.filter((i) => i.description && (i.unitPrice == null || i.unitPrice === '')).length,
    [items],
  );
  const total = useMemo(
    () => items.reduce((a, i) => a + (Number(i.qty) || 0) * (Number(i.unitPrice) || 0), 0),
    [items],
  );

  async function run() {
    const text = prompt.trim();
    if (!text) { toast('Describe what you need first.'); return; }
    setRunning(true); setStage({}); setResult(null);
    try {
      const out = await api.studio.generate(text);
      const withCitations = {
        ...out.draft,
        sections: (out.draft.sections || []).map((s) => ({
          ...s,
          citations: (s.source_ids || [])
            .map((id) => (out.trace.hits.find((h) => h.id === id) || {}).title)
            .filter(Boolean),
        })),
      };
      setResult({ ...out, draft: withCitations });
      setItems(out.lineItems);
      if (out.modelError) toast(`Drafted from retrieved passages — ${out.modelError}`);
    } catch (err) {
      toast(err.message, 'error');
    }
    setRunning(false);
  }

  const payload = useCallback(() => ({
    draft: result.draft, lineItems: items, assets,
  }), [result, items, assets]);

  async function openPreview() {
    try {
      setPreview(await api.studio.preview(payload()));
      setShowPreview(true);
    } catch (err) { toast(err.message, 'error'); }
  }

  async function exportAs(format) {
    try {
      const out = await api.studio.exportAs(format, payload());
      if (out) toast(`Saved to ${out.path}`, 'good');
    } catch (err) { toast(err.message, 'error'); }
  }

  async function saveToLibrary() {
    try {
      const out = await api.studio.saveToLibrary(payload());
      toast(`Saved to the library at ${out.path}`, 'good');
    } catch (err) { toast(err.message, 'error'); }
  }

  async function pickAsset(key, index) {
    try {
      const img = await api.settings.pickImage();
      if (!img) return;
      setAssets((a) => (key === 'plate'
        ? { ...a, plates: { ...a.plates, [index]: img.dataUri } }
        : { ...a, [key]: img.dataUri }));
    } catch (err) { toast(err.message, 'error'); }
  }

  /* ----------------------------------------------------------- prompt view */
  if (!result) {
    return (
      <div className="mx-auto max-w-[840px] px-8 pb-16 pt-9">
        <header className="mb-7">
          <p className="text-[11px] font-semibold uppercase tracking-[.16em] text-ink-faint">Proposal studio</p>
          <h1 className="mt-1.5 text-[27px] font-bold tracking-[-.025em]">Write a proposal</h1>
          <p className="mt-2 max-w-[68ch] text-[14px] leading-relaxed text-ink-soft">
            Describe what you need in plain words. Cabinet finds the relevant past work itself —
            you don't have to look anything up or attach anything.
          </p>
        </header>

        <Card bodyClass="p-5">
          <textarea
            className="field min-h-[132px] resize-y text-[14px] leading-relaxed"
            placeholder="A fixed-price proposal for… covering… over…"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) run(); }}
            aria-label="Describe the document you need"
          />
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-[11.5px] text-ink-faint">
              {brand.name ? `Signed as ${brand.name}` : 'Set your branding in Settings so the document carries your logo'}
              {' · '}<kbd className="font-mono">⌘↵</kbd> to generate
            </p>
            <Button tone="brass" size="lg" icon={running ? undefined : 'sparkle'} onClick={run} disabled={running}>
              {running ? <><Spinner /> Working…</> : 'Generate draft'}
            </Button>
          </div>

          {running && (
            <ol className="mt-5 space-y-2 border-t border-rule pt-4">
              {STAGES.map(([key, label]) => (
                <li key={key} className="flex items-center gap-2.5 text-[12.5px]">
                  <span className={`flex h-4 w-4 items-center justify-center rounded-full
                    ${stage[key] === 'done' ? 'bg-ledger text-white'
                    : stage[key] === 'running' ? 'bg-brass text-white' : 'bg-paper-sunk text-ink-faint'}`}
                  >
                    {stage[key] === 'done' ? <Icon name="check" size={10} />
                      : stage[key] === 'running' ? <Spinner size={9} /> : null}
                  </span>
                  <span className={stage[key] ? 'text-ink' : 'text-ink-faint'}>{label}</span>
                </li>
              ))}
            </ol>
          )}
        </Card>

        <div className="mt-6">
          <p className="label">Try one of these</p>
          <div className="space-y-2">
            {EXAMPLES.map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => setPrompt(e)}
                className="block w-full rounded-lg border border-rule bg-paper-raised px-4 py-2.5 text-left
                  text-[12.5px] text-ink-soft transition hover:border-rule-strong hover:text-ink"
              >
                {e}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  /* ------------------------------------------------------------ draft view */
  const { draft, trace, entity, usedModel } = result;

  return (
    <div className="mx-auto max-w-[1240px] px-8 pb-16 pt-9">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <Button size="sm" tone="ghost" icon="back" className="-ml-2 mb-1" onClick={() => setResult(null)}>
            Start over
          </Button>
          <h1 className="text-[24px] font-bold tracking-[-.02em]">{draft.title}</h1>
          <p className="mt-1 text-[12.5px] text-ink-soft">
            {plural(trace.hits.length, 'passage')} of past work used
            {entity.status === 'new' && ' · this client is new, so only reusable material was available'}
            {!usedModel && ' · assembled from retrieved passages'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button icon="eye" onClick={openPreview}>Preview</Button>
          <Button icon="library" onClick={saveToLibrary}>Save to library</Button>
          <Button icon="download" disabled={unpriced > 0} onClick={() => exportAs('word')}>Word</Button>
          <Button tone="accent" icon="download" disabled={unpriced > 0} onClick={() => exportAs('pdf')}>PDF</Button>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1.45fr_1fr]">
        <div className="min-w-0 space-y-5">
          <Card title="Sections" note="Edit anything — the preview and exports follow." bodyClass="p-5 space-y-5">
            {draft.sections.map((s, i) => (
              <div key={s.heading + i}>
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <h4 className="text-[13px] font-semibold">{s.heading}</h4>
                  <Button
                    size="sm"
                    tone="ghost"
                    icon="image"
                    onClick={() => pickAsset('plate', i)}
                  >
                    {assets.plates[i] ? 'Change photo' : 'Add photo'}
                  </Button>
                </div>
                <textarea
                  className="field min-h-[104px] resize-y leading-relaxed"
                  value={s.body}
                  onChange={(e) => {
                    const body = e.target.value;
                    setResult((r) => ({
                      ...r,
                      draft: { ...r.draft, sections: r.draft.sections.map((x, j) => (j === i ? { ...x, body } : x)) },
                    }));
                  }}
                  aria-label={s.heading}
                />
                {s.citations && s.citations.length > 0 && (
                  <p className="mt-1.5 text-[11px] text-ink-faint">
                    Drawn from {s.citations.join(', ')}
                  </p>
                )}
              </div>
            ))}

            <div>
              <h4 className="mb-1.5 text-[13px] font-semibold">Terms</h4>
              <textarea
                className="field min-h-[80px] resize-y leading-relaxed"
                value={draft.terms || ''}
                onChange={(e) => setResult((r) => ({ ...r, draft: { ...r.draft, terms: e.target.value } }))}
                aria-label="Terms"
              />
            </div>
          </Card>

          <Card
            title="Line items"
            note="You set the prices"
            right={<span className="chip">{money(total, currency)}</span>}
            bodyClass="p-0"
          >
            <div className={`mx-5 mt-4 rounded-lg border px-3.5 py-2.5 text-[12px] leading-relaxed
              ${unpriced ? 'border-brass/35 bg-brass-wash text-brass-deep' : 'border-ledger/30 bg-ledger-wash text-ledger-deep'}`}
            >
              {unpriced
                ? `Prices are never written for you. ${plural(unpriced, 'line')} still ${unpriced === 1 ? 'needs' : 'need'} a price — downloads unlock once every line has one.`
                : 'Every line has a price. Totals are calculated here, not written by a model.'}
            </div>

            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="text-left text-[10.5px] uppercase tracking-[.09em] text-ink-faint">
                  <th className="px-5 pb-2 pt-4 font-semibold">Description</th>
                  <th className="w-[64px] pb-2 pt-4 font-semibold">Qty</th>
                  <th className="w-[108px] pb-2 pt-4 font-semibold">Unit price</th>
                  <th className="w-[92px] pb-2 pt-4 text-right font-semibold">Amount</th>
                  <th className="w-[44px] pb-2 pr-5 pt-4" />
                </tr>
              </thead>
              <tbody>
                {items.map((it, i) => {
                  const set = (key, value) => setItems((list) => list.map((x, j) => (j === i ? { ...x, [key]: value } : x)));
                  const amount = (Number(it.qty) || 0) * (Number(it.unitPrice) || 0);
                  return (
                    <tr key={i} className="border-t border-rule align-top">
                      <td className="px-5 py-2.5">
                        <input className="field" value={it.description} onChange={(e) => set('description', e.target.value)} aria-label={`Description ${i + 1}`} />
                        {it.basis && <p className="mt-1 text-[10.5px] text-ink-faint">{it.basis}</p>}
                      </td>
                      <td className="py-2.5 pr-2">
                        <input className="field" type="number" min="0" value={it.qty} onChange={(e) => set('qty', e.target.value === '' ? '' : Number(e.target.value))} aria-label={`Quantity ${i + 1}`} />
                      </td>
                      <td className="py-2.5 pr-2">
                        <input
                          className={`field ${it.unitPrice == null || it.unitPrice === '' ? 'border-brass/50 bg-brass-wash' : ''}`}
                          type="number" min="0" step="0.01" placeholder="—"
                          value={it.unitPrice == null ? '' : it.unitPrice}
                          onChange={(e) => set('unitPrice', e.target.value === '' ? null : Number(e.target.value))}
                          aria-label={`Unit price ${i + 1}`}
                        />
                      </td>
                      <td className="py-[18px] pr-1 text-right font-medium tabular-nums">
                        {it.unitPrice == null || it.unitPrice === '' ? '—' : money(amount, currency)}
                      </td>
                      <td className="py-3 pr-5">
                        <Button size="sm" tone="ghost" icon="x" aria-label={`Remove line ${i + 1}`}
                          onClick={() => setItems((list) => list.filter((_, j) => j !== i))} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <div className="border-t border-rule p-4">
              <Button size="sm" icon="plus"
                onClick={() => setItems((l) => [...l, { description: '', qty: 1, unit: '', unitPrice: null, basis: '' }])}>
                Add a line
              </Button>
            </div>
          </Card>
        </div>

        <div className="space-y-5">
          <Card title="Imagery" note="Placeholders print cleanly if you leave them." bodyClass="p-4 space-y-2">
            <AssetRow label="Cover photograph" value={assets.hero} onPick={() => pickAsset('hero')}
              onClear={() => setAssets((a) => ({ ...a, hero: null }))} />
            <AssetRow label="Client logo" value={assets.clientLogo} onPick={() => pickAsset('clientLogo')}
              onClear={() => setAssets((a) => ({ ...a, clientLogo: null }))} />
            <AssetRow label="Your logo" value={brand.logo} locked onPick={() => go('settings')} />
          </Card>

          <Card title="What Cabinet read to write this" bodyClass="p-4">
            <p className="mb-3 text-[11.5px] leading-relaxed text-ink-soft">
              Searched {trace.searched} passages. Kept {trace.hits.length}: {trace.counts.own} from this
              client, {trace.counts.comparable} from comparable work, {trace.counts.keyword} from keyword matching.
            </p>
            <ul className="space-y-1.5">
              {trace.hits.map((h) => (
                <li key={h.id} className="rounded-md border border-rule bg-paper-sunk/60 px-2.5 py-2">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-[11.5px] font-medium">{h.title}</span>
                    <span className="shrink-0 font-mono text-[10px] text-ink-faint">{h.score.toFixed(3)}</span>
                  </div>
                  <p className="mt-0.5 text-[10.5px] text-ink-faint">{h.company} · {h.section} · {h.via}</p>
                </li>
              ))}
              {!trace.hits.length && (
                <li className="text-[12px] text-ink-faint">
                  Nothing in the library matched. The draft was written from your request alone.
                </li>
              )}
            </ul>

            {trace.excluded.length > 0 && (
              <div className="mt-3 rounded-md border border-rule bg-paper-sunk px-3 py-2 text-[11px] text-ink-soft">
                <b className="mb-0.5 block">Deliberately excluded</b>
                {trace.excluded.join(' · ')}
              </div>
            )}
            {trace.checks.length > 0 && (
              <div className="mt-2 rounded-md border border-brass/35 bg-brass-wash px-3 py-2 text-[11px] text-brass-deep">
                <b className="mb-0.5 block">Checks applied</b>
                {trace.checks.join(' · ')}
              </div>
            )}
          </Card>
        </div>
      </div>

      {showPreview && preview && (
        <PreviewOverlay html={preview} onClose={() => setShowPreview(false)} onExport={exportAs} disabled={unpriced > 0} />
      )}
    </div>
  );
}

const AssetRow = ({ label, value, onPick, onClear, locked }) => (
  <div className="flex items-center gap-3 rounded-lg border border-rule bg-paper-sunk/50 p-2">
    <div className="flex h-11 w-16 shrink-0 items-center justify-center overflow-hidden rounded border border-rule bg-white">
      {value
        ? <img src={value} alt="" className="max-h-full max-w-full object-contain" />
        : <Icon name="image" size={16} className="text-ink-faint" />}
    </div>
    <div className="min-w-0 flex-1">
      <p className="text-[12px] font-medium">{label}</p>
      <p className="text-[10.5px] text-ink-faint">{value ? 'Set' : 'Placeholder will print'}</p>
    </div>
    <Button size="sm" tone="ghost" onClick={onPick}>{locked ? 'Settings' : value ? 'Change' : 'Add'}</Button>
    {value && !locked && <Button size="sm" tone="ghost" icon="x" aria-label={`Remove ${label}`} onClick={onClear} />}
  </div>
);

function PreviewOverlay({ html, onClose, onExport, disabled }) {
  const frame = useRef(null);
  useEscape(onClose);
  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-slate-950/70 backdrop-blur-sm" role="dialog" aria-modal="true">
      <div className="flex items-center justify-between gap-3 px-5 py-3">
        <p className="text-[13px] font-semibold text-white">Document preview — exactly what exports</p>
        <div className="flex gap-2">
          <Button size="sm" tone="quiet" className="!border-white/25 !bg-white/10 !text-white hover:!bg-white/20"
            icon="download" disabled={disabled} onClick={() => onExport('pdf')}>PDF</Button>
          <Button size="sm" tone="quiet" className="!border-white/25 !bg-white/10 !text-white hover:!bg-white/20"
            icon="x" onClick={onClose}>Close</Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 px-5 pb-5">
        <iframe
          ref={frame}
          title="Document preview"
          srcDoc={html}
          sandbox=""
          className="h-full w-full rounded-lg border border-white/10 bg-white"
        />
      </div>
    </div>
  );
}
