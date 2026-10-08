(function () {
  "use strict";

  const C = window.BOOKING_CONFIG;
  const STORE_KEY = "roombooking.bookings.v1";
  const USER_KEY = "roombooking.user.v1";

  // ---- Storage --------------------------------------------------------------
  // Three backends with the same async interface:
  //  - served by the Apps Script web app (apps-script/): google.script.run
  //  - hosted elsewhere with sheetsApiUrl set: the web app's JSON API
  //  - otherwise: this browser's localStorage, for trying it on one machine.
  const localStore = {
    async list() {
      try { return JSON.parse(localStorage.getItem(STORE_KEY)) || []; } catch { return []; }
    },
    async add(b) {
      const list = await this.list();
      if (list.some((x) => x.roomId === b.roomId && x.date === b.date && x.start === b.start))
        throw new Error("Sorry, that slot was just taken. Please pick another.");
      const booking = { ...b, id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7), createdAt: new Date().toISOString() };
      this._save(list.concat(booking));
      return booking;
    },
    async cancel(id) {
      this._save((await this.list()).filter((x) => x.id !== id));
    },
    _save(list) {
      try { localStorage.setItem(STORE_KEY, JSON.stringify(list)); } catch {}
    },
  };

  const sheetsStore = {
    async list() {
      const from = ymd(addDays(new Date(), -31));
      const res = await fetch(`${C.sheetsApiUrl}?action=list&from=${from}`);
      return (await this._json(res)).bookings;
    },
    async add(b) {
      return (await this._post({ action: "book", booking: b })).booking;
    },
    async cancel(id, email) {
      await this._post({ action: "cancel", id, email });
    },
    async _post(body) {
      // text/plain keeps this a "simple" request, which Apps Script accepts cross-origin.
      const res = await fetch(C.sheetsApiUrl, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(body) });
      return this._json(res);
    },
    async _json(res) {
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Something went wrong.");
      return data;
    },
  };

  const gasRun = (fn, ...args) =>
    new Promise((resolve, reject) =>
      google.script.run
        .withSuccessHandler(resolve)
        .withFailureHandler((e) => reject(new Error(String(e && e.message || e).replace(/^Error:\s*/, ""))))
        [fn](...args));
  const appsScriptStore = {
    list: () => gasRun("apiList", ymd(addDays(new Date(), -31))),
    add: (b) => gasRun("apiBook", b),
    cancel: (id, email) => gasRun("apiCancel", id, email),
  };

  const store = window.google?.script?.run ? appsScriptStore : C.sheetsApiUrl ? sheetsStore : localStore;

  function loadUser() {
    try { return JSON.parse(localStorage.getItem(USER_KEY)); } catch { return null; }
  }
  function saveUser(u) {
    try { localStorage.setItem(USER_KEY, JSON.stringify(u)); } catch {}
  }

  // ---- Time helpers ---------------------------------------------------------
  const pad = (n) => String(n).padStart(2, "0");
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseYmd = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const isWeekend = (d) => d.getDay() === 0 || d.getDay() === 6;
  const fmtDay = (d) => d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });

  // Slots: [{start: 8, end: 10, label: "08:00–10:00"}, ...]
  const SLOTS = [];
  for (let h = C.openHour; h + C.blockHours <= C.closeHour; h += C.blockHours) {
    SLOTS.push({ start: h, end: h + C.blockHours, label: `${pad(h)}:00–${pad(h + C.blockHours)}:00` });
  }

  function bookableDays() {
    const out = [];
    const today = new Date(); today.setHours(0, 0, 0, 0);
    for (let i = 0; i <= C.bookingWindowDays; i++) {
      const d = addDays(today, i);
      if (C.allowWeekends || !isWeekend(d)) out.push(d);
    }
    return out;
  }

  function slotIsPast(dateStr, slot) {
    const end = parseYmd(dateStr); end.setHours(slot.end, 0, 0, 0);
    return end <= new Date();
  }

  // ---- State ---------------------------------------------------------------
  let bookings = [];
  let user = loadUser();
  if (user && !user.phone) user = null; // saved before phone numbers were required
  let busy = false;
  const days = bookableDays();
  let selectedDay = days.length ? ymd(days[0]) : ymd(new Date());
  let selectedType = "All";
  const types = ["All", ...new Set(C.rooms.map((r) => r.type))];

  const el = (id) => document.getElementById(id);
  const roomById = (id) => C.rooms.find((r) => r.id === id);
  const sameUser = (b) => user && b.email.toLowerCase() === user.email.toLowerCase();

  const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function toast(msg) {
    const t = el("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove("show"), 2800);
  }

  // ---- Rules ---------------------------------------------------------------
  // Checked here for instant feedback; the Sheets backend re-checks under a lock.
  function hoursUsed(email, dateStr) {
    return bookings
      .filter((b) => b.date === dateStr && b.email.toLowerCase() === email.toLowerCase())
      .reduce((sum, b) => sum + (b.end - b.start), 0);
  }

  function capReached(dateStr) {
    return !!(user && C.maxHoursPerPersonPerDay &&
      hoursUsed(user.email, dateStr) + C.blockHours > C.maxHoursPerPersonPerDay);
  }

  function canBook(roomId, dateStr, slot) {
    if (!user) return "Enter your name, work email and phone number first.";
    if (slotIsPast(dateStr, slot)) return "That slot has already passed.";
    if (bookings.some((b) => b.roomId === roomId && b.date === dateStr && b.start === slot.start))
      return "That slot was just taken.";
    if (bookings.some((b) => sameUser(b) && b.date === dateStr && b.start === slot.start))
      return "You already have a booking at that time.";
    if (capReached(dateStr))
      return `Daily limit reached: ${C.maxHoursPerPersonPerDay}h per person per day.`;
    return null;
  }

  async function refresh() {
    try {
      bookings = await store.list();
    } catch (e) {
      toast("Couldn't load bookings: " + e.message);
    }
    render();
  }

  async function run(work, done) {
    if (busy) return;
    busy = true;
    document.body.classList.add("busy");
    try {
      await work();
      toast(done);
    } catch (e) {
      toast(e.message);
    } finally {
      busy = false;
      document.body.classList.remove("busy");
      await refresh();
    }
  }

  function book(roomId, dateStr, slot) {
    const err = canBook(roomId, dateStr, slot);
    if (err) { toast(err); return; }
    const room = roomById(roomId);
    run(
      () => store.add({ roomId, roomName: room.name, date: dateStr, start: slot.start, end: slot.end,
                        name: user.name, email: user.email, phone: user.phone }),
      `Booked ${room.name}, ${fmtDay(parseYmd(dateStr))} ${slot.label}`
    );
  }

  function cancel(id) {
    const b = bookings.find((x) => x.id === id);
    if (!b || !sameUser(b)) return;
    if (!confirm(`Cancel ${roomById(b.roomId)?.name || b.roomId} on ${fmtDay(parseYmd(b.date))}?`)) return;
    run(() => store.cancel(id, user.email), "Booking cancelled — the slot is free for others.");
  }

  // ---- Rendering -----------------------------------------------------------
  function renderWho() {
    el("who-name").value = user?.name || "";
    el("who-email").value = user?.email || "";
    el("who-phone").value = user?.phone || "";
    el("who-status").textContent = user ? `Booking as ${user.name}` : "Not set";
  }

  function renderRules() {
    let limit;
    if (C.maxHoursPerPersonPerDay) {
      const used = user ? hoursUsed(user.email, selectedDay) : 0;
      limit = `Limit: <b>${C.maxHoursPerPersonPerDay}h per person per day</b>` +
        (user ? ` <span class="muted">(you've used ${used}h on this day)</span>. ` : ". ");
    } else {
      limit = "Book as many blocks as you need, one room per time block. ";
    }
    el("rules").innerHTML =
      `Bookings are in <b>${C.blockHours}-hour blocks</b> (${pad(C.openHour)}:00–${pad(C.closeHour)}:00), ` +
      `up to ${C.bookingWindowDays} days ahead. ${limit}<br>` +
      `<b>No-show:</b> if nobody has turned up ${C.noShowReleaseMinutes} minutes after the start, anyone may use the room. ` +
      `Questions about a booking? Contact the person who booked it — their number is on the slot.` +
      (store !== localStore ? "" : ` <span class="muted">(Prototype mode: bookings are saved in this browser only.)</span>`);
  }

  function renderDays() {
    el("days").innerHTML = "";
    for (const d of days) {
      const b = document.createElement("button");
      b.textContent = fmtDay(d);
      b.className = ymd(d) === selectedDay ? "active" : "";
      b.onclick = () => { selectedDay = ymd(d); render(); };
      el("days").appendChild(b);
    }
  }

  function renderTypes() {
    el("types").innerHTML = "";
    for (const t of types) {
      const b = document.createElement("button");
      b.textContent = t === "All" ? "All rooms" : t + "s";
      b.className = t === selectedType ? "active" : "";
      b.onclick = () => { selectedType = t; render(); };
      el("types").appendChild(b);
    }
  }

  function renderGrid() {
    const grid = el("grid");
    grid.innerHTML = "";
    const head = grid.insertRow();
    head.innerHTML = `<th class="room">Room</th>` + SLOTS.map((s) => `<th>${s.label}</th>`).join("");

    const atCap = capReached(selectedDay);
    let lastType = null;
    for (const room of C.rooms) {
      if (selectedType !== "All" && room.type !== selectedType) continue;
      if (room.type !== lastType) {
        const g = grid.insertRow(); g.className = "group";
        g.innerHTML = `<th colspan="${SLOTS.length + 1}">${room.type}s</th>`;
        lastType = room.type;
      }
      const tr = grid.insertRow();
      const th = document.createElement("th");
      th.className = "room";
      th.innerHTML = `${room.name}<small>${room.location} · ${room.capacity} pax</small>`;
      tr.appendChild(th);

      for (const slot of SLOTS) {
        const td = tr.insertCell();
        const btn = document.createElement("button");
        btn.className = "slot";
        const b = bookings.find((x) => x.roomId === room.id && x.date === selectedDay && x.start === slot.start);
        if (b && sameUser(b)) {
          btn.classList.add("mine"); btn.textContent = "Yours · cancel";
          btn.onclick = () => cancel(b.id);
        } else if (b) {
          btn.classList.add("taken"); btn.disabled = true;
          btn.innerHTML = `${esc(b.name)}<small>${esc(b.phone || "")}</small>`;
        } else if (slotIsPast(selectedDay, slot)) {
          btn.classList.add("past"); btn.textContent = "—"; btn.disabled = true;
        } else {
          btn.classList.add(atCap ? "blocked" : "free");
          btn.textContent = atCap ? "Limit reached" : "Book";
          btn.onclick = () => book(room.id, selectedDay, slot);
        }
        btn.title = `${room.name} · ${slot.label}` + (b ? ` · booked by ${b.name}, ${b.phone || ""}` : "");
        td.appendChild(btn);
      }
    }
  }

  function renderMine() {
    const list = el("mine-list");
    if (!user) { list.innerHTML = `<p class="empty">Enter your name and email above to see your bookings.</p>`; return; }
    const mine = bookings
      .filter((b) => sameUser(b) && !slotIsPast(b.date, b))
      .sort((a, b) => (a.date + pad(a.start)).localeCompare(b.date + pad(b.start)));
    if (!mine.length) { list.innerHTML = `<p class="empty">No upcoming bookings.</p>`; return; }
    list.innerHTML = "";
    for (const b of mine) {
      const room = roomById(b.roomId);
      const card = document.createElement("div");
      card.className = "card";
      card.innerHTML = `<div><strong>${room?.name || b.roomId}</strong>
        <div class="when">${fmtDay(parseYmd(b.date))} · ${pad(b.start)}:00–${pad(b.end)}:00 · ${room?.location || ""}</div></div>`;
      const btn = document.createElement("button");
      btn.textContent = "Cancel";
      btn.onclick = () => cancel(b.id);
      card.appendChild(btn);
      list.appendChild(card);
    }
  }

  function renderUsage() {
    const range = Number(el("usage-range").value);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const dates = [];
    if (range > 0) for (let i = 0; i < range; i++) dates.push(addDays(today, i));
    else for (let i = range; i < 0; i++) dates.push(addDays(today, i));
    const dayStrs = dates.filter((d) => C.allowWeekends || !isWeekend(d)).map(ymd);
    const daySet = new Set(dayStrs);
    const inRange = bookings.filter((b) => daySet.has(b.date));

    const rows = types.filter((t) => t !== "All").map((t) => {
      const rooms = C.rooms.filter((r) => r.type === t);
      const capacity = rooms.length * SLOTS.length * dayStrs.length;
      const used = inRange.filter((b) => roomById(b.roomId)?.type === t).length;
      return { label: t + "s", rooms: rooms.length, used, capacity };
    });
    const total = rows.reduce((a, r) => ({ used: a.used + r.used, capacity: a.capacity + r.capacity }), { used: 0, capacity: 0 });
    const pct = (u, c) => (c ? Math.round((u / c) * 100) : 0);

    const slotRows = SLOTS.map((s) => {
      const used = inRange.filter((b) => b.start === s.start).length;
      return { label: s.label, used, capacity: C.rooms.length * dayStrs.length };
    });

    const people = new Set(inRange.map((b) => b.email.toLowerCase())).size;
    const tableHtml = (title, list) => `
      <table class="usage-table" style="margin-bottom:16px">
        <tr><th>${title}</th><th>Blocks booked</th><th>Utilisation</th><th style="width:40%"></th></tr>
        ${list.map((r) => `<tr><td>${r.label}</td><td>${r.used} / ${r.capacity}</td><td>${pct(r.used, r.capacity)}%</td>
          <td><div class="bar"><i style="width:${pct(r.used, r.capacity)}%"></i></div></td></tr>`).join("")}
      </table>`;

    const overall = pct(total.used, total.capacity);
    el("usage").innerHTML =
      `<p><strong>${overall}%</strong> overall · ${total.used} bookings · ${people} people · ${dayStrs.length} working days</p>` +
      tableHtml("Room type", rows) + tableHtml("Time block", slotRows) +
      (overall < 50 && total.capacity && C.maxHoursPerPersonPerDay
        ? `<p class="hint">Utilisation is under 50% — consider raising <code>maxHoursPerPersonPerDay</code> in config.js.</p>`
        : overall >= 85
        ? `<p class="hint">Utilisation is 85%+ — demand is high; consider a per-person cap (<code>maxHoursPerPersonPerDay</code>) or shorter blocks.</p>`
        : "");
  }

  function exportCsv() {
    const head = ["date", "start", "end", "room", "type", "name", "email", "phone", "createdAt"];
    const csv = (v) => `"${String(v).replace(/"/g, '""')}"`;
    const lines = [head.join(",")].concat(
      bookings.map((b) => {
        const r = roomById(b.roomId);
        return [b.date, `${pad(b.start)}:00`, `${pad(b.end)}:00`, r?.name || b.roomId, r?.type || "", b.name, b.email, b.phone || "", b.createdAt].map(csv).join(",");
      })
    );
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
    a.download = `room-bookings-${ymd(new Date())}.csv`;
    a.click();
  }

  function render() {
    renderWho(); renderRules(); renderDays(); renderTypes(); renderGrid(); renderMine(); renderUsage();
  }

  // ---- Wiring --------------------------------------------------------------
  el("who").addEventListener("submit", (e) => {
    e.preventDefault();
    const name = el("who-name").value.trim();
    const email = el("who-email").value.trim();
    const phone = el("who-phone").value.trim();
    if (!name || !email || !phone) return;
    user = { name, email, phone };
    saveUser(user);
    toast(`Saved — booking as ${name}`);
    render();
  });

  document.querySelectorAll(".tab").forEach((t) =>
    t.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((x) => x.classList.toggle("active", x === t));
      document.querySelectorAll(".view").forEach((v) => (v.hidden = v.id !== "view-" + t.dataset.view));
    })
  );
  el("usage-range").addEventListener("change", renderUsage);
  el("export").addEventListener("click", exportCsv);
  window.addEventListener("storage", (e) => { if (e.key === STORE_KEY) refresh(); });
  // Pick up other people's bookings while the page is open.
  setInterval(() => { if (!busy && !document.hidden) refresh(); }, 60000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });

  render();
  refresh();
})();
