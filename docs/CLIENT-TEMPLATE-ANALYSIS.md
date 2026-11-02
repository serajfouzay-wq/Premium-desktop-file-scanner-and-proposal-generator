# Smart Solutions Learning — what the files tell us

Findings from the client's own material: the 12-page proposal template, four
state itinerary decks (Janda Baik, Melaka, Perak, Port Dickson) and the written
requirements. Everything here is measured from those files, not assumed.

## 1. The proposal is a fixed 12-page template, not a generated deck

The requirement is explicit — *"Retain the existing standard template and
layout. No editing or customisation is required."* Pages 2, 3, 10 and 11 are
fixed; 5, 6 and 7 are empty pages waiting for content; the rest carry
placeholders the designer highlighted yellow and filled with `xxx`.

| Page | Role | Fillable slots |
|---|---|---|
| 1 | Cover | 6 — ref, prepared by, client, attention, date, group size |
| 2–3 | About us, Clientele | fixed |
| 4 | Description | 3 — company, date/duration, participants |
| 5 | Programme Venue & Photo | empty — venue photographs inserted |
| 6 | Programme Itinerary | empty — itinerary inserted |
| 7 | Activity Detail | empty — activities inserted |
| 8 | Investment, programme | 9 — days, pax, fees, tax, subtotal |
| 9 | Investment, venue + transport | 7 — hotel, transport, grand total |
| 10–11 | Terms & conditions | fixed |
| 12 | Service confirmation | 6 — values repeated from pages 1, 4 and 9 |

**31 fillable placeholders**, on exactly the pages the requirements name.

This is why the engine fills their file rather than drawing a new one: their
deck *is* the design. Redrawing it could only approximate it, and approximate
is what they asked us not to do.

## 2. The itinerary needs one number per state, not an itinerary per state

Comparing the four state decks step by step, **19 of 21 programme steps are
identical**. What varies is the travel, and it varies predictably:

| State | Depart office | Arrive hotel | Journey | Leave hotel | Arrive back | Journey |
|---|---|---|---|---|---|---|
| Janda Baik | 7.30am | 9.30am | 2h00 | 1.30pm | 3.30pm | 2h00 |
| Melaka | 7.00am | 9.30am | 2h30 | 1.30pm | 4.00pm | 2h30 |
| Perak | 7.00am | 9.30am | 2h30 | 1.30pm | 4.00pm | 2h30 |
| Port Dickson | 7.30am | 9.30am | 2h00 | 1.30pm | 3.30pm | 2h00 |

Arrival is **always 9.30am**. Departure from the hotel is **always 1.30pm**.
The outbound and return journeys are the same length in every state. So both
variable times follow from a single stored figure:

```
depart from office = 09:30 − journey time
arrive back        = 13:30 + journey time
```

Storing a whole itinerary per state would mean maintaining the same twenty-one
rows four times over, and they would drift apart. Storing the journey time
means adding a new state is one number.

**One anomaly to confirm with the client:** Melaka's day two runs 30–45 minutes
earlier throughout (registration 8.30am rather than 9.00am). That is not
explained by travel time, since Melaka's journey is the same as Perak's. It is
either a deliberate variant or a stray edit, and it is worth asking.

## 3. Venues are per state, several per proposal

| State | Venues listed | Photographs |
|---|---|---|
| Janda Baik | 5 | 12 |
| Melaka | 5 | 17 |
| Perak | 6 | 24 |
| Port Dickson | 7 | 22 |

The requirement asks for photographs "categorised by state and location", with
several venues selectable per proposal and comparison across states. That maps
onto the catalog already in place: a location, hotels under it, photographs
under each hotel.

## 4. An inconsistency in the template itself

Pages 8, 9 and 12 price in **RM**. Page 10, clause 1, reads *"All fees are
quoted in Singapore Dollars (SGD)"*. A proposal that quotes ringgit in the
table and commits to Singapore dollars in the terms is a dispute waiting to
happen. Worth raising before the template is locked in.

## 5. The reference number

`SSL/COMP/MONTH/YEAR/001`, where the serial advances per revision and the
original is never overwritten. A revision is therefore a new row and a new
file, with the previous one kept — not an edit in place.
