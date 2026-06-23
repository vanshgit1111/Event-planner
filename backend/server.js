/**
 * EventMind AI Backend
 * — Gemini 2.5 Flash for AI features
 * — Notion API for cloud data backup
 */

import express from 'express';
import cors from 'cors';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';
import nodemailer from 'nodemailer';
import * as store from './store.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Load .env ────────────────────────────────────────────────────────────────
function loadEnv() {
  try {
    const content = readFileSync(resolve(__dirname, '../.env'), 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx === -1) continue;
      const key = trimmed.slice(0, idx).trim();
      const val = trimmed.slice(idx + 1).trim();
      if (!process.env[key]) process.env[key] = val;
    }
  } catch (e) {
    console.error('Could not load .env:', e.message);
  }
}
loadEnv();

const GEMINI_API_KEY    = process.env.GEMINI_API_KEY;
const GEMINI_MODEL      = 'gemini-2.5-flash';
const GEMINI_URL        = GEMINI_API_KEY
  ? `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`
  : null;

const NOTION_TOKEN       = process.env.NOTION_TOKEN;
const NOTION_VERSION     = '2022-06-28';
const NOTION_DB_EVENTS   = process.env.NOTION_DB_EVENTS;
const NOTION_DB_VENDORS  = process.env.NOTION_DB_VENDORS;
const NOTION_DB_BOOKINGS = process.env.NOTION_DB_BOOKINGS;
const NOTION_DB_FEEDBACK = process.env.NOTION_DB_FEEDBACK;
const NOTION_DB_CHAT_LOGS = process.env.NOTION_DB_CHAT_LOGS;
const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY;
const GEOAPIFY_API_KEY = process.env.GEOAPIFY_API_KEY;

// ─── SMTP Email Configuration ──────────────────────────────────────────────────
const SMTP_HOST = process.env.SMTP_HOST || 'smtp.gmail.com';
const SMTP_PORT = Number(process.env.SMTP_PORT) || 587;
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const SMTP_FROM = process.env.SMTP_FROM;

let emailTransporter = null;

function getEmailTransporter() {
  if (emailTransporter) return emailTransporter;
  if (!SMTP_USER || !SMTP_PASS) {
    return null;
  }
  try {
    emailTransporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465,
      auth: {
        user: SMTP_USER,
        pass: SMTP_PASS,
      },
    });
    console.log(`✉️ Nodemailer SMTP transporter initialized with host: ${SMTP_HOST}`);
  } catch (err) {
    console.error('❌ Failed to initialize Nodemailer SMTP transporter:', err.message);
  }
  return emailTransporter;
}

async function sendEmail({ to, subject, text, html }) {
  const transporter = getEmailTransporter();
  const from = SMTP_FROM || SMTP_USER || 'no-reply@eventmind.com';
  if (!transporter) {
    console.log(`✉️ [MOCK EMAIL] To: ${to} | Subject: ${subject}`);
    console.log(`Body: ${text}`);
    return { mock: true, message: 'SMTP credentials not configured, printed to console' };
  }
  return transporter.sendMail({
    from,
    to,
    subject,
    text,
    html
  });
}

const app  = express();
app.use(cors());
app.use(express.json());
const PORT = 5001;

// ─── Caching, Resilience, Notion Update & Upsert Helpers ───────────────────────
const vendorSearchCache = new Map();
const CACHE_TTL = 3600000; // 1 hour

// IP-based Rate Limiter (max 30 requests/minute per client IP)
const rateLimitWindow = 60000;
const rateLimitMax = 30;
const requestTracks = new Map();

function rateLimiter(req, res, next) {
  const ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  const now = Date.now();
  if (!requestTracks.has(ip)) {
    requestTracks.set(ip, []);
  }
  const timestamps = requestTracks.get(ip).filter(t => now - t < rateLimitWindow);
  if (timestamps.length >= rateLimitMax) {
    console.warn(`Rate limit exceeded for IP: ${ip}`);
    return res.status(429).json({ error: 'Too many requests. Please try again in a minute.' });
  }
  timestamps.push(now);
  requestTracks.set(ip, timestamps);
  next();
}

// Resilient Fetch with Timeout and Retry
async function fetchWithRetryAndTimeout(url, options = {}, retries = 2, timeout = 12000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(id);
      if (!response.ok) {
        throw new Error(`HTTP error ${response.status}`);
      }
      return response;
    } catch (err) {
      clearTimeout(id);
      console.warn(`Fetch attempt ${attempt} failed for ${url}: ${err.message}`);
      if (attempt === retries) {
        throw err;
      }
      await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 500));
    }
  }
}

// Notion Update Page API
async function notionUpdate(pageId, properties) {
  if (!NOTION_TOKEN || !pageId) return null;
  try {
    const res = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
      method: 'PATCH',
      headers: {
        'Authorization':  `Bearer ${NOTION_TOKEN}`,
        'Notion-Version': NOTION_VERSION,
        'Content-Type':   'application/json',
      },
      body: JSON.stringify({ properties }),
    });
    if (!res.ok) {
      const err = await res.text();
      console.error(`Notion update failed (Page: ${pageId}):`, err);
      return null;
    }
    return await res.json();
  } catch (e) {
    console.error('Notion update exception:', e.message);
    return null;
  }
}

// Notion Event Upsert (de-duplication by Event Name)
async function notionUpsertEvent(name, properties) {
  if (!NOTION_TOKEN || !NOTION_DB_EVENTS) return null;
  try {
    const queryResult = await notionQuery(NOTION_DB_EVENTS, {
      filter: { property: 'Name', title: { equals: name } }
    });
    const existingPage = queryResult?.results?.[0];
    if (existingPage) {
      console.log(`🔄 Notion: Event "${name}" already exists. Updating page ID: ${existingPage.id}`);
      return await notionUpdate(existingPage.id, properties);
    } else {
      console.log(`➕ Notion: Creating new Event "${name}"`);
      return await notionInsert(NOTION_DB_EVENTS, properties);
    }
  } catch (err) {
    console.error('notionUpsertEvent error:', err.message);
  }
}

// Notion Vendor Upsert (de-duplication by Organization)
async function notionUpsertVendor(organization, properties) {
  if (!NOTION_TOKEN || !NOTION_DB_VENDORS) return null;
  try {
    const queryResult = await notionQuery(NOTION_DB_VENDORS, {
      filter: { property: 'Organization', title: { equals: organization } }
    });
    const existingPage = queryResult?.results?.[0];
    if (existingPage) {
      console.log(`🔄 Notion: Vendor "${organization}" already exists. Updating page ID: ${existingPage.id}`);
      return await notionUpdate(existingPage.id, properties);
    } else {
      console.log(`➕ Notion: Creating new Vendor "${organization}"`);
      return await notionInsert(NOTION_DB_VENDORS, properties);
    }
  } catch (err) {
    console.error('notionUpsertVendor error:', err.message);
  }
}

// Notion Booking Upsert (de-duplication by Event Name + Vendor)
async function notionUpsertBooking(eventName, vendorName, properties) {
  if (!NOTION_TOKEN || !NOTION_DB_BOOKINGS) return null;
  try {
    const queryResult = await notionQuery(NOTION_DB_BOOKINGS, {
      filter: {
        and: [
          { property: 'Event Name', title: { equals: eventName } },
          { property: 'Vendor', rich_text: { equals: vendorName } }
        ]
      }
    });
    const existingPage = queryResult?.results?.[0];
    if (existingPage) {
      console.log(`🔄 Notion: Booking for "${eventName}" with "${vendorName}" already exists. Updating ID: ${existingPage.id}`);
      return await notionUpdate(existingPage.id, properties);
    } else {
      console.log(`➕ Notion: Creating new Booking for "${eventName}"`);
      return await notionInsert(NOTION_DB_BOOKINGS, properties);
    }
  } catch (err) {
    console.error('notionUpsertBooking error:', err.message);
  }
}

// Notion Chat Log Upsert (de-duplication by Message ID)
async function notionUpsertChatLog(messageId, properties) {
  if (!NOTION_TOKEN || !NOTION_DB_CHAT_LOGS) return null;
  try {
    const queryResult = await notionQuery(NOTION_DB_CHAT_LOGS, {
      filter: { property: 'Message ID', title: { equals: String(messageId) } }
    });
    const existingPage = queryResult?.results?.[0];
    if (existingPage) {
      return await notionUpdate(existingPage.id, properties);
    } else {
      return await notionInsert(NOTION_DB_CHAT_LOGS, properties);
    }
  } catch (err) {
    console.error('notionUpsertChatLog error:', err.message);
  }
}

// Scoring and Ranking for Vendor Recommendations
function calculateVendorScore(vendor, categoryBudget, guestCount) {
  let score = 0;
  score += (Number(vendor.rating) || 4.0) * 10; // up to 50 pts
  if (categoryBudget > 0) {
    const minCost = estimateVendorMinCost(vendor, guestCount);
    if (minCost <= categoryBudget) {
      score += 40; // fully within budget
    } else if (minCost <= categoryBudget * 1.15) {
      score += 25; // slightly over budget
    } else if (minCost <= categoryBudget * 1.3) {
      score += 10; // moderately over budget
    }
  } else {
    score += 20;
  }
  return score;
}

function rankVendors(vendors, budgetBreakdown, guestCount) {
  const alloc = Object.fromEntries((budgetBreakdown || []).map((b) => [b.category, Number(b.amount) || 0]));
  return [...vendors].sort((a, b) => {
    const scoreA = calculateVendorScore(a, alloc[a.category] || 0, guestCount);
    const scoreB = calculateVendorScore(b, alloc[b.category] || 0, guestCount);
    return scoreB - scoreA;
  });
}


// ─── Gemini helper ────────────────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function callGemini(prompt, jsonMode = false, retries = 3) {
  if (!GEMINI_API_KEY || !GEMINI_URL) {
    throw new Error('GEMINI_API_KEY not configured');
  }
  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: jsonMode
      ? { responseMimeType: 'application/json', temperature: 0.7 }
      : { temperature: 0.7 },
  };

  for (let attempt = 1; attempt <= retries; attempt++) {
    const res = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (res.ok) {
      const data = await res.json();
      return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    }

    if (res.status === 503 && attempt < retries) {
      const waitMs = 1500 * attempt;
      console.log(`Gemini 503 on attempt ${attempt}, retrying in ${waitMs}ms...`);
      await sleep(waitMs);
      continue;
    }

    const errText = await res.text();
    throw new Error(`Gemini API error ${res.status}: ${errText}`);
  }
}

function fallbackChatReply(messages, eventContext, vendorContext) {
  const lastUserText = [...(messages || [])].reverse().find((m) => m.role === 'user')?.text || '';
  if (vendorContext) {
    return `Thanks for reaching out about "${lastUserText}". Please share your preferred date, guest count, and budget range, and I’ll help with package options and next steps.`;
  }
  if (eventContext?.name) {
    return `For "${lastUserText}", here’s the best quick guidance for ${eventContext.name}: focus on budget, vendor shortlist, and timeline sequencing first. Ask a more specific follow-up and I’ll narrow it down.`;
  }
  return `I understood your question: "${lastUserText}". I can help better once you share event type, city, guest count, and budget.`;
}

