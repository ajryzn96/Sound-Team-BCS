const STORAGE_KEY = "sounddesk-school-events-v1";
const EQUIPMENT_STORAGE_KEY = "myown-equipment-register-v1";
const EQUIPMENT_TYPES = ["Mixer", "Microphones", "Speakers", "Wireless systems", "XLR cables", "DI boxes", "Lighting equipment", "Lighting Console"];
const EQUIPMENT_ICONS = ["≋", "♩", "▥", "⌁", "⌁", "◈", "✧", "▤"];
const seedEvents = [
  { id: "culture-day", name: "Culture Day", date: "2026-11-20", time: "09:00", location: "Main Hall", requirements: ["Speakers", "Wireless systems", "Mixer"], notes: "Sound check and stage setup from 08:30." },
  { id: "christmas-quiz", name: "Christmas quiz", date: "2026-12-11", time: "13:30", location: "Assembly Hall", requirements: ["Speakers", "Microphones"], notes: "Four wireless microphones needed." },
  { id: "school-concert", name: "School concert", date: "2026-12-17", time: "18:00", location: "Main Hall", requirements: ["Speakers", "Microphones", "Mixer", "XLR cables"], notes: "Evening performance." }
];

const pageTitle = document.querySelector("#page-title");
const dashboardView = document.querySelector("#dashboard-view");
const views = {
  dashboard: dashboardView,
  events: document.querySelector("#events-view"),
  team: document.querySelector("#team-view"),
  equipment: document.querySelector("#equipment-view")
};
const pageNames = { dashboard: "Dashboard", events: "Events", team: "Sound team", equipment: "Equipment" };
const dialog = document.querySelector("#event-dialog");
const eventForm = document.querySelector("#event-form");
const equipmentDialog = document.querySelector("#equipment-dialog");
const equipmentForm = document.querySelector("#equipment-form");
const eventSearch = document.querySelector("#event-search");
let activeFilter = "all";
let toastTimer;

function loadEvents() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (Array.isArray(saved)) return saved.filter(isValidEvent);
  } catch { /* Use the starter calendar if browser storage is unavailable. */ }
  return [...seedEvents];
}

function isValidEvent(event) {
  return event && typeof event.id === "string" && typeof event.name === "string" && /^\d{4}-\d{2}-\d{2}$/.test(event.date);
}

let events = loadEvents();
let equipment = loadEquipment();

function loadEquipment() {
  try {
    const saved = JSON.parse(localStorage.getItem(EQUIPMENT_STORAGE_KEY));
    if (Array.isArray(saved)) return saved.filter((item) => item && typeof item.id === "string" && EQUIPMENT_TYPES.includes(item.type) && typeof item.name === "string");
  } catch { /* Start with an empty register if browser storage is unavailable. */ }
  return [];
}

function normalizeRequirement(item) {
  const aliases = { "PA speakers": "Speakers", "Wireless microphones": "Microphones", "Mixing desk": "Mixer", "Cables & stands": "XLR cables" };
  return aliases[item] || item;
}

function persistEvents() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(events)); }
  catch { showToast("Changes are saved for this session only."); }
}

function persistEquipment() {
  try { localStorage.setItem(EQUIPMENT_STORAGE_KEY, JSON.stringify(equipment)); }
  catch { showToast("Changes are saved for this session only."); }
}

