import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

/* ------------------------------------------------------------------ icons */
/* Inline so the app has no icon-font dependency and works fully offline. */

const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' };

export const Icon = ({ name, size = 18, className = '' }) => {
  const paths = {
    scan: <><path d="M3 7V5a2 2 0 012-2h2M17 3h2a2 2 0 012 2v2M21 17v2a2 2 0 01-2 2h-2M7 21H5a2 2 0 01-2-2v-2" /><path d="M3 12h18" /></>,
    library: <><path d="M4 4h4v16H4zM10 4h4v16h-4z" /><path d="M16.5 5l3.5.9-3 15.1-3.4-.9z" /></>,
    pen: <><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4z" /></>,
    gear: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 008 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06A1.65 1.65 0 004.6 15a1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06A1.65 1.65 0 009 4.6a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06A1.65 1.65 0 0019.4 9c.14.35.4.64.74.82.3.16.63.24.96.18H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z" /></>,
    home: <><path d="M3 10l9-7 9 7v9a2 2 0 01-2 2H5a2 2 0 01-2-2z" /><path d="M9 21V12h6v9" /></>,
    folder: <><path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" /></>,
    file: <><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><path d="M14 2v6h6" /></>,
    check: <path d="M20 6L9 17l-5-5" />,
    alert: <><path d="M12 9v4M12 17h.01" /><path d="M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L14.7 3.9a2 2 0 00-3.4 0z" /></>,
    arrow: <><path d="M5 12h14" /><path d="M12 5l7 7-7 7" /></>,
    back: <><path d="M19 12H5" /><path d="M12 19l-7-7 7-7" /></>,
    plus: <><path d="M12 5v14M5 12h14" /></>,
    x: <><path d="M18 6L6 18M6 6l12 12" /></>,
    download: <><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><path d="M7 10l5 5 5-5" /><path d="M12 15V3" /></>,
    image: <><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" /></>,
    search: <><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></>,
    sparkle: <><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" /><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" /></>,
    shield: <><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></>,
    eye: <><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" /><circle cx="12" cy="12" r="3" /></>,
    trash: <><path d="M3 6h18" /><path d="M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2" /><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" /></>,
  };
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} aria-hidden="true" {...stroke}>
      {paths[name] || paths.file}
    </svg>
  );
};

/* ----------------------------------------------------------------- button */

const TONES = {
  primary: 'bg-ink text-paper-raised border-ink hover:bg-slate-800 active:bg-slate-900 disabled:hover:bg-ink',
  accent: 'bg-ledger text-white border-ledger hover:bg-ledger-deep active:bg-ledger-deep disabled:hover:bg-ledger',
  brass: 'bg-brass-deep text-[#FDFBF4] border-brass-deep hover:bg-brass active:bg-brass-deep',
  quiet: 'bg-transparent text-ink border-rule hover:bg-ink/[.04] active:bg-ink/[.07]',
  ghost: 'bg-transparent text-ink-soft border-transparent hover:bg-ink/[.05] hover:text-ink',
  danger: 'bg-transparent text-brick border-brick/30 hover:bg-brick-wash',
};

const SIZES = {
  sm: 'px-2.5 py-1.5 text-[12px] gap-1.5 rounded-md',
  md: 'px-3.5 py-2 text-[13px] gap-2 rounded-lg',
  lg: 'px-5 py-2.5 text-[14px] gap-2 rounded-lg',
};

export const Button = ({ tone = 'quiet', size = 'md', icon, children, className = '', ...rest }) => (
  <button
    type="button"
    className={`inline-flex items-center justify-center border font-semibold transition
      disabled:cursor-not-allowed disabled:opacity-40
      focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ledger/35 focus-visible:ring-offset-1
      focus-visible:ring-offset-paper ${TONES[tone]} ${SIZES[size]} ${className}`}
    {...rest}
  >
    {icon && <Icon name={icon} size={size === 'sm' ? 14 : 16} />}
    {children}
  </button>
);

/* ------------------------------------------------------------------ misc */

export const Card = ({ title, note, right, children, className = '', bodyClass = 'p-5' }) => (
  <section className={`card overflow-hidden ${className}`}>
    {(title || right) && (
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-rule px-5 py-3.5">
        <div className="min-w-0">
          {title && <h3 className="text-[14px] font-semibold tracking-[-.01em]">{title}</h3>}
          {note && <p className="mt-0.5 text-[12px] text-ink-soft">{note}</p>}
        </div>
        {right}
      </header>
    )}
    <div className={bodyClass}>{children}</div>
  </section>
);

export const Empty = ({ icon = 'file', title, children }) => (
  <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
    <span className="mb-1 flex h-11 w-11 items-center justify-center rounded-full bg-paper-sunk text-ink-faint">
      <Icon name={icon} size={20} />
    </span>
    <p className="text-[14px] font-semibold">{title}</p>
    {children && <p className="max-w-[46ch] text-[12.5px] leading-relaxed text-ink-soft">{children}</p>}
  </div>
);

export const Progress = ({ value, tone = 'ledger' }) => (
  <div className="h-1.5 overflow-hidden rounded-full bg-paper-sunk">
    <div
      className={`h-full rounded-full transition-[width] duration-200 ease-out ${tone === 'brass' ? 'bg-brass' : 'bg-ledger'}`}
      style={{ width: `${Math.max(0, Math.min(100, value || 0))}%` }}
    />
  </div>
);

export const Stat = ({ label, value, tone }) => (
  <div>
    <div className={`text-[26px] font-bold leading-none tracking-[-.02em] ${tone === 'alert' ? 'text-brick' : tone === 'good' ? 'text-ledger' : 'text-ink'}`}>
      {value}
    </div>
    <div className="mt-1.5 text-[11.5px] font-medium text-ink-soft">{label}</div>
  </div>
);

export const Spinner = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" className="animate-spin" aria-hidden="true">
    <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2.4" opacity=".2" />
    <path d="M21 12a9 9 0 00-9-9" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
  </svg>
);

/* ----------------------------------------------------------------- toasts */

const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);

export const ToastHost = ({ children }) => {
  const [items, setItems] = useState([]);

  const push = useCallback((message, tone = 'info') => {
    const id = Math.random().toString(36).slice(2);
    setItems((list) => [...list, { id, message, tone }]);
    setTimeout(() => setItems((list) => list.filter((t) => t.id !== id)), tone === 'error' ? 6000 : 3600);
  }, []);

  const value = useMemo(() => push, [push]);

  return (
    <ToastCtx.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-2">
        {items.map((t) => (
          <div
            key={t.id}
            role="status"
            className={`animate-rise pointer-events-auto max-w-[70ch] rounded-lg px-4 py-2.5 text-[13px]
              font-medium shadow-lift ${t.tone === 'error'
              ? 'bg-brick text-white' : t.tone === 'good' ? 'bg-ledger text-white' : 'bg-slate-900 text-paper'}`}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
};

/* Escape closes things; used by the document preview overlay. */
export const useEscape = (handler, active = true) => {
  useEffect(() => {
    if (!active) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') handler(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handler, active]);
};