function safeJsonParse(raw) {
  if (!raw) return null;
  const clean = String(raw).replace(/```json|```/g, '').trim();
  try {
    return JSON.parse(clean);
  } catch {
    return null;
  }
}

function computeBudgetBreakdown(total, categories) {
  const weights = categories.map((c) => {
    const w =
      c === 'Venue' ? 0.28 :
      c === 'Catering' ? 0.32 :
      c === 'Photography' ? 0.10 :
      c === 'Decoration' ? 0.12 :
      c === 'Entertainment' ? 0.08 :
      0.10;
    return w;
  });
  const wsum = weights.reduce((a, b) => a + b, 0) || 1;
  const normalized = weights.map(w => w / wsum);

  const amounts = normalized.map(p => Math.floor(total * p));
  const sum = amounts.reduce((a, b) => a + b, 0);
  const remainder = total - sum;
  if (amounts.length > 0) amounts[0] += remainder;

  const percentages = normalized.map(p => Math.round(p * 100));
  const psum = percentages.reduce((a, b) => a + b, 0);
  const prem = 100 - psum;
  if (percentages.length > 0) percentages[0] += prem;

  return categories.map((category, i) => ({
    category,
    amount: amounts[i] ?? 0,
    percentage: percentages[i] ?? 0,
  }));
}

function normalizeLocationKey(location) {
  return String(location || '').trim().toLowerCase();
}

function locationMultiplier(location) {
  const key = normalizeLocationKey(location);
  if (!key) return 1.0;
  if (['mumbai', 'delhi', 'gurgaon', 'bengaluru', 'bangalore'].some(c => key.includes(c))) return 1.25;
  if (['pune', 'hyderabad', 'chennai', 'kolkata', 'navi mumbai', 'noida'].some(c => key.includes(c))) return 1.1;
  if (['jaipur', 'lucknow', 'indore', 'surat', 'nagpur'].some(c => key.includes(c))) return 0.95;
  return 1.0;
}

function buildEstimatedCost({ budgetMin, budgetMax, guestCount, location }) {
  const min = Number(budgetMin) || 0;
  const max = Number(budgetMax) || 0;
  const guests = Math.max(1, Number(guestCount) || 1);
  const multiplier = locationMultiplier(location);
  const baseMin = min > 0 ? min : Math.round(max * 0.75);
  const perGuestBase = Math.max(1500, Math.round(max / guests));
  const adjustedMax = Math.round(max * multiplier);
  const adjustedMin = Math.round(Math.max(baseMin, (perGuestBase * guests) * 0.8) * multiplier);
  return {
    location: location || 'India',
    estimatedMin: adjustedMin,
    estimatedMax: Math.max(adjustedMax, adjustedMin),
    note: `Estimate adjusted for local market rates (${Math.round(multiplier * 100)}% baseline).`,
  };
}

function buildBestOptions({ location, recommendationPriority, preferredVenueType, preferredCuisine, preferredVibe, budgetMax }) {
  const city = location || 'your city';
  const priority = recommendationPriority || 'Balanced';
  const premium = priority === 'Premium Quality';
  const valueFocused = priority === 'Best Value';
  const budget = Number(budgetMax) || 0;

  return [
    {
      category: 'Venue',
      option: preferredVenueType ? `${preferredVenueType} in ${city}` : `Top-rated banquet/lawn options in ${city}`,
      reason: valueFocused
        ? 'Strong guest capacity and inclusions at better package value.'
        : premium
          ? 'High service quality and ambience aligned with premium events.'
          : 'Balanced option between quality, availability, and cost.',
      estimatedCost: `₹${Math.round(budget * 0.24).toLocaleString()} - ₹${Math.round(budget * 0.36).toLocaleString()}`,
    },
    {
      category: 'Catering',
      option: preferredCuisine ? `${preferredCuisine} specialist caterers` : 'Multi-cuisine catering teams',
      reason: preferredVibe
        ? `Menu and presentation aligned to a ${preferredVibe} event vibe.`
        : 'Reliable menu flexibility and service quality for mixed audiences.',
      estimatedCost: `₹${Math.round(budget * 0.25).toLocaleString()} - ₹${Math.round(budget * 0.35).toLocaleString()}`,
    },
    {
      category: 'Photography',
      option: premium ? 'Candid + cinematic team with premium edits' : 'Candid + traditional combo packages',
      reason: premium ? 'Best output quality with full coverage workflow.' : 'High value coverage with essential deliverables.',
      estimatedCost: `₹${Math.round(budget * 0.08).toLocaleString()} - ₹${Math.round(budget * 0.14).toLocaleString()}`,
    }
  ];
}

function formatInrRange(min, max) {
  const safeMin = Math.max(1000, Math.round(min || 0));
  const safeMax = Math.max(safeMin, Math.round(max || safeMin));
  return `₹${safeMin.toLocaleString('en-IN')} - ₹${safeMax.toLocaleString('en-IN')}`;
}

function parseMoneyNumbers(raw) {
  const matches = String(raw || '').match(/\d[\d,]*/g) || [];
  return matches.map((m) => Number(String(m).replace(/,/g, ''))).filter(Boolean);
}

function estimateVendorMinCost(vendor, guestCount) {
  const range = String(vendor?.priceRange || '');
  const nums = parseMoneyNumbers(range);
  if (!nums.length) return 0;
  if (range.toLowerCase().includes('per plate')) {
    const perPlate = nums[0];
    const guests = Math.max(1, Number(guestCount) || 1);
    return perPlate * guests;
  }
  return nums[0];
}

function budgetAdviceForVendors(vendors, budgetMax, guestCount) {
  const totalBudget = Number(budgetMax) || 0;
  const requiredMin = (vendors || []).reduce((sum, v) => sum + estimateVendorMinCost(v, guestCount), 0);
  const overBy = Math.max(0, requiredMin - totalBudget);
  return {
    withinBudget: requiredMin <= totalBudget,
    requiredMin,
    suggestedBudget: requiredMin > totalBudget ? requiredMin : totalBudget,
    overBy,
    message: requiredMin > totalBudget
      ? `Current budget may be low for these vendor ranges. Consider increasing to at least ₹${requiredMin.toLocaleString('en-IN')}.`
      : 'Current suggested vendor ranges are aligned with your budget.',
  };
}

function midpointFromRange(priceRange, guestCount) {
  const range = String(priceRange || '');
  const nums = parseMoneyNumbers(range);
  if (!nums.length) return 0;
  if (range.toLowerCase().includes('per plate')) {
    const guests = Math.max(1, Number(guestCount) || 1);
    const perPlateMid = nums.length >= 2 ? (nums[0] + nums[1]) / 2 : nums[0];
    return Math.round(perPlateMid * guests);
  }
  return Math.round(nums.length >= 2 ? (nums[0] + nums[1]) / 2 : nums[0]);
}

function budgetBasedRange(amount, guestCount, isPerPlate = false) {
  const base = Number(amount) || 0;
  if (isPerPlate) {
    const guests = Math.max(1, Number(guestCount) || 1);
    const perPlate = Math.max(200, Math.round(base / guests));
    return `₹${Math.round(perPlate * 0.9).toLocaleString('en-IN')} - ₹${Math.round(perPlate * 1.2).toLocaleString('en-IN')} per plate`;
  }
  return formatInrRange(base * 0.85, base * 1.2);
}

async function geocodeLocation(location) {
  try {
    const q = encodeURIComponent(location || 'India');
    const res = await fetchWithRetryAndTimeout(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${q}`, {
      headers: { 'User-Agent': 'EventMind/1.0 (event planner app)' }
    });
    const data = await res.json();
    if (!Array.isArray(data) || !data[0]) return null;
    return { lat: Number(data[0].lat), lon: Number(data[0].lon) };
  } catch (err) {
    console.warn('geocodeLocation failed:', err.message);
    return null;
  }
}

async function geocodeLocationGeoapify(location) {
  if (!GEOAPIFY_API_KEY) return null;
  try {
    const q = encodeURIComponent(location || 'India');
    const url = `https://api.geoapify.com/v1/geocode/search?text=${q}&limit=1&apiKey=${GEOAPIFY_API_KEY}`;
    const res = await fetchWithRetryAndTimeout(url);
    const data = await res.json();
    const coords = data?.features?.[0]?.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) return null;
    return { lat: Number(coords[1]), lon: Number(coords[0]) };
  } catch (err) {
    console.warn('geocodeLocationGeoapify failed:', err.message);
    return null;
  }
}

async function fetchGeoapifyVendors({ location, budgetBreakdown, guestCount }) {
  if (!GEOAPIFY_API_KEY) return [];
  const center = await geocodeLocationGeoapify(location);
  if (!center) return [];

  const alloc = Object.fromEntries((budgetBreakdown || []).map((b) => [b.category, Number(b.amount) || 0]));
  const categories = [
    { category: 'Venue', apiCategory: 'activity.events_venue,accommodation.hotel', allocKey: 'Venue', perPlate: false, fallbackName: 'Event venue' },
    { category: 'Catering', apiCategory: 'catering.restaurant', allocKey: 'Catering', perPlate: true, fallbackName: 'Catering service' },
    { category: 'Photography', apiCategory: 'service.photographer,commercial.hobby.photo', allocKey: 'Photography', perPlate: false, fallbackName: 'Photography vendor' },
    { category: 'Decoration', apiCategory: 'commercial.florist', allocKey: 'Decoration', perPlate: false, fallbackName: 'Decoration vendor' },
    { category: 'Entertainment', apiCategory: 'entertainment', allocKey: 'Entertainment', perPlate: false, fallbackName: 'Entertainment vendor' },
  ];

  const calls = categories.map(async (c) => {
    try {
      const url = `https://api.geoapify.com/v2/places?categories=${c.apiCategory}&filter=circle:${center.lon},${center.lat},10000&bias=proximity:${center.lon},${center.lat}&limit=5&apiKey=${GEOAPIFY_API_KEY}`;
      const resp = await fetchWithRetryAndTimeout(url);
      const data = await resp.json();
      const place = data?.features?.[0]?.properties;
      if (!place) return null;
      const displayName = place.name || place.formatted || c.fallbackName;
      const baseAmt = alloc[c.allocKey] || 0;
      const isPerPlate = c.perPlate;
      const guests = Math.max(1, Number(guestCount) || 1);
      let pMin = 0;
      let pMax = 0;
      if (isPerPlate) {
        const perPlate = Math.max(200, Math.round(baseAmt / guests));
        pMin = Math.round(perPlate * 0.9) * guests;
        pMax = Math.round(perPlate * 1.2) * guests;
      } else {
        pMin = Math.max(1000, Math.round(baseAmt * 0.85));
        pMax = Math.max(pMin, Math.round(baseAmt * 1.2));
      }

      return {
        category: c.category,
        name: displayName,
        priceRange: budgetBasedRange(baseAmt, guestCount, isPerPlate),
        priceMin: pMin,
        priceMax: pMax,
        rating: 4.0,
        notes: place.formatted || `${location || 'India'} (Geoapify)`,
        lat: Number(place.lat),
        lon: Number(place.lon),
        mapUrl: place.datasource?.raw?.website || (Number.isFinite(Number(place.lat)) && Number.isFinite(Number(place.lon))
          ? `https://www.openstreetmap.org/?mlat=${Number(place.lat)}&mlon=${Number(place.lon)}#map=16/${Number(place.lat)}/${Number(place.lon)}`
          : null)
      };
    } catch (e) {
      console.warn(`fetchGeoapifyVendors failed for ${c.category}:`, e.message);
      return null;
    }
  });

  return (await Promise.all(calls)).filter(Boolean);
}

