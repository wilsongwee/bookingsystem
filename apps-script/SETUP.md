# Google Sheets setup (about 10 minutes)

The booking page runs from a Google Sheet's Apps Script. You get one link to
share with staff; every booking is a row in the sheet.

## 1. Create the sheet

1. In Google Drive, create a new Google Sheet, e.g. **Room Bookings**.
2. In the sheet: **Extensions → Apps Script**.

## 2. Add the code

1. In the Apps Script editor, open `Code.gs`, delete what's there and paste in
   the contents of [`Code.gs`](Code.gs).
2. Click **+ → HTML** next to *Files*, name it `Index` (the editor adds `.html`),
   delete what's there and paste in the contents of [`Index.html`](Index.html).
3. **Project Settings** (gear icon) → set **Time zone** to your office's time
   zone (e.g. *(GMT+08:00) Singapore*). This is used to reject bookings for
   slots that have already ended.
4. Click **Save**.

## 3. Create the Bookings tab

1. In the editor's function drop-down choose `setup`, then **Run**.
2. Approve the permission prompt (it asks to manage this spreadsheet).
3. A **Bookings** tab with a header row appears in the sheet.

## 4. Publish the booking page

1. **Deploy → New deployment** → type **Web app**.
2. **Execute as:** *Me*.
3. **Who has access:**
   - *Anyone within <your organisation>* (recommended, on Google Workspace):
     staff sign in with their work Google account; nobody outside can see
     bookings or phone numbers.
   - *Anyone with a Google account* / *Anyone*: only if staff don't have
     organisation Google accounts. Anyone with the link can then see names and
     phone numbers on the page.
4. **Deploy**, then copy the **Web app URL**. That is the booking link to share
   (and to put on the help slide of the instruction deck).

## Day-to-day

- **See or export bookings:** open the sheet. Cancelled bookings stay as rows
  with `status = cancelled`, so utilisation history is kept.
- **Remove a booking as admin:** change its `status` cell to `cancelled`.
- **Don't** reorder or rename the header row.

## Changing rules or rooms

1. Edit `config.js` in this repo (hours, block length, booking window,
   optional cap, room list).
2. If you set a cap, set `MAX_HOURS_PER_PERSON_PER_DAY` in `Code.gs` to the
   same number.
3. Run `node build-apps-script.js` to regenerate `Index.html`.
4. Paste the new `Index.html` (and `Code.gs` if changed) into the editor, then
   **Deploy → Manage deployments → Edit (pencil) → Version: New version →
   Deploy**. The link stays the same.

## Alternative: host the page elsewhere

The web app also answers as a JSON API, so the page can be hosted anywhere
(e.g. an intranet). Put the Web app URL in `sheetsApiUrl` in `config.js`. This
requires **Who has access: Anyone**, which exposes bookings (including phone
numbers) to anyone with the URL, so prefer the setup above.
