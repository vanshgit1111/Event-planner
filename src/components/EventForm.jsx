import { useState } from "react";

const EVENT_TYPES = ["Birthday Party", "Wedding", "Corporate Event", "College Fest", "Baby Shower", "Anniversary", "Graduation Party", "Conference", "Other"];

export default function EventForm({ eventData, setEventData, setAiResults, onNext }) {
  const [form, setForm] = useState({
    id: eventData?.id || `evt-${Date.now()}`,
    name: "", type: "Birthday Party", date: "", guestCount: "", location: "",
    budgetMin: "", budgetMax: "", description: "",
    wantSuggestions: false,
    preferredVenueType: "",
    preferredCuisine: "",
    preferredVibe: "",
    recommendationPriority: "Best Value",
    ...(eventData || {})
  });
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);

  const [notionStatus, setNotionStatus] = useState(null); // null | 'saving' | 'saved' | 'error'

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleGenerate = async () => {
    if (!form.name || !form.date || !form.guestCount || !form.budgetMax) {
      alert("Please fill in Event Name, Date, Guest Count, and Budget first.");
      return;
    }
    const nextEvent = { ...form, id: form.id || `evt-${Date.now()}` };
    setForm(nextEvent);
    setEventData(nextEvent);
    setAiResults(null);
    setLoading(true);
    setNotionStatus(null);
    try {
      const response = await fetch("/api/generate-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(nextEvent)
      });
      if (!response.ok) throw new Error("Backend AI Generation failed");
      const parsed = await response.json();
      setAiResults(parsed);
      setSaved(true);
      setNotionStatus('saved'); // backend saved to Notion during plan generation
      setTimeout(() => { setSaved(false); onNext(); }, 800);
    } catch (err) {
      console.error(err);
      setNotionStatus('error');
      alert("AI generation failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <div className="section-header">
        <div className="flex items-center gap-2 mb-1">
          <span className="badge badge-accent">Step 01</span>
        </div>
        <h1 className="section-title">Plan your event</h1>
        <p className="section-sub">Fill in the details and let AI generate your vendors, budget & timeline</p>
      </div>

      <div className="grid-2" style={{ gap: "2rem" }}>
        <div className="card" style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
          <div className="form-group">
            <label className="form-label">Event Name</label>
            <input className="form-input" placeholder="e.g. Priya's 25th Birthday" value={form.name} onChange={e => set("name", e.target.value)} />
          </div>
          <div className="grid-2">
            <div className="form-group">
              <label className="form-label">Event Type</label>
              <select className="form-select" value={form.type} onChange={e => set("type", e.target.value)}>
                {EVENT_TYPES.map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Date</label>
              <input type="date" className="form-input" value={form.date} onChange={e => set("date", e.target.value)} />
            </div>
          </div>
          <div className="grid-2">
            <div className="form-group">
              <label className="form-label">Guest Count</label>
              <input type="number" className="form-input" placeholder="e.g. 150" value={form.guestCount} onChange={e => set("guestCount", e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Location / City</label>
              <input className="form-input" placeholder="e.g. Mumbai" value={form.location} onChange={e => set("location", e.target.value)} />
            </div>
          </div>
          <div className="grid-2">
            <div className="form-group">
              <label className="form-label">Budget Min (₹)</label>
              <input type="number" className="form-input" placeholder="50000" value={form.budgetMin} onChange={e => set("budgetMin", e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Budget Max (₹)</label>
              <input type="number" className="form-input" placeholder="200000" value={form.budgetMax} onChange={e => set("budgetMax", e.target.value)} />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Description / Special Requirements</label>
            <textarea className="form-textarea" placeholder="Any special requirements, theme, dietary needs..." value={form.description} onChange={e => set("description", e.target.value)} />
          </div>
          <div className="card-sm" style={{ border: "1px solid rgba(61,207,176,0.2)" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "8px", color: "var(--text2)", fontSize: "13px", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={!!form.wantSuggestions}
                onChange={e => set("wantSuggestions", e.target.checked)}
              />
              Suggest best possible options based on my preferences
            </label>
            {form.wantSuggestions && (
              <div style={{ marginTop: "0.75rem", display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                <div className="grid-2">
                  <div className="form-group">
                    <label className="form-label">Preferred Venue Type</label>
                    <input className="form-input" placeholder="Banquet, Lawn, Beachside..." value={form.preferredVenueType} onChange={e => set("preferredVenueType", e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Preferred Cuisine</label>
                    <input className="form-input" placeholder="North Indian, Multi-cuisine..." value={form.preferredCuisine} onChange={e => set("preferredCuisine", e.target.value)} />
                  </div>
                </div>
                <div className="grid-2">
                  <div className="form-group">
                    <label className="form-label">Event Vibe / Theme</label>
                    <input className="form-input" placeholder="Elegant, Traditional, Minimal..." value={form.preferredVibe} onChange={e => set("preferredVibe", e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Recommendation Priority</label>
                    <select className="form-select" value={form.recommendationPriority} onChange={e => set("recommendationPriority", e.target.value)}>
                      {["Best Value", "Premium Quality", "Balanced"].map(option => <option key={option}>{option}</option>)}
                    </select>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <div className="card" style={{ borderColor: "rgba(159,133,255,0.25)" }}>
            <div style={{ fontSize: "12px", fontFamily: "DM Mono", color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "0.75rem" }}>AI will generate</div>
            {[
              { icon: "◈", label: "Vendor Suggestions", desc: "5+ categories with pricing" },
              { icon: "◆", label: "Budget Breakdown", desc: "Smart allocation by event type" },
              { icon: "◎", label: "Location Cost Estimate", desc: "Expected min/max by city and guests" },
              { icon: "◷", label: "Task Timeline", desc: "Day-by-day checklist" },
              { icon: "✦", label: "Expert Tips", desc: "Tailored to your event" },
              { icon: "◇", label: "Preference Matches", desc: "Optional best options if enabled" }
            ].map(item => (
              <div key={item.label} className="flex items-center gap-2" style={{ padding: "10px 0", borderBottom: "1px solid var(--border)" }}>
                <span style={{ color: "var(--accent2)", fontSize: "16px", width: "20px" }}>{item.icon}</span>
                <div>
                  <div style={{ fontSize: "14px", fontWeight: 500, color: "var(--text)" }}>{item.label}</div>
                  <div style={{ fontSize: "12px", color: "var(--text3)" }}>{item.desc}</div>
                </div>
              </div>
            ))}
            <button
              className="btn btn-ai mt-2"
              style={{ width: "100%", justifyContent: "center", padding: "12px" }}
              onClick={handleGenerate}
              disabled={loading}
            >
              {loading ? (
                <>
                  <div className="ai-dot" /><div className="ai-dot" /><div className="ai-dot" />
                  Generating your plan...
                </>
              ) : saved ? "✓ Saved! Redirecting..." : "✦ Generate AI Plan"}
            </button>
            {notionStatus === 'saved' && (
              <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "8px", fontSize: "12px", color: "var(--teal)" }}>
                <span>✅</span> Backed up to Notion
              </div>
            )}
            {notionStatus === 'error' && (
              <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "8px", fontSize: "12px", color: "var(--coral)" }}>
                <span>⚠</span> Notion sync unavailable
              </div>
            )}
          </div>

          <div className="card-sm">
            <div style={{ fontSize: "11px", fontFamily: "DM Mono", color: "var(--text3)", textTransform: "uppercase", marginBottom: "8px" }}>Quick tips</div>
            <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: "6px" }}>
              {["Book venue at least 2 months ahead", "Allocate 10% buffer for miscellaneous", "Send invites 4 weeks before event", "Get 3 quotes per vendor category"].map(t => (
                <li key={t} style={{ fontSize: "13px", color: "var(--text2)", display: "flex", gap: "8px" }}>
                  <span style={{ color: "var(--teal)" }}>→</span> {t}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
