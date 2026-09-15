import React, { useEffect, useState } from 'react';
import { Button, Card, Empty, Icon, Spinner, Stat } from '../components/ui';
import { api, isDesktop } from '../lib/api';
import { TYPE_LABEL, TYPE_TONE, plural, shortDate } from '../lib/format';

export default function Dashboard({ settings, go }) {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const s = await api.library.stats();
        if (live) setStats(s);
      } catch { /* empty state covers it */ }
      if (live) setLoading(false);
    })();
    return () => { live = false; };
  }, []);

  const brand = (settings && settings.brand) || {};
  const configured = !!brand.name;
  const empty = !stats || stats.documents === 0;

  return (
    <div className="mx-auto max-w-[1100px] px-8 pb-16 pt-9">
      <header className="mb-8">
        <p className="text-[11px] font-semibold uppercase tracking-[.16em] text-ink-faint">Overview</p>
        <h1 className="mt-1.5 text-[27px] font-bold tracking-[-.025em]">
          {configured ? `Good to see you, ${brand.name}` : 'Welcome to Cabinet'}
        </h1>
        <p className="mt-2 max-w-[62ch] text-[14px] leading-relaxed text-ink-soft">
          Cabinet reads the documents already scattered across your machine, files them by company,
          and then writes new proposals from what it found.
        </p>
      </header>

      {loading ? (
        <div className="flex items-center gap-2 text-[13px] text-ink-soft"><Spinner /> Opening the cabinet…</div>
      ) : (
        <>
          <div className="mb-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card bodyClass="p-5"><Stat label="Companies" value={stats ? stats.companies : 0} /></Card>
            <Card bodyClass="p-5"><Stat label="Documents filed" value={stats ? stats.documents : 0} /></Card>
            <Card bodyClass="p-5"><Stat label="Passages indexed" value={stats ? stats.chunks : 0} /></Card>
            <Card bodyClass="p-5"><Stat label="Proposals written" value={stats ? stats.proposals : 0} tone="good" /></Card>
          </div>

          {empty ? (
            <Card>
              <Empty icon="scan" title="Nothing filed yet">
                Point Cabinet at a folder — your Desktop or Downloads is a good start. It reads each
                PDF, Word and Excel file, works out who it belongs to, and shows you the filing plan
                before a single file is touched.
              </Empty>
              <div className="flex flex-wrap justify-center gap-2 pb-6">
                <Button tone="accent" icon="scan" size="lg" onClick={() => go('scanner')}>Scan a folder</Button>
                {!configured && <Button icon="gear" size="lg" onClick={() => go('settings')}>Set up branding</Button>}
              </div>
            </Card>
          ) : (
            <div className="grid gap-5 lg:grid-cols-[1.35fr_1fr]">
              <Card
                title="Recently filed"
                note={`${plural(stats.documents, 'document')} in the library`}
                right={<Button size="sm" icon="library" onClick={() => go('library')}>Open library</Button>}
                bodyClass="p-0"
              >
                <ul className="divide-y divide-rule">
                  {stats.recent.map((d) => (
                    <li key={d.id} className="flex items-center gap-3 px-5 py-3">
                      <span className={`chip shrink-0 border ${TYPE_TONE[d.doc_type] || TYPE_TONE.other}`}>
                        {TYPE_LABEL[d.doc_type] || 'Other'}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-medium">{d.title}</p>
                        <p className="truncate text-[11.5px] text-ink-faint">{d.company}</p>
                      </div>
                      <span className="shrink-0 text-[11.5px] text-ink-faint">{shortDate(d.created_at)}</span>
                    </li>
                  ))}
                </ul>
              </Card>

              <div className="space-y-5">
                <Card title="Write something new" bodyClass="p-5">
                  <p className="mb-4 text-[13px] leading-relaxed text-ink-soft">
                    Describe the proposal you need in plain words. Cabinet finds the relevant past
                    work itself — you never have to look anything up.
                  </p>
                  <Button tone="brass" icon="sparkle" size="lg" className="w-full" onClick={() => go('studio')}>
                    Write a proposal
                  </Button>
                </Card>

                {stats.byType.length > 0 && (
                  <Card title="What's in the cabinet" bodyClass="p-5">
                    <ul className="space-y-2.5">
                      {stats.byType.map((t) => {
                        const pct = Math.round((t.n / stats.documents) * 100);
                        return (
                          <li key={t.doc_type}>
                            <div className="mb-1 flex items-baseline justify-between text-[12.5px]">
                              <span className="font-medium">{TYPE_LABEL[t.doc_type] || 'Other'}</span>
                              <span className="text-ink-faint">{t.n}</span>
                            </div>
                            <div className="h-1.5 overflow-hidden rounded-full bg-paper-sunk">
                              <div className="h-full rounded-full bg-ink/25" style={{ width: `${pct}%` }} />
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </Card>
                )}
              </div>
            </div>
          )}

          {isDesktop && stats && stats.root && (
            <button
              type="button"
              onClick={() => api.openPath(stats.root)}
              className="mt-6 inline-flex items-center gap-2 text-[12px] text-ink-soft transition hover:text-ink"
            >
              <Icon name="folder" size={14} />
              <span className="font-mono">{stats.root}</span>
              <Icon name="arrow" size={13} />
            </button>
          )}
        </>
      )}
    </div>
  );
}
