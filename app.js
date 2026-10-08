(function () {
  "use strict";

  const C = window.BOOKING_CONFIG;
  const STORE_KEY = "roombooking.bookings.v1";
  const USER_KEY = "roombooking.user.v1";

  // ---- Storage --------------------------------------------------------------
  // Prototype keeps data in this browser only. Swap these two functions for
  // API calls (or a shared sheet/db) when moving beyond the prototype.
  function loadBookings() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || []; } catch { return []; }
  }
  function saveBookings(list) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(list)); } catch {}
  }
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
  let bookings = loadBookings();
  let user = loadUser();
  const days = bookableDays();
  let selectedDay = days.length ? ymd(days[0]) : ymd(new Date());
  let selectedType = "All";
  const types = ["All", ...new Set(C.rooms.map((r) => r.type))];

  const el = (id) => document.getElementById(id);
  const roomById = (id) => C.rooms.find((r) => r.id === id);
  const sameUser = (b) => user && b.email.toLowerCase() === user.email.toLowerCase();

  function toast(msg) {
    const t = el("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove("show"), 2800);
  }

  // ---- Rules ---------------------------------------------------------------
  function hoursUsed(email, dateStr) {
    return bookings
      .filter((b) => b.date === dateStr && b.email.toLowerCase() === email.toLowerCase())
      .reduce((sum, b) => sum + (b.end - b.start), 0);
  }

  function canBook(roomId, dateStr, slot) {
    if (!user) return "Enter your name and work email first.";
    if (slotIsPast(dateStr, slot)) return "That slot has already passed.";
    if (bookings.some((b) => b.roomId === roomId && b.date === dateStr && b.start === slot.start))
      return "That slot was just taken.";
    if (bookings.some((b) => sameUser(b) && b.date === dateStr && b.start === slot.start))
      return "You already have a booking at that time.";
    if (hoursUsed(user.email, dateStr) + C.blockHours > C.maxHoursPerPersonPerDay)
      return `Daily limit reached: ${C.maxHoursPerPersonPerDay}h per person per day.`;
    return null;
  }

  function book(roomId, dateStr, slot) {
    bookings = loadBookings(); // pick up changes from other tabs
    const err = canBook(roomId, dateStr, slot);
    if (err) { toast(err); render(); return; }
    bookings.push({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      roomId, date: dateStr, start: slot.start, end: slot.end,
      name: user.name, email: user.email, createdAt: new Date().toISOString(),
    });
    saveBookings(bookings);
    toast(`Booked ${roomById(roomId).name}, ${fmtDay(parseYmd(dateStr))} ${slot.label}`);
    render();
  }

  function cancel(id) {
    const b = bookings.find((x) => x.id === id);
    if (!b || !sameUser(b)) return;
    if (!confirm(`Cancel ${roomById(b.roomId)?.name || b.roomId} on ${fmtDay(parseYmd(b.date))}?`)) return;
    bookings = loadBookings().filter((x) => x.id !== id);
    saveBookings(bookings);
    toast("Booking cancelled — the slot is free for others.");
    render();
  }

  // ---- Rendering -----------------------------------------------------------
  function renderWho() {
    el("who-name").value = user?.name || "";
    el("who-email").value = user?.email || "";
    el("who-status").textContent = user ? `Booking as ${user.name}` : "Not set";
  }

  function renderRules() {
    const blocksPerDay = Math.floor(C.maxHoursPerPersonPerDay / C.blockHours);
    let used = user ? hoursUsed(user.email, selectedDay) : 0;
    el("rules").innerHTML =
      `Bookings are in <b>${C.blockHours}-hour blocks</b> (${pad(C.openHour)}:00–${pad(C.closeHour)}:00). ` +
      `Limit: <b>${C.maxHoursPerPersonPerDay}h per person per day</b> ` +
      `(${blocksPerDay} block${blocksPerDay === 1 ? "" : "s"}). Book up to ${C.bookingWindowDays} days ahead.` +
      (user ? ` <span class="muted">You've used ${used}h of ${C.maxHoursPerPersonPerDay}h on this day.</span>` : "");
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

    const capReached = user && hoursUsed(user.email, selectedDay) + C.blockHours > C.maxHoursPerPersonPerDay;
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
          btn.classList.add("taken"); btn.textContent = b.name; btn.disabled = true;
        } else if (slotIsPast(selectedDay, slot)) {
          btn.classList.add("past"); btn.textContent = "—"; btn.disabled = true;
        } else {
          btn.classList.add(capReached ? "blocked" : "free");
          btn.textContent = capReached ? "Limit reached" : "Book";
          btn.onclick = () => book(room.id, selectedDay, slot);
        }
        btn.title = `${room.name} · ${slot.label}`;
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
      (overall < 50 && total.capacity
        ? `<p class="hint">Utilisation is under 50% — consider raising <code>maxHoursPerPersonPerDay</code> in config.js.</p>`
        : overall >= 85
        ? `<p class="hint">Utilisation is 85%+ — demand is high; keep the 2h cap or consider shorter blocks.</p>`
        : "");
  }

  function exportCsv() {
    const head = ["date", "start", "end", "room", "type", "name", "email", "createdAt"];
    const esc = (v) => `"${String(v).replace(/"/g, '""')}"`;
    const lines = [head.join(",")].concat(
      bookings.map((b) => {
        const r = roomById(b.roomId);
        return [b.date, `${pad(b.start)}:00`, `${pad(b.end)}:00`, r?.name || b.roomId, r?.type || "", b.name, b.email, b.createdAt].map(esc).join(",");
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
    if (!name || !email) return;
    user = { name, email };
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
  window.addEventListener("storage", (e) => { if (e.key === STORE_KEY) { bookings = loadBookings(); render(); } });

  render();
})();
