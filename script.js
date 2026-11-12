import { auth, db } from "./firebase/firebase-config.js";
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  updateProfile
} from "https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js";
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  setDoc
} from "https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js";

const LEGACY_EVENTS_KEY = "sounddesk-school-events-v1";
const LEGACY_EQUIPMENT_KEY = "myown-equipment-register-v1";
const EQUIPMENT_TYPES = ["Mixer", "Microphones", "Speakers", "Wireless systems", "XLR cables", "DI boxes", "Lighting equipment", "Lighting Console"];
const EQUIPMENT_ICONS = ["≋", "♩", "▥", "⌁", "⌁", "◈", "✧", "▤"];
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
const authScreen = document.querySelector("#auth-screen");
const appShell = document.querySelector("#app-shell");
const loadingScreen = document.querySelector("#loading-screen");
const loadingMessage = document.querySelector("#loading-message");
const authForm = document.querySelector("#auth-form");
const authMessage = document.querySelector("#auth-message");
const authSubmit = document.querySelector("#auth-submit");
const authSubmitLabel = authSubmit.querySelector("span");
let authMode = "signin";
let activeFilter = "all";
let toastTimer;
let events = [];
let equipment = [];
let eventUnsubscribe = null;
let equipmentUnsubscribe = null;
let workspaceGeneration = 0;
let initialEventSnapshot = false;
let initialEquipmentSnapshot = false;

function readLegacyData(key, validator) {
  try {
    const saved = JSON.parse(localStorage.getItem(key));
    if (Array.isArray(saved)) return saved.filter(validator);
  } catch { /* Ignore missing or malformed browser cache during migration. */ }
  return [];
}