function normalizeVendorId(str) {
  return String(str || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 80);
}

function categoryLabelFromGeoapifyCats(cats = []) {
  const list = Array.isArray(cats) ? cats : [];
  const has = (s) => list.some((c) => String(c).includes(s));
  if (has('commercial.photo') || has('photo_studio') || has('photographer')) return 'Photography';
  if (has('commercial.florist') || has('florist') || has('craft.florist')) return 'Decoration';
  if (has('events_venue') || has('accommodation') || has('hotel')) return 'Venue';
  if (has('catering') || has('restaurant') || has('food')) return 'Catering';
  if (has('entertainment') || has('theatre') || has('cinema') || has('nightclub') || has('music')) return 'Entertainment';
  return 'Other';
}

function getDefaultCategoryPrice(category, priceLevel) {
  let multiplier = 1.0;
  if (priceLevel === 1 || String(priceLevel).includes('INEXPENSIVE') || String(priceLevel) === '1') multiplier = 0.6;
  else if (priceLevel === 3 || String(priceLevel).includes('EXPENSIVE') || String(priceLevel) === '3') multiplier = 1.5;
  else if (priceLevel === 4 || String(priceLevel).includes('VERY_EXPENSIVE') || String(priceLevel) === '4') multiplier = 2.5;

  const defaults = {
    'Venue': { min: 40000, max: 200000 },
    'Catering': { min: 25000, max: 120000 },
    'Photography': { min: 15000, max: 75000 },
    'Decoration': { min: 10000, max: 50000 },
    'Entertainment': { min: 8000, max: 40000 },
    'Other': { min: 5000, max: 25000 }
  };

  const val = defaults[category] || defaults['Other'];
  return {
    priceMin: Math.round(val.min * multiplier),
    priceMax: Math.round(val.max * multiplier)
  };
}

async function fetchGeoapifyVendorList({ location, limit = 36 }) {
  if (!GEOAPIFY_API_KEY) return [];
  const center = await geocodeLocationGeoapify(location);
  if (!center) return [];

  // Broad categories for marketplace browsing; we will map to our app categories.
  const categories = [
    'catering',
    'catering.restaurant',
    'catering.fast_food',
    'service.photographer',
    'commercial.hobby.photo',
    'commercial.florist',
    'entertainment',
    'activity.events_venue',
    'accommodation.hotel',
  ];

  try {
    const catParam = categories.join(','); // Geoapify requires raw commas, not %2C
    const url = `https://api.geoapify.com/v2/places?categories=${catParam}&filter=circle:${center.lon},${center.lat},15000&bias=proximity:${center.lon},${center.lat}&limit=${Math.min(60, Math.max(10, limit))}&apiKey=${GEOAPIFY_API_KEY}`;
    const resp = await fetchWithRetryAndTimeout(url);
    const data = await resp.json();
    const features = Array.isArray(data?.features) ? data.features : [];

    const out = features.map((f) => {
      const p = f?.properties || {};
      const name = p.name || p.formatted || 'Vendor';
      const lat = Number(p.lat);
      const lon = Number(p.lon);
      const category = categoryLabelFromGeoapifyCats(p.categories || []);
      const id = `geoapify-${normalizeVendorId(name)}-${normalizeVendorId(category)}-${normalizeVendorId(String(p.place_id || ''))}`;
      const prices = getDefaultCategoryPrice(category, p.datasource?.raw?.price_level);
      return {
        id,
        category,
        organization: name,
        rating: typeof p.rank?.popularity === 'number' ? Math.min(5, Math.max(3.5, 3.5 + (p.rank.popularity / 100))) : 4.0,
        location: location || p.city || p.state || '',
        address: p.formatted || '',
        priceLevel: p.datasource?.raw?.price_level || null,
        priceMin: prices.priceMin,
        priceMax: prices.priceMax,
        priceRange: `₹${prices.priceMin.toLocaleString('en-IN')} - ₹${prices.priceMax.toLocaleString('en-IN')}`,
        services: (Array.isArray(p.categories) ? p.categories.slice(0, 3).join(', ') : ''),
        lat: Number.isFinite(lat) ? lat : null,
        lon: Number.isFinite(lon) ? lon : null,
        mapUrl: Number.isFinite(lat) && Number.isFinite(lon)
          ? `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=16/${lat}/${lon}`
          : null
      };
    });

    // Dedupe by org+category
    const seen = new Set();
    const deduped = [];
    for (const v of out) {
      const key = `${v.organization}|${v.category}`.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(v);
      if (deduped.length >= limit) break;
    }
    return deduped;
  } catch (e) {
    console.warn('fetchGeoapifyVendorList failed:', e.message);
    return [];
  }
}

