import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Card, Empty, Icon, Spinner, useToast } from '../components/ui';
import { api, isDesktop } from '../lib/api';
import { money as fmtMoney } from '../lib/pricing-shared';

/*
 * The catalog dashboard.
 *
 * Every vendor the deck can show is created and edited here. The forms are
 * described as data rather than written out one by one, so adding a field to a
 * category is a line in this table instead of a new form component — and every
 * category behaves identically, which is what makes it learnable.
 */

const money = (n) => fmtMoney(n, 'RM ');

const num = (v) => (v === '' || v == null ? null : Number(v));

const RATE_TYPES = [
  ['per_head', 'Per person'],
  ['flat', 'Flat rate'],
  ['per_day', 'Per day'],
];

/* The schema of the interface. `cost` and `price` name the two money columns
   for each category, because they are not called the same thing in each table. */
const CATEGORIES = [
  {
    key: 'hotels', table: 'hotels', label: 'Hotels', icon: 'folder', owner: 'hotel',
    sub: 'Rooms are priced separately, on each hotel.',
    fields: [
      { name: 'name', label: 'Hotel name', span: 2, required: true },
      { name: 'location_id', label: 'Location', type: 'location' },
      { name: 'star_rating', label: 'Stars', type: 'number' },
      { name: 'address', label: 'Address', span: 2 },
      { name: 'amenities', label: 'What the venue offers', type: 'textarea', span: 2, hint: 'One per line — these become the bullet points on the slide.' },
      { name: 'notes', label: 'Internal notes', span: 2, hint: 'Never appears in a proposal.' },
    ],
    summary: (h) => `${'★'.repeat(h.star_rating || 0)} ${h.address || ''}`,
  },
  {
    key: 'venues', table: 'venues', label: 'Venues', icon: 'library', owner: 'venue',
    sub: 'Ballrooms, function rooms and outdoor spaces.',
    cost: 'cost_price', price: 'client_price',
    fields: [
      { name: 'name', label: 'Venue name', span: 2, required: true },
      { name: 'location_id', label: 'Location', type: 'location' },
      { name: 'kind', label: 'Kind', type: 'select', options: [['ballroom', 'Ballroom'], ['function room', 'Function room'], ['outdoor', 'Outdoor']] },
      { name: 'capacity', label: 'Capacity (guests)', type: 'number' },
      { name: 'rate_type', label: 'Charged', type: 'select', options: RATE_TYPES },
      { name: 'description', label: 'Description', type: 'textarea', span: 2 },
    ],
    summary: (v) => `${v.kind || ''} · up to ${v.capacity || '—'} guests`,
  },
  {
    key: 'mcs', table: 'mcs', label: 'Hosts & MCs', icon: 'pen', owner: 'mc',
    sub: 'Charged per day.',
    cost: 'cost_price', price: 'day_rate',
    fields: [
      { name: 'name', label: 'Name', span: 2, required: true },
      { name: 'headline', label: 'Headline', span: 2, hint: 'One line, shown large beside the headshot.' },
      { name: 'languages', label: 'Languages', hint: 'Comma separated — each becomes a badge.' },
      { name: 'years', label: 'Years hosting', type: 'number' },
      { name: 'bio', label: 'Biography', type: 'textarea', span: 2 },
    ],
    summary: (m) => `${m.headline || ''}${m.languages ? ` · ${m.languages}` : ''}`,
  },
  {
    key: 'activities', table: 'activities', label: 'Activities', icon: 'sparkle', owner: 'activity',
    sub: 'Team building, gala and conference items.',
    cost: 'cost_price', price: 'rate',
    fields: [
      { name: 'name', label: 'Activity name', span: 2, required: true },
      { name: 'category', label: 'Category', type: 'select', options: [['team building', 'Team building'], ['gala', 'Gala'], ['conference', 'Conference']] },
      { name: 'rate_type', label: 'Charged', type: 'select', options: RATE_TYPES },
      { name: 'duration_mins', label: 'Duration (minutes)', type: 'number' },
      { name: 'indoor', label: 'Indoor', type: 'select', options: [['0', 'Outdoor'], ['1', 'Indoor']] },
      { name: 'pax_min', label: 'Minimum pax', type: 'number' },
      { name: 'pax_max', label: 'Maximum pax', type: 'number' },
      { name: 'summary', label: 'Description', type: 'textarea', span: 2, hint: 'Two or three sentences — this is the text on the slide.' },
      { name: 'gear', label: 'Equipment provided', span: 2 },
    ],
    summary: (a) => `${a.category || ''} · ${a.duration_mins ? `${Math.round(a.duration_mins / 60 * 10) / 10}h` : '—'} · ${a.pax_min || 0}–${a.pax_max || '∞'} pax`,
  },
  {
    key: 'logistics', table: 'logistics', label: 'Production', icon: 'gear', owner: null,
    sub: 'Sound, lighting, staging and transport.',
    cost: 'cost_price', price: 'rate',
    fields: [
      { name: 'name', label: 'Item', span: 2, required: true },
      { name: 'category', label: 'Category', type: 'select', options: [['audio', 'Audio'], ['lighting', 'Lighting'], ['staging', 'Staging'], ['transport', 'Transport']] },
      { name: 'rate_type', label: 'Charged', type: 'select', options: RATE_TYPES },
      { name: 'spec', label: 'Specification', type: 'textarea', span: 2 },
    ],
    summary: (l) => `${l.category || ''} · ${l.spec || ''}`,
  },
];

