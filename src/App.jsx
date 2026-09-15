import React, { useCallback, useEffect, useState } from 'react';
import { Icon, ToastHost } from './components/ui';
import { api, isDesktop } from './lib/api';

import Dashboard from './views/Dashboard';
import Scanner from './views/Scanner';
import Library from './views/Library';
import Studio from './views/Studio';
import Settings from './views/Settings';

const NAV = [
  { id: 'dashboard', label: 'Overview', icon: 'home', hint: 'What Cabinet holds' },
  { id: 'scanner', label: 'Filing desk', icon: 'scan', hint: 'Scan and organise' },
  { id: 'library', label: 'Library', icon: 'library', hint: 'Every filed document' },
  { id: 'studio', label: 'Write a proposal', icon: 'pen', hint: 'Draft from past work' },
  { id: 'settings', label: 'Settings', icon: 'gear', hint: 'Branding and storage' },
];

export default function App() {
  const [view, setView] = useState('dashboard');
  const [settings, setSettings] = useState(null);
  const [info, setInfo] = useState(null);
  const [ready, setReady] = useState(false);

  const refreshSettings = useCallback(async () => {
    if (!isDesktop) return null;
    const s = await api.settings.get();
    setSettings(s);
    return s;
  }, []);

  useEffect(() => {
    (async () => {
      if (isDesktop) {
        try {
          const [s, i] = await Promise.all([api.settings.get(), api.info()]);
          setSettings(s);
          setInfo(i);
        } catch { /* surfaced by the views themselves */ }
      }
      setReady(true);
    })();
  }, []);

  // Number keys jump between views, the way a desktop app should.
  useEffect(() => {
    const onKey = (e) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const n = Number(e.key);
      if (n >= 1 && n <= NAV.length) { e.preventDefault(); setView(NAV[n - 1].id); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const shared = { settings, refreshSettings, go: setView };

  return (
    <ToastHost>
      <div className="flex h-full w-full overflow-hidden bg-paper">
        <Sidebar view={view} setView={setView} info={info} settings={settings} />

        <main className="relative flex min-w-0 flex-1 flex-col">
          {!isDesktop && <BrowserNotice />}
          <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
            {ready && (
              <div key={view} className="animate-rise">
                {view === 'dashboard' && <Dashboard {...shared} />}
                {view === 'scanner' && <Scanner {...shared} />}
                {view === 'library' && <Library {...shared} />}
                {view === 'studio' && <Studio {...shared} />}
                {view === 'settings' && <Settings {...shared} />}
              </div>
            )}
          </div>
        </main>
      </div>
    </ToastHost>
  );
}

function Sidebar({ view, setView, info, settings }) {
  const brandName = (settings && settings.brand && settings.brand.name) || 'Document desk';
  return (
    <aside className="flex w-[228px] shrink-0 flex-col border-r border-black/25 bg-slate-950 text-white/80">
      <div className="drag h-[52px] shrink-0" />

      <div className="no-drag px-4 pb-5">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brass text-slate-950">
            <Icon name="library" size={17} />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-[14px] font-bold tracking-[-.01em] text-white">Cabinet</span>
              {/* Both versions can be installed at once, so which one is open
                  has to be obvious at a glance during a demo. */}
              {info && (
                <span className="rounded bg-brass px-1.5 py-px text-[9.5px] font-bold text-slate-950">
                  v{String(info.version).split('.')[0]}
                </span>
              )}
            </div>
            <div className="truncate text-[10.5px] text-white/45">{brandName}</div>
          </div>
        </div>
      </div>

      <nav className="no-drag flex-1 space-y-0.5 px-2.5">
        {NAV.map((item, i) => {
          const active = view === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setView(item.id)}
              aria-current={active ? 'page' : undefined}
              className={`group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition
                ${active ? 'bg-white/[.10] text-white shadow-[inset_2px_0_0_theme(colors.brass.DEFAULT)]'
                : 'text-white/60 hover:bg-white/[.06] hover:text-white/90'}`}
            >
              <Icon name={item.icon} size={16} className={active ? 'text-brass' : 'text-white/40 group-hover:text-white/70'} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold">{item.label}</span>
                <span className="block truncate text-[10.5px] text-white/35">{item.hint}</span>
              </span>
              <kbd className="rounded border border-white/10 px-1 font-mono text-[9.5px] text-white/25">{i + 1}</kbd>
            </button>
          );
        })}
      </nav>

      <footer className="no-drag space-y-1 border-t border-white/[.07] px-4 py-3.5 text-[10.5px] text-white/35">
        {settings && settings.library && settings.library.root && (
          <div className="truncate" title={settings.library.root}>
            Library · {settings.library.root.split(/[\\/]/).pop()}
          </div>
        )}
        {info && (
          <div>
            v{info.version} · {info.storage && info.storage.engine === 'better-sqlite3' ? 'SQLite' : 'SQLite (WASM)'}
          </div>
        )}
      </footer>
    </aside>
  );
}

const BrowserNotice = () => (
  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-brass/25 bg-brass-wash px-6 py-2 text-[12px] text-brass-deep">
    <Icon name="alert" size={14} />
    <span>
      <b>Web preview with sample data.</b> Every screen is live and clickable, but reading your own
      files and exporting PDFs need the desktop app — a browser cannot reach your hard drive.
    </span>
    <a
      href="https://github.com/serajfouzay-wq/Premium-desktop-file-scanner-and-proposal-generator/releases/latest"
      target="_blank"
      rel="noreferrer"
      className="font-semibold underline underline-offset-2 hover:text-brass"
    >
      Download the real app
    </a>
  </div>
);
