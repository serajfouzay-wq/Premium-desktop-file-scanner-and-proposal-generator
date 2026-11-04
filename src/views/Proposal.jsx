import React, { useCallback, useEffect, useState } from 'react';
import { Button, Card, Empty, Icon, Spinner, useToast } from '../components/ui';
import { api } from '../lib/api';

/*
 * Write what the job is; get the client's own PowerPoint back, filled.
 *
 * Nothing on this screen consults a model. The sentence is matched against the
 * catalog, the rates and the pictures come from the records it matched, and
 * the template is the client's own file. So what appears under "What it
 * understood" is exactly what will be placed, and anything it could not place
 * is listed rather than guessed at.
 */

const EXAMPLE = 'team building for ABC Sdn Bhd, attn: Ms Joanne Teoh, 45 pax, '
  + '14 - 15 March 2026, 2D1N at Lexis Hibiscus Port Dickson, MC Sera Fouzay, '
  + 'amazing race and beach olympics, depart 8:30am back 6pm';

const basename = (p) => String(p).split(/[\\/]/).pop();

function Row({ label, value }) {
  if (value == null || value === '' || (Array.isArray(value) && !value.length)) return null;
  return (
    <div className="flex gap-3 border-b border-rule py-1.5 last:border-0">
      <div className="w-36 shrink-0 text-[12px] font-medium text-ink-soft">{label}</div>
      <div className="text-[13px]">{Array.isArray(value) ? value.join(', ') : value}</div>
    </div>
  );
}

function Lines({ title, items }) {
  if (!items || !items.length) return null;
  return (
    <div className="mt-4">
      <div className="text-[12px] font-semibold text-ink-soft">{title}</div>
      <ul className="mt-1 space-y-0.5 text-[12px]">
        {items.map((t, i) => <li key={`${t}-${i}`}>{t}</li>)}
      </ul>
    </div>
  );
}

