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

  // ---- Look & feel ---------------------------------------------------------
  const ICON_PATHS = {
    logo: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
    sofa: '<path d="M20 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v3"/><path d="M2 16a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-5a2 2 0 0 0-4 0v1.5a.5.5 0 0 1-.5.5h-11a.5.5 0 0 1-.5-.5V11a2 2 0 0 0-4 0z"/><path d="M4 18v2M20 18v2"/>',
    monitor: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
    clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    timer: '<path d="M10 2h4M12 14l3-3"/><circle cx="12" cy="14" r="8"/>',
    phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/>',
    pin: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
    chart: '<path d="M3 3v18h18M18 17V9M13 17V5M8 17v-3"/>',
  };
  const icon = (name) => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${ICON_PATHS[name] || ""}</svg>`;

  // Colour and icon per room type; unknown types fall back to the brand style.
  const TYPE_STYLE = {
    "Relax Room": { cls: "t-relax", icon: "sofa" },
    "Mini Workpod": { cls: "t-pod", icon: "monitor" },
    "Discussion Room": { cls: "t-disc", icon: "users" },
  };
  const typeStyle = (t) => TYPE_STYLE[t] || { cls: "", icon: "logo" };

  const AVATAR_COLOURS = ["#6366F1", "#8B5CF6", "#EC4899", "#F97316", "#10B981", "#0EA5E9", "#14B8A6", "#EF4444"];
  function avatar(name, small) {
    const s = String(name || "?");
    let h = 0;
    for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    const initials = s.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";
    return `<span class="avatar${small ? " sm" : ""}" style="background:${AVATAR_COLOURS[h % AVATAR_COLOURS.length]}">${esc(initials)}</span>`;
  }

  const dow = (d) => d.toLocaleDateString(undefined, { weekday: "short" });
  const mon = (d) => d.toLocaleDateString(undefined, { month: "short" });
  const isToday = (d) => ymd(d) === ymd(new Date());
  const slotFor = (b) => SLOTS.find((s) => s.start === b.start) || { start: b.start, end: b.end, label: `${pad(b.start)}:00–${pad(b.end)}:00` };

  function freeCount(dateStr, type) {
    let n = 0;
    for (const room of C.rooms) {
      if (type && type !== "All" && room.type !== type) continue;
      for (const slot of SLOTS) {
        if (slotIsPast(dateStr, slot)) continue;
        if (!bookings.some((b) => b.roomId === room.id && b.date === dateStr && b.start === slot.start)) n++;
      }
    }
    return n;
  }

  // ---- Rendering -----------------------------------------------------------
  let editingWho = false;

  function renderWho() {
    const showForm = !user || editingWho;
    el("who").hidden = !showForm;
    el("who-name").value = user?.name || "";
    el("who-email").value = user?.email || "";
    el("who-phone").value = user?.phone || "";
    el("profile").innerHTML = user
      ? `<div class="who-chip">${avatar(user.name)}<div><strong>${esc(user.name)}</strong><small>${esc(user.phone)}</small></div>
           <button type="button" id="who-edit">${editingWho ? "Close" : "Edit"}</button></div>`
      : "";
    const edit = document.getElementById("who-edit");
    if (edit) edit.onclick = () => { editingWho = !editingWho; renderWho(); };
  }

  function renderRules() {
    const rule = (ic, title, text) =>
      `<div class="rule"><div class="ic">${icon(ic)}</div><div><strong>${title}</strong><span>${text}</span></div></div>`;
    let limit = C.maxHoursPerPersonPerDay
      ? rule("calendar", `Up to ${C.maxHoursPerPersonPerDay}h per person a day`,
          user ? `You've used ${hoursUsed(user.email, selectedDay)}h on this day` : `Book up to ${C.bookingWindowDays} days ahead`)
      : rule("calendar", `Book up to ${C.bookingWindowDays} days ahead`, "As many blocks as you need, one room at a time");
    el("rules").innerHTML =
      rule("clock", `${C.blockHours}-hour blocks`, `${pad(C.openHour)}:00 – ${pad(C.closeHour)}:00 on ${C.allowWeekends ? "all days" : "weekdays"}`) +
      limit +
      rule("timer", `${C.noShowReleaseMinutes}-minute no-show rule`, "No one there? Anyone may use the room") +
      rule("phone", "Questions about a booking?", "Call the booker — their number is on the slot");
    el("banner").innerHTML = store !== localStore ? "" :
      `<div class="banner">${icon("info")} Prototype mode: bookings are saved in this browser only.</div>`;
  }

  function renderDays() {
    el("days").innerHTML = "";
    for (const d of days) {
      const b = document.createElement("button");
      const free = freeCount(ymd(d), "All");
      b.className = "day" + (ymd(d) === selectedDay ? " active" : "");
      b.innerHTML = `<div class="dow">${isToday(d) ? "Today" : dow(d)}</div><div class="num">${d.getDate()}</div>
        <div class="mon">${mon(d)}</div><div class="free-n${free ? "" : " none"}">${free ? free + " free" : "Full"}</div>`;
      b.onclick = () => { selectedDay = ymd(d); render(); };
      el("days").appendChild(b);
    }
  }

  function renderTypes() {
    el("types").innerHTML = "";
    for (const t of types) {
      const st = typeStyle(t);
      const rooms = t === "All" ? C.rooms.length : C.rooms.filter((r) => r.type === t).length;
      const free = freeCount(selectedDay, t);
      const b = document.createElement("button");
      b.className = `type-card ${st.cls}` + (t === selectedType ? " active" : "");
      b.innerHTML = `<div class="ic">${icon(st.icon)}</div><div><strong>${t === "All" ? "All rooms" : t + "s"}</strong>
        <span>${rooms} room${rooms === 1 ? "" : "s"} · ${free} slot${free === 1 ? "" : "s"} free</span></div>`;
      b.onclick = () => { selectedType = t; render(); };
      el("types").appendChild(b);
    }
  }

  function renderGrid() {
    const d = parseYmd(selectedDay);
    el("grid-title").textContent =
      `${selectedType === "All" ? "All rooms" : selectedType + "s"} · ${d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}`;

    const grid = el("grid");
    grid.innerHTML = "";
    const head = grid.insertRow();
    head.className = "head";
    head.innerHTML = `<th class="room">Room</th>` + SLOTS.map((s) => `<th>${s.label}</th>`).join("");

    const atCap = capReached(selectedDay);
    let lastType = null;
    for (const room of C.rooms) {
      if (selectedType !== "All" && room.type !== selectedType) continue;
      const st = typeStyle(room.type);
      if (room.type !== lastType && selectedType === "All") {
        const g = grid.insertRow();
        g.className = `group ${st.cls}`;
        g.innerHTML = `<th colspan="${SLOTS.length + 1}"><span class="group-label"><i class="dot"></i>${room.type}s</span></th>`;
      }
      lastType = room.type;

      const tr = grid.insertRow();
      tr.className = st.cls;
      const th = document.createElement("th");
      th.className = "room";
      th.innerHTML = `<div class="room-cell"><div class="ic">${icon(st.icon)}</div><div><strong>${esc(room.name)}</strong>
        <small>${icon("pin")} ${esc(room.location)} · ${room.capacity} pax</small></div></div>`;
      tr.appendChild(th);

      for (const slot of SLOTS) {
        const td = tr.insertCell();
        const btn = document.createElement("button");
        btn.className = "slot";
        const b = bookings.find((x) => x.roomId === room.id && x.date === selectedDay && x.start === slot.start);
        if (b && sameUser(b)) {
          btn.classList.add("mine");
          btn.innerHTML = `<span>${icon("check")} Yours</span><small>Tap to cancel</small>`;
          btn.onclick = () => cancel(b.id);
        } else if (b) {
          btn.classList.add("taken"); btn.disabled = true;
          btn.innerHTML = `${avatar(b.name, true)}<span class="who"><span>${esc(b.name)}</span><small>${icon("phone")} ${esc(b.phone || "")}</small></span>`;
        } else if (slotIsPast(selectedDay, slot)) {
          btn.classList.add("past"); btn.textContent = "Past"; btn.disabled = true;
        } else if (atCap) {
          btn.classList.add("blocked"); btn.textContent = "Limit reached";
          btn.onclick = () => book(room.id, selectedDay, slot);
        } else {
          btn.classList.add("free"); btn.innerHTML = `${icon("plus")} Book`;
          btn.onclick = () => book(room.id, selectedDay, slot);
        }
        btn.title = `${room.name} · ${slot.label}` + (b ? ` · booked by ${b.name}, ${b.phone || ""}` : "");
        td.appendChild(btn);
      }
    }
  }

  function renderMine() {
    const list = el("mine-list");
    const empty = (ic, title, text) =>
      `<div class="card empty"><div class="ic">${icon(ic)}</div><strong>${title}</strong>${text}</div>`;
    const mine = user
      ? bookings.filter((b) => sameUser(b) && !slotIsPast(b.date, b))
          .sort((a, b) => (a.date + pad(a.start)).localeCompare(b.date + pad(b.start)))
      : [];
    el("mine-count").hidden = !mine.length;
    el("mine-count").textContent = mine.length;
    if (!user) { list.innerHTML = empty("users", "Who's booking?", "Enter your details at the top to see your bookings."); return; }
    if (!mine.length) { list.innerHTML = empty("calendar", "No upcoming bookings", "Head to “Book a room” to grab a slot."); return; }
    list.innerHTML = "";
    for (const b of mine) {
      const room = roomById(b.roomId);
      const st = typeStyle(room?.type);
      const d = parseYmd(b.date);
      const card = document.createElement("div");
      card.className = `card booking ${st.cls}`;
      card.innerHTML = `<div class="date-tile"><div class="dow">${isToday(d) ? "Today" : dow(d)}</div><div class="num">${d.getDate()}</div><div class="dow">${mon(d)}</div></div>
        <div class="info"><strong>${icon(st.icon)} ${esc(room?.name || b.roomId)}</strong>
        <span><em>${icon("clock")} ${slotFor(b).label}</em><em>${icon("pin")} ${esc(room?.location || "")}</em></span></div>`;
      const btn = document.createElement("button");
      btn.className = "btn-cancel";
      btn.innerHTML = `${icon("x")} Cancel`;
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
    const pct = (u, c) => (c ? Math.round((u / c) * 100) : 0);

    const typeRows = types.filter((t) => t !== "All").map((t) => {
      const rooms = C.rooms.filter((r) => r.type === t);
      const capacity = rooms.length * SLOTS.length * dayStrs.length;
      const used = inRange.filter((b) => roomById(b.roomId)?.type === t).length;
      return { label: t + "s", st: typeStyle(t), used, capacity };
    });
    const slotRows = SLOTS.map((s) => ({
      label: s.label, st: { cls: "", icon: "clock" },
      used: inRange.filter((b) => b.start === s.start).length, capacity: C.rooms.length * dayStrs.length,
    }));
    const total = typeRows.reduce((a, r) => ({ used: a.used + r.used, capacity: a.capacity + r.capacity }), { used: 0, capacity: 0 });
    const overall = pct(total.used, total.capacity);
    const people = new Set(inRange.map((b) => b.email.toLowerCase())).size;

    const rows = (list) => list.map((r) => `
      <div class="urow ${r.st.cls}"><div class="lbl"><span class="ic">${icon(r.st.icon)}</span>${r.label}</div>
        <div class="bar"><i style="width:${pct(r.used, r.capacity)}%"></i></div><div class="n">${pct(r.used, r.capacity)}%</div>
        <div class="sub">${r.used} of ${r.capacity} blocks</div></div>`).join("");
    const stat = (k, v, cls = "") => `<div class="card stat ${cls}"><div class="k">${k}</div><div class="v">${v}</div></div>`;

    el("usage").innerHTML =
      `<div class="stats">${stat("Overall utilisation", overall + "%", "hero-stat")}${stat("Bookings", total.used)}${stat("People", people)}${stat("Working days", dayStrs.length)}</div>
       <div class="usage-cols">
         <div class="card usage-card"><h3>By room type</h3>${rows(typeRows)}</div>
         <div class="card usage-card"><h3>By time block</h3>${rows(slotRows)}</div>
       </div>` +
      (overall < 50 && total.capacity && C.maxHoursPerPersonPerDay
        ? `<div class="hint">${icon("info")} Utilisation is under 50% — consider raising <code>maxHoursPerPersonPerDay</code> in config.js.</div>`
        : overall >= 85
        ? `<div class="hint">${icon("info")} Utilisation is 85%+ — demand is high; consider a per-person cap (<code>maxHoursPerPersonPerDay</code>) or shorter blocks.</div>`
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
    editingWho = false;
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

  el("logo").innerHTML = icon("logo");
  el("export").innerHTML = `${icon("download")} Export CSV`;
  render();
  refresh();
})();