function localDate(dateString) {
  const [year, month, day] = dateString.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function startOfToday() {
  const date = new Date();
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function dateParts(dateString) {
  const date = localDate(dateString);
  return {
    day: new Intl.DateTimeFormat("en", { day: "2-digit" }).format(date),
    month: new Intl.DateTimeFormat("en", { month: "short" }).format(date).toUpperCase(),
    weekday: new Intl.DateTimeFormat("en", { weekday: "short" }).format(date),
    long: new Intl.DateTimeFormat("en", { weekday: "short", month: "short", day: "numeric", year: "numeric" }).format(date)
  };
}

function sortedEvents() {
  return [...events].sort((a, b) => localDate(a.date) - localDate(b.date) || (a.time || "").localeCompare(b.time || ""));
}

function upcomingEvents() {
  const today = startOfToday();
  return sortedEvents().filter((event) => localDate(event.date) >= today);
}

function formatTime(time) {
  if (!time) return "Time to be confirmed";
  const [hours, minutes] = time.split(":").map(Number);
  return new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit" }).format(new Date(2020, 0, 1, hours, minutes));
}

function eventRequirements(event) {
  return Array.isArray(event.requirements) ? event.requirements.map(normalizeRequirement) : [];
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

function eventRow(event, showActions = false) {
  const date = dateParts(event.date);
  const details = [date.weekday, formatTime(event.time), event.location].filter(Boolean).join(" · ");
  return `<article class="${showActions ? "managed-event" : "event-row"}" data-event-id="${escapeHtml(event.id)}">
    <span class="event-type-marker" aria-hidden="true"></span>
    <span class="date-tile"><span>${date.month}</span><strong>${date.day}</strong></span>
    <span class="event-row-copy"><strong>${escapeHtml(event.name)}</strong><small>${escapeHtml(details)}</small>${eventRequirements(event).length ? `<span class="event-requirements">Kit · ${eventRequirements(event).map(escapeHtml).join(" · ")}</span>` : ""}${showActions && event.notes ? `<span class="managed-notes">${escapeHtml(event.notes)}</span>` : ""}</span>
    ${showActions ? `<span class="managed-event-actions"><span class="status-pill ${localDate(event.date) < startOfToday() ? "" : "ready"}">${localDate(event.date) < startOfToday() ? "Past event" : "Scheduled"}</span><button class="small-action" type="button" data-action="edit" data-id="${escapeHtml(event.id)}">Edit</button><button class="small-action delete" type="button" data-action="delete" data-id="${escapeHtml(event.id)}">Delete</button></span>` : `<button class="row-menu" type="button" data-action="edit" data-id="${escapeHtml(event.id)}" aria-label="Edit ${escapeHtml(event.name)}">···</button>`}
  </article>`;
}

function renderDashboard() {
  const upcoming = upcomingEvents();
  document.querySelector("#dashboard-event-list").innerHTML = upcoming.length
    ? upcoming.slice(0, 4).map((event) => eventRow(event)).join("")
    : `<div class="empty-state">No upcoming events yet. Create one to get started.</div>`;

  const count = upcoming.length;
  document.querySelector("#summary-event-total").textContent = count;
  document.querySelector("#event-count").textContent = count;
  document.querySelector("#all-events-count").textContent = events.length;
  const next = upcoming[0];
  if (next) {
    const days = Math.ceil((localDate(next.date) - startOfToday()) / 86400000);
    document.querySelector("#next-event-days").textContent = days === 0 ? "today" : days === 1 ? "tomorrow" : `${days} days`;
    document.querySelectorAll(".duty-name").forEach((node) => node.textContent = next.name);
    const parts = dateParts(next.date);
    document.querySelector(".duty-date").innerHTML = `<span>${parts.month}</span><strong>${parts.day}</strong><small>${parts.weekday.toUpperCase()}</small>`;
    document.querySelector(".duty-details>span").textContent = `${formatTime(next.time)} setup · ${next.location || "Location TBC"}`;
  } else {
    document.querySelector("#next-event-days").textContent = "none scheduled";
    document.querySelectorAll(".duty-name").forEach((node) => node.textContent = "No duty scheduled");
  }

  const label = new Intl.DateTimeFormat("en", { weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(new Date()).toUpperCase();
  document.querySelector("#welcome-date").textContent = label;
  document.querySelector("#today-label").textContent = new Intl.DateTimeFormat("en", { weekday: "short", month: "short", day: "numeric" }).format(new Date());
}

function renderEvents() {
  const query = (eventSearch?.value || "").trim().toLowerCase();
  const today = startOfToday();
  const filtered = sortedEvents().filter((event) => {
    const past = localDate(event.date) < today;
    const matchesFilter = activeFilter === "all" || (activeFilter === "past" ? past : !past);
    const matchesSearch = !query || `${event.name} ${event.location || ""} ${event.notes || ""}`.toLowerCase().includes(query);
    return matchesFilter && matchesSearch;
  });
  document.querySelector("#managed-event-list").innerHTML = filtered.length
    ? filtered.map((event) => eventRow(event, true)).join("")
    : `<div class="empty-state">${query ? "No events match your search." : "No events here yet. Add one to your calendar."}</div>`;
}

function renderTeam() {
  const duties = upcomingEvents();
  document.querySelector("#team-duty-list").innerHTML = duties.length
    ? duties.map((event) => {
      const date = dateParts(event.date);
      const gear = eventRequirements(event).length ? ` · Kit: ${eventRequirements(event).join(", ")}` : "";
      const details = `${date.long} · ${formatTime(event.time)} · ${event.location || "Location TBC"}${gear}`;
      return `<div class="team-duty-item"><span class="date-tile"><span>${date.month}</span><strong>${date.day}</strong></span><span class="event-row-copy"><strong>${escapeHtml(event.name)}</strong><small>${escapeHtml(details)}</small></span><span class="status-pill assigned">Sound duty</span></div>`;
    }).join("")
    : `<div class="empty-state">Create an event to start planning sound duties.</div>`;
}

function renderUpcomingRequirements() {
  const upcoming = upcomingEvents().filter((event) => eventRequirements(event).length);
  document.querySelector("#upcoming-requirements-list").innerHTML = upcoming.length
    ? upcoming.map((event) => {
      const date = dateParts(event.date);
      return `<div class="upcoming-requirement"><span class="date-tile"><span>${date.month}</span><strong>${date.day}</strong></span><span class="requirement-event-copy"><strong>${escapeHtml(event.name)}</strong><small>${escapeHtml(event.location || "Location TBC")}</small></span><span class="requirement-tags">${eventRequirements(event).map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</span></div>`;
    }).join("")
    : `<div class="empty-state">Add equipment requirements to an upcoming event to see them here.</div>`;
}

function conditionClass(condition) {
  if (condition === "Ready") return "ready";
  if (condition === "Needs repair") return "needs-repair";
  return "attention";
}

function renderEquipment() {
  const total = equipment.length;
  const ready = equipment.filter((item) => item.condition === "Ready").length;
  const attention = total - ready;
  const equipmentAlert = document.querySelector("#equipment-alert");
  equipmentAlert.hidden = attention === 0;
  equipmentAlert.setAttribute("aria-label", `${attention} equipment items need attention`);
  document.querySelector("#equipment-total-count").textContent = total;
  document.querySelector("#equipment-ready-count").textContent = ready;
  document.querySelector("#equipment-attention-count").textContent = attention;
  document.querySelector("#equipment-summary-total").innerHTML = `${total} <small>${total === 1 ? "piece" : "pieces"}</small>`;
  document.querySelector("#equipment-summary-note").textContent = total ? `${ready} ready · ${attention} need attention` : "Across 8 equipment types";
  document.querySelector("#equipment-type-total").textContent = `${EQUIPMENT_TYPES.length} types · ${total} ${total === 1 ? "item" : "items"}`;

  document.querySelector("#equipment-catalog").innerHTML = EQUIPMENT_TYPES.map((type, index) => {
    const items = equipment.filter((item) => item.type === type);
    const records = items.length
      ? items.map((item) => {
        const details = [item.assetNumber ? `ID ${item.assetNumber}` : "No asset ID", item.location || "Location not set"].join(" · ");
        return `<div class="equipment-record"><span class="equipment-record-icon equipment-tone-${index % 4}">${EQUIPMENT_ICONS[index]}</span><span class="equipment-record-copy"><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(details)}</small></span><span class="status-pill ${conditionClass(item.condition)}">${escapeHtml(item.condition || "Needs check")}</span><span class="equipment-record-actions"><button class="small-action" type="button" data-equipment-action="edit" data-id="${escapeHtml(item.id)}">Edit</button><button class="small-action delete" type="button" data-equipment-action="delete" data-id="${escapeHtml(item.id)}">Delete</button></span></div>`;
      }).join("")
      : `<div class="equipment-empty">No individual items recorded yet.</div>`;
    return `<section class="equipment-category"><div class="equipment-category-heading"><span class="equipment-record-icon equipment-tone-${index % 4}">${EQUIPMENT_ICONS[index]}</span><div><h3>${escapeHtml(type)}</h3><small>${items.length} ${items.length === 1 ? "item" : "items"} recorded</small></div><button class="small-action add-item-action" type="button" data-add-equipment data-type="${escapeHtml(type)}">+ Add item</button></div><div class="equipment-record-list">${records}</div></section>`;
  }).join("");

  const summary = document.querySelector("#dashboard-equipment-summary");
  if (!total) {
    summary.innerHTML = `<div class="equipment-register-empty"><span>No items recorded yet</span><button class="small-action" type="button" data-page="equipment">Start inventory →</button></div>`;
  } else {
    const groups = EQUIPMENT_TYPES.map((type) => ({ type, items: equipment.filter((item) => item.type === type) })).filter((group) => group.items.length).slice(0, 3);
    summary.innerHTML = groups.map((group) => {
      const groupReady = group.items.filter((item) => item.condition === "Ready").length;
      const groupAttention = group.items.length - groupReady;
      const status = groupAttention ? `<span class="status-pill attention">${groupAttention} check</span>` : `<span class="status-pill ready">Ready</span>`;
      const iconIndex = EQUIPMENT_TYPES.indexOf(group.type);
      return `<div class="equipment-status-row"><span class="equipment-record-icon equipment-tone-${iconIndex % 4}">${EQUIPMENT_ICONS[iconIndex]}</span><span class="equipment-label"><strong>${escapeHtml(group.type)}</strong><small>${group.items.length} ${group.items.length === 1 ? "item" : "items"} · ${groupReady} ready</small></span>${status}</div>`;
    }).join("");
  }
}

function render() {
  renderDashboard();
  renderEvents();
  renderTeam();
  renderUpcomingRequirements();
  renderEquipment();
}

function navigate(page) {
  if (!views[page]) return;
  Object.entries(views).forEach(([key, view]) => { view.hidden = key !== page; });
  pageTitle.textContent = pageNames[page];
  document.querySelectorAll(".nav-button[data-page]").forEach((button) => button.classList.toggle("active", button.dataset.page === page));
  if (page === "events") renderEvents();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function showToast(message) {
  const toast = document.querySelector("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2600);
}

function openEventDialog(event = null) {
  eventForm.reset();
  document.querySelector("#event-id").value = event?.id || "";
  document.querySelector("#dialog-title").textContent = event ? "Edit event" : "Create an event";
  document.querySelector("#save-event").textContent = event ? "Save changes" : "Create event";
  document.querySelector("#event-name").value = event?.name || "";
  document.querySelector("#event-date").value = event?.date || "";
  document.querySelector("#event-time").value = event?.time || "";
  document.querySelector("#event-location").value = event?.location || "";
  document.querySelector("#event-notes").value = event?.notes || "";
  const selectedRequirements = new Set(eventRequirements(event || {}));
  document.querySelectorAll('input[name="requirements"]').forEach((input) => { input.checked = selectedRequirements.has(input.value); });
  dialog.showModal();
  document.querySelector("#event-name").focus();
}

function openEquipmentDialog(item = null, type = EQUIPMENT_TYPES[0]) {
  equipmentForm.reset();
  document.querySelector("#equipment-id").value = item?.id || "";
  document.querySelector("#equipment-dialog-title").textContent = item ? "Edit equipment" : "Add equipment";
  document.querySelector("#save-equipment").textContent = item ? "Save changes" : "Add item";
  document.querySelector("#equipment-type").value = item?.type || type;
  document.querySelector("#equipment-name").value = item?.name || "";
  document.querySelector("#equipment-serial").value = item?.assetNumber || "";
  document.querySelector("#equipment-condition").value = item?.condition || "Ready";
  document.querySelector("#equipment-location").value = item?.location || "";
  equipmentDialog.showModal();
  document.querySelector("#equipment-name").focus();
}

document.querySelector("#equipment-type").innerHTML = EQUIPMENT_TYPES.map((type) => `<option value="${escapeHtml(type)}">${escapeHtml(type)}</option>`).join("");

document.addEventListener("click", (event) => {
  const pageButton = event.target.closest("[data-page]");
  if (pageButton) navigate(pageButton.dataset.page);

  if (event.target.closest("[data-create-event]")) openEventDialog();

  const addEquipmentButton = event.target.closest("[data-add-equipment]");
  if (addEquipmentButton) openEquipmentDialog(null, addEquipmentButton.dataset.type || EQUIPMENT_TYPES[0]);

  const actionButton = event.target.closest("[data-action]");
  if (actionButton) {
    const selected = events.find((item) => item.id === actionButton.dataset.id);
    if (actionButton.dataset.action === "edit" && selected) openEventDialog(selected);
    if (actionButton.dataset.action === "delete" && selected && window.confirm(`Delete “${selected.name}” from the calendar?`)) {
      events = events.filter((item) => item.id !== selected.id);
      persistEvents();
      render();
      showToast("Event deleted.");
    }
  }

  const equipmentAction = event.target.closest("[data-equipment-action]");
  if (equipmentAction) {
    const selectedItem = equipment.find((item) => item.id === equipmentAction.dataset.id);
    if (equipmentAction.dataset.equipmentAction === "edit" && selectedItem) openEquipmentDialog(selectedItem);
    if (equipmentAction.dataset.equipmentAction === "delete" && selectedItem && window.confirm(`Remove “${selectedItem.name}” from the equipment register?`)) {
      equipment = equipment.filter((item) => item.id !== selectedItem.id);
      persistEquipment();
      renderEquipment();
      showToast("Equipment record removed.");
    }
  }
});

document.querySelectorAll(".filter-tab").forEach((tab) => tab.addEventListener("click", () => {
  activeFilter = tab.dataset.filter;
  document.querySelectorAll(".filter-tab").forEach((item) => item.classList.toggle("selected", item === tab));
  renderEvents();
}));

eventSearch.addEventListener("input", renderEvents);
document.querySelector("#close-dialog").addEventListener("click", () => dialog.close());
document.querySelector("#cancel-dialog").addEventListener("click", () => dialog.close());
document.querySelector("#close-equipment-dialog").addEventListener("click", () => equipmentDialog.close());
document.querySelector("#cancel-equipment-dialog").addEventListener("click", () => equipmentDialog.close());

eventForm.addEventListener("submit", (submitEvent) => {
  submitEvent.preventDefault();
  if (!eventForm.reportValidity()) return;
  const id = document.querySelector("#event-id").value || (globalThis.crypto?.randomUUID?.() ?? `event-${Date.now()}`);
  const wasEditing = Boolean(document.querySelector("#event-id").value);
  const nextEvent = {
    id,
    name: document.querySelector("#event-name").value.trim(),
    date: document.querySelector("#event-date").value,
    time: document.querySelector("#event-time").value,
    location: document.querySelector("#event-location").value.trim(),
    requirements: [...document.querySelectorAll('input[name="requirements"]:checked')].map((input) => input.value),
    notes: document.querySelector("#event-notes").value.trim()
  };
  events = wasEditing ? events.map((item) => item.id === id ? nextEvent : item) : [...events, nextEvent];
  persistEvents();
  render();
  dialog.close();
  navigate("events");
  showToast(wasEditing ? "Event updated." : "Event added to the calendar.");
});

equipmentForm.addEventListener("submit", (submitEvent) => {
  submitEvent.preventDefault();
  if (!equipmentForm.reportValidity()) return;
  const idField = document.querySelector("#equipment-id");
  const id = idField.value || (globalThis.crypto?.randomUUID?.() ?? `equipment-${Date.now()}`);
  const wasEditing = Boolean(idField.value);
  const item = {
    id,
    type: document.querySelector("#equipment-type").value,
    name: document.querySelector("#equipment-name").value.trim(),
    assetNumber: document.querySelector("#equipment-serial").value.trim(),
    condition: document.querySelector("#equipment-condition").value,
    location: document.querySelector("#equipment-location").value.trim()
  };
  equipment = wasEditing ? equipment.map((existing) => existing.id === id ? item : existing) : [...equipment, item];
  persistEquipment();
  renderEquipment();
  equipmentDialog.close();
  navigate("equipment");
  showToast(wasEditing ? "Equipment record updated." : "Equipment item recorded.");
});

document.querySelector("#notifications-button").addEventListener("click", () => showToast("You’re all caught up."));
document.querySelector(".profile-button").addEventListener("click", () => showToast("Signed in as Aaron."));

render();
