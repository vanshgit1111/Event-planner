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
const GEMINI_MODEL      = 'gemini-2.0-flash';
const GEMINI_URL        = GEMINI_API_KEY
  ? `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`
  : null;

const NOTION_TOKEN      = process.env.NOTION_TOKEN;
const NOTION_VERSION    = '2022-06-28';
const NOTION_DB_EVENTS  = process.env.NOTION_DB_EVENTS;
const NOTION_DB_VENDORS = process.env.NOTION_DB_VENDORS;
const NOTION_DB_BOOKINGS= process.env.NOTION_DB_BOOKINGS;
const NOTION_DB_FEEDBACK= process.env.NOTION_DB_FEEDBACK;
const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY;
const GEOAPIFY_API_KEY = process.env.GEOAPIFY_API_KEY;

const app  = express();
app.use(cors());
app.use(express.json());
const PORT = 5001;


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
  const q = encodeURIComponent(location || 'India');
  const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${q}`, {
    headers: { 'User-Agent': 'EventMind/1.0 (event planner app)' }
  });
  if (!res.ok) return null;
  const data = await res.json();
  if (!Array.isArray(data) || !data[0]) return null;
  return { lat: Number(data[0].lat), lon: Number(data[0].lon) };
}

async function geocodeLocationGeoapify(location) {
  if (!GEOAPIFY_API_KEY) return null;
  const q = encodeURIComponent(location || 'India');
  const url = `https://api.geoapify.com/v1/geocode/search?text=${q}&limit=1&apiKey=${GEOAPIFY_API_KEY}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  const coords = data?.features?.[0]?.geometry?.coordinates;
  if (!Array.isArray(coords) || coords.length < 2) return null;
  return { lat: Number(coords[1]), lon: Number(coords[0]) };
}