async function fetchGooglePlacesVendorList({ location, limit = 36 }) {
  if (!GOOGLE_PLACES_API_KEY) return [];
  const queries = [
    { category: 'Venue', q: `banquet hall in ${location}` },
    { category: 'Catering', q: `catering service in ${location}` },
    { category: 'Photography', q: `event photographer in ${location}` },
    { category: 'Decoration', q: `event decorator in ${location}` },
    { category: 'Entertainment', q: `dj service in ${location}` },
  ];
  const perQuery = Math.max(5, Math.floor(limit / queries.length));

  const calls = queries.map(async ({ category, q }) => {
    try {
      const resp = await fetchWithRetryAndTimeout('https://places.googleapis.com/v1/places:searchText', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': GOOGLE_PLACES_API_KEY,
          'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.rating,places.userRatingCount,places.priceLevel,places.location,places.googleMapsUri'
        },
        body: JSON.stringify({ textQuery: q, maxResultCount: perQuery })
      });
      const data = await resp.json();
      const places = Array.isArray(data.places) ? data.places : [];
      return places.map((p) => {
        const prices = getDefaultCategoryPrice(category, p.priceLevel);
        return {
          id: `gplaces-${p.id}`,
          category,
          organization: p.displayName?.text || 'Vendor',
          rating: Number(p.rating || 4.0),
          location: location || '',
          address: p.formattedAddress || '',
          priceLevel: p.priceLevel || null,
          priceMin: prices.priceMin,
          priceMax: prices.priceMax,
          priceRange: `₹${prices.priceMin.toLocaleString('en-IN')} - ₹${prices.priceMax.toLocaleString('en-IN')}`,
          services: p.userRatingCount ? `${p.userRatingCount} reviews` : '',
          lat: Number(p.location?.latitude),
          lon: Number(p.location?.longitude),
          mapUrl: p.googleMapsUri || null
        };
      });
    } catch (e) {
      console.warn(`fetchGooglePlacesVendorList failed for ${category}:`, e.message);
      return [];
    }
  });

  const merged = (await Promise.all(calls)).flat();
  const seen = new Set();
  const out = [];
  for (const v of merged) {
    const key = `${v.organization}|${v.category}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
    if (out.length >= limit) break;
  }
  return out;
}

async function fetchLiveVendorList({ location, limit = 36 }) {
  if (!location) return [];
  const cacheKey = `${location.toLowerCase()}-${limit}`;
  const cached = vendorSearchCache.get(cacheKey);
  if (cached && (Date.now() - cached.timestamp < CACHE_TTL)) {
    console.log(`📦 Serving live vendor list from cache for: ${location}`);
    return cached.data;
  }

  const fetchResults = async () => {
    // 1) Try Geoapify (best for India)
    if (GEOAPIFY_API_KEY) {
      try {
        const geo = await fetchGeoapifyVendorList({ location, limit });
        if (geo.length) { console.log(`✅ Geoapify returned ${geo.length} vendors`); return geo; }
      } catch (e) {
        console.warn('Geoapify vendor list failed:', e.message);
      }
    }
    // 2) Try Google Places
    if (GOOGLE_PLACES_API_KEY) {
      try {
        const gp = await fetchGooglePlacesVendorList({ location, limit });
        if (gp.length) { console.log(`✅ Google Places returned ${gp.length} vendors`); return gp; }
      } catch (e) {
        console.warn('Google vendor list failed:', e.message);
      }
    }
    // 3) Try Overpass OSM (free, no key needed)
    try {
      const osmVendors = await fetchOverpassVendorList({ location, limit });
      if (osmVendors.length) { console.log(`✅ Overpass OSM returned ${osmVendors.length} vendors`); return osmVendors; }
    } catch (e) {
      console.warn('Overpass vendor list failed:', e.message);
    }
    // 4) Offline curated vendor list based on city
    console.log(`⚠️ All APIs failed, generating offline vendors for ${location}`);
    return generateOfflineVendorList({ location, limit });
  };

  const results = await fetchResults();
  if (results.length) {
    vendorSearchCache.set(cacheKey, { data: results, timestamp: Date.now() });
  }
  return results;
}

// ─── Overpass Vendor List (no API key required) ────────────────────────────────
async function fetchOverpassVendorList({ location, limit = 36 }) {
  const center = await geocodeLocation(location);
  if (!center) return [];

  const osmCategories = [
    { category: 'Venue', tags: ['[\"amenity\"=\"events_venue\"]', '[\"amenity\"=\"banquet_hall\"]', '[\"leisure\"=\"event_venue\"]'] },
    { category: 'Catering', tags: ['[\"amenity\"=\"restaurant\"]', '[\"amenity\"=\"catering\"]'] },
    { category: 'Photography', tags: ['[\"shop\"=\"photo\"]', '[\"shop\"=\"photography\"]', '[\"craft\"=\"photographer\"]'] },
    { category: 'Decoration', tags: ['[\"shop\"=\"florist\"]', '[\"shop\"=\"party\"]', '[\"shop\"=\"event\"]'] },
    { category: 'Entertainment', tags: ['[\"amenity\"=\"nightclub\"]', '[\"amenity\"=\"music_venue\"]', '[\"leisure\"=\"dance\"]'] },
  ];

  const calls = osmCategories.map(async (c) => {
    const unionParts = c.tags.flatMap(tag => [
      `node${tag}(around:15000,${center.lat},${center.lon});`,
      `way${tag}(around:15000,${center.lat},${center.lon});`,
    ]).join('\n        ');

    const query = `[out:json][timeout:20];\n(\n${unionParts}\n);\nout center tags 10;`;
    try {
      const resp = await fetchWithRetryAndTimeout('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(query)}`
      }, 2, 22000);
      const data = await resp.json();
      const elements = (data.elements || []).filter(e => e.tags?.name);
      return elements.slice(0, Math.ceil(limit / osmCategories.length)).map((e) => {
        const lat = Number(e.lat ?? e.center?.lat);
        const lon = Number(e.lon ?? e.center?.lon);
        const prices = getDefaultCategoryPrice(c.category, null);
        return {
          id: `osm-${e.type}-${e.id}`,
          category: c.category,
          organization: e.tags.name,
          rating: 4.0,
          location: location || '',
          address: e.tags['addr:full'] || e.tags['addr:street'] || `${location}, India`,
          priceMin: prices.priceMin,
          priceMax: prices.priceMax,
          priceRange: `₹${prices.priceMin.toLocaleString('en-IN')} - ₹${prices.priceMax.toLocaleString('en-IN')}`,
          services: `${c.category} service`,
          lat: Number.isFinite(lat) ? lat : null,
          lon: Number.isFinite(lon) ? lon : null,
          mapUrl: Number.isFinite(lat) && Number.isFinite(lon)
            ? `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=16/${lat}/${lon}`
            : null
        };
      });
    } catch (e) {
      console.warn(`Overpass list failed for ${c.category}:`, e.message);
      return [];
    }
  });

  const merged = (await Promise.all(calls)).flat();
  const seen = new Set();
  const out = [];
  for (const v of merged) {
    const key = `${v.organization}|${v.category}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
    if (out.length >= limit) break;
  }
  return out;
}

// ─── Offline Vendor List Generator (curated, realistic Indian vendors) ─────────
function generateOfflineVendorList({ location, limit = 36 }) {
  const city = location || 'India';
  const templates = [
    { category: 'Venue', names: [`${city} Grand Banquet`, `Royal Palace ${city}`, `${city} Convention Center`, `The Ritz ${city}`, `${city} Event Suites`], priceMin: 80000, priceMax: 250000 },
    { category: 'Catering', names: [`${city} Catering Co.`, `Royal Feast ${city}`, `Spice Garden Caterers`, `${city} Food Hub`, `Premium Caterers ${city}`], priceMin: 15000, priceMax: 80000 },
    { category: 'Photography', names: [`${city} Studio`, `Moments by Priya`, `Lens & Light ${city}`, `${city} Photographers`, `Clickstudio ${city}`], priceMin: 20000, priceMax: 80000 },
    { category: 'Decoration', names: [`${city} Decors`, `Floral Fantasy ${city}`, `Dream Setup ${city}`, `${city} Event Decor`, `Bloom & Style`], priceMin: 15000, priceMax: 60000 },
    { category: 'Entertainment', names: [`${city} DJ Services`, `Live Band ${city}`, `Magic Show ${city}`, `${city} Entertainment`, `Star Performers`], priceMin: 10000, priceMax: 50000 },
  ];

  const vendors = [];
  for (const t of templates) {
    for (let i = 0; i < t.names.length && vendors.length < limit; i++) {
      vendors.push({
        id: `offline-${t.category.toLowerCase()}-${i}`,
        category: t.category,
        organization: t.names[i],
        rating: (4.0 + Math.random() * 0.9).toFixed(1) * 1,
        location: city,
        address: `${city}, India`,
        priceMin: t.priceMin,
        priceMax: t.priceMax,
        priceRange: `₹${t.priceMin.toLocaleString('en-IN')} - ₹${t.priceMax.toLocaleString('en-IN')}`,
        services: `${t.category} service in ${city}`,
        lat: null,
        lon: null,
        mapUrl: null,
        isOffline: true
      });
    }
  }
  return vendors;
}


async function fetchGooglePlacesVendors({ location, budgetBreakdown, guestCount }) {
  if (!GOOGLE_PLACES_API_KEY) return [];
  const center = await geocodeLocation(location);
  const categories = [
    { category: 'Venue', query: `event venue in ${location || 'India'}`, allocKey: 'Venue', perPlate: false },
    { category: 'Catering', query: `catering service in ${location || 'India'}`, allocKey: 'Catering', perPlate: true },
    { category: 'Photography', query: `event photographer in ${location || 'India'}`, allocKey: 'Photography', perPlate: false },
    { category: 'Decoration', query: `event decorator in ${location || 'India'}`, allocKey: 'Decoration', perPlate: false },
    { category: 'Entertainment', query: `dj service in ${location || 'India'}`, allocKey: 'Entertainment', perPlate: false },
  ];
  const alloc = Object.fromEntries((budgetBreakdown || []).map((b) => [b.category, Number(b.amount) || 0]));

  const calls = categories.map(async (c) => {
    const body = {
      textQuery: c.query,
      maxResultCount: 5,
      ...(center
        ? {
            locationBias: {
              circle: {
                center: { latitude: center.lat, longitude: center.lon },
                radius: 10000
              }
            }
          }
        : {})
    };
    try {
      const resp = await fetchWithRetryAndTimeout('https://places.googleapis.com/v1/places:searchText', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': GOOGLE_PLACES_API_KEY,
          'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.rating,places.userRatingCount,places.priceLevel,places.location,places.googleMapsUri'
        },
        body: JSON.stringify(body)
      });
      const data = await resp.json();
      const place = Array.isArray(data.places) ? data.places[0] : null;
      if (!place?.displayName?.text) return null;

      const priceMultiplier =
        place.priceLevel === 'PRICE_LEVEL_EXPENSIVE' ? 1.2 :
        place.priceLevel === 'PRICE_LEVEL_VERY_EXPENSIVE' ? 1.35 :
        place.priceLevel === 'PRICE_LEVEL_INEXPENSIVE' ? 0.85 :
        place.priceLevel === 'PRICE_LEVEL_MODERATE' ? 1.0 :
        1.0;
      const baseAmount = (alloc[c.allocKey] || 0) * priceMultiplier;
      const isPerPlate = c.perPlate;
      const guests = Math.max(1, Number(guestCount) || 1);
      let pMin = 0;
      let pMax = 0;
      if (isPerPlate) {
        const perPlate = Math.max(200, Math.round(baseAmount / guests));
        pMin = Math.round(perPlate * 0.9) * guests;
        pMax = Math.round(perPlate * 1.2) * guests;
      } else {
        pMin = Math.max(1000, Math.round(baseAmount * 0.85));
        pMax = Math.max(pMin, Math.round(baseAmount * 1.2));
      }

      return {
        category: c.category,
        name: place.displayName.text,
        priceRange: budgetBasedRange(baseAmount, guestCount, c.perPlate),
        priceMin: pMin,
        priceMax: pMax,
        rating: Number(place.rating || 4.0),
        notes: place.formattedAddress || `${location || 'India'} (Google Places)`,
        lat: Number(place.location?.latitude),
        lon: Number(place.location?.longitude),
        mapUrl: place.googleMapsUri || null
      };
    } catch (e) {
      console.warn(`fetchGooglePlacesVendors failed for ${c.category}:`, e.message);
      return null;
    }
  });
  const vendors = (await Promise.all(calls)).filter(Boolean);
  return vendors;
}

async function fetchOverpassVendors({ location, budgetBreakdown, guestCount }) {
  const center = await geocodeLocation(location);
  if (!center) return [];
  const alloc = Object.fromEntries((budgetBreakdown || []).map((b) => [b.category, Number(b.amount) || 0]));
  const categories = [
    { category: 'Venue', tag: '["amenity"="events_venue"]', allocKey: 'Venue', perPlate: false },
    { category: 'Catering', tag: '["amenity"="restaurant"]', allocKey: 'Catering', perPlate: true },
    { category: 'Photography', tag: '["shop"="photo"]', allocKey: 'Photography', perPlate: false },
    { category: 'Decoration', tag: '["shop"="florist"]', allocKey: 'Decoration', perPlate: false },
    { category: 'Entertainment', tag: '["amenity"="nightclub"]', allocKey: 'Entertainment', perPlate: false },
  ];

  const calls = categories.map(async (c) => {
    const query = `
      [out:json][timeout:15];
      (
        node${c.tag}(around:10000,${center.lat},${center.lon});
        way${c.tag}(around:10000,${center.lat},${center.lon});
        relation${c.tag}(around:10000,${center.lat},${center.lon});
      );
      out center tags 5;
    `;
    try {
      const resp = await fetchWithRetryAndTimeout('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(query)}`
      }, 2, 20000);
      const data = await resp.json();
      const firstWithName = (data.elements || []).find((e) => e.tags?.name);
      if (!firstWithName?.tags?.name) return null;
      const baseAmt = alloc[c.allocKey] || 0;
      const isPerPlate = c.perPlate;
      const guests = Math.max(1, Number(guestCount) || 1);
      let pMin = 0;
      let pMax = 0;
      if (isPerPlate) {
        const perPlate = Math.max(200, Math.round(baseAmt / guests));
        pMin = Math.round(perPlate * 0.9) * guests;
        pMax = Math.round(perPlate * 1.2) * guests;
      } else {
        pMin = Math.max(1000, Math.round(baseAmt * 0.85));
        pMax = Math.max(pMin, Math.round(baseAmt * 1.2));
      }

      return {
        category: c.category,
        name: firstWithName.tags.name,
        priceRange: budgetBasedRange(baseAmt, guestCount, c.perPlate),
        priceMin: pMin,
        priceMax: pMax,
        rating: 4.0,
        notes: firstWithName.tags['addr:full'] || firstWithName.tags['addr:street'] || `${location || 'India'} (OpenStreetMap)`,
        lat: Number(firstWithName.lat ?? firstWithName.center?.lat),
        lon: Number(firstWithName.lon ?? firstWithName.center?.lon),
        mapUrl: Number.isFinite(Number(firstWithName.lat ?? firstWithName.center?.lat)) && Number.isFinite(Number(firstWithName.lon ?? firstWithName.center?.lon))
          ? `https://www.openstreetmap.org/?mlat=${Number(firstWithName.lat ?? firstWithName.center?.lat)}&mlon=${Number(firstWithName.lon ?? firstWithName.center?.lon)}#map=16/${Number(firstWithName.lat ?? firstWithName.center?.lat)}/${Number(firstWithName.lon ?? firstWithName.center?.lon)}`
          : null
      };
    } catch (e) {
      console.warn(`fetchOverpassVendors failed for ${c.category}:`, e.message);
      return null;
    }
  });

  const vendors = (await Promise.all(calls)).filter(Boolean);
  return vendors;
}

async function fetchLocationRealVendors({ location, budgetBreakdown, guestCount }) {
  let list = [];
  try {
    const geoapifyVendors = await fetchGeoapifyVendors({ location, budgetBreakdown, guestCount });
    if (geoapifyVendors.length) list = geoapifyVendors;
  } catch (e) {
    console.warn('Geoapify lookup failed:', e.message);
  }
  if (!list.length) {
    try {
      const googleVendors = await fetchGooglePlacesVendors({ location, budgetBreakdown, guestCount });
      if (googleVendors.length) list = googleVendors;
    } catch (e) {
      console.warn('Google Places lookup failed:', e.message);
    }
  }
  if (!list.length) {
    try {
      const osmVendors = await fetchOverpassVendors({ location, budgetBreakdown, guestCount });
      if (osmVendors.length) list = osmVendors;
    } catch (e) {
      console.warn('Overpass lookup failed:', e.message);
    }
  }
  
  // Score and rank vendor recommendations
  return rankVendors(list, budgetBreakdown, guestCount);
}

function buildBestOptionsFromVendors({ vendors, budgetBreakdown, guestCount }) {
  if (!Array.isArray(vendors) || !vendors.length) return [];
  const alloc = Object.fromEntries((budgetBreakdown || []).map((b) => [b.category, Number(b.amount) || 0]));
  return vendors.slice(0, 5).map((v) => {
    const target = alloc[v.category] || 0;
    const mid = midpointFromRange(v.priceRange, guestCount);
    const fit = target > 0 && mid <= target * 1.15;
    return {
      category: v.category,
      option: v.name,
      reason: fit
        ? 'Good match for your current budget and location.'
        : 'Strong local option; consider reallocating this category slightly.',
      estimatedCost: v.priceRange
    };
  });
}