function isValidEvent(event) {
  if (!event || typeof event.id !== "string" || typeof event.name !== "string" || typeof event.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(event.date)) return false;
  const [year, month, day] = event.date.split("-").map(Number);
  const date = localDate(event.date);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

function readLegacyEvents() { return readLegacyData(LEGACY_EVENTS_KEY, isValidEvent); }
function readLegacyEquipment() { return readLegacyData(LEGACY_EQUIPMENT_KEY, (item) => item && typeof item.id === "string" && EQUIPMENT_TYPES.includes(item.type) && typeof item.name === "string"); }

function normalizeRequirement(item) {
  const aliases = { "PA speakers": "Speakers", "Wireless microphones": "Microphones", "Mixing desk": "Mixer", "Cables & stands": "XLR cables" };
  return aliases[item] || item;
}

function eventsCollection() { return collection(db, "schools", "bcs", "events"); }
function equipmentCollection() { return collection(db, "schools", "bcs", "equipment"); }
function eventDocument(id) { return doc(db, "schools", "bcs", "events", id); }
function equipmentDocument(id) { return doc(db, "schools", "bcs", "equipment", id); }

function setSyncStatus(label, state = "ok") {
  const status = document.querySelector("#sync-status");
  status.dataset.state = state;
  status.querySelector("span").textContent = label;
}

function showLoading(message) {
  loadingMessage.textContent = message;
  loadingScreen.hidden = false;
}

function hideLoading() {
  loadingScreen.hidden = true;
}

function finishWorkspaceLoading(generation) {
  if (generation === workspaceGeneration && initialEventSnapshot && initialEquipmentSnapshot) hideLoading();
}

function firestoreErrorMessage(error) {
  if (error?.code === "permission-denied") return "Firestore rules blocked this save. Allow signed-in BCS team members to read and write schools/bcs.";
  if (error?.code === "unauthenticated") return "Your sign-in expired. Sign in again to save changes.";
  if (error?.code === "unavailable" || error?.code === "network-request-failed") return "The database is unreachable. Check your connection and try again.";
  return "Firestore couldn’t save this change. Check the database connection and rules.";
}

function reportFirestoreError(error) {
  setSyncStatus("Database error", "error");
  showToast(firestoreErrorMessage(error));
}

async function connectWorkspaceData(generation) {
  initialEventSnapshot = false;
  initialEquipmentSnapshot = false;
  showLoading("Loading your BCS workspace…");
  setSyncStatus("Connecting to BCS database…", "busy");
  try {
    const [remoteEvents, remoteEquipment] = await Promise.all([
      getDocs(eventsCollection()),
      getDocs(equipmentCollection())
    ]);
    if (generation !== workspaceGeneration) return;

    // Move browser records created before Firestore was wired up into the cloud once.
    const remoteEventIds = new Set(remoteEvents.docs.map((item) => item.id));
    const legacyEvents = readLegacyEvents().filter((item) => !remoteEventIds.has(item.id));
    await Promise.all(legacyEvents.map((item) => setDoc(eventDocument(item.id), item)));

    const remoteEquipmentIds = new Set(remoteEquipment.docs.map((item) => item.id));
    const legacyEquipment = readLegacyEquipment().filter((item) => !remoteEquipmentIds.has(item.id));
    await Promise.all(legacyEquipment.map((item) => setDoc(equipmentDocument(item.id), item)));
    if (generation !== workspaceGeneration) return;

    eventUnsubscribe?.();
    equipmentUnsubscribe?.();
    eventUnsubscribe = onSnapshot(eventsCollection(), (snapshot) => {
      if (generation !== workspaceGeneration) return;
      events = snapshot.docs.map((item) => ({ ...item.data(), id: item.id })).filter(isValidEvent);
      render();
      initialEventSnapshot = true;
      finishWorkspaceLoading(generation);
      setSyncStatus("Synced with BCS", "ok");
    }, (error) => {
      if (generation !== workspaceGeneration) return;
      hideLoading();
      reportFirestoreError(error);
    });
    equipmentUnsubscribe = onSnapshot(equipmentCollection(), (snapshot) => {
      if (generation !== workspaceGeneration) return;
      equipment = snapshot.docs.map((item) => ({ ...item.data(), id: item.id })).filter((item) => item && typeof item.name === "string" && EQUIPMENT_TYPES.includes(item.type));
      render();
      initialEquipmentSnapshot = true;
      finishWorkspaceLoading(generation);
      setSyncStatus("Synced with BCS", "ok");
    }, (error) => {
      if (generation !== workspaceGeneration) return;
      hideLoading();
      reportFirestoreError(error);
    });
  } catch (error) {
    if (generation === workspaceGeneration) {
      hideLoading();
      reportFirestoreError(error);
    }
  }
}

async function saveEventRecord(event) {
  setSyncStatus("Saving event…", "busy");
  await setDoc(eventDocument(event.id), event);
  events = [...events.filter((item) => item.id !== event.id), event];
  render();
  setSyncStatus("All changes saved", "ok");
}

async function removeEventRecord(id) {
  setSyncStatus("Removing event…", "busy");
  await deleteDoc(eventDocument(id));
  events = events.filter((item) => item.id !== id);
  render();
  setSyncStatus("All changes saved", "ok");
}

async function saveEquipmentRecord(item) {
  setSyncStatus("Saving equipment…", "busy");
  await setDoc(equipmentDocument(item.id), item);
  equipment = [...equipment.filter((existing) => existing.id !== item.id), item];
  render();
  setSyncStatus("All changes saved", "ok");
}

async function removeEquipmentRecord(id) {
  setSyncStatus("Removing equipment…", "busy");
  await deleteDoc(equipmentDocument(id));
  equipment = equipment.filter((item) => item.id !== id);
  render();
  setSyncStatus("All changes saved", "ok");
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
    const dutyDetails = `${formatTime(next.time)} setup · ${next.location || "Location TBC"}`;
    document.querySelector(".duty-details>span").textContent = dutyDetails;
    document.querySelector("#next-duty-details").textContent = `${parts.weekday}, ${parts.month} ${parts.day} · ${next.location || "Location TBC"}`;
  } else {
    document.querySelector("#next-event-days").textContent = "none scheduled";
    document.querySelectorAll(".duty-name").forEach((node) => node.textContent = "No duty scheduled");
    document.querySelector(".duty-date").innerHTML = "<span>—</span><strong>—</strong><small>—</small>";
    document.querySelector(".duty-details>span").textContent = "No upcoming event scheduled";
    document.querySelector("#next-duty-details").textContent = "No upcoming event scheduled";
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
  const next = duties[0];
  const nextTitle = document.querySelector("#team-next-title");
  const nextEyebrow = document.querySelector("#team-next-eyebrow");
  const nextDetails = document.querySelector("#team-next-details");
  const nextStatus = document.querySelector("#team-next-status");
  if (next) {
    const date = dateParts(next.date);
    nextEyebrow.textContent = `UP NEXT · ${date.long.toUpperCase()}`;
    nextTitle.textContent = next.name;
    nextDetails.textContent = `${formatTime(next.time)} setup · ${next.location || "Location TBC"}`;
    nextStatus.hidden = false;
  } else {
    nextEyebrow.textContent = "UP NEXT";
    nextTitle.textContent = "No upcoming event";
    nextDetails.textContent = "Create an event to start planning sound duties.";
    nextStatus.hidden = true;
  }

  const laterDuties = duties.slice(1);
  document.querySelector("#team-duty-list").innerHTML = laterDuties.length
    ? laterDuties.map((event) => {
      const date = dateParts(event.date);
      const gear = eventRequirements(event).length ? ` · Kit: ${eventRequirements(event).join(", ")}` : "";
      const details = `${date.long} · ${formatTime(event.time)} · ${event.location || "Location TBC"}${gear}`;
      return `<div class="team-duty-item"><span class="date-tile"><span>${date.month}</span><strong>${date.day}</strong></span><span class="event-row-copy"><strong>${escapeHtml(event.name)}</strong><small>${escapeHtml(details)}</small></span><span class="status-pill assigned">Sound duty</span></div>`;
    }).join("")
    : `<div class="empty-state">${next ? "No later sound duties scheduled." : "Create an event to start planning sound duties."}</div>`;
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

function confirmDestructiveAction(title, message, actionLabel) {
  const confirmDialog = document.querySelector("#confirm-dialog");
  confirmDialog.querySelector("#confirm-title").textContent = title;
  confirmDialog.querySelector("#confirm-message").textContent = message;
  const actionButton = confirmDialog.querySelector("#confirm-action");
  actionButton.textContent = actionLabel;
  return new Promise((resolve) => {
    confirmDialog.addEventListener("close", () => {
      resolve(confirmDialog.returnValue === "confirm");
    }, { once: true });
    confirmDialog.showModal();
  });
}

function setAuthMessage(message = "", kind = "error") {
  authMessage.textContent = message;
  authMessage.className = `auth-message${message ? ` ${kind}` : ""}`;
  authMessage.hidden = !message;
}

function setAuthMode(mode) {
  authMode = mode;
  const isSignup = mode === "signup";
  document.querySelectorAll("[data-toggle-password]").forEach((button) => {
    document.querySelector(`#${button.dataset.togglePassword}`).type = "password";
    button.textContent = "Show";
    button.setAttribute("aria-label", "Show password");
  });
  const nameField = document.querySelector("#auth-name-field");
  const confirmField = document.querySelector("#auth-confirm-field");
  nameField.hidden = !isSignup;
  confirmField.hidden = !isSignup;
  document.querySelector("#auth-name").required = isSignup;
  document.querySelector("#auth-confirm-password").required = isSignup;
  document.querySelector("#auth-password").autocomplete = isSignup ? "new-password" : "current-password";
  document.querySelector("#forgot-password").hidden = isSignup;
  document.querySelector("#auth-title").textContent = isSignup ? "Create your account" : "Welcome back";
  document.querySelector("#auth-description").textContent = isSignup
    ? "Join the BCS sound team workspace."
    : "Sign in to your school events workspace.";
  document.querySelector("#auth-switch-copy").textContent = isSignup ? "Already have an account?" : "New to the team?";
  document.querySelector("#auth-mode-toggle").textContent = isSignup ? "Sign in" : "Create an account";
  authSubmitLabel.textContent = isSignup ? "Create account" : "Sign in";
  setAuthMessage();
}

function authErrorMessage(error) {
  const messages = {
    "auth/invalid-email": "Enter a valid email address.",
    "auth/invalid-credential": "That email and password combination wasn’t recognised.",
    "auth/invalid-login-credentials": "That email and password combination wasn’t recognised.",
    "auth/wrong-password": "That email and password combination wasn’t recognised.",
    "auth/user-not-found": "That email and password combination wasn’t recognised.",
    "auth/email-already-in-use": "An account already exists for this email. Try signing in.",
    "auth/weak-password": "Choose a password with at least 6 characters.",
    "auth/too-many-requests": "There have been too many attempts. Wait a little and try again.",
    "auth/network-request-failed": "Couldn’t reach the sign-in service. Check your internet connection.",
    "auth/operation-not-allowed": "Email and password sign-in needs to be enabled in Firebase Authentication.",
    "auth/unauthorized-domain": "This site address needs to be added to Firebase Authentication’s authorised domains."
  };
  return messages[error?.code] || "Something went wrong. Please try again.";
}

function setAccountIdentity(user) {
  const emailName = user.email?.split("@")[0]?.replace(/[._-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
  const displayName = user.displayName?.trim() || emailName || "BCS team member";
  const initials = displayName.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase()
    || displayName.slice(0, 2).toUpperCase();
  document.querySelector("#profile-name").textContent = displayName;
  document.querySelector("#profile-avatar").textContent = initials;
  document.querySelector("#account-name").textContent = displayName;
  document.querySelector("#account-email").textContent = user.email || "Signed in";
  document.querySelector("#current-user-name").textContent = displayName.split(/\s+/)[0];
}

document.querySelector("#auth-mode-toggle").addEventListener("click", () => {
  const email = document.querySelector("#auth-email").value;
  authForm.reset();
  setAuthMode(authMode === "signin" ? "signup" : "signin");
  document.querySelector("#auth-email").value = email;
});

authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setAuthMessage();
  if (!authForm.reportValidity()) return;
  const email = document.querySelector("#auth-email").value.trim();
  const password = document.querySelector("#auth-password").value;
  const name = document.querySelector("#auth-name").value.trim();
  if (authMode === "signup" && password !== document.querySelector("#auth-confirm-password").value) {
    setAuthMessage("Those passwords don’t match.");
    document.querySelector("#auth-confirm-password").focus();
    return;
  }

  authSubmit.disabled = true;
  authSubmitLabel.textContent = authMode === "signup" ? "Creating account…" : "Signing in…";
  try {
    if (authMode === "signup") {
      const credential = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(credential.user, { displayName: name });
      setAccountIdentity(credential.user);
    } else {
      await signInWithEmailAndPassword(auth, email, password);
    }
  } catch (error) {
    setAuthMessage(authErrorMessage(error));
  } finally {
    authSubmit.disabled = false;
    authSubmitLabel.textContent = authMode === "signup" ? "Create account" : "Sign in";
  }
});

document.querySelector("#forgot-password").addEventListener("click", async () => {
  const email = document.querySelector("#auth-email").value.trim();
  if (!email) {
    setAuthMessage("Enter your email address and we’ll send a reset link.", "info");
    document.querySelector("#auth-email").focus();
    return;
  }
  try {
    await sendPasswordResetEmail(auth, email);
    setAuthMessage("If an account exists for that email, a password reset link is on its way.", "success");
  } catch (error) {
    setAuthMessage(authErrorMessage(error));
  }
});

document.querySelectorAll("[data-toggle-password]").forEach((button) => button.addEventListener("click", () => {
  const input = document.querySelector(`#${button.dataset.togglePassword}`);
  const show = input.type === "password";
  input.type = show ? "text" : "password";
  button.textContent = show ? "Hide" : "Show";
  button.setAttribute("aria-label", `${show ? "Hide" : "Show"} password`);
}));

setAuthMode("signin");
onAuthStateChanged(auth, (user) => {
  authScreen.hidden = Boolean(user);
  appShell.hidden = !user;
  if (user) {
    workspaceGeneration += 1;
    eventUnsubscribe?.();
    equipmentUnsubscribe?.();
    authForm.reset();
    setAccountIdentity(user);
    setAuthMessage();
    connectWorkspaceData(workspaceGeneration);
  } else {
    workspaceGeneration += 1;
    eventUnsubscribe?.();
    equipmentUnsubscribe?.();
    eventUnsubscribe = null;
    equipmentUnsubscribe = null;
    events = [];
    equipment = [];
    initialEventSnapshot = false;
    initialEquipmentSnapshot = false;
    hideLoading();
    setSyncStatus("Sign in to sync", "busy");
    document.querySelector("#account-menu").hidden = true;
    document.querySelector("#profile-button").setAttribute("aria-expanded", "false");
    setAuthMode("signin");
  }
}, (error) => {
  hideLoading();
  setAuthMessage(authErrorMessage(error));
});

document.querySelector("#profile-button").addEventListener("click", () => {
  const menu = document.querySelector("#account-menu");
  const isOpening = menu.hidden;
  menu.hidden = !isOpening;
  document.querySelector("#profile-button").setAttribute("aria-expanded", String(isOpening));
});

document.querySelector("#sign-out-button").addEventListener("click", async () => {
  const button = document.querySelector("#sign-out-button");
  button.disabled = true;
  try {
    await signOut(auth);
  } catch (error) {
    showToast(authErrorMessage(error));
  } finally {
    button.disabled = false;
  }
});

document.addEventListener("click", (event) => {
  if (event.target.closest("#profile-button") || event.target.closest("#account-menu")) return;
  document.querySelector("#account-menu").hidden = true;
  document.querySelector("#profile-button").setAttribute("aria-expanded", "false");
});

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

document.addEventListener("click", async (event) => {
  const pageButton = event.target.closest("[data-page]");
  if (pageButton) navigate(pageButton.dataset.page);

  if (event.target.closest("[data-create-event]")) openEventDialog();

  const addEquipmentButton = event.target.closest("[data-add-equipment]");
  if (addEquipmentButton) openEquipmentDialog(null, addEquipmentButton.dataset.type || EQUIPMENT_TYPES[0]);

  const actionButton = event.target.closest("[data-action]");
  if (actionButton) {
    const selected = events.find((item) => item.id === actionButton.dataset.id);
    if (actionButton.dataset.action === "edit" && selected) openEventDialog(selected);
    if (actionButton.dataset.action === "delete" && selected && await confirmDestructiveAction(
      "Delete this event?",
      `“${selected.name}” will be permanently removed from the calendar.`,
      "Delete event"
    )) {
      showLoading("Deleting event…");
      try {
        await removeEventRecord(selected.id);
        showToast("Event deleted.");
      } catch (error) {
        reportFirestoreError(error);
      } finally {
        hideLoading();
      }
    }
  }

  const equipmentAction = event.target.closest("[data-equipment-action]");
  if (equipmentAction) {
    const selectedItem = equipment.find((item) => item.id === equipmentAction.dataset.id);
    if (equipmentAction.dataset.equipmentAction === "edit" && selectedItem) openEquipmentDialog(selectedItem);
    if (equipmentAction.dataset.equipmentAction === "delete" && selectedItem && await confirmDestructiveAction(
      "Remove this equipment item?",
      `“${selectedItem.name}” will be permanently removed from the equipment register.`,
      "Remove item"
    )) {
      showLoading("Removing equipment…");
      try {
        await removeEquipmentRecord(selectedItem.id);
        showToast("Equipment record removed.");
      } catch (error) {
        reportFirestoreError(error);
      } finally {
        hideLoading();
      }
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

eventForm.addEventListener("submit", async (submitEvent) => {
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
  const saveButton = document.querySelector("#save-event");
  const saveLabel = saveButton.textContent;
  saveButton.disabled = true;
  saveButton.textContent = "Saving…";
  showLoading("Saving event…");
  try {
    await saveEventRecord(nextEvent);
    dialog.close();
    navigate("events");
    showToast(wasEditing ? "Event updated." : "Event added to the calendar.");
  } catch (error) {
    reportFirestoreError(error);
  } finally {
    saveButton.disabled = false;
    saveButton.textContent = saveLabel;
    hideLoading();
  }
});

equipmentForm.addEventListener("submit", async (submitEvent) => {
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
  const saveButton = document.querySelector("#save-equipment");
  const saveLabel = saveButton.textContent;
  saveButton.disabled = true;
  saveButton.textContent = "Saving…";
  showLoading("Saving equipment…");
  try {
    await saveEquipmentRecord(item);
    equipmentDialog.close();
    navigate("equipment");
    showToast(wasEditing ? "Equipment record updated." : "Equipment item recorded.");
  } catch (error) {
    reportFirestoreError(error);
  } finally {
    saveButton.disabled = false;
    saveButton.textContent = saveLabel;
    hideLoading();
  }
});

document.querySelector("#notifications-button").addEventListener("click", () => showToast("You’re all caught up."));

render();