export default function Inventory() {
  const toast = useToast();
  const [tab, setTab] = useState('hotels');
  const [items, setItems] = useState([]);
  const [locations, setLocations] = useState([]);
  const [editing, setEditing] = useState(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');

  const category = CATEGORIES.find((c) => c.key === tab);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [rows, locs] = await Promise.all([
        tab === 'hotels' ? api.catalog.hotels()
          : tab === 'venues' ? api.catalog.venues()
            : tab === 'mcs' ? api.catalog.mcs()
              : tab === 'activities' ? api.catalog.activities()
                : api.catalog.logistics(),
        api.catalog.locations(),
      ]);
      setItems(rows); setLocations(locs);
    } catch (err) { toast(err.message, 'error'); }
    setLoading(false);
  }, [tab, toast]);

  useEffect(() => { load(); setEditing(null); }, [load]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((i) => JSON.stringify(i).toLowerCase().includes(q));
  }, [items, query]);

  async function save(values) {
    try {
      if (editing.id) await api.catalog.update(category.table, editing.id, values);
      else {
        const id = await api.catalog.create(category.table, values);
        setEditing({ ...editing, id, ...values });
        await load();
        toast('Added to the catalog.', 'good');
        return;
      }
      await load();
      toast('Saved.', 'good');
    } catch (err) { toast(err.message, 'error'); }
  }

  async function remove(item) {
    try {
      await api.catalog.remove(category.table, item.id);
      setEditing(null);
      await load();
      toast(`${item.name} removed. Its photographs are left on disk.`);
    } catch (err) { toast(err.message, 'error'); }
  }

  return (
    <div className="mx-auto max-w-[1240px] px-8 pb-16 pt-9">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[.16em] text-ink-faint">Inventory</p>
          <h1 className="mt-1.5 text-[27px] font-bold tracking-[-.025em]">Catalog and assets</h1>
          <p className="mt-2 max-w-[70ch] text-[14px] leading-relaxed text-ink-soft">
            Everything a proposal can contain. Each item carries what it costs you and what
            the client is shown — the difference is your margin, and it never leaves this screen.
          </p>
        </div>
        <Button tone="accent" icon="plus" onClick={() => setEditing({ id: null })}>
          Add {category.label.replace(/s$/, '').toLowerCase()}
        </Button>
      </header>

      <div className="mb-5 flex flex-wrap items-center gap-1.5">
        {CATEGORIES.map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => setTab(c.key)}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-semibold transition
              ${tab === c.key ? 'bg-ink text-paper-raised' : 'text-ink-soft hover:bg-ink/[.05]'}`}
          >
            <Icon name={c.icon} size={14} />{c.label}
          </button>
        ))}
        <label className="relative ml-auto">
          <Icon name="search" size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint" />
          <input className="field w-[240px] pl-8" placeholder={`Search ${category.label.toLowerCase()}`}
            value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_420px]">
        <Card title={category.label} note={category.sub} right={<span className="chip">{visible.length}</span>} bodyClass="p-0">
          {loading ? (
            <div className="flex items-center gap-2 p-5 text-[13px] text-ink-soft"><Spinner /> Loading…</div>
          ) : visible.length === 0 ? (
            <Empty icon="folder" title={`No ${category.label.toLowerCase()} yet`}>
              Add the first one and it becomes available to every proposal.
            </Empty>
          ) : (
            <ul className="divide-y divide-rule">
              {visible.map((item) => (
                <li key={item.id}>
                  <button type="button" onClick={() => setEditing(item)}
                    className={`flex w-full items-center gap-3 px-5 py-3.5 text-left transition hover:bg-ink/[.03]
                      ${editing && editing.id === item.id ? 'bg-ledger-wash' : ''}`}>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13.5px] font-semibold">{item.name}</span>
                      <span className="block truncate text-[11.5px] text-ink-faint">{category.summary(item)}</span>
                    </span>
                    {category.price && (
                      <span className="shrink-0 text-right">
                        <span className="block text-[12.5px] font-semibold">{money(item[category.price])}</span>
                        <Margin cost={item[category.cost]} price={item[category.price]} />
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div>
          {editing ? (
            <ItemEditor
              key={editing.id || 'new'}
              category={category}
              item={editing}
              locations={locations}
              onSave={save}
              onDelete={() => remove(editing)}
              onClose={() => setEditing(null)}
              onChanged={load}
            />
          ) : (
            <Card bodyClass="p-0">
              <Empty icon="pen" title="Nothing selected">
                Choose an item to edit it, or add a new one. Photographs are copied into the
                app's own folder, so tidying your Desktop later cannot empty your catalog.
              </Empty>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

const Margin = ({ cost, price }) => {
  const c = Number(cost) || 0;
  const p = Number(price) || 0;
  if (!p) return null;
  if (!c) return <span className="block text-[10.5px] text-brass-deep">no cost set</span>;
  const pct = Math.round(((p - c) / p) * 1000) / 10;
  return <span className={`block text-[10.5px] ${pct <= 0 ? 'text-brick' : 'text-ink-faint'}`}>{pct}% margin</span>;
};

function ItemEditor({ category, item, locations, onSave, onDelete, onClose, onChanged }) {
  const toast = useToast();
  const [values, setValues] = useState(() => ({ ...item }));
  const [images, setImages] = useState([]);
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setValues((s) => ({ ...s, [k]: v }));

  const loadImages = useCallback(async () => {
    if (!category.owner || !item.id) { setImages([]); return; }
    try {
      const list = (item.images || []);
      const withData = await Promise.all(list.map(async (im) => ({ ...im, data: await api.catalog.imageData(im.path) })));
      setImages(withData);
    } catch { setImages([]); }
  }, [category.owner, item]);

  useEffect(() => { loadImages(); }, [loadImages]);

  const missing = category.fields.filter((f) => f.required && !String(values[f.name] || '').trim());

  async function addImages() {
    setBusy(true);
    try {
      const added = await api.catalog.importImages(category.owner, item.id);
      if (added.length) { toast(`${added.length} photograph${added.length === 1 ? '' : 's'} added.`, 'good'); await onChanged(); }
    } catch (err) { toast(err.message, 'error'); }
    setBusy(false);
  }

  async function dropImage(id) {
    try { await api.catalog.removeImage(id, false); setImages((l) => l.filter((i) => i.id !== id)); await onChanged(); }
    catch (err) { toast(err.message, 'error'); }
  }

  return (
    <Card
      title={item.id ? item.name || 'Edit' : `New ${category.label.replace(/s$/, '').toLowerCase()}`}
      note={item.id ? 'Changes apply to proposals made from now on.' : 'This becomes available to every proposal.'}
      right={<Button size="sm" tone="ghost" icon="x" aria-label="Close" onClick={onClose} />}
      bodyClass="p-5 space-y-4"
    >
      <div className="grid grid-cols-2 gap-3">
        {category.fields.map((f) => (
          <Field key={f.name} field={f} value={values[f.name]} locations={locations}
            onChange={(v) => set(f.name, v)} />
        ))}
      </div>

      {category.price && (
        <div className="rounded-lg border border-rule bg-paper-sunk/60 p-3.5">
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="label">Your cost</span>
              <input className="field" type="number" step="0.01" min="0"
                value={values[category.cost] ?? ''} onChange={(e) => set(category.cost, num(e.target.value))} />
            </label>
            <label className="block">
              <span className="label">Client price</span>
              <input className="field" type="number" step="0.01" min="0"
                value={values[category.price] ?? ''} onChange={(e) => set(category.price, num(e.target.value))} />
            </label>
          </div>
          <p className="mt-2 text-[11.5px] text-ink-soft">
            {Number(values[category.price]) > 0 && Number(values[category.cost]) > 0 ? (
              <>Margin <b>{money(Number(values[category.price]) - Number(values[category.cost]))}</b>
                {' '}({Math.round(((values[category.price] - values[category.cost]) / values[category.price]) * 1000) / 10}%).
                {' '}Only the client price is ever printed in a proposal.</>
            ) : 'Set both and the margin appears here. Only the client price is ever printed in a proposal.'}
          </p>
        </div>
      )}

      {category.owner && (
        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="label !mb-0">Photographs</span>
            {item.id && (
              <Button size="sm" icon={busy ? undefined : 'image'} onClick={addImages} disabled={busy}>
                {busy ? <><Spinner /> Copying…</> : 'Add photographs'}
              </Button>
            )}
          </div>
          {!item.id ? (
            <p className="text-[11.5px] text-ink-faint">Save this first, then photographs can be attached to it.</p>
          ) : images.length === 0 ? (
            <p className="text-[11.5px] text-ink-faint">
              None yet — the slide will show a framed placeholder. The first picture is used as the main image.
            </p>
          ) : (
            <ul className="grid grid-cols-3 gap-2">
              {images.map((im, i) => (
                <li key={im.id} className="group relative overflow-hidden rounded-md border border-rule">
                  {im.data
                    ? <img src={im.data} alt="" className="h-20 w-full object-cover" />
                    : <div className="flex h-20 items-center justify-center text-[10px] text-ink-faint">missing</div>}
                  {i === 0 && <span className="absolute left-1 top-1 rounded bg-slate-950/70 px-1.5 py-px text-[9px] font-semibold text-white">MAIN</span>}
                  <button type="button" onClick={() => dropImage(im.id)}
                    className="absolute right-1 top-1 rounded bg-slate-950/70 p-1 text-white opacity-0 transition group-hover:opacity-100"
                    aria-label="Remove photograph">
                    <Icon name="x" size={11} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {missing.length > 0 && (
        <p className="text-[11.5px] text-brass-deep">{missing.map((f) => f.label).join(', ')} still needed.</p>
      )}

      <div className="flex gap-2 border-t border-rule pt-4">
        <Button tone="accent" icon="check" className="flex-1" disabled={missing.length > 0}
          onClick={() => onSave(values)}>
          {item.id ? 'Save changes' : 'Add to catalog'}
        </Button>
        {item.id && <Button tone="danger" icon="trash" onClick={onDelete}>Remove</Button>}
      </div>
    </Card>
  );
}

function Field({ field: f, value, onChange, locations }) {
  const span = f.span === 2 ? 'col-span-2' : '';
  const common = 'field';
  return (
    <label className={`block ${span}`}>
      <span className="label">{f.label}{f.required ? ' *' : ''}</span>
      {f.type === 'textarea' ? (
        <textarea className={`${common} min-h-[80px] resize-y`} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
      ) : f.type === 'select' ? (
        <select className={common} value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
          <option value="">—</option>
          {f.options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      ) : f.type === 'location' ? (
        <select className={common} value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
          <option value="">—</option>
          {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
      ) : (
        <input className={common} type={f.type === 'number' ? 'number' : 'text'} value={value ?? ''}
          onChange={(e) => onChange(f.type === 'number' ? num(e.target.value) : e.target.value)} />
      )}
      {f.hint && <span className="mt-1 block text-[10.5px] leading-relaxed text-ink-faint">{f.hint}</span>}
    </label>
  );
}