async function fetchGeoapifyVendors({ location, budgetBreakdown, guestCount }) {
  if (!GEOAPIFY_API_KEY) return [];
  const center = await geocodeLocationGeoapify(location);
  if (!center) return [];

  const alloc = Object.fromEntries((budgetBreakdown || []).map((b) => [b.category, Number(b.amount) || 0]));
  const categories = [
    { category: 'Venue', apiCategory: 'catering', allocKey: 'Venue', perPlate: false, fallbackName: 'Event venue' },
    { category: 'Catering', apiCategory: 'catering.restaurant', allocKey: 'Catering', perPlate: true, fallbackName: 'Catering service' },
    { category: 'Photography', apiCategory: 'commercial.photo_studio', allocKey: 'Photography', perPlate: false, fallbackName: 'Photography vendor' },
    { category: 'Decoration', apiCategory: 'commercial.florist', allocKey: 'Decoration', perPlate: false, fallbackName: 'Decoration vendor' },
    { category: 'Entertainment', apiCategory: 'entertainment', allocKey: 'Entertainment', perPlate: false, fallbackName: 'Entertainment vendor' },
  ];

  const calls = categories.map(async (c) => {
    const url = `https://api.geoapify.com/v2/places?categories=${encodeURIComponent(c.apiCategory)}&filter=circle:${center.lon},${center.lat},10000&bias=proximity:${center.lon},${center.lat}&limit=5&apiKey=${GEOAPIFY_API_KEY}`;
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const data = await resp.json();
    const place = data?.features?.[0]?.properties;
    if (!place) return null;
    const displayName = place.name || place.formatted || c.fallbackName;

    return {
      category: c.category,
      name: displayName,
      priceRange: budgetBasedRange(alloc[c.allocKey] || 0, guestCount, c.perPlate),
      rating: 4.0,
      notes: place.formatted || `${location || 'India'} (Geoapify)`,
      lat: Number(place.lat),
      lon: Number(place.lon),
      mapUrl: place.datasource?.raw?.website || (Number.isFinite(Number(place.lat)) && Number.isFinite(Number(place.lon))
        ? `https://www.openstreetmap.org/?mlat=${Number(place.lat)}&mlon=${Number(place.lon)}#map=16/${Number(place.lat)}/${Number(place.lon)}`
        : null)
    };
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
  if (has('commercial.photo') || has('photo_studio')) return 'Photography';
  if (has('commercial.florist') || has('florist') || has('craft.florist')) return 'Decoration';
  if (has('catering') || has('restaurant') || has('food')) return 'Catering';
  if (has('entertainment') || has('theatre') || has('cinema') || has('nightclub') || has('music')) return 'Entertainment';
  return 'Other';
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
    'commercial.photo_studio',
    'commercial.florist',
    'entertainment',
  ];

  const url = `https://api.geoapify.com/v2/places?categories=${encodeURIComponent(categories.join(','))}&filter=circle:${center.lon},${center.lat},15000&bias=proximity:${center.lon},${center.lat}&limit=${Math.min(60, Math.max(10, limit))}&apiKey=${GEOAPIFY_API_KEY}`;
  const resp = await fetch(url);
  if (!resp.ok) return [];
  const data = await resp.json();
  const features = Array.isArray(data?.features) ? data.features : [];

  const out = features.map((f) => {
    const p = f?.properties || {};
    const name = p.name || p.formatted || 'Vendor';
    const lat = Number(p.lat);
    const lon = Number(p.lon);
    const category = categoryLabelFromGeoapifyCats(p.categories || []);
    const id = `geoapify-${normalizeVendorId(name)}-${normalizeVendorId(category)}-${normalizeVendorId(String(p.place_id || ''))}`;
    return {
      id,
      category,
      organization: name,
      rating: typeof p.rank?.popularity === 'number' ? Math.min(5, Math.max(3.5, 3.5 + (p.rank.popularity / 100))) : 4.0,
      location: location || p.city || p.state || '',
      address: p.formatted || '',
      priceLevel: p.datasource?.raw?.price_level || null,
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
    const resp = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': GOOGLE_PLACES_API_KEY,
        'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.rating,places.userRatingCount,places.priceLevel,places.location,places.googleMapsUri'
      },
      body: JSON.stringify({ textQuery: q, maxResultCount: perQuery })
    });
    if (!resp.ok) return [];
    const data = await resp.json();
    const places = Array.isArray(data.places) ? data.places : [];
    return places.map((p) => ({
      id: `gplaces-${p.id}`,
      category,
      organization: p.displayName?.text || 'Vendor',
      rating: Number(p.rating || 4.0),
      location: location || '',
      address: p.formattedAddress || '',
      priceLevel: p.priceLevel || null,
      services: p.userRatingCount ? `${p.userRatingCount} reviews` : '',
      lat: Number(p.location?.latitude),
      lon: Number(p.location?.longitude),
      mapUrl: p.googleMapsUri || null
    }));
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
  try {
    const geo = await fetchGeoapifyVendorList({ location, limit });
    if (geo.length) return geo;
  } catch (e) {
    console.warn('Geoapify vendor list failed:', e.message);
  }
  try {
    const gp = await fetchGooglePlacesVendorList({ location, limit });
    if (gp.length) return gp;
  } catch (e) {
    console.warn('Google vendor list failed:', e.message);
  }
  // As a last resort, return empty (OSM Overpass broad search is expensive and rate-limited).
  return [];
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
    const resp = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': GOOGLE_PLACES_API_KEY,
        'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.rating,places.userRatingCount,places.priceLevel,places.location,places.googleMapsUri'
      },
      body: JSON.stringify(body)
    });
    if (!resp.ok) return null;
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
    return {
      category: c.category,
      name: place.displayName.text,
      priceRange: budgetBasedRange(baseAmount, guestCount, c.perPlate),
      rating: Number(place.rating || 4.0),
      notes: place.formattedAddress || `${location || 'India'} (Google Places)`,
      lat: Number(place.location?.latitude),
      lon: Number(place.location?.longitude),
      mapUrl: place.googleMapsUri || null
    };
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
    const resp = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: query
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    const firstWithName = (data.elements || []).find((e) => e.tags?.name);
    if (!firstWithName?.tags?.name) return null;
    return {
      category: c.category,
      name: firstWithName.tags.name,
      priceRange: budgetBasedRange(alloc[c.allocKey] || 0, guestCount, c.perPlate),
      rating: 4.0,
      notes: firstWithName.tags['addr:full'] || firstWithName.tags['addr:street'] || `${location || 'India'} (OpenStreetMap)`,
      lat: Number(firstWithName.lat ?? firstWithName.center?.lat),
      lon: Number(firstWithName.lon ?? firstWithName.center?.lon),
      mapUrl: Number.isFinite(Number(firstWithName.lat ?? firstWithName.center?.lat)) && Number.isFinite(Number(firstWithName.lon ?? firstWithName.center?.lon))
        ? `https://www.openstreetmap.org/?mlat=${Number(firstWithName.lat ?? firstWithName.center?.lat)}&mlon=${Number(firstWithName.lon ?? firstWithName.center?.lon)}#map=16/${Number(firstWithName.lat ?? firstWithName.center?.lat)}/${Number(firstWithName.lon ?? firstWithName.center?.lon)}`
        : null
    };
  });

  const vendors = (await Promise.all(calls)).filter(Boolean);
  return vendors;
}