async function offlineGeneratePlan({ name, type, date, guestCount, location, budgetMin, budgetMax, description, wantSuggestions, preferredVenueType, preferredCuisine, preferredVibe, recommendationPriority }) {
  const total = Number(budgetMax) || 0;
  const cats = ['Venue', 'Catering', 'Photography', 'Decoration', 'Entertainment', 'Miscellaneous'];
  const breakdown = computeBudgetBreakdown(total, cats);
  const city = location || 'India';
  const eventType = type || 'Event';
  const guests = Number(guestCount) || null;

  const vendors = [];

  const timeline = [
    { task: 'Finalize venue shortlist & visits', daysBeforeEvent: 60, priority: 'high' },
    { task: 'Lock venue + pay advance', daysBeforeEvent: 55, priority: 'high' },
    { task: 'Finalize caterer & menu', daysBeforeEvent: 45, priority: 'high' },
    { task: 'Book photography team', daysBeforeEvent: 30, priority: 'medium' },
    { task: 'Design invite & guest list', daysBeforeEvent: 28, priority: 'medium' },
    { task: 'Send invitations', daysBeforeEvent: 21, priority: 'high' },
    { task: 'Finalize decor theme', daysBeforeEvent: 14, priority: 'medium' },
    { task: 'Confirm final headcount', daysBeforeEvent: 7, priority: 'high' },
    { task: 'Reconfirm vendors & schedule', daysBeforeEvent: 3, priority: 'low' },
    { task: 'Day-of coordination', daysBeforeEvent: 0, priority: 'high' },
  ];

  const tips = [
    `For a ${eventType} in ${city}, shortlist 3 vendors per category and negotiate packages.`,
    'Keep an 8–12% buffer for last-minute add-ons (extra plates, transport, décor fixes).',
    description ? `Special requirement reminder: ${String(description).slice(0, 120)}` : 'Share a one-page schedule with all vendors 48 hours before the event.',
  ];

  return {
    vendors,
    budget: { total, breakdown },
    timeline,
    tips,
    estimatedCost: buildEstimatedCost({ budgetMin, budgetMax, guestCount, location }),
    budgetAdvice: budgetAdviceForVendors(vendors, budgetMax, guestCount),
    bestOptions: wantSuggestions
      ? (buildBestOptionsFromVendors({ vendors, budgetBreakdown: breakdown, guestCount }).length
          ? buildBestOptionsFromVendors({ vendors, budgetBreakdown: breakdown, guestCount })
          : buildBestOptions({ location, recommendationPriority, preferredVenueType, preferredCuisine, preferredVibe, budgetMax }))
      : []
  };
}

function offlineTagVendors(vendors) {
  const out = {};
  for (const v of vendors || []) {
    const max = Number(v.max ?? v.priceMax ?? 0);
    const tag =
      max < 20000 ? 'Budget-friendly' :
      max <= 60000 ? 'Standard' :
      max <= 120000 ? 'Premium' :
      'Luxury';
    if (v.id) out[v.id] = tag;
  }
  return out;
}

function offlineAnalyzeFeedback(feedbackList) {
  const list = Array.isArray(feedbackList) ? feedbackList : [];
  const n = list.length;
  const avg = n ? (list.reduce((s, f) => s + (Number(f.overall) || 0), 0) / n) : 0;
  const rec = n ? Math.round((list.filter(f => f.recommend === 'Definitely!').length / n) * 100) : 0;
  const positives = list.filter(f => (f.comment || '').toLowerCase().match(/good|great|nice|loved|amazing|excellent/)).length;
  const negatives = list.filter(f => (f.comment || '').toLowerCase().match(/bad|poor|late|delay|cold|rude|issue|problem/)).length;
  return [
    `• Overall sentiment: average rating ${avg.toFixed(1)}/5 across ${n} response(s), with ${rec}% saying "Definitely!" recommend.`,
    `• Guests loved: ${positives ? 'multiple comments mention positives (food/ambience/service)' : 'no strong positive pattern detected yet — collect a few more comments for clearer themes'}.`,
    `• Needs improvement + action: ${negatives ? 'some comments indicate issues (timing/coordination/quality)' : 'no strong negative pattern detected'} — assign one owner for vendor coordination and do a final confirmation call 48 hours before.`,
  ].join('\n');
}


