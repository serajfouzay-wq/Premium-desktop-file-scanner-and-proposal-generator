import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Card, Empty, Icon, Progress, Spinner, Stat, useToast } from '../components/ui';
import { api, isDesktop } from '../lib/api';
import { TYPE_LABEL, bytes, plural } from '../lib/format';

const TYPES = ['invoice', 'proposal', 'contract', 'receipt', 'report', 'purchase_order', 'other'];

export default function Scanner({ settings, go }) {
  const toast = useToast();
  const [phase, setPhase] = useState('idle');       // idle | discovering | reading | done
  const [progress, setProgress] = useState({ found: 0, done: 0, total: 0, current: '' });
  const [files, setFiles] = useState([]);
  const [skipped, setSkipped] = useState(null);
  const [filing, setFiling] = useState(false);
  const unsubscribe = useRef(null);

  useEffect(() => {
    unsubscribe.current = api.scan.onProgress((p) => {
      setPhase(p.phase);
      setProgress((prev) => ({ ...prev, ...p }));
    });
    return () => { if (unsubscribe.current) unsubscribe.current(); };
  }, []);

  const root = settings && settings.library && settings.library.root;
  const mode = (settings && settings.filing && settings.filing.mode) || 'copy';

  const ready = useMemo(() => files.filter((f) => f.status === 'ready'), [files]);
  const review = useMemo(() => files.filter((f) => f.status === 'review'), [files]);
  const filed = useMemo(() => files.filter((f) => f.status === 'filed'), [files]);

  async function pick(kind) {
    try {
      const roots = kind === 'folder' ? await api.scan.chooseFolder() : await api.scan.chooseFiles();
      if (!roots.length) return;
      setFiles([]); setSkipped(null); setPhase('discovering');
      const result = await api.scan.start(roots);
      setFiles(result.files);
      setSkipped(result.skipped);
      setPhase('done');
      if (!result.files.length) toast('No readable PDF, Word or Excel documents in that selection.');
    } catch (err) {
      setPhase('idle');
      toast(err.message, 'error');
    }
  }

  const patch = (path, changes) => setFiles((list) => list.map((f) => (f.path === path ? { ...f, ...changes } : f)));

  async function fileOne(file) {
    if (!file.company) { toast('Add a company name so Cabinet knows where to file it.', 'error'); return; }
    try {
      const placed = await api.scan.fileOne(file);
      patch(file.path, { status: 'filed', filedTo: placed.relative });
    } catch (err) { toast(err.message, 'error'); }
  }

  async function fileEverything() {
    if (!root) { toast('Choose a library folder in Settings first.', 'error'); return; }
    setFiling(true);
    try {
      const batch = ready.map((f) => f);
      const placed = await api.scan.fileAll(batch);
      batch.forEach((f, i) => patch(f.path, { status: 'filed', filedTo: placed[i] && placed[i].relative }));
      toast(`${plural(batch.length, 'document')} ${mode === 'move' ? 'moved' : 'copied'} into the library.`, 'good');
    } catch (err) { toast(err.message, 'error'); }
    setFiling(false);
  }

  const busy = phase === 'discovering' || phase === 'reading';
  const readPct = progress.total ? (progress.done / progress.total) * 100 : 0;

  return (
    <div className="mx-auto max-w-[1100px] px-8 pb-16 pt-9">
      <header className="mb-7">
        <p className="text-[11px] font-semibold uppercase tracking-[.16em] text-ink-faint">Filing desk</p>
        <h1 className="mt-1.5 text-[27px] font-bold tracking-[-.025em]">Scan and organise your files</h1>
        <p className="mt-2 max-w-[70ch] text-[14px] leading-relaxed text-ink-soft">
          Cabinet lists the files first so you see progress immediately, then opens each one to work
          out who it belongs to and what it is. Nothing is filed until you say so — and
          {mode === 'copy' ? ' originals are copied, never moved.' : ' originals are moved into the library.'}
        </p>
      </header>

      {!root && isDesktop && (
        <Card className="mb-5 border-brass/40 bg-brass-wash" bodyClass="flex flex-wrap items-center justify-between gap-3 p-4">
          <p className="text-[13px] text-brass-deep">
            <b>No library folder set.</b> Choose where Cabinet should keep the organised copies.
          </p>
          <Button size="sm" tone="brass" icon="folder" onClick={() => go('settings')}>Open settings</Button>
        </Card>
      )}

      {phase === 'idle' && files.length === 0 ? (
        <Card bodyClass="p-0">
          <div className="px-6 py-14 text-center">
            <span className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-ledger-wash text-ledger">
              <Icon name="scan" size={26} />
            </span>
            <h2 className="text-[19px] font-semibold tracking-[-.015em]">Scan local files</h2>
            <p className="mx-auto mt-2 max-w-[52ch] text-[13.5px] leading-relaxed text-ink-soft">
              Choose a folder such as Desktop or Downloads, or pick individual documents.
              Everything is read on this machine — nothing is uploaded.
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-2.5">
              <Button tone="accent" size="lg" icon="folder" onClick={() => pick('folder')}>Choose a folder</Button>
              <Button size="lg" icon="file" onClick={() => pick('files')}>Choose files</Button>
            </div>
            <p className="mt-5 text-[11.5px] text-ink-faint">PDF · Word (.docx) · Excel (.xlsx) · Text</p>
          </div>
        </Card>
      ) : (
        <>
          <div className="mb-5 grid gap-4 md:grid-cols-2">
            <Card bodyClass="p-4">
              <div className="mb-2 flex items-baseline justify-between">
                <span className="text-[12.5px] font-semibold">Finding files</span>
                <span className="text-[12px] text-ink-faint">{progress.found || files.length} found</span>
              </div>
              <Progress tone="brass" value={phase === 'discovering' ? 100 : 100} />
              <p className="mt-2 h-4 truncate text-[11px] text-ink-faint">
                {phase === 'discovering' ? progress.current : 'Done'}
              </p>
            </Card>
            <Card bodyClass="p-4">
              <div className="mb-2 flex items-baseline justify-between">
                <span className="text-[12.5px] font-semibold">Reading them</span>
                <span className="text-[12px] text-ink-faint">
                  {progress.total ? `${progress.done} of ${progress.total}` : '—'}
                </span>
              </div>
              <Progress value={readPct} />
              <p className="mt-2 h-4 truncate text-[11px] text-ink-faint">
                {phase === 'reading' ? `Reading ${progress.current || ''}` : phase === 'done' ? 'Finished reading.' : ''}
              </p>
            </Card>
          </div>

          <div className="mb-6 flex flex-wrap items-center gap-x-9 gap-y-4 border-y border-rule py-4">
            <Stat label="Read" value={files.length} />
            <Stat label="Ready to file" value={ready.length} tone="good" />
            <Stat label="Need a look" value={review.length} tone={review.length ? 'alert' : undefined} />
            <Stat label="Filed" value={filed.length} />
            <div className="ml-auto flex gap-2">
              {busy && <Button icon="x" onClick={() => api.scan.cancel()}>Stop</Button>}
              <Button icon="scan" onClick={() => pick('folder')} disabled={busy}>Scan more</Button>
              <Button
                tone="accent"
                icon={filing ? undefined : 'check'}
                disabled={!ready.length || filing || !root}
                onClick={fileEverything}
              >
                {filing ? <><Spinner /> Filing…</> : `File ${ready.length || ''} into library`.trim()}
              </Button>
            </div>
          </div>

          {skipped && (skipped.system + skipped.unsupported + skipped.empty + skipped.oversized) > 0 && (
            <p className="mb-5 text-[12px] text-ink-faint">
              Skipped {skipped.unsupported} unsupported, {skipped.system} system or hidden,
              {' '}{skipped.empty} empty and {skipped.oversized} oversized files.
            </p>
          )}

          {review.length > 0 && (
            <Card
              className="mb-5"
              title="Cabinet wasn't sure about these"
              note="Confirm the company and type, then file them."
              right={(
                <Button
                  size="sm"
                  onClick={() => {
                    setFiles((list) => list.map((f) => (f.status === 'review'
                      ? { ...f, company: f.company || 'Unfiled', status: 'ready' } : f)));
                    toast('Best guesses accepted. Anything without a company went to Unfiled.');
                  }}
                >
                  Accept all guesses
                </Button>
              )}
              bodyClass="p-0"
            >
              <ul className="divide-y divide-rule">
                {review.map((f) => (
                  <li key={f.path} className="grid items-center gap-3 px-5 py-3.5 lg:grid-cols-[1.5fr_1fr_.8fr_auto]">
                    <div className="min-w-0">
                      <p className="truncate font-mono text-[12px]" title={f.path}>{f.name}</p>
                      <p className="mt-0.5 text-[11.5px] text-brick">{f.reason}</p>
                    </div>
                    <input
                      className="field"
                      placeholder="Company name"
                      defaultValue={f.company || ''}
                      onChange={(e) => patch(f.path, { company: e.target.value.trim() })}
                      aria-label={`Company for ${f.name}`}
                    />
                    <select
                      className="field"
                      defaultValue={f.type || 'other'}
                      onChange={(e) => patch(f.path, { type: e.target.value })}
                      aria-label={`Document type for ${f.name}`}
                    >
                      {TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
                    </select>
                    <Button size="sm" tone="primary" onClick={() => fileOne(files.find((x) => x.path === f.path))}>
                      File it
                    </Button>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card
            title="Proposed filing"
            note={root ? root : 'Choose a library folder to see full paths'}
            bodyClass="p-0"
          >
            {ready.length + filed.length === 0 ? (
              <Empty icon="folder" title="Nothing ready yet">
                As documents are read with enough confidence, the folder layout builds itself here.
              </Empty>
            ) : (
              <Tree files={[...ready, ...filed]} />
            )}
          </Card>
        </>
      )}
    </div>
  );
}

/* The filing plan, grouped the way it will appear on disk. */
function Tree({ files }) {
  const grouped = useMemo(() => {
    const out = {};
    for (const f of files) {
      const company = f.company || 'Unfiled';
      const folder = TYPE_LABEL[f.type] ? `${TYPE_LABEL[f.type]}s`.replace('Others', 'Unsorted') : 'Unsorted';
      out[company] = out[company] || {};
      out[company][folder] = out[company][folder] || [];
      out[company][folder].push(f);
    }
    return out;
  }, [files]);

  return (
    <ul className="divide-y divide-rule">
      {Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b)).map(([company, folders]) => {
        const count = Object.values(folders).reduce((a, b) => a + b.length, 0);
        return (
          <li key={company} className="px-5 py-4">
            <div className="mb-2.5 flex items-center gap-2">
              <Icon name="folder" size={15} className="text-brass" />
              <span className="text-[13.5px] font-semibold">{company}</span>
              <span className="chip">{plural(count, 'document')}</span>
            </div>
            <div className="ml-2 space-y-3 border-l border-rule pl-4">
              {Object.entries(folders).sort(([a], [b]) => a.localeCompare(b)).map(([folder, items]) => (
                <div key={folder}>
                  <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[.09em] text-ink-faint">{folder}</p>
                  <ul className="space-y-1">
                    {items.map((f) => (
                      <li key={f.path} className="flex items-center gap-2 text-[12px]">
                        <Icon name="file" size={13} className="shrink-0 text-ink-faint" />
                        <span className="truncate font-mono text-ink-soft">{f.filedTo || f.name}</span>
                        <span className="ml-auto shrink-0 text-[11px] text-ink-faint">{bytes(f.bytes)}</span>
                        <span className={`chip shrink-0 ${f.status === 'filed' ? 'border-ledger/30 bg-ledger-wash text-ledger-deep' : ''}`}>
                          {f.status === 'filed' ? 'filed' : 'ready'}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
