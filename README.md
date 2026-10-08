# Room Booking (prototype)

Booking system for the functional rooms:

| Type | Rooms | Where |
|---|---|---|
| Relax Room | 2 (briefing rooms for the lounge) | Lounge |
| Mini Workpod | 6 | WHQ offices |
| Discussion Room | 7 | WHQ |

## Rules (prototype defaults)

- Bookings are in **2-hour blocks**: 08:00–10:00, 10:00–12:00, 12:00–14:00, 14:00–16:00, 16:00–18:00.
- **No daily cap** — book as many blocks as you need, across rooms and days. You
  can't hold two rooms in the same time block.
- Book up to **7 days ahead**, weekdays only.
- Booking asks for **name, work email and phone number**. Taken slots show the
  booker's name and number, so they are the contact for that booking.
- **No-show:** if nobody has turned up 15 minutes after the start, anyone may use
  the room (shown on the page; not enforced by the system).
- Cancel from the grid or *My bookings* to free the slot.

All of these live in [`config.js`](config.js) — change hours, block length,
booking window, weekends, an optional per-person daily cap
(`maxHoursPerPersonPerDay`), or the room list there.

## Run it

- **With Google Sheets (shared, for the pilot):** follow
  [`apps-script/SETUP.md`](apps-script/SETUP.md). You get one link for staff;
  bookings are rows in the sheet.
- **Try it locally:** open `index.html` in a browser. Bookings are saved in that
  browser only.

After changing `index.html`, `styles.css`, `config.js` or `app.js`, run
`node build-apps-script.js` to regenerate `apps-script/Index.html`.

## Utilisation

The **Utilisation** tab shows the share of blocks booked by room type and by time
block (next 7 / past 7 / past 30 days). **Export bookings (CSV)** downloads the
raw data; with Google Sheets, the sheet itself is the full record (cancelled
bookings are kept with `status = cancelled`).

## Prototype limitations

- Identity is self-declared (name + work email + phone). Cancelling checks the
  email matches the booking. Before wider rollout, consider using the signed-in
  Google account instead.
