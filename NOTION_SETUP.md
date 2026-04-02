## 🔗 Notion Setup — 3 Quick Steps

Your Notion integration token is already saved. You just need to share **one page** with the integration, then run one command.

---

### Step 1 — Create a Notion Page

1. Open **[Notion](https://www.notion.so)**
2. Click **"+ New page"** in the sidebar
3. Name it: **`EventMind Data`**
4. Leave it blank (just a title page)

---

### Step 2 — Share with Integration

1. On the `EventMind Data` page, click the **`···`** (three dots) menu at the top right
2. Click **"Connections"** → **"Connect to"** → search for **`EventMind`** → click it
3. The page is now shared with your integration ✅

---

### Step 3 — Copy the Page ID & Run Setup

From the page URL, copy the Page ID:
```
https://www.notion.so/EventMind-Data-{THIS-IS-YOUR-PAGE-ID}?...
```

The Page ID is the long string of letters/numbers right before the `?`.

Then run in terminal (inside the event-planner folder):
```bash
node backend/setup-notion.js YOUR_PAGE_ID
```

This will **automatically**:
- ✅ Create the `Events` database
- ✅ Create the `Vendors` database  
- ✅ Create the `Bookings` database
- ✅ Create the `Feedback` database
- ✅ Save all IDs to your `.env` file

---

### After Setup

Restart your app:
```bash
npm run dev
```

Every time you:
- Generate an AI plan → saved to **Events** in Notion
- Save a vendor profile → saved to **Vendors** in Notion
- Book a vendor → saved to **Bookings** in Notion
- Submit feedback → saved to **Feedback** in Notion
