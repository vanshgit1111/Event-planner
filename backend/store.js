import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, 'data');
const STORE_PATH = resolve(DATA_DIR, 'store.json');

const DEFAULT_STORE = {
  event: null,
  aiResults: null,
  vendors: [],
  bookings: [],
  attendees: [],
  feedback: [],
  expenses: [],
  messages: [],
};

function ensureStore() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  if (!existsSync(STORE_PATH)) {
    writeFileSync(STORE_PATH, JSON.stringify(DEFAULT_STORE, null, 2));
    return structuredClone(DEFAULT_STORE);
  }
  try {
    const raw = readFileSync(STORE_PATH, 'utf-8');
    return { ...DEFAULT_STORE, ...JSON.parse(raw) };
  } catch {
    writeFileSync(STORE_PATH, JSON.stringify(DEFAULT_STORE, null, 2));
    return structuredClone(DEFAULT_STORE);
  }
}

let cache = ensureStore();

function persist() {
  writeFileSync(STORE_PATH, JSON.stringify(cache, null, 2));
}

export function getStore() {
  return cache;
}

export function getAll() {
  return { ...cache };
}

export function setEvent(event) {
  cache.event = event;
  persist();
  return cache.event;
}

export function setAiResults(aiResults) {
  cache.aiResults = aiResults;
  persist();
  return cache.aiResults;
}

export function listVendors() {
  return [...cache.vendors];
}

export function upsertVendor(vendor) {
  const idx = cache.vendors.findIndex(v => v.id === vendor.id);
  if (idx >= 0) cache.vendors[idx] = vendor;
  else cache.vendors.push(vendor);
  persist();
  return vendor;
}

export function listBookings() {
  return [...cache.bookings];
}

export function addBooking(booking) {
  cache.bookings.push(booking);
  persist();
  return booking;
}

export function updateBooking(id, patch) {
  const idx = cache.bookings.findIndex(b => b.id === id);
  if (idx < 0) return null;
  cache.bookings[idx] = { ...cache.bookings[idx], ...patch };
  persist();
  return cache.bookings[idx];
}

export function listAttendees() {
  return [...cache.attendees];
}

export function addAttendee(attendee) {
  cache.attendees.push(attendee);
  persist();
  return attendee;
}

export function updateAttendee(id, patch) {
  const idx = cache.attendees.findIndex(a => a.id === id);
  if (idx < 0) return null;
  cache.attendees[idx] = { ...cache.attendees[idx], ...patch };
  persist();
  return cache.attendees[idx];
}

export function removeAttendee(id) {
  cache.attendees = cache.attendees.filter(a => a.id !== id);
  persist();
}

export function listFeedback() {
  return [...cache.feedback];
}

export function addFeedback(entry) {
  cache.feedback.push(entry);
  persist();
  return entry;
}

export function listExpenses() {
  return [...cache.expenses];
}

export function addExpense(expense) {
  cache.expenses.push(expense);
  persist();
  return expense;
}

export function removeExpense(id) {
  cache.expenses = cache.expenses.filter(e => e.id !== id);
  persist();
}

export function listMessages(vendorId) {
  const msgs = vendorId
    ? cache.messages.filter(m => m.vendorId === vendorId)
    : cache.messages;
  return [...msgs];
}

export function addMessage(message) {
  cache.messages.push(message);
  persist();
  return message;
}

export function clearMessages(vendorId) {
  cache.messages = cache.messages.filter(m => m.vendorId !== vendorId);
  persist();
}

export function updateMessageStatus(id, status) {
  const msg = cache.messages.find(m => m.id === id);
  if (msg) {
    msg.status = status;
    persist();
  }
  return msg;
}
