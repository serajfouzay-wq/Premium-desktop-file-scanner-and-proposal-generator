'use strict';
/* ───────────────────────── itinerary ─────────────────────────
   The programme timetable, built from the request rather than stored four
   times over.

   Comparing the client's four state decks step by step, 19 of 21 steps are
   identical. What varies is the travel, and it varies predictably: arrival at
   the hotel is always 9.30am and departure from it always 1.30pm, so both
   variable times follow from one number per city.

       depart from office = 09:30 − journey time
       arrive back        = 13:30 + journey time

   | State        | Depart | Arrive | Journey | Leave  | Back   |
   |--------------|--------|--------|---------|--------|--------|
   | Janda Baik   | 7.30am | 9.30am | 2h00    | 1.30pm | 3.30pm |
   | Melaka       | 7.00am | 9.30am | 2h30    | 1.30pm | 4.00pm |
   | Perak        | 7.00am | 9.30am | 2h30    | 1.30pm | 4.00pm |
   | Port Dickson | 7.30am | 9.30am | 2h00    | 1.30pm | 3.30pm |

   Storing a whole itinerary per city would mean maintaining the same rows
   four times and watching them drift apart. Storing the journey means adding
   a city is one number.

   The activity rows carry the names from the request, in the order they were
   asked for. Where fewer activities are named than the programme has slots,
   the extra slots are dropped rather than filled with "ACTIVITY 4" — a client
   should not be sent a placeholder. */

const ARRIVE_AT_HOTEL = 9 * 60 + 30;   // 09:30, the same in every deck
const LEAVE_HOTEL = 13 * 60 + 30;      // 13:30, likewise
const DEFAULT_JOURNEY = 120;           // two hours, when the city is unknown

const clamp = (m) => ((m % 1440) + 1440) % 1440;

