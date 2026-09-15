import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Card, Empty, Icon, Spinner, useToast } from '../components/ui';
import { api, isDesktop } from '../lib/api';
import { TYPE_LABEL, TYPE_TONE, bytes, plural, shortDate } from '../lib/format';

export default function Library({ go }) {
  const toast = useToast();
  const [companies, setCompanies] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [active, setActive] = useState(null);
  const [open, setOpen] = useState(null);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [co, docs] = await Promise.all([api.library.companies(), api.library.documents(null)]);
      setCompanies(co);
      setDocuments(docs);
    } catch (err) { toast(err.message, 'error'); }
    setLoading(false);
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return documents.filter((d) => (
      (!active || d.company === active)
      && (!q || `${d.title} ${d.company} ${d.preview || ''}`.toLowerCase().includes(q))
    ));
  }, [documents, active, query]);

  async function show(id) {
    try { setOpen(await api.library.document(id)); }
    catch (err) { toast(err.message, 'error'); }
  }

  async function toggleReuse(doc) {
    const next = doc.confidentiality === 'shareable' ? 'internal' : 'shareable';
    try {
      await api.library.setConfidentiality(doc.id, next);
      setDocuments((list) => list.map((d) => (d.id === doc.id ? { ...d, confidentiality: next } : d)));
      if (open && open.id === doc.id) setOpen({ ...open, confidentiality: next });
      toast(next === 'shareable'
        ? 'Wording from this document may now be reused for other clients. Pricing never is.'
        : 'This document is internal again.', 'good');
    } catch (err) { toast(err.message, 'error'); }
  }

  async function remove(doc) {
    try {
      await api.library.remove(doc.id);
      setDocuments((list) => list.filter((d) => d.id !== doc.id));
      if (open && open.id === doc.id) setOpen(null);
      toast('Removed from the index. The file on disk is untouched.');
      load();
    } catch (err) { toast(err.message, 'error'); }
  }

  if (loading) {
    return <div className="flex items-center gap-2 px-8 pt-10 text-[13px] text-ink-soft"><Spinner /> Opening the library…</div>;
  }

  if (!documents.length) {
    return (
      <div className="mx-auto max-w-[900px] px-8 pt-16">
        <Card>
          <Empty icon="library" title="The library is empty">
            Scan a folder on the filing desk and send the documents here. Everything Cabinet writes
            later is drawn from what lives in this library.
          </Empty>
          <div className="flex justify-center pb-6">
            <Button tone="accent" icon="scan" size="lg" onClick={() => go('scanner')}>Go to the filing desk</Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-[1240px] gap-6 px-8 pb-16 pt-9">
      <aside className="w-[210px] shrink-0">
        <p className="label">Companies</p>
        <ul className="space-y-0.5">
          <CompanyRow label="All companies" count={documents.length} active={!active} onClick={() => setActive(null)} />
          {companies.map((c) => (
            <CompanyRow
              key={c.name}
              label={c.name}
              count={c.documents}
              active={active === c.name}
              onClick={() => setActive(c.name)}
            />
          ))}
        </ul>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-[22px] font-bold tracking-[-.02em]">{active || 'Library'}</h1>
            <p className="mt-1 text-[13px] text-ink-soft">
              {plural(visible.length, 'document')} · mark a document reusable to let its wording
              seed other clients' proposals. Pricing is never reused.
            </p>
          </div>
          <label className="relative">
            <Icon name="search" size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint" />
            <input
              className="field w-[260px] pl-8"
              placeholder="Search titles and contents"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search the library"
            />
          </label>
        </header>

        <Card bodyClass="p-0">
          {visible.length === 0 ? (
            <Empty icon="search" title="Nothing matches">Try a different search, or clear the company filter.</Empty>
          ) : (
            <ul className="divide-y divide-rule">
              {visible.map((d) => (
                <li key={d.id} className="flex items-center gap-3 px-5 py-3.5">
                  <span className={`chip shrink-0 border ${TYPE_TONE[d.doc_type] || TYPE_TONE.other}`}>
                    {TYPE_LABEL[d.doc_type] || 'Other'}
                  </span>
                  <button type="button" onClick={() => show(d.id)} className="min-w-0 flex-1 text-left">
                    <p className="truncate text-[13px] font-medium hover:underline">{d.title}</p>
                    <p className="truncate text-[11.5px] text-ink-faint">
                      {d.company} · {shortDate(d.doc_date || d.created_at)}
                      {d.origin === 'generated' && ' · written here'}
                      {d.bytes ? ` · ${bytes(d.bytes)}` : ''}
                    </p>
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleReuse(d)}
                    title={d.confidentiality === 'shareable'
                      ? 'Reusable for other clients — click to make internal'
                      : 'Internal only — click to allow reuse'}
                    className={`chip shrink-0 transition ${d.confidentiality === 'shareable'
                      ? 'border-ledger/30 bg-ledger-wash text-ledger-deep' : 'hover:border-rule-strong'}`}
                  >
                    <Icon name="shield" size={12} />
                    {d.confidentiality === 'shareable' ? 'reusable' : 'internal'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {open && (
        <DocumentPane
          doc={open}
          onClose={() => setOpen(null)}
          onToggleReuse={() => toggleReuse(open)}
          onRemove={() => remove(open)}
        />
      )}
    </div>
  );
}

const CompanyRow = ({ label, count, active, onClick }) => (
  <li>
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12.5px] transition
        ${active ? 'bg-ink text-paper-raised font-semibold' : 'text-ink-soft hover:bg-ink/[.05] hover:text-ink'}`}
    >
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className={active ? 'text-paper/60' : 'text-ink-faint'}>{count}</span>
    </button>
  </li>
);

function DocumentPane({ doc, onClose, onToggleReuse, onRemove }) {
  return (
    <aside className="w-[330px] shrink-0">
      <Card
        title={doc.title}
        note={`${doc.company} · ${shortDate(doc.doc_date || doc.created_at)}`}
        right={<Button size="sm" tone="ghost" icon="x" onClick={onClose} aria-label="Close" />}
        bodyClass="p-0"
      >
        <div className="space-y-2.5 border-b border-rule p-4">
          <Button size="sm" className="w-full" icon="shield" onClick={onToggleReuse}>
            {doc.confidentiality === 'shareable' ? 'Make internal only' : 'Allow reuse for other clients'}
          </Button>
          {isDesktop && doc.filed_path && (
            <div className="flex gap-2">
              <Button size="sm" className="flex-1" icon="eye" onClick={() => api.openPath(doc.filed_path)}>Open</Button>
              <Button size="sm" className="flex-1" icon="folder" onClick={() => api.revealPath(doc.filed_path)}>Reveal</Button>
            </div>
          )}
          <Button size="sm" tone="danger" className="w-full" icon="trash" onClick={onRemove}>
            Remove from index
          </Button>
        </div>
        <div className="scroll-thin max-h-[52vh] overflow-y-auto p-4">
          <p className="label">Extracted text</p>
          <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-ink-soft">
            {doc.body || '(no text)'}
          </pre>
        </div>
      </Card>
    </aside>
  );
}
