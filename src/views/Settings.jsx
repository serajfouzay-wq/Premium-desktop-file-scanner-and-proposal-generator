import React, { useEffect, useState } from 'react';
import { Button, Card, Icon, useToast } from '../components/ui';
import { api, isDesktop } from '../lib/api';

export default function Settings({ settings, refreshSettings }) {
  const toast = useToast();
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [info, setInfo] = useState(null);

  useEffect(() => { if (settings) setForm(structuredClone(settings)); }, [settings]);
  useEffect(() => { if (isDesktop) api.info().then(setInfo).catch(() => {}); }, []);

  if (!form) return <div className="px-8 pt-10 text-[13px] text-ink-soft">Loading settings…</div>;

  const brand = form.brand;
  const setBrand = (patch) => setForm((f) => ({ ...f, brand: { ...f.brand, ...patch } }));

  async function save() {
    setSaving(true);
    try {
      await api.settings.update(form);
      await refreshSettings();
      toast('Settings saved. New documents carry these details.', 'good');
    } catch (err) { toast(err.message, 'error'); }
    setSaving(false);
  }

  async function chooseRoot() {
    try {
      const next = await api.settings.chooseLibraryRoot();
      if (next) { setForm(structuredClone(next)); await refreshSettings(); toast('Library folder updated.', 'good'); }
    } catch (err) { toast(err.message, 'error'); }
  }

  async function pickLogo() {
    try {
      const img = await api.settings.pickImage();
      if (img) setBrand({ logo: img.dataUri });
    } catch (err) { toast(err.message, 'error'); }
  }

  return (
    <div className="mx-auto max-w-[960px] px-8 pb-16 pt-9">
      <header className="mb-7 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[.16em] text-ink-faint">Settings</p>
          <h1 className="mt-1.5 text-[27px] font-bold tracking-[-.025em]">Branding and storage</h1>
          <p className="mt-2 max-w-[64ch] text-[14px] leading-relaxed text-ink-soft">
            Set once. Your logo and details appear on every document Cabinet writes from now on —
            documents already written keep the branding they were made with.
          </p>
        </div>
        <Button tone="accent" size="lg" icon="check" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save settings'}
        </Button>
      </header>

      <div className="grid gap-5 lg:grid-cols-[1.25fr_1fr]">
        <div className="space-y-5">
          <Card title="Your identity" note="Shown in the header of every generated document." bodyClass="p-5">
            <div className="mb-5 flex items-center gap-4">
              <div className="flex h-[70px] w-[132px] shrink-0 items-center justify-center overflow-hidden rounded-lg border border-dashed border-rule-strong bg-paper-sunk">
                {brand.logo
                  ? <img src={brand.logo} alt="Your logo" className="max-h-full max-w-full object-contain" />
                  : <Icon name="image" size={22} className="text-ink-faint" />}
              </div>
              <div className="space-y-2">
                <Button size="sm" icon="image" onClick={pickLogo}>{brand.logo ? 'Replace logo' : 'Add your logo'}</Button>
                {brand.logo && <Button size="sm" tone="ghost" icon="x" onClick={() => setBrand({ logo: null })}>Remove</Button>}
                <p className="max-w-[34ch] text-[11px] leading-relaxed text-ink-faint">
                  PNG with a transparent background works best. Up to 6 MB.
                </p>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Company name" value={brand.name} onChange={(v) => setBrand({ name: v })} className="sm:col-span-2" />
              <Field label="Tagline" value={brand.tagline} onChange={(v) => setBrand({ tagline: v })} className="sm:col-span-2" />
              <Field label="Address" value={brand.address} onChange={(v) => setBrand({ address: v })} className="sm:col-span-2" />
              <Field label="Phone" value={brand.phone} onChange={(v) => setBrand({ phone: v })} />
              <Field label="Email" value={brand.email} onChange={(v) => setBrand({ email: v })} />
              <Field label="Website" value={brand.website} onChange={(v) => setBrand({ website: v })} />
              <div>
                <span className="label">Accent colour</span>
                <div className="flex gap-2">
                  <input type="color" value={brand.accent || '#1F6E62'}
                    onChange={(e) => setBrand({ accent: e.target.value })}
                    className="h-[38px] w-[52px] cursor-pointer rounded-md border border-rule bg-white p-1"
                    aria-label="Accent colour" />
                  <input className="field font-mono" value={brand.accent || ''} onChange={(e) => setBrand({ accent: e.target.value })} />
                </div>
              </div>
              <Field label="Currency symbol" value={brand.currency} onChange={(v) => setBrand({ currency: v })} />
              <Field label="Payment terms (days)" type="number" value={brand.paymentDays}
                onChange={(v) => setBrand({ paymentDays: Number(v) || 0 })} />
              <div className="sm:col-span-2">
                <span className="label">Default terms</span>
                <textarea className="field min-h-[74px] resize-y" value={brand.defaultTerms || ''}
                  onChange={(e) => setBrand({ defaultTerms: e.target.value })}
                  placeholder="Used when nothing suitable is found in past work" />
              </div>
            </div>
          </Card>

          <Card title="Drafting model" note="Optional. Without a key, Cabinet assembles drafts from the passages it retrieved." bodyClass="p-5 space-y-3">
            <label className="flex items-start gap-2.5">
              <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[#1F6E62]"
                checked={!!form.model.enabled}
                onChange={(e) => setForm((f) => ({ ...f, model: { ...f.model, enabled: e.target.checked } }))} />
              <span className="text-[13px] leading-relaxed">
                Use a model to write the prose
                <span className="mt-0.5 block text-[11.5px] text-ink-faint">
                  Retrieved passages are sent to the Anthropic API. Prices are never generated
                  either way — that rule applies to the model too.
                </span>
              </span>
            </label>
            <Field label="API key" type="password" value={form.model.apiKey}
              onChange={(v) => setForm((f) => ({ ...f, model: { ...f.model, apiKey: v } }))}
              placeholder="sk-ant-…" />
            <Field label="Model" value={form.model.model}
              onChange={(v) => setForm((f) => ({ ...f, model: { ...f.model, model: v } }))} />
          </Card>
        </div>

        <div className="space-y-5">
          <Card title="Where files are kept" bodyClass="p-5 space-y-3">
            <div>
              <span className="label">Library folder</span>
              <p className="break-all rounded-md border border-rule bg-paper-sunk px-3 py-2 font-mono text-[11.5px] text-ink-soft">
                {form.library.root || 'Not set'}
              </p>
            </div>
            <div className="flex gap-2">
              <Button size="sm" icon="folder" onClick={chooseRoot}>Change folder</Button>
              {isDesktop && form.library.root && (
                <Button size="sm" tone="ghost" icon="eye" onClick={() => api.openPath(form.library.root)}>Open</Button>
              )}
            </div>

            <div className="border-t border-rule pt-3">
              <span className="label">When filing a document</span>
              {[
                ['copy', 'Copy it', 'The original stays exactly where it is. Safest.'],
                ['move', 'Move it', 'The original is relocated into the library.'],
              ].map(([value, title, note]) => (
                <label key={value} className="mb-1.5 flex cursor-pointer items-start gap-2.5 rounded-lg border border-rule p-2.5
                  transition hover:border-rule-strong has-[:checked]:border-ledger has-[:checked]:bg-ledger-wash">
                  <input type="radio" name="filing" value={value} className="mt-0.5 h-4 w-4 accent-[#1F6E62]"
                    checked={form.filing.mode === value}
                    onChange={() => setForm((f) => ({ ...f, filing: { mode: value } }))} />
                  <span>
                    <span className="block text-[12.5px] font-semibold">{title}</span>
                    <span className="block text-[11px] text-ink-faint">{note}</span>
                  </span>
                </label>
              ))}
            </div>
          </Card>

          <Card title="How your header will look" bodyClass="p-5">
            <div className="rounded-lg border border-rule bg-white p-4">
              <div className="flex items-start justify-between gap-3 border-b border-rule pb-3">
                {brand.logo
                  ? <img src={brand.logo} alt="" className="max-h-[38px] max-w-[130px] object-contain" />
                  : <span className="font-serif text-[15px] font-bold">{brand.name || 'Your company'}</span>}
                <div className="text-right text-[9.5px] leading-snug text-ink-faint">
                  <b className="block text-[10.5px] text-ink">Client name</b>Prepared for
                </div>
              </div>
              <p className="mt-3 text-[9px] font-semibold uppercase tracking-[.2em]" style={{ color: brand.accent || '#1F6E62' }}>
                Proposal
              </p>
              <p className="font-serif text-[20px] font-semibold leading-tight tracking-[-.02em]">
                A project for your client
              </p>
              <p className="mt-3 border-t border-rule pt-2 text-[9.5px] text-ink-faint">
                {[brand.address, brand.phone, brand.email, brand.website].filter(Boolean).join(' · ') || 'Your contact details appear here'}
              </p>
            </div>
          </Card>

          {info && (
            <Card title="This installation" bodyClass="p-5 space-y-1.5 text-[11.5px] text-ink-soft">
              <Row k="Version" v={info.version} />
              <Row k="Electron" v={info.electron} />
              <Row k="Database" v={info.storage.engine === 'better-sqlite3' ? 'SQLite (native)' : 'SQLite (WebAssembly)'} />
              <Row k="Data folder" v={info.userData} mono />
              {info.storage.note && (
                <p className="mt-2 rounded border border-rule bg-paper-sunk px-2.5 py-2 text-[10.5px] leading-relaxed">
                  The native SQLite binding didn't load, so the WebAssembly build is in use. Same
                  database file, slightly slower on very large libraries. Run
                  {' '}<code className="font-mono">npx electron-rebuild -f -w better-sqlite3</code> to switch to native.
                </p>
              )}
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

const Field = ({ label, value, onChange, type = 'text', className = '', placeholder }) => (
  <label className={`block ${className}`}>
    <span className="label">{label}</span>
    <input className="field" type={type} value={value == null ? '' : value} placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)} />
  </label>
);

const Row = ({ k, v, mono }) => (
  <div className="flex items-baseline justify-between gap-3">
    <span className="shrink-0 text-ink-faint">{k}</span>
    <span className={`min-w-0 truncate text-right ${mono ? 'font-mono text-[10.5px]' : ''}`} title={v}>{v}</span>
  </div>
);