/** 570 -> "9.30am", written the way the client's own decks write it. */
function clock(minutes) {
  const m = clamp(Math.round(minutes));
  const h24 = Math.floor(m / 60);
  const min = m % 60;
  const suffix = h24 < 12 ? 'am' : 'pm';
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h}.${String(min).padStart(2, '0')}${suffix}`;
}

/* Day one, as the decks run it. `at` is minutes from midnight; a row with an
   `activity` index takes its name from the request. */
const DAY_ONE = [
  { at: null, text: 'Bus depart from office to hotel', travel: 'out' },
  { at: ARRIVE_AT_HOTEL, text: 'Arrival hotel\nMorning Tea break\nParticipant Registration' },
  { at: 10 * 60, activity: 0, kind: 'INDOOR' },
  { at: 11 * 60, activity: 1, kind: 'INDOOR' },
  { at: 12 * 60, text: 'Debrief and sharing' },
  { at: 12 * 60 + 30, text: 'Buffet Lunch\nPrayer' },
  { at: 14 * 60, text: 'Energizer' },
  { at: 14 * 60 + 30, activity: 2, kind: 'OUTDOOR' },
  { at: 16 * 60 + 30, text: 'Debrief and sharing\nEnd of Day 1 Activity' },
  { at: 17 * 60, text: 'Check in\nFree and easy', overnight: true },
  { at: 19 * 60 + 30, text: 'Buffet Dinner at hotel', overnight: true },
  { at: 21 * 60 + 30, text: 'End of Day 1', overnight: true },
];

const DAY_TWO = [
  { at: 7 * 60 + 30, text: 'Breakfast' },
  { at: 9 * 60, text: 'Registration' },
  { at: 9 * 60 + 15, activity: 3, kind: 'INDOOR', also: 'Reflection on Day 1 Learning' },
  { at: 10 * 60 + 15, activity: 4, kind: 'INDOOR' },
  { at: 11 * 60 + 15, text: 'Debrief and sharing\nAcknowledgement Session' },
  { at: 11 * 60 + 30, text: 'Group Photo\nCheck Out' },
  { at: 12 * 60, text: 'Lunch' },
  { at: LEAVE_HOTEL, text: 'Depart from hotel to Office', departs: true },
  { at: null, text: 'Arrival\nEnd of Teambuilding', travel: 'back' },
];

/* A one-day programme never checks in, so it closes after the afternoon
   activity and drives home the same evening. The debrief that ends day one is
   already in DAY_ONE, so this adds only what follows it — repeating it put
   two debriefs at the same minute. */
const SINGLE_DAY_TAIL = [
  { at: 17 * 60, text: 'Acknowledgement Session\nGroup Photo' },
  { at: 17 * 60 + 30, text: 'Depart from venue to Office', departs: true },
  { at: null, text: 'Arrival\nEnd of Teambuilding', travel: 'back' },
];

function rowText(step, activities) {
  if (step.activity == null) return step.text;
  const named = activities[step.activity];
  if (!named) return null;             // nothing named for this slot
  const label = `${named.name || named}`.toUpperCase();
  return step.also ? `${label}\n${step.also}` : label;
}

/**
 * @param {object} resolved   from resolve(): days, nights, activities
 * @param {object} opts       { journeyMinutes, label }
 * @returns {{days: Array, journeyMinutes: number, notes: string[]}}
 */
function build(resolved = {}, opts = {}) {
  const journey = Number.isFinite(opts.journeyMinutes) && opts.journeyMinutes > 0
    ? Math.round(opts.journeyMinutes)
    : DEFAULT_JOURNEY;
  const notes = [];
  if (!Number.isFinite(opts.journeyMinutes) || !(opts.journeyMinutes > 0)) {
    notes.push(`No journey time is stored for this city, so ${Math.round(journey / 60)} `
      + 'hour(s) was assumed. Set it against the city so the bus times are right.');
  }

  const activities = resolved.activities || [];
  const overnight = (resolved.nights || 0) > 0;

  const render = (steps, dayNumber) => {
    const rows = [];
    /* The return journey is measured from whenever the group actually leaves,
       not from a fixed hour: a one-day programme leaves at 5.30pm, and taking
       the two-day departure instead had the bus arriving back two hours before
       it set off. */
    let leftAt = LEAVE_HOTEL;
    for (const step of steps) {
      if (step.overnight && !overnight) continue;
      const text = rowText(step, activities);
      if (text == null) continue;
      let at = step.at;
      if (step.travel === 'out') at = ARRIVE_AT_HOTEL - journey;
      if (step.travel === 'back') at = leftAt + journey;
      if (step.departs) leftAt = at;
      rows.push({ time: clock(at), minutes: clamp(at), text });
    }
    return { day: dayNumber, title: `PROGRAM DESCRIPTION – DAY ${dayNumber}`, rows };
  };

  const days = [];
  if (overnight) {
    days.push(render(DAY_ONE, 1));
    days.push(render(DAY_TWO, 2));
  } else {
    days.push(render([...DAY_ONE.filter((s) => !s.overnight), ...SINGLE_DAY_TAIL], 1));
  }

  const slots = overnight ? 5 : 3;
  if (activities.length > slots) {
    notes.push(`${activities.length} activities were named but a `
      + `${overnight ? '2-day' : 'single-day'} programme has ${slots} slots; the `
      + `last ${activities.length - slots} are not in the itinerary.`);
  } else if (activities.length && activities.length < slots) {
    notes.push(`${activities.length} of ${slots} activity slots are filled. The empty `
      + 'slots were removed rather than left reading "ACTIVITY 4".');
  }

  return {
    days,
    journeyMinutes: journey,
    departOffice: clock(ARRIVE_AT_HOTEL - journey),
    arriveBack: clock(LEAVE_HOTEL + journey),
    notes,
  };
}

/** The itinerary as table rows: a header per day, then time and description. */
function asRows(itin) {
  const rows = [];
  for (const day of itin.days) {
    rows.push(['TIME', day.title]);
    for (const r of day.rows) rows.push([r.time, r.text]);
  }
  return rows;
}

module.exports = {
  build, asRows, clock, ARRIVE_AT_HOTEL, LEAVE_HOTEL, DEFAULT_JOURNEY,
};