export default function Proposal() {
  const toast = useToast();
  const [text, setText] = useState('');
  const [template, setTemplate] = useState(null);
  const [reading, setReading] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    api.proposal.template().then(setTemplate).catch(() => {});
  }, []);

  /* Read as it is typed, so a name is seen being recognised before anybody
     commits to producing a deck from it. */
  useEffect(() => {
    if (!text.trim()) { setReading(null); return undefined; }
    let live = true;
    const timer = setTimeout(() => {
      api.proposal.read(text)
        .then((r) => { if (live) setReading(r); })
        .catch(() => { if (live) setReading(null); });
    }, 250);
    return () => { live = false; clearTimeout(timer); };
  }, [text]);

  const chooseTemplate = useCallback(async () => {
    try {
      const picked = await api.proposal.chooseTemplate();
      if (!picked) return;
      setTemplate(picked.path);
      toast(`Template read: ${picked.slides} pages, ${picked.placeholders} fillable spots.`, 'good');
    } catch (err) {
      toast(err.message || 'Could not read that file.', 'error');
    }
  }, [toast]);

  const build = useCallback(async () => {
    setBusy(true);
    setResult(null);
    try {
      const built = await api.proposal.build({ text, jobTypeId: 'team_building' });
      setResult(built);
      toast(`Proposal ${built.reference} written.`, 'good');
    } catch (err) {
      toast(err.message || 'Could not build the proposal.', 'error');
    } finally {
      setBusy(false);
    }
  }, [text, toast]);

  const found = reading && reading.found;

  return (
    <div className="space-y-5">
      <Card
        title="Write what the job is"
        note="Every name is looked up in your catalog. No AI is involved."
        right={(
          <div className="flex items-center gap-2 text-[12px] text-ink-soft">
            {template
              ? <>Template: <span className="font-semibold text-ink">{basename(template)}</span></>
              : <span className="font-semibold text-brick">No template chosen yet</span>}
            <Button tone="quiet" size="sm" onClick={chooseTemplate}>
              {template ? 'Change' : 'Choose template'}
            </Button>
          </div>
        )}
      >
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          spellCheck={false}
          placeholder={EXAMPLE}
          className="w-full rounded-lg border border-rule bg-paper-raised px-3 py-2.5 text-[13px]
            leading-relaxed outline-none focus:border-rule-strong"
        />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button tone="accent" onClick={build} disabled={busy || !text.trim() || !template}>
            {busy ? <Spinner /> : <Icon name="sparkle" size={16} />}
            Make the PowerPoint
          </Button>
          <Button tone="ghost" onClick={() => setText(EXAMPLE)}>Use the example</Button>
          {!template && (
            <span className="text-[12px] text-ink-soft">
              Choose the PowerPoint template first — the engine fills your own file.
            </span>
          )}
        </div>
      </Card>

      {found && (
        <Card title="What it understood" note="Read this before you build. Nothing here was guessed.">
          <Row label="Job type" value={found.jobType} />
          <Row label="Client" value={found.company} />
          <Row label="Attention to" value={found.pic} />
          <Row label="Participants" value={found.pax ? `${found.pax} pax` : null} />
          <Row label="Dates" value={found.dates} />
          <Row label="Duration" value={found.duration} />
          <Row label="Location" value={found.location} />
          <Row label="Hotel" value={found.hotels} />
          <Row label="Event hall" value={found.venues} />
          <Row label="Host" value={found.mc} />
          <Row label="Activities" value={found.activities} />
          <Row label="Prices typed" value={found.money.map((m) => `${m.text} (${m.basis})`)} />
          <Row label="Times" value={found.times} />

          {reading.ambiguous.length > 0 && (
            <div className="mt-4 rounded-lg bg-brick-wash p-3 text-[12px]">
              <div className="font-semibold">Two records fit equally well — say which one:</div>
              {reading.ambiguous.map((a) => (
                <div key={a.field} className="mt-1">
                  {a.field}: {a.options.map((o) => o.name).join('  or  ')}
                </div>
              ))}
            </div>
          )}
          {reading.unrecognised.length > 0 && (
            <div className="mt-3 rounded-lg bg-paper-sunk p-3 text-[12px] text-ink-soft">
              Not in the catalog: <span className="font-semibold text-ink">{reading.unrecognised.join(', ')}</span>
              <div className="mt-1">Add them under Inventory and they will be found next time.</div>
            </div>
          )}
        </Card>
      )}

      {result && (
        <Card
          title="Done"
          note={result.reference}
          right={(
            <div className="flex items-center gap-2">
              <Button tone="accent" size="sm" onClick={() => api.openPath(result.path)}>
                <Icon name="sparkle" size={14} /> Open the PowerPoint
              </Button>
              <Button tone="quiet" size="sm" onClick={() => api.revealPath(result.path)}>
                Show the file
              </Button>
            </div>
          )}
        >
          <div className="text-[12px] text-ink-soft">
            {result.placed} spots filled
            {result.photos.length ? ` · ${result.photos.length} photograph(s)` : ''}
            {result.itinerary ? ` · itinerary of ${result.itinerary} rows` : ''}
            {result.addedSlides && result.addedSlides.length
              ? ` · ${result.addedSlides.length} page(s) created`
              : ''}
            {result.cleared ? ` · ${result.cleared} unused placeholder(s) cleared` : ''}
            {` · ${(result.bytes / 1024 / 1024).toFixed(1)} MB`}
          </div>

          {result.addedSlides && result.addedSlides.length > 0 && (
            <div className="mt-3 rounded-lg bg-ledger-wash p-3 text-[12px]">
              <span className="font-semibold">Pages the template did not have: </span>
              {result.addedSlides.map((a) => a.title || `page ${a.slide}`).join(', ')}
              {' — added after page '}
              {result.addedSlides.map((a) => a.after).join(', ')}
              {'.'}
            </div>
          )}
          {result.departOffice && (
            <div className="mt-2 text-[12px] text-ink-soft">
              The coach leaves the office at{' '}
              <span className="font-semibold text-ink">{result.departOffice}</span>
              {' and is back at '}
              <span className="font-semibold text-ink">{result.arriveBack}</span>
              {'. Both follow from the journey time stored against the city.'}
            </div>
          )}

          <Lines title="The money, and where each figure came from" items={result.computed} />
          <Lines
            title="Photographs placed"
            items={result.photos.map((p) => `page ${p.slide}${p.onNewSlide ? ' (created)' : ''}: ${p.size}`
              + (p.grid ? ` in a ${p.grid} grid` : ' into the frame already there')
              + (p.trimmed ? ` — ${p.trimmed}% trimmed to fit` : ' — no trim needed'))}
          />

          {result.missing.length > 0 && (
            <div className="mt-4 rounded-lg bg-brick-wash p-3 text-[12px]">
              Still needed: <span className="font-semibold">{result.missing.join(', ')}</span>
            </div>
          )}
          {result.notes.length > 0 && (
            <div className="mt-3 rounded-lg bg-paper-sunk p-3 text-[12px] text-ink-soft">
              {result.notes.map((n) => <div key={n}>{n}</div>)}
            </div>
          )}
          {result.problems.length > 0 && (
            <div className="mt-3 rounded-lg bg-brick-wash p-3 text-[12px]">
              <div className="font-semibold">The template did not match in places:</div>
              {result.problems.map((n) => <div key={n}>{n}</div>)}
            </div>
          )}
          {result.removedSentences > 0 && (
            <div className="mt-3 text-[12px] text-ink-faint">
              {result.removedSentences} sentence(s) needing a figure nobody supplied were removed
              rather than left half-written.
            </div>
          )}
        </Card>
      )}

      {!found && !result && (
        <Empty icon="pen" title="Nothing typed yet">
          Write the job in your own words — the client, the head count, the dates, the hotel,
          the host and the activities. Every name is looked up in your catalog, and what it
          understands appears here before anything is produced.
        </Empty>
      )}
    </div>
  );
}