// ─── Notion helper ────────────────────────────────────────────────────────────
async function notionInsert(databaseId, properties) {
  if (!NOTION_TOKEN || !databaseId) return null;

  const res = await fetch('https://api.notion.com/v1/pages', {
    method: 'POST',
    headers: {
      'Authorization':  `Bearer ${NOTION_TOKEN}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type':   'application/json',
    },
    body: JSON.stringify({
      parent: { database_id: databaseId },
      properties,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error(`Notion insert failed (DB: ${databaseId}):`, err);
    return null;
  }
  return res.json();
}

async function notionQuery(databaseId, body) {
  if (!NOTION_TOKEN || !databaseId) return null;
  const res = await fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${NOTION_TOKEN}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body || {}),
  });
  if (!res.ok) {
    const err = await res.text();
    console.error(`Notion query failed (DB: ${databaseId}):`, err);
    return null;
  }
  return res.json();
}

function rtPlain(rt) {
  const arr = Array.isArray(rt) ? rt : [];
  return arr.map(x => x?.plain_text || '').join('').trim();
}

function titlePlain(title) {
  const arr = Array.isArray(title) ? title : [];
  return arr.map(x => x?.plain_text || '').join('').trim();
}

function mapNotionVendor(page) {
  const p = page?.properties || {};
  return {
    id: page.id,
    category: p['Category']?.select?.name || 'Other',
    organization: titlePlain(p['Organization']?.title),
    location: rtPlain(p['Location']?.rich_text),
    priceMin: Number(p['Price Min']?.number || 0),
    priceMax: Number(p['Price Max']?.number || 0),
    services: rtPlain(p['Services']?.rich_text),
    contact: rtPlain(p['Contact']?.rich_text),
    rating: Number(p['Rating']?.number || 0) || 4.0,
    notionId: page.id,
  };
}

function normStr(s) {
  return String(s || '').trim().toLowerCase();
}

function enrichVendorsWithNotionPricing(vendors, notionVendors) {
  const nv = Array.isArray(notionVendors) ? notionVendors : [];
  const byCategory = nv.reduce((acc, v) => {
    const cat = v.category || 'Other';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(v);
    return acc;
  }, {});

  return (Array.isArray(vendors) ? vendors : []).map((v) => {
    const vName = normStr(v?.name || v?.organization);
    const vCat = v?.category || 'Other';
    const candidates = byCategory[vCat] || nv;
    const match = candidates.find((c) => {
      const cName = normStr(c.organization);
      return cName && (cName.includes(vName) || vName.includes(cName));
    });

    if (match && (Number(match.priceMin) > 0 || Number(match.priceMax) > 0)) {
      return {
        ...v,
        name: v?.name || match.organization,
        priceRange: `₹${Number(match.priceMin || 0).toLocaleString('en-IN')} - ₹${Number(match.priceMax || 0).toLocaleString('en-IN')}`,
        priceMin: Number(match.priceMin || 0),
        priceMax: Number(match.priceMax || 0),
        priceSource: 'notion',
        notionVendorId: match.notionId || match.id,
      };
    }

    return {
      ...v,
      priceMin: Number(v.priceMin || 0),
      priceMax: Number(v.priceMax || 0),
      priceRange: v.priceRange || 'Request quote',
      priceSource: v.priceRange ? 'api' : 'unknown',
    };
  });
}

// Notion property builders
const nTitle   = val => ({ title:     [{ text: { content: String(val ?? '') } }] });
const nText    = val => ({ rich_text: [{ text: { content: String(val ?? '') } }] });
const nNumber  = val => ({ number: val !== '' && val != null ? Number(val) : null });
const nDate    = val => ({ date: val ? { start: val } : null });
const nSelect  = val => ({ select: val ? { name: String(val) } : null });
const nToday   = ()  => ({ date: { start: new Date().toISOString().slice(0, 10) } });


// ─── /api/generate-plan ──────────────────────────────────────────────────────
app.post('/api/generate-plan', rateLimiter, async (req, res) => {
  try {
    const {
      name, type, date, guestCount, location, budgetMin, budgetMax, description,
      wantSuggestions, preferredVenueType, preferredCuisine, preferredVibe, recommendationPriority
    } = req.body;

    if (!name || !budgetMax) {
      return res.status(400).json({ error: 'Missing required fields: name, budgetMax' });
    }

    const prompt = `You are a professional Indian event planner. Plan the following event and return ONLY valid JSON.

Event Details:
- Name: ${name}
- Type: ${type || 'General'}
- Date: ${date || 'TBD'}
- Guest Count: ${guestCount || 'Unknown'}
- Location: ${location || 'India'}
- Budget: ₹${budgetMin || 0} – ₹${budgetMax}
- Special Requirements: ${description || 'None'}
- User requested preference-based suggestions: ${wantSuggestions ? 'Yes' : 'No'}
- Preferred Venue Type: ${preferredVenueType || 'Not specified'}
- Preferred Cuisine: ${preferredCuisine || 'Not specified'}
- Preferred Vibe: ${preferredVibe || 'Not specified'}
- Recommendation Priority: ${recommendationPriority || 'Balanced'}

Return this exact JSON structure with realistic Indian market data:
{
  "vendors": [
    { "category": "Venue", "name": "Vendor name or type", "priceRange": "₹X – ₹Y", "rating": 4.5, "notes": "short note" },
    { "category": "Catering", "name": "...", "priceRange": "₹X – ₹Y", "rating": 4.3, "notes": "..." },
    { "category": "Photography", "name": "...", "priceRange": "₹X – ₹Y", "rating": 4.7, "notes": "..." },
    { "category": "Decoration", "name": "...", "priceRange": "₹X – ₹Y", "rating": 4.2, "notes": "..." },
    { "category": "Entertainment", "name": "...", "priceRange": "₹X – ₹Y", "rating": 4.0, "notes": "..." }
  ],
  "budget": {
    "total": ${Number(budgetMax)},
    "breakdown": [
      { "category": "Venue", "amount": 0, "percentage": 0 },
      { "category": "Catering", "amount": 0, "percentage": 0 },
      { "category": "Photography", "amount": 0, "percentage": 0 },
      { "category": "Decoration", "amount": 0, "percentage": 0 },
      { "category": "Entertainment", "amount": 0, "percentage": 0 },
      { "category": "Miscellaneous", "amount": 0, "percentage": 0 }
    ]
  },
  "timeline": [
    { "task": "Book venue", "daysBeforeEvent": 60, "priority": "high" },
    { "task": "Confirm catering", "daysBeforeEvent": 45, "priority": "high" },
    { "task": "Send invitations", "daysBeforeEvent": 30, "priority": "high" },
    { "task": "Book photographer", "daysBeforeEvent": 21, "priority": "medium" },
    { "task": "Arrange decorations", "daysBeforeEvent": 14, "priority": "medium" },
    { "task": "Final guest count", "daysBeforeEvent": 7, "priority": "high" },
    { "task": "Send reminders", "daysBeforeEvent": 3, "priority": "low" },
    { "task": "Day-of coordination", "daysBeforeEvent": 0, "priority": "high" }
  ],
  "tips": [
    "Tip specific to ${type} events",
    "Tip about budget or vendors for ${location || 'India'}",
    "Tip about guest management or logistics"
  ],
  "estimatedCost": {
    "location": "${location || 'India'}",
    "estimatedMin": 0,
    "estimatedMax": 0,
    "note": "Short location-based estimate note"
  },
  "bestOptions": [
    { "category": "Venue", "option": "Best option", "reason": "Why this matches preferences", "estimatedCost": "₹X - ₹Y" }
  ],
  "budgetAdvice": {
    "withinBudget": true,
    "requiredMin": 0,
    "suggestedBudget": 0,
    "overBy": 0,
    "message": "Budget advisory message"
  }
}

Rules:
- Budget amounts must sum exactly to ${Number(budgetMax)}
- Percentages must sum to 100
- All amounts in INR (₹)
- Tips must be specific to event type and location
- estimatedCost must reflect location and guest count
- Vendor price ranges should align with budget breakdown (avoid unrealistic high ranges for low budgets)
- If user requested preference-based suggestions is "No", return "bestOptions": []
- If user requested preference-based suggestions is "Yes", return 3 to 5 bestOptions entries and align reasons to preferences`;

    let parsed = null;
    if (GEMINI_API_KEY && GEMINI_URL) {
      try {
        const rawText = await callGemini(prompt, true);
        parsed = safeJsonParse(rawText);
      } catch (err) {
        console.warn('Gemini generate-plan failed, using offline fallback:', err.message);
      }
    }
    if (!parsed) {
      parsed = await offlineGeneratePlan({
        name, type, date, guestCount, location, budgetMin, budgetMax, description,
        wantSuggestions, preferredVenueType, preferredCuisine, preferredVibe, recommendationPriority
      });
    }
    const realVendors = await fetchLocationRealVendors({
      location: location || 'India',
      budgetBreakdown: parsed?.budget?.breakdown || [],
      guestCount
    });
    if (realVendors.length) {
      parsed.vendors = realVendors;
    } else {
      // Fallback: generate curated offline vendors for the city
      const offlineVendors = generateOfflineVendorList({ location: location || 'India', limit: 10 });
      parsed.vendors = offlineVendors;
      parsed.tips = Array.isArray(parsed.tips) ? parsed.tips : [];
      if (!GEOAPIFY_API_KEY && !GOOGLE_PLACES_API_KEY) {
        parsed.tips.unshift('💡 Add GEOAPIFY_API_KEY to your .env for real live vendors with maps in your city.');
      }
    }

    // Pricing policy (Option A): show prices ONLY if vendor exists in Notion.
    if (NOTION_TOKEN && NOTION_DB_VENDORS) {
      const notionData = await notionQuery(NOTION_DB_VENDORS, {
        page_size: 60,
        ...(location ? { filter: { property: 'Location', rich_text: { contains: String(location) } } } : {}),
      });
      const notionVendors = notionData?.results ? notionData.results.map(mapNotionVendor) : [];
      parsed.vendors = enrichVendorsWithNotionPricing(parsed.vendors || [], notionVendors);
    } else {
      parsed.vendors = (parsed.vendors || []).map((v) => ({
        ...v,
        priceMin: Number(v.priceMin || 0),
        priceMax: Number(v.priceMax || 0),
        priceRange: v.priceRange || 'Request quote',
        priceSource: v.priceRange ? 'api' : 'unknown'
      }));
    }

    if (!parsed.estimatedCost) {
      parsed.estimatedCost = buildEstimatedCost({ budgetMin, budgetMax, guestCount, location });
    }
    if (!Array.isArray(parsed.bestOptions)) {
      parsed.bestOptions = wantSuggestions
        ? buildBestOptions({ location, recommendationPriority, preferredVenueType, preferredCuisine, preferredVibe, budgetMax })
        : [];
    }
    parsed.budgetAdvice = budgetAdviceForVendors(parsed.vendors || [], budgetMax, guestCount);
    if (wantSuggestions) {
      parsed.bestOptions = buildBestOptionsFromVendors({
        vendors: parsed.vendors || [],
        budgetBreakdown: parsed?.budget?.breakdown || [],
        guestCount
      });
    }

    // ── Sync to Notion (non-blocking) ──
    notionUpsertEvent(name, {
      'Name':           nTitle(name),
      'Type':           nText(type),
      'Date':           nDate(date),
      'Guests':         nNumber(guestCount),
      'Location':       nText(location),
      'Budget Min':     nNumber(budgetMin),
      'Budget Max':     nNumber(budgetMax),
      'Description':    nText(description),
      'Generated Plan': nText(JSON.stringify(parsed)),
      'Created At':     nToday(),
    }).then(() => console.log(`✅ Notion: event "${name}" synced`))
      .catch(e  => console.error('Notion event sync failed:', e.message));

    store.setEvent({ name, type, date, guestCount, location, budgetMin, budgetMax, description, id: req.body.id || `evt-${Date.now()}` });
    store.setAiResults(parsed);

    res.json(parsed);
  } catch (err) {
    console.error('generate-plan error:', err.message);
    res.status(500).json({ error: 'Failed to generate plan', details: err.message });
  }
});


// ─── /api/tag-vendors ────────────────────────────────────────────────────────
app.post('/api/tag-vendors', async (req, res) => {
  try {
    const { vendors } = req.body;
    if (!vendors || vendors.length === 0) {
      return res.status(400).json({ error: 'No vendors provided' });
    }

    const prompt = `You are an expert Indian event marketplace analyst.

Tag each vendor so users can quickly understand:
1) Pricing segment: "Budget-friendly" | "Standard" | "Premium" | "Luxury"
2) Service quality label: "Basic" | "Good" | "Great" | "Elite"
3) One short reason (max 12 words)

Use ALL available fields: category, rating, priceLevel (if present), review count hints in services/address, and any priceMin/priceMax if present.

Return ONLY valid JSON in this exact structure:
{
  "<vendorId>": { "segment": "Standard", "quality": "Great", "reason": "High rating and strong reviews, mid price level" }
}

Vendors:
${JSON.stringify(vendors)}`;

    if (GEMINI_API_KEY && GEMINI_URL) {
      try {
        const rawText = await callGemini(prompt, true);
        const parsed = safeJsonParse(rawText);
        if (parsed) return res.json(parsed);
      } catch (err) {
        console.warn('Gemini tag-vendors failed, using offline fallback:', err.message);
      }
    }
    // Offline fallback: best-effort based on rating + priceMax/priceLevel
    const out = {};
    for (const v of vendors || []) {
      const rating = Number(v.rating || 0);
      const max = Number(v.max ?? v.priceMax ?? 0);
      const priceLevel = String(v.priceLevel || '').toUpperCase();
      const segment =
        priceLevel.includes('VERY_EXPENSIVE') || max > 120000 ? 'Luxury' :
        priceLevel.includes('EXPENSIVE') || max > 60000 ? 'Premium' :
        priceLevel.includes('INEXPENSIVE') || max > 0 && max < 20000 ? 'Budget-friendly' :
        'Standard';
      const quality =
        rating >= 4.7 ? 'Elite' :
        rating >= 4.4 ? 'Great' :
        rating >= 4.1 ? 'Good' :
        'Basic';
      if (v.id) out[v.id] = { segment, quality, reason: `${quality} quality, ${segment} pricing` };
    }
    return res.json(out);
  } catch (err) {
    console.error('tag-vendors error:', err.message);
    res.status(500).json({ error: 'Failed to tag vendors', details: err.message });
  }
});

// ─── /api/vendors (live vendor discovery) ─────────────────────────────────────
app.get('/api/vendors', async (req, res) => {
  try {
    const location = String(req.query.location || '').trim();
    if (!location) return res.json(store.listVendors());
    const limit = Math.min(60, Math.max(12, Number(req.query.limit || 36)));
    const vendors = await fetchLiveVendorList({ location, limit });
    const source = vendors.length
      ? (vendors[0].id?.startsWith('offline-') ? 'offline' : vendors[0].id?.startsWith('osm-') ? 'osm' : 'live')
      : 'none';
    return res.json({ vendors, source });
  } catch (err) {
    console.error('vendors endpoint error:', err.message);
    res.status(500).json({ error: 'Failed to fetch vendors', details: err.message });
  }
});

app.post('/api/vendors', (req, res) => {
  const vendor = req.body;
  if (!vendor?.organization) return res.status(400).json({ error: 'organization required' });
  const saved = store.upsertVendor({
    ...vendor,
    id: vendor.id || `v-${Date.now()}`,
    priceMin: Number(vendor.priceMin) || 0,
    priceMax: Number(vendor.priceMax) || 0,
    rating: Number(vendor.rating) || 5,
  });
  res.json(saved);
});


// ─── /api/analyze-feedback ───────────────────────────────────────────────────
app.post('/api/analyze-feedback', async (req, res) => {
  try {
    const { feedbackList } = req.body;
    if (!feedbackList || feedbackList.length === 0) {
      return res.status(400).json({ error: 'No feedback provided' });
    }

    const prompt = `You are an AI event analyst. Analyze this post-event feedback data and write 3 concise bullet points summarizing the insights.

Feedback data:
${JSON.stringify(feedbackList, null, 2)}

Write exactly 3 bullet points starting with "•". Cover: what guests loved, what needed improvement, and one actionable recommendation.`;

    if (GEMINI_API_KEY && GEMINI_URL) {
      try {
        const analysis = await callGemini(prompt, false);
        return res.json({ analysis });
      } catch (err) {
        console.warn('Gemini analyze-feedback failed, using offline fallback:', err.message);
      }
    }
    return res.json({ analysis: offlineAnalyzeFeedback(feedbackList) });
  } catch (err) {
    console.error('analyze-feedback error:', err.message);
    res.status(500).json({ error: 'Failed to analyze feedback', details: err.message });
  }
});

// ─── /api/invitation-templates ────────────────────────────────────────────────
app.post('/api/invitation-templates', async (req, res) => {
  try {
    const { name, type, date, location, guestCount, description, hostName } = req.body || {};
    if (!name || !date) {
      return res.status(400).json({ error: 'Missing required fields: name, date' });
    }

    const prompt = `You are an expert Indian event copywriter.
Generate 3 invitation templates for the event below.

Event:
- Name: ${name}
- Type: ${type || 'Event'}
- Date: ${date}
- Location: ${location || 'To be decided'}
- Guest count: ${guestCount || 'N/A'}
- Notes: ${description || 'None'}
- Host name (if any): ${hostName || 'Not specified'}

Return ONLY valid JSON with this exact structure:
{
  "templates": [
    { "title": "Short WhatsApp", "channel": "whatsapp", "text": "..." },
    { "title": "Formal Email", "channel": "email", "text": "..." },
    { "title": "Fun & Friendly", "channel": "whatsapp", "text": "..." }
  ]
}

Rules:
- Keep WhatsApp templates under 700 characters
- Email template should include a subject line like: "Subject: ..."
- Use emojis sparingly (max 3 per template)
- Include RSVP line
- Use Indian tone + phrasing (polite, warm)`;

    if (GEMINI_API_KEY && GEMINI_URL) {
      try {
        const rawText = await callGemini(prompt, true);
        const parsed = safeJsonParse(rawText);
        if (parsed?.templates && Array.isArray(parsed.templates)) return res.json(parsed);
      } catch (err) {
        console.warn('Gemini invitation-templates failed, using offline fallback:', err.message);
      }
    }

    const prettyDate = new Date(date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    const place = location || 'TBD';
    const host = hostName ? `— ${hostName}` : '';
    return res.json({
      templates: [
        {
          title: 'Short WhatsApp',
          channel: 'whatsapp',
          text:
`Hi! You’re invited to *${name}* 🎉
📅 ${prettyDate}
📍 ${place}

Would love to see you there. Please reply with your RSVP: Yes / No / Maybe.
${host}`.trim()
        },
        {
          title: 'Formal Email',
          channel: 'email',
          text:
`Subject: Invitation — ${name} on ${prettyDate}

Dear Guest,

You are warmly invited to ${name} (${type || 'Event'}).

Date: ${prettyDate}
Location: ${place}

Kindly confirm your attendance by replying to this message with your RSVP.

Regards,
${hostName || 'Host'}`.trim()
        },
        {
          title: 'Fun & Friendly',
          channel: 'whatsapp',
          text:
`Hey! Quick invite for *${name}* ✨
🗓 ${prettyDate} | 📍 ${place}

Come celebrate with us! RSVP: Yes / No / Maybe (and bring your best vibes).
${host}`.trim()
        }
      ]
    });
  } catch (err) {
    console.error('invitation-templates error:', err.message);
    res.status(500).json({ error: 'Failed to generate invitation templates', details: err.message });
  }
});


// ─── /api/chat ───────────────────────────────────────────────────────────────
app.post('/api/chat', async (req, res) => {
  try {
    const { messages, eventContext, vendorContext } = req.body;

    if (!messages || messages.length === 0) {
      return res.status(400).json({ error: 'No messages provided' });
    }

    const eventInfo = eventContext
      ? `Current event being planned:\n- Name: ${eventContext.name || 'N/A'}\n- Type: ${eventContext.type || 'N/A'}\n- Date: ${eventContext.date || 'N/A'}\n- Guests: ${eventContext.guestCount || 'N/A'}\n- Location: ${eventContext.location || 'N/A'}\n- Budget: ₹${eventContext.budgetMin || 0} to ₹${eventContext.budgetMax || 'N/A'}\n- Description: ${eventContext.description || 'None'}`
      : 'No specific event context provided.';

    const vendorInfo = vendorContext
      ? `You are acting as a representative of: ${vendorContext.organization} (${vendorContext.category}), priced at ₹${vendorContext.priceMin}-₹${vendorContext.priceMax}, rated ${vendorContext.rating}/5, based in ${vendorContext.location || 'India'}. Services: ${vendorContext.services || 'Not specified'}.`
      : '';

    const latestQuestion = messages.filter(m => m.role === 'user').slice(-1)[0]?.text || '';
    const systemPrompt = `You are EventMind AI, an expert Indian event planning assistant.\n${vendorInfo}\n${eventInfo}\n\nYour role:
- Answer the USER'S LATEST QUESTION directly and specifically
- Stay tightly relevant to what was asked; do not give generic canned advice
- Use the conversation history only as supporting context
- Give practical advice for events in India (prices in ₹, Indian vendors, cultural context)
- Be concise and friendly, use short paragraphs
- If acting as a vendor, respond on behalf of that vendor professionally
- If information is missing, say exactly what is missing instead of guessing broadly

Latest user question:
${latestQuestion}`;

    const conversationHistory = messages
      .map(m => `${m.role === 'user' ? 'User' : 'EventMind AI'}: ${m.text}`)
      .join('\n');

    const fullPrompt = `${systemPrompt}\n\nConversation:\n${conversationHistory}\n\nEventMind AI:`;

    if (GEMINI_API_KEY && GEMINI_URL) {
      try {
        const reply = await callGemini(fullPrompt, false);
        if (reply?.trim()) return res.json({ reply: reply.trim() });
      } catch (err) {
        console.warn('Gemini chat failed, using offline fallback:', err.message);
      }
    }

    return res.json({ reply: fallbackChatReply(messages, eventContext, vendorContext) });
  } catch (err) {
    console.error('chat error:', err.message);
    res.status(500).json({ error: 'Chat failed', details: err.message });
  }
});


// ─── /api/notion/save-vendor ─────────────────────────────────────────────────
app.post('/api/notion/save-vendor', async (req, res) => {
  try {
    const { organization, category, location, priceMin, priceMax, services, contact, rating } = req.body;
    if (!organization) return res.status(400).json({ error: 'organization required' });

    const result = await notionUpsertVendor(organization, {
      'Organization': nTitle(organization),
      'Category':     nSelect(category),
      'Location':     nText(location),
      'Price Min':    nNumber(priceMin),
      'Price Max':    nNumber(priceMax),
      'Services':     nText(services),
      'Contact':      nText(contact),
      'Rating':       nNumber(rating),
      'Saved At':     nToday(),
    });

    if (!result) return res.status(503).json({ error: 'Notion not configured or upsert failed' });
    console.log(`✅ Notion: vendor "${organization}" saved/updated`);
    res.json({ success: true, pageId: result.id });
  } catch (err) {
    console.error('notion/save-vendor error:', err.message);
    res.status(500).json({ error: 'Failed to save vendor to Notion' });
  }
});

// ─── /api/notion/vendors (list vendors from Notion DB) ────────────────────────
app.get('/api/notion/vendors', async (req, res) => {
  try {
    if (!NOTION_TOKEN || !NOTION_DB_VENDORS) {
      return res.status(503).json({ error: 'Notion not configured' });
    }
    const location = String(req.query.location || '').trim();
    const category = String(req.query.category || '').trim();
    const q = String(req.query.q || '').trim();
    const limit = Math.min(60, Math.max(5, Number(req.query.limit || 48)));

    const filters = [];
    if (location) {
      filters.push({
        property: 'Location',
        rich_text: { contains: location }
      });
    }
    if (category && category !== 'All Categories') {
      filters.push({
        property: 'Category',
        select: { equals: category }
      });
    }
    if (q) {
      filters.push({
        property: 'Organization',
        title: { contains: q }
      });
    }

    const body = {
      page_size: limit,
      sorts: [{ property: 'Saved At', direction: 'descending' }],
      ...(filters.length ? { filter: filters.length === 1 ? filters[0] : { and: filters } } : {}),
    };

    const data = await notionQuery(NOTION_DB_VENDORS, body);
    if (!data) return res.json({ vendors: [] });

    const vendors = (data.results || []).map(mapNotionVendor).filter(v => v.organization);
    return res.json({ vendors });
  } catch (err) {
    console.error('notion/vendors error:', err.message);
    res.status(500).json({ error: 'Failed to list Notion vendors', details: err.message });
  }
});


// ─── /api/notion/save-booking ────────────────────────────────────────────────
app.post('/api/notion/save-booking', async (req, res) => {
  try {
    const { eventName, vendorName, date, budget, status } = req.body;
    if (!eventName) return res.status(400).json({ error: 'eventName required' });

    const result = await notionUpsertBooking(eventName, vendorName, {
      'Event Name':   nTitle(eventName),
      'Vendor':       nText(vendorName),
      'Event Date':   nDate(date),
      'Budget':       nNumber(budget),
      'Status':       nSelect(status || 'Pending'),
      'Requested At': nToday(),
    });

    if (!result) return res.status(503).json({ error: 'Notion not configured or upsert failed' });
    console.log(`✅ Notion: booking for "${eventName}" saved/updated`);
    res.json({ success: true, pageId: result.id });
  } catch (err) {
    console.error('notion/save-booking error:', err.message);
    res.status(500).json({ error: 'Failed to save booking to Notion' });
  }
});


// ─── /api/notion/save-feedback ───────────────────────────────────────────────
app.post('/api/notion/save-feedback', async (req, res) => {
  try {
    const { name, eventName, overall, venue, catering, recommend, comment } = req.body;

    const result = await notionInsert(NOTION_DB_FEEDBACK, {
      'Name':      nTitle(name || 'Anonymous'),
      'Event':     nText(eventName),
      'Rating':    nNumber(overall),
      'Venue':     nNumber(venue),
      'Catering':  nNumber(catering),
      'Recommend': nSelect(recommend),
      'Comment':   nText(comment),
      'Date':      nToday(),
    });

    if (!result) return res.status(503).json({ error: 'Notion not configured or insert failed' });
    console.log(`✅ Notion: feedback from "${name || 'Anonymous'}" saved`);
    res.json({ success: true, pageId: result.id });
  } catch (err) {
    console.error('notion/save-feedback error:', err.message);
    res.status(500).json({ error: 'Failed to save feedback to Notion' });
  }
});


// ─── Data store API ────────────────────────────────────────────────────────────

app.get('/api/data', (req, res) => {
  res.json(store.getAll());
});

app.get('/api/event', (req, res) => {
  const data = store.getAll();
  res.json({ event: data.event, aiResults: data.aiResults });
});

app.put('/api/event', (req, res) => {
  const { event } = req.body;
  if (!event) return res.status(400).json({ error: 'event required' });
  res.json({ event: store.setEvent(event) });
});

app.put('/api/ai-results', (req, res) => {
  const { aiResults } = req.body;
  res.json({ aiResults: store.setAiResults(aiResults) });
});

app.get('/api/bookings', (req, res) => {
  res.json(store.listBookings());
});

app.post('/api/bookings', (req, res) => {
  const booking = req.body;
  if (!booking?.vendorId) return res.status(400).json({ error: 'vendorId required' });
  const saved = store.addBooking({
    ...booking,
    id: booking.id || Date.now(),
    budget: Number(booking.budget) || 0,
    status: booking.status || 'Pending',
  });
  res.json(saved);
});

app.patch('/api/bookings/:id', (req, res) => {
  const id = Number(req.params.id);
  const updated = store.updateBooking(id, req.body);
  if (!updated) return res.status(404).json({ error: 'Booking not found' });
  res.json(updated);
});

app.get('/api/attendees', (req, res) => {
  res.json(store.listAttendees());
});

app.post('/api/attendees', (req, res) => {
  const attendee = req.body;
  if (!attendee?.name || !attendee?.email) {
    return res.status(400).json({ error: 'name and email required' });
  }
  res.json(store.addAttendee({ ...attendee, id: attendee.id || Date.now() }));
});

app.patch('/api/attendees/:id', (req, res) => {
  const id = Number(req.params.id);
  const updated = store.updateAttendee(id, req.body);
  if (!updated) return res.status(404).json({ error: 'Attendee not found' });
  res.json(updated);
});

app.delete('/api/attendees/:id', (req, res) => {
  store.removeAttendee(Number(req.params.id));
  res.json({ success: true });
});

app.post('/api/attendees/remind', async (req, res) => {
  const { id, bulk } = req.body;
  const attendees = store.listAttendees();
  const event = store.getAll().event || {};
  const eventName = event.name || 'Your Event';
  
  if (bulk) {
    const invited = attendees.filter(a => a.status === 'Invited');
    let sentCount = 0;
    for (const a of invited) {
      try {
        const text = `Hi ${a.name},\n\nThis is a friendly reminder to RSVP for "${eventName}" scheduled on ${event.date || 'TBD'} at ${event.location || 'TBD'}.\n\nPlease let us know if you can make it.\n\nBest regards,\nEvent Planner`;
        await sendEmail({
          to: a.email,
          subject: `Reminder: RSVP for ${eventName}`,
          text
        });
        sentCount++;
      } catch (err) {
        console.error(`Failed to send reminder to ${a.email}:`, err.message);
      }
    }
    return res.json({
      success: true,
      count: sentCount,
      message: `Reminders sent to ${sentCount} invited attendee(s)`,
    });
  }
  const att = attendees.find(a => a.id === id);
  if (!att) return res.status(404).json({ error: 'Attendee not found' });
  
  try {
    const text = `Hi ${att.name},\n\nThis is a friendly reminder to RSVP for "${eventName}" scheduled on ${event.date || 'TBD'} at ${event.location || 'TBD'}.\n\nPlease let us know if you can make it.\n\nBest regards,\nEvent Planner`;
    await sendEmail({
      to: att.email,
      subject: `Reminder: RSVP for ${eventName}`,
      text
    });
    res.json({ success: true, message: `Reminder sent to ${att.name} at ${att.email}` });
  } catch (err) {
    console.error(`Failed to send reminder to ${att.email}:`, err.message);
    res.status(500).json({ error: `Failed to send email: ${err.message}` });
  }
});

app.post('/api/attendees/invite-preview', (req, res) => {
  const { event } = req.body;
  if (!event?.name) return res.status(400).json({ error: 'event required' });
  const preview = `💌 You're Invited!\nJoin us for ${event.name}\n\n📅 Date: ${event.date || 'TBD'}\n📍 Location: ${event.location || 'To Be Decided'}\n\nWe would love for you to join us on this special day.\nPlease RSVP at your earliest convenience.`.trim();
  res.json({ preview });
});