async function fetchLocationRealVendors({ location, budgetBreakdown, guestCount }) {
  try {
    const geoapifyVendors = await fetchGeoapifyVendors({ location, budgetBreakdown, guestCount });
    if (geoapifyVendors.length) return geoapifyVendors;
  } catch (e) {
    console.warn('Geoapify lookup failed:', e.message);
  }
  try {
    const googleVendors = await fetchGooglePlacesVendors({ location, budgetBreakdown, guestCount });
    if (googleVendors.length) return googleVendors;
  } catch (e) {
    console.warn('Google Places lookup failed:', e.message);
  }
  try {
    const osmVendors = await fetchOverpassVendors({ location, budgetBreakdown, guestCount });
    if (osmVendors.length) return osmVendors;
  } catch (e) {
    console.warn('Overpass lookup failed:', e.message);
  }
  return [];
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
        priceSource: 'notion',
        notionVendorId: match.notionId || match.id,
      };
    }

    return {
      ...v,
      priceRange: 'Request quote',
      priceSource: 'unknown',
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
app.post('/api/generate-plan', async (req, res) => {
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
      parsed.vendors = [];
      parsed.tips = Array.isArray(parsed.tips) ? parsed.tips : [];
      parsed.tips.unshift('Could not fetch live vendors for this location right now. Try a nearby city name or add GEOAPIFY_API_KEY / GOOGLE_PLACES_API_KEY for richer results.');
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
      parsed.vendors = (parsed.vendors || []).map((v) => ({ ...v, priceRange: 'Request quote', priceSource: 'unknown' }));
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
    notionInsert(NOTION_DB_EVENTS, {
      'Name':        nTitle(name),
      'Type':        nText(type),
      'Date':        nDate(date),
      'Guests':      nNumber(guestCount),
      'Location':    nText(location),
      'Budget Min':  nNumber(budgetMin),
      'Budget Max':  nNumber(budgetMax),
      'Description': nText(description),
      'Created At':  nToday(),
    }).then(() => console.log(`✅ Notion: event "${name}" saved`))
      .catch(e  => console.error('Notion event save failed:', e.message));

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
    const limit = Math.min(60, Math.max(12, Number(req.query.limit || 36)));
    if (!location) return res.status(400).json({ error: 'location required' });
    const vendors = await fetchLiveVendorList({ location, limit });
    return res.json({ vendors, source: vendors.length ? 'live' : 'none' });
  } catch (err) {
    console.error('vendors endpoint error:', err.message);
    res.status(500).json({ error: 'Failed to fetch vendors', details: err.message });
  }
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

    const result = await notionInsert(NOTION_DB_VENDORS, {
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

    if (!result) return res.status(503).json({ error: 'Notion not configured or insert failed' });
    console.log(`✅ Notion: vendor "${organization}" saved`);
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

    const result = await notionInsert(NOTION_DB_BOOKINGS, {
      'Event Name':   nTitle(eventName),
      'Vendor':       nText(vendorName),
      'Event Date':   nDate(date),
      'Budget':       nNumber(budget),
      'Status':       nSelect(status || 'Pending'),
      'Requested At': nToday(),
    });

    if (!result) return res.status(503).json({ error: 'Notion not configured or insert failed' });
    console.log(`✅ Notion: booking for "${eventName}" saved`);
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


app.listen(PORT, '127.0.0.1', () => {
  const keyLoaded   = !!GEMINI_API_KEY && GEMINI_API_KEY !== 'your_gemini_api_key_here';
  const notionReady = !!NOTION_TOKEN && !!NOTION_DB_EVENTS;
  console.log('──────────────────────────────────────');
  console.log('  EventMind AI Backend — Port ' + PORT);
  console.log('  Model: ' + GEMINI_MODEL);
  console.log('  Gemini: ' + (keyLoaded ? GEMINI_API_KEY.slice(0, 8) + '...' : 'NOT LOADED ⚠'));
  console.log('  Notion: ' + (notionReady ? '✅ Connected' : '⚠  DBs not set up yet (run setup-notion.js)'));
  console.log('──────────────────────────────────────');
});
