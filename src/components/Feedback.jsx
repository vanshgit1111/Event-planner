import { useState } from "react";

export default function Feedback({ feedbackList, setFeedbackList, eventData }) {
  const [form, setForm] = useState({ name: "", overall: 0, venue: 0, catering: 0, organization: 0, comment: "", recommend: "" });
  const [analysis, setAnalysis] = useState(null);
  const [loading, setLoading] = useState(false);
  const [notionToast, setNotionToast] = useState(null); // null | 'saving' | 'saved' | 'error'

  const setRating = (field, val) => setForm(f => ({ ...f, [field]: val }));

  const submit = async () => {
    if (!form.overall) { alert("Please provide an overall rating"); return; }
    const entry = { ...form, id: Date.now(), date: new Date().toLocaleDateString("en-IN") };
    setFeedbackList(l => [...l, entry]);
    setForm({ name: "", overall: 0, venue: 0, catering: 0, organization: 0, comment: "", recommend: "" });
    alert("Thank you for your feedback!");

    // Sync to Notion in background
    setNotionToast('saving');
    try {
      const res = await fetch("/api/notion/save-feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...entry, eventName: eventData?.name || "" }),
      });
      setNotionToast(res.ok ? 'saved' : 'error');
    } catch {
      setNotionToast('error');
    }
    setTimeout(() => setNotionToast(null), 4000);
  };

  const analyzeFeedback = async () => {
    if (feedbackList.length === 0) return alert("No feedback to analyze.");
    setLoading(true);
    try {
      const payload = feedbackList.map(f => ({ overall: f.overall, comment: f.comment, recommend: f.recommend }));
      const response = await fetch("/api/analyze-feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feedbackList: payload })
      });
      if (!response.ok) throw new Error("Analysis API failed");
      const data = await response.json();
      setAnalysis(data.analysis);
    } catch (err) {
      console.error(err);
      alert("AI analysis failed.");
    } finally {
      setLoading(false);
    }
  };

  const StarRow = ({ label, field }) => (
    <div className="flex justify-between items-center" style={{ padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
      <span style={{ fontSize: "14px", color: "var(--text2)" }}>{label}</span>
      <div className="stars">
        {[1,2,3,4,5].map(s => (
          <span key={s} className={`star ${form[field] >= s ? "active" : ""}`} onClick={() => setRating(field, s)}>★</span>
        ))}
      </div>
    </div>
  );

  const avgRating = feedbackList.length ? (feedbackList.reduce((s, f) => s + f.overall, 0) / feedbackList.length).toFixed(1) : "—";

  return (
    <div>
      <div className="section-header">
        <div className="flex items-center gap-2 mb-1">
          <span className="badge badge-accent">Step 05</span>
        </div>
        <h1 className="section-title">Post-event feedback</h1>
        <p className="section-sub">Collect guest feedback to improve future events</p>
      </div>

      <div className="grid-2" style={{ gap: "1.5rem", alignItems: "start" }}>
        <div className="card">
          <div style={{ fontSize: "14px", fontWeight: 500, marginBottom: "1rem" }}>Submit feedback</div>

          <div className="form-group mb-2">
            <label className="form-label">Your Name (optional)</label>
            <input className="form-input" placeholder="Anonymous" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          </div>

          <StarRow label="Overall Experience *" field="overall" />
          <StarRow label="Venue & Ambience" field="venue" />
          <StarRow label="Food & Catering" field="catering" />
          <StarRow label="Organisation" field="organization" />

          <div className="form-group mt-2">
            <label className="form-label">Would you recommend?</label>
            <div className="flex gap-2" style={{ flexWrap: "wrap" }}>
              {["Definitely!", "Maybe", "Probably not"].map(opt => (
                <button
                  key={opt}
                  className={`btn btn-sm ${form.recommend === opt ? "btn-primary" : "btn-outline"}`}
                  onClick={() => setForm(f => ({ ...f, recommend: opt }))}
                >
                  {opt}
                </button>
              ))}
            </div>
          </div>

          <div className="form-group mt-2">
            <label className="form-label">Comments</label>
            <textarea className="form-textarea" placeholder="Share your experience..." value={form.comment} onChange={e => setForm(f => ({ ...f, comment: e.target.value }))} />
          </div>

          <button className="btn btn-primary mt-2" style={{ width: "100%" }} onClick={submit}>Submit Feedback</button>
          {notionToast === 'saving' && (
            <div style={{ marginTop: "8px", fontSize: "12px", color: "var(--text3)" }}>⏳ Syncing to Notion...</div>
          )}
          {notionToast === 'saved' && (
            <div style={{ marginTop: "8px", fontSize: "12px", color: "var(--teal)" }}>✅ Feedback backed up to Notion</div>
          )}
          {notionToast === 'error' && (
            <div style={{ marginTop: "8px", fontSize: "12px", color: "var(--coral)" }}>⚠ Notion sync failed (saved locally)</div>
          )}
        </div>

        <div>
          <div className="grid-2 mb-2">
            <div className="stat-card">
              <div className="stat-label">Avg Rating</div>
              <div className="stat-value" style={{ color: "var(--gold)" }}>{avgRating} ★</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Responses</div>
              <div className="stat-value">{feedbackList.length}</div>
            </div>
          </div>

          <div className="flex justify-between items-center mb-2">
            <div style={{ fontSize: "14px", fontWeight: 500 }}>Recent responses</div>
            <button className="btn btn-ai btn-sm" onClick={analyzeFeedback} disabled={loading}>
              {loading ? "Analyzing..." : "✦ Analyze Feedback"}
            </button>
          </div>

          {analysis && (
            <div className="card mb-2" style={{ borderColor: "rgba(159,133,255,0.3)" }}>
               <div style={{ fontSize: "12px", fontFamily: "DM Mono", color: "var(--text3)", textTransform: "uppercase", marginBottom: "8px" }}>AI Insight Summary</div>
               <div style={{ fontSize: "13px", color: "var(--text2)", whiteSpace: "pre-wrap" }}>{analysis}</div>
            </div>
          )}

          {feedbackList.length === 0 ? (
            <div className="card" style={{ borderStyle: "dashed", textAlign: "center", padding: "2rem" }}>
              <div style={{ color: "var(--text3)", fontSize: "13px" }}>No feedback submitted yet</div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              {[...feedbackList].reverse().map(fb => (
                <div key={fb.id} className="card" style={{ padding: "1rem" }}>
                  <div className="flex justify-between items-center mb-1">
                    <span style={{ fontWeight: 500, fontSize: "14px" }}>{fb.name || "Anonymous"}</span>
                    <div className="flex items-center gap-2">
                      <span style={{ color: "var(--gold)", fontSize: "14px" }}>{"★".repeat(fb.overall)}</span>
                      <span style={{ fontSize: "11px", color: "var(--text3)", fontFamily: "DM Mono" }}>{fb.date}</span>
                    </div>
                  </div>
                  {fb.recommend && <div style={{ fontSize: "12px", color: "var(--teal)", marginBottom: "4px" }}>Recommend: {fb.recommend}</div>}
                  {fb.comment && <div style={{ fontSize: "13px", color: "var(--text2)", fontStyle: "italic" }}>"{fb.comment}"</div>}
                  <div className="flex gap-2 mt-1" style={{ flexWrap: "wrap" }}>
                    {fb.venue > 0 && <span className="badge badge-accent">Venue: {fb.venue}★</span>}
                    {fb.catering > 0 && <span className="badge badge-teal">Food: {fb.catering}★</span>}
                    {fb.organization > 0 && <span className="badge badge-gold">Org: {fb.organization}★</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