app.post('/api/attendees/send-invites', async (req, res) => {
  const attendees = store.listAttendees().filter(a => a.status === 'Invited');
  const event = store.getAll().event || {};
  const eventName = event.name || 'Your Event';
  
  let sentCount = 0;
  for (const a of attendees) {
    try {
      const text = `💌 You're Invited!\n\nHi ${a.name},\n\nJoin us for "${eventName}"!\n\n📅 Date: ${event.date || 'TBD'}\n📍 Location: ${event.location || 'TBD'}\n\nWe would love for you to join us on this special day. Please RSVP at your earliest convenience.\n\nBest regards,\nEvent Planner`;
      await sendEmail({
        to: a.email,
        subject: `Invitation: ${eventName}`,
        text
      });
      sentCount++;
    } catch (err) {
      console.error(`Failed to send invitation to ${a.email}:`, err.message);
    }
  }
  res.json({ success: true, count: sentCount, message: `Invitations sent to ${sentCount} pending attendee(s)` });
});

app.get('/api/feedback', (req, res) => {
  res.json(store.listFeedback());
});

app.post('/api/feedback', (req, res) => {
  const entry = req.body;
  if (!entry?.overall) return res.status(400).json({ error: 'overall rating required' });
  res.json(store.addFeedback({
    ...entry,
    id: entry.id || Date.now(),
    date: entry.date || new Date().toLocaleDateString('en-IN'),
  }));
});

