# Room Booking (prototype)

Booking system for the functional rooms:

| Type | Rooms | Where |
|---|---|---|
| Relax Room | 2 (briefing rooms for the lounge) | Lounge |
| Mini Workpod | 6 (placeholder count — adjust) | WHQ offices |
| Discussion Room | 7 | WHQ |

## Rules (prototype defaults)

- Bookings are in **2-hour blocks**: 08:00–10:00, 10:00–12:00, 12:00–14:00, 14:00–16:00, 16:00–18:00.
- **Cap: 2 hours per person per day** (one block), across all rooms.
- Book up to **7 days ahead**, weekdays only.
- Cancel from the grid or *My bookings* to free the slot.

All of these live in [`config.js`](config.js) — change hours, block length, the cap,
booking window, weekends, or the room list there. No other code needs to change.

## Run it

Open `index.html` in a browser. No install or server needed.

## Utilisation

The **Utilisation** tab shows the share of blocks booked by room type and by time
block (next 7 / past 7 / past 30 days), with a hint when it is low enough to raise
the cap or high enough to keep it. **Export bookings (CSV)** downloads the raw data.

## Prototype limitations

- Bookings are stored in the browser (`localStorage`), so each device sees only its
  own bookings. For a shared pilot, replace `loadBookings` / `saveBookings` in
  `app.js` with calls to a shared store (e.g. SharePoint list, Google Sheet, or a
  small API).
- Identity is self-declared (name + work email). Hook up SSO before go-live.
