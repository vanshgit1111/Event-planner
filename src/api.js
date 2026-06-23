const API = import.meta.env.VITE_API_URL || '/api';

async function request(path, options = {}) {
  const res = await fetch(`${API}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || err.details || 'Request failed');
  }
  return res.json();
}

export const api = {
  health: () => request('/health'),

  getData: () => request('/data'),
  getEvent: () => request('/event'),
  saveEvent: (event) => request('/event', { method: 'PUT', body: JSON.stringify({ event }) }),
  saveAiResults: (aiResults) => request('/ai-results', { method: 'PUT', body: JSON.stringify({ aiResults }) }),

  getVendors: () => request('/vendors'),
  saveVendor: (vendor) => request('/vendors', { method: 'POST', body: JSON.stringify(vendor) }),

  getBookings: () => request('/bookings'),
  createBooking: (booking) => request('/bookings', { method: 'POST', body: JSON.stringify(booking) }),
  updateBooking: (id, patch) => request(`/bookings/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),

  getAttendees: () => request('/attendees'),
  addAttendee: (attendee) => request('/attendees', { method: 'POST', body: JSON.stringify(attendee) }),
  updateAttendee: (id, patch) => request(`/attendees/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  removeAttendee: (id) => request(`/attendees/${id}`, { method: 'DELETE' }),
  remindAttendee: (id) => request('/attendees/remind', { method: 'POST', body: JSON.stringify({ id }) }),
  bulkRemind: () => request('/attendees/remind', { method: 'POST', body: JSON.stringify({ bulk: true }) }),
  invitePreview: (event) => request('/attendees/invite-preview', { method: 'POST', body: JSON.stringify({ event }) }),
  sendInvites: () => request('/attendees/send-invites', { method: 'POST', body: JSON.stringify({}) }),

  getFeedback: () => request('/feedback'),
  addFeedback: (entry) => request('/feedback', { method: 'POST', body: JSON.stringify(entry) }),

  getExpenses: () => request('/expenses'),
  addExpense: (expense) => request('/expenses', { method: 'POST', body: JSON.stringify(expense) }),
  removeExpense: (id) => request(`/expenses/${id}`, { method: 'DELETE' }),

  getMessages: (vendorId) => request(vendorId ? `/messages?vendorId=${vendorId}` : '/messages'),
  addMessage: (message) => request('/messages', { method: 'POST', body: JSON.stringify(message) }),
  clearMessages: (vendorId) => request(`/messages?vendorId=${vendorId}`, { method: 'DELETE' }),

  generatePlan: (event) => request('/generate-plan', { method: 'POST', body: JSON.stringify(event) }),
  tagVendors: (vendors) => request('/tag-vendors', { method: 'POST', body: JSON.stringify({ vendors }) }),
  analyzeFeedback: (feedbackList) => request('/analyze-feedback', { method: 'POST', body: JSON.stringify({ feedbackList }) }),
  chat: (payload) => request('/chat', { method: 'POST', body: JSON.stringify(payload) }),
};
