# EventMind — AI-Powered Event Planning App

A full-stack, AI-powered event planning application built with React + Claude API (Anthropic).

## Features

- **Event Creation** — Form with event type, date, guest count, location, budget range
- **AI Vendor & Budget Suggestions** — Powered by Claude API (Anthropic)
- **Task Timeline & Checklist** — Auto-generated day-by-day task list with priority tracking
- **Attendee Management** — RSVP tracking, group management, automated reminders
- **Post-Event Feedback** — Star ratings across multiple dimensions
- **Analytics Dashboard** — Budget utilization, attendance rate, feedback scores

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + Vite |
| AI | Claude claude-sonnet-4-20250514 (Anthropic API) |
| Styling | Custom CSS (dark theme) |
| Deployment | Vercel (free) |
| Version Control | GitHub |

---

## Local Setup

```bash
# 1. Clone the repo
git clone https://github.com/YOUR_USERNAME/eventmind-ai-planner.git
cd eventmind-ai-planner

# 2. Install dependencies
npm install

# 3. Start dev server
npm run dev
```

Open http://localhost:5173

---

## Deploy to Vercel (Free)

### Step 1: Push to GitHub

```bash
git init
git add .
git commit -m "initial commit: EventMind AI Event Planner"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/eventmind-ai-planner.git
git push -u origin main
```

### Step 2: Deploy on Vercel

1. Go to https://vercel.com and sign in with GitHub
2. Click **"Add New Project"**
3. Import your `eventmind-ai-planner` repository
4. Framework: **Vite** (auto-detected)
5. Click **Deploy**

Done! You'll get a live URL like `https://eventmind-ai-planner.vercel.app`

---

## Project Structure

```
src/
├── App.jsx              # Main app with tab navigation
├── App.css              # Global styles (dark theme)
└── components/
    ├── EventForm.jsx    # Event creation + AI trigger
    ├── VendorBudget.jsx # Vendor suggestions + expense tracker
    ├── Timeline.jsx     # Task checklist + timeline
    ├── Attendees.jsx    # Attendee RSVP management
    ├── Feedback.jsx     # Post-event feedback form
    └── Analytics.jsx    # Dashboard with charts
```

---

## How the AI Works

When a user fills in the event form and clicks "Generate AI Plan":
1. Event details are sent to Claude claude-sonnet-4-20250514 via the Anthropic API
2. Claude returns a structured JSON with vendors, budget breakdown, timeline tasks, and tips
3. The app parses and displays the results across all tabs

---

## Module Coverage (Assignment Rubric)

| Module | Status |
|--------|--------|
| 25% — App Structure & Data Setup | ✅ Event form, budget templates, vendor DB |
| 50% — Timeline, Checklist & Budget | ✅ Timeline, checklist, expense tracker, attendee list |
| 75% — AI Features & Automation | ✅ Claude AI integration, reminder simulation |
| 100% — Feedback & Analytics | ✅ Feedback form + analytics dashboard |

---

## Team

Built for [Course Name] — AI-Powered No-Code Application Development

## License

MIT
