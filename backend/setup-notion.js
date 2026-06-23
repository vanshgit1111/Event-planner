/**
 * EventMind — Notion Database Setup Script
 * Run: node backend/setup-notion.js <PARENT_PAGE_ID>
 * 
 * 1) Open Notion, create a blank page called "EventMind Data"
 * 2) Share it with your integration (··· → Connections → EventMind)
 * 3) Copy the page ID from the URL: notion.so/EventMind-Data-{PAGE_ID}
 * 4) Run: node backend/setup-notion.js YOUR_PAGE_ID
 */

import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env
const envPath = resolve(__dirname, '../.env');
const envExamplePath = resolve(__dirname, '../.env.example');

if (!existsSync(envPath) && existsSync(envExamplePath)) {
  copyFileSync(envExamplePath, envPath);
  console.log('📝 Created .env from .env.example');
} else if (!existsSync(envPath)) {
  writeFileSync(envPath, 'GEMINI_API_KEY=\nNOTION_TOKEN=\nNOTION_DB_EVENTS=\nNOTION_DB_VENDORS=\nNOTION_DB_BOOKINGS=\nNOTION_DB_FEEDBACK=\nNOTION_DB_CHAT_LOGS=\nGOOGLE_PLACES_API_KEY=\nGEOAPIFY_API_KEY=\n');
  console.log('📝 Created empty .env file');
}

const envContent = readFileSync(envPath, 'utf-8');
let NOTION_TOKEN = '';
for (const line of envContent.split('\n')) {
  const [k, v] = line.split('=');
  if (k?.trim() === 'NOTION_TOKEN') NOTION_TOKEN = v?.trim();
}

const parentPageId = process.argv[2];
if (!parentPageId) {
  console.error('❌  Usage: node backend/setup-notion.js <PARENT_PAGE_ID>');
  console.error('   Get the page ID from your Notion page URL.');
  process.exit(1);
}
if (!NOTION_TOKEN) {
  console.error('❌  NOTION_TOKEN not found in .env');
  process.exit(1);
}

const headers = {
  'Authorization': `Bearer ${NOTION_TOKEN}`,
  'Notion-Version': '2022-06-28',
  'Content-Type': 'application/json',
};

async function createDatabase(title, properties) {
  const res = await fetch('https://api.notion.com/v1/databases', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      parent: { type: 'page_id', page_id: parentPageId },
      title: [{ type: 'text', text: { content: title } }],
      properties,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Failed to create "${title}": ${JSON.stringify(data)}`);
  return data.id;
}

async function main() {
  console.log('🔧 Creating Notion databases...\n');

  // 1. Events DB
  const eventsId = await createDatabase('📅 Events', {
    'Name':           { title: {} },
    'Type':           { rich_text: {} },
    'Date':           { date: {} },
    'Guests':         { number: {} },
    'Location':       { rich_text: {} },
    'Budget Min':     { number: {} },
    'Budget Max':     { number: {} },
    'Description':    { rich_text: {} },
    'Generated Plan': { rich_text: {} },
    'Created At':     { date: {} },
  });
  console.log(`✅ Events DB:   ${eventsId}`);

  // 2. Vendors DB
  const vendorsId = await createDatabase('🏪 Vendors', {
    'Organization': { title: {} },
    'Category':     { select: { options: [
      { name: 'Venue', color: 'blue' },
      { name: 'Catering', color: 'orange' },
      { name: 'Photography', color: 'purple' },
      { name: 'Decoration', color: 'pink' },
      { name: 'Entertainment', color: 'green' },
      { name: 'Other', color: 'gray' },
    ]}},
    'Location':    { rich_text: {} },
    'Price Min':   { number: {} },
    'Price Max':   { number: {} },
    'Services':    { rich_text: {} },
    'Contact':     { rich_text: {} },
    'Rating':      { number: {} },
    'Saved At':    { date: {} },
  });
  console.log(`✅ Vendors DB:  ${vendorsId}`);

  // 3. Bookings DB
  const bookingsId = await createDatabase('📋 Bookings', {
    'Event Name':   { title: {} },
    'Vendor':       { rich_text: {} },
    'Event Date':   { date: {} },
    'Budget':       { number: {} },
    'Status':       { select: { options: [
      { name: 'Pending', color: 'yellow' },
      { name: 'Confirmed', color: 'green' },
      { name: 'Rejected', color: 'red' },
    ]}},
    'Requested At': { date: {} },
  });
  console.log(`✅ Bookings DB: ${bookingsId}`);

  // 4. Feedback DB
  const feedbackId = await createDatabase('💬 Feedback', {
    'Name':       { title: {} },
    'Event':      { rich_text: {} },
    'Rating':     { number: {} },
    'Venue':      { number: {} },
    'Catering':   { number: {} },
    'Recommend':  { select: { options: [
      { name: 'Definitely!', color: 'green' },
      { name: 'Maybe', color: 'yellow' },
      { name: 'Probably not', color: 'red' },
    ]}},
    'Comment':    { rich_text: {} },
    'Date':       { date: {} },
  });
  console.log(`✅ Feedback DB: ${feedbackId}`);

  // 5. Chat Logs DB
  const chatLogsId = await createDatabase('💬 Chat Logs', {
    'Message ID':  { title: {} },
    'Sender':      { select: { options: [
      { name: 'User', color: 'blue' },
      { name: 'Vendor', color: 'green' },
      { name: 'AI', color: 'purple' },
    ]}},
    'Vendor Name': { rich_text: {} },
    'Event Name':  { rich_text: {} },
    'Message':     { rich_text: {} },
    'Status':      { select: { options: [
      { name: 'Sent', color: 'gray' },
      { name: 'Delivered', color: 'blue' },
      { name: 'Read', color: 'green' },
    ]}},
    'Timestamp':   { date: {} },
  });
  console.log(`✅ Chat Logs DB: ${chatLogsId}`);

  // Write IDs to .env
  let updatedEnv = envContent;
  const toAdd = [
    ['NOTION_DB_EVENTS',   eventsId.replace(/-/g, '')],
    ['NOTION_DB_VENDORS',  vendorsId.replace(/-/g, '')],
    ['NOTION_DB_BOOKINGS', bookingsId.replace(/-/g, '')],
    ['NOTION_DB_FEEDBACK', feedbackId.replace(/-/g, '')],
    ['NOTION_DB_CHAT_LOGS',chatLogsId.replace(/-/g, '')],
  ];
  for (const [key, val] of toAdd) {
    if (updatedEnv.includes(key)) {
      updatedEnv = updatedEnv.replace(new RegExp(`${key}=.*`), `${key}=${val}`);
    } else {
      updatedEnv += `\n${key}=${val}`;
    }
  }
  writeFileSync(envPath, updatedEnv);

  console.log('\n✅  All 4 databases created and IDs written to .env!');
  console.log('🚀  You can now run: npm run dev\n');
}

main().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
