export const bytes = (n) => {
  const v = Number(n) || 0;
  if (v < 1024) return `${v} B`;
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(0)} KB`;
  return `${(v / 1024 / 1024).toFixed(1)} MB`;
};

export const money = (n, currency = '$') => (
  Number.isFinite(Number(n))
    ? currency + Number(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
    : '—'
);

export const shortDate = (iso) => (iso
  ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
  : '—');

export const plural = (n, one, many) => `${n} ${n === 1 ? one : many || `${one}s`}`;

export const TYPE_LABEL = {
  invoice: 'Invoice', proposal: 'Proposal', contract: 'Contract', receipt: 'Receipt',
  report: 'Report', purchase_order: 'Purchase Order', other: 'Other',
};

export const TYPE_TONE = {
  invoice: 'bg-brass-wash text-brass-deep border-brass/25',
  proposal: 'bg-ledger-wash text-ledger-deep border-ledger/25',
  contract: 'bg-[#EAE7F5] text-[#4B3E8E] border-[#4B3E8E]/20',
  receipt: 'bg-[#E8F1E4] text-[#3C6B2E] border-[#3C6B2E]/20',
  report: 'bg-[#E6EFF5] text-[#2C5A78] border-[#2C5A78]/20',
  purchase_order: 'bg-[#F5EDE4] text-[#7A5327] border-[#7A5327]/20',
  other: 'bg-paper-sunk text-ink-soft border-rule',
};