app.get('/api/expenses', (req, res) => {
  res.json(store.listExpenses());
});

app.post('/api/expenses', (req, res) => {
  const expense = req.body;
  if (!expense?.category || !expense?.amount) {
    return res.status(400).json({ error: 'category and amount required' });
  }
  res.json(store.addExpense({ ...expense, id: expense.id || Date.now(), amount: Number(expense.amount) }));
});

app.delete('/api/expenses/:id', (req, res) => {
  store.removeExpense(Number(req.params.id));
  res.json({ success: true });
});

app.get('/api/messages', (req, res) => {
  res.json(store.listMessages(req.query.vendorId || undefined));
});

app.post('/api/messages', (req, res) => {
  const message = req.body;
  if (!message?.vendorId || !message?.text) {
    return res.status(400).json({ error: 'vendorId and text required' });
  }
  res.json(store.addMessage({
    ...message,
    id: message.id || Date.now(),
    timestamp: message.timestamp || new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
  }));
});

app.delete('/api/messages', (req, res) => {
  const { vendorId } = req.query;
  if (!vendorId) return res.status(400).json({ error: 'vendorId required' });
  store.clearMessages(vendorId);
  res.json({ success: true });
});


// ─── /api/health ─────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  const keyLoaded    = !!GEMINI_API_KEY && GEMINI_API_KEY !== 'your_gemini_api_key_here';
  const notionReady  = !!NOTION_TOKEN && !!NOTION_DB_EVENTS;
  res.json({
    status:        'ok',
    model:         GEMINI_MODEL,
    keyLoaded,
    keyPreview:    keyLoaded ? GEMINI_API_KEY.slice(0, 8) + '...' : 'NOT SET',
    aiMode:        keyLoaded ? 'gemini' : 'offline-fallback',
    notion: {
      connected:   notionReady,
      dbsConfigured: {
        events:    !!NOTION_DB_EVENTS,
        vendors:   !!NOTION_DB_VENDORS,
        bookings:  !!NOTION_DB_BOOKINGS,
        feedback:  !!NOTION_DB_FEEDBACK,
      }
    }
  });
});

app.get('/api/clear-cache', (req, res) => {
  vendorSearchCache.clear();
  console.log('🧹 Live vendor cache cleared');
  res.json({ status: 'ok', message: 'Live vendor search cache cleared successfully' });
});


async function syncMessageToNotion(msg) {
  if (!NOTION_TOKEN || !NOTION_DB_CHAT_LOGS) return;
  
  const eventName = store.getAll().event?.name || 'General Event';
  const vendor = store.listVendors().find(v => v.id === msg.vendorId);
  const vendorName = vendor ? vendor.organization : (msg.vendorId === 'ai-assistant' ? 'EventMind AI' : msg.vendorId);
  
  try {
    await notionUpsertChatLog(msg.id, {
      'Message ID':  nTitle(String(msg.id)),
      'Sender':      nSelect(msg.sender === 'Vendor' ? 'Vendor' : (msg.isAI ? 'AI' : 'User')),
      'Vendor Name': nText(vendorName),
      'Event Name':  nText(eventName),
      'Message':     nText(msg.text),
      'Status':      nSelect(msg.status || 'Sent'),
      'Timestamp':   nDate(new Date().toISOString()),
    });
    console.log(`✅ Notion: chat message synced`);
  } catch (err) {
    console.error('Notion chat sync failed:', err.message);
  }
}

async function syncReadStatusToNotion(vendorId, senderRole) {
  if (!NOTION_TOKEN || !NOTION_DB_CHAT_LOGS) return;
  
  const threadMsgs = store.listMessages(vendorId);
  for (const m of threadMsgs) {
    if (m.sender !== senderRole && m.status === 'read') {
      try {
        const queryResult = await notionQuery(NOTION_DB_CHAT_LOGS, {
          filter: { property: 'Message ID', title: { equals: String(m.id) } }
        });
        const page = queryResult?.results?.[0];
        if (page) {
          await notionUpdate(page.id, {
            'Status': nSelect('Read')
          });
        }
      } catch (err) {
        console.error(`Notion sync status update failed for msg ${m.id}:`, err.message);
      }
    }
  }
}

const server = app.listen(PORT, '127.0.0.1', () => {
  const keyLoaded   = !!GEMINI_API_KEY && GEMINI_API_KEY !== 'your_gemini_api_key_here';
  const notionReady = !!NOTION_TOKEN && !!NOTION_DB_EVENTS;
  console.log('──────────────────────────────────────');
  console.log('  EventMind AI Backend — Port ' + PORT);
  console.log('  Model: ' + GEMINI_MODEL);
  console.log('  Gemini: ' + (keyLoaded ? GEMINI_API_KEY.slice(0, 8) + '...' : 'NOT LOADED ⚠'));
  console.log('  Notion: ' + (notionReady ? '✅ Connected' : '⚠  DBs not set up yet (run setup-notion.js)'));
  console.log('──────────────────────────────────────');
});

// Setup WebSocket Server bound to the same HTTP server
const wss = new WebSocketServer({ server, path: '/api/chat-ws' });
const chatClients = new Map(); // clientId -> ws socket

function deliverPendingMessages(clientId) {
  const ws = chatClients.get(clientId);
  if (!ws || ws.readyState !== 1) return;
  
  const allMsgs = store.listMessages();
  allMsgs.forEach(m => {
    const isTargetUser = clientId === 'user-client' && m.sender !== 'User';
    const isTargetVendor = clientId === m.vendorId && m.sender === 'User';
    
    if ((isTargetUser || isTargetVendor) && m.status === 'sent') {
      m.status = 'delivered';
      store.updateMessageStatus(m.id, 'delivered');
      
      const senderId = m.sender === 'User' ? 'user-client' : m.vendorId;
      const senderWs = chatClients.get(senderId);
      if (senderWs && senderWs.readyState === 1) {
        senderWs.send(JSON.stringify({ type: 'status-update', msgId: m.id, status: 'delivered' }));
      }
      
      syncMessageToNotion(m);
      ws.send(JSON.stringify({ type: 'message', message: m }));
    }
  });
}

wss.on('connection', (ws) => {
  console.log('🔌 New WS Connection established');
  
  ws.on('message', async (data) => {
    try {
      const packet = JSON.parse(data);
      if (packet.type === 'register') {
        ws.clientId = packet.clientId;
        ws.role = packet.role;
        chatClients.set(packet.clientId, ws);
        console.log(`Registered WS client: ${packet.clientId} (${packet.role})`);
        deliverPendingMessages(packet.clientId);
      } else if (packet.type === 'message') {
        const msg = packet.message;
        msg.status = 'sent';
        
        store.addMessage(msg);
        syncMessageToNotion(msg);
        
        const recipientId = msg.sender === 'User' ? msg.vendorId : 'user-client';
        const recipientWs = chatClients.get(recipientId);
        
        if (recipientWs && recipientWs.readyState === 1) {
          msg.status = 'delivered';
          store.updateMessageStatus(msg.id, 'delivered');
          recipientWs.send(JSON.stringify({ type: 'message', message: msg }));
          syncMessageToNotion(msg);
        }
        
        ws.send(JSON.stringify({ type: 'status-update', msgId: msg.id, status: msg.status }));
      } else if (packet.type === 'read-receipt') {
        const { vendorId, senderRole } = packet;
        const threadMsgs = store.listMessages(vendorId);
        threadMsgs.forEach(m => {
          if (m.sender !== senderRole && m.status !== 'read') {
            m.status = 'read';
            store.updateMessageStatus(m.id, 'read');
            
            const senderId = m.sender === 'User' ? 'user-client' : m.vendorId;
            const senderWs = chatClients.get(senderId);
            if (senderWs && senderWs.readyState === 1) {
              senderWs.send(JSON.stringify({ type: 'status-update', msgId: m.id, status: 'read' }));
            }
          }
        });
        syncReadStatusToNotion(vendorId, senderRole);
      }
    } catch (err) {
      console.error('WS message processing error:', err.message);
    }
  });

  ws.on('close', () => {
    if (ws.clientId) {
      console.log(`🔌 WS Connection closed: ${ws.clientId}`);
      chatClients.delete(ws.clientId);
    }
  });
  
  ws.on('error', (err) => {
    console.error('WS socket error:', err.message);
  });
});
