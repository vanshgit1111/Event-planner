export default function Analytics({ eventData, attendees, feedbackList, expenses, aiResults }) {
  const budget = Number(eventData?.budgetMax) || 0;
  const totalSpent = expenses.reduce((s, e) => s + e.amount, 0);
  const budgetUtil = budget ? Math.round((totalSpent / budget) * 100) : 0;

  const confirmed = attendees.filter(a => a.status === "Confirmed").length;
  const declined = attendees.filter(a => a.status === "Declined").length;
  const pending = attendees.filter(a => a.status === "Invited").length;
  const maybe = attendees.filter(a => a.status === "Maybe").length;
  const total = attendees.length;
  const confirmRate = total ? Math.round((confirmed / total) * 100) : 0;

  const avgRating = feedbackList.length
    ? (feedbackList.reduce((s, f) => s + f.overall, 0) / feedbackList.length).toFixed(1)
    : null;
  const avgVenue = feedbackList.length ? (feedbackList.reduce((s,f) => s + (f.venue||0), 0) / feedbackList.length).toFixed(1) : null;
  const avgFood = feedbackList.length ? (feedbackList.reduce((s,f) => s + (f.catering||0), 0) / feedbackList.length).toFixed(1) : null;
  const avgOrg = feedbackList.length ? (feedbackList.reduce((s,f) => s + (f.organization||0), 0) / feedbackList.length).toFixed(1) : null;
  const recommendCount = feedbackList.filter(f => f.recommend === "Definitely!").length;

  const Bar = ({ label, value, max, color = "var(--accent2)", suffix = "" }) => (
    <div style={{ marginBottom: "12px" }}>
      <div className="flex justify-between" style={{ marginBottom: "4px" }}>
        <span style={{ fontSize: "13px", color: "var(--text2)" }}>{label}</span>
        <span style={{ fontSize: "13px", fontWeight: 500 }}>{value}{suffix}</span>
      </div>
      <div className="progress-bar">
        <div className="progress-fill" style={{ width: `${max ? Math.min(100, Math.round((value / max) * 100)) : 0}%`, background: color }} />
      </div>
    </div>
  );

  return (
    <div>
      <div className="section-header">
        <div className="flex items-center gap-2 mb-1">
          <span className="badge badge-accent">Step 06</span>
        </div>
        <h1 className="section-title">Analytics dashboard</h1>
        <p className="section-sub">End-to-end event performance at a glance</p>
      </div>

      {/* Top stats */}
      <div className="grid-4 mb-3">
        <div className="stat-card">
          <div className="stat-label">Attendance Rate</div>
          <div className="stat-value" style={{ color: confirmRate >= 70 ? "var(--teal)" : "var(--gold)" }}>{confirmRate}%</div>
          <div className="stat-sub">{confirmed} confirmed</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Budget Used</div>
          <div className="stat-value" style={{ color: budgetUtil > 90 ? "var(--coral)" : "var(--accent)" }}>{budgetUtil}%</div>
          <div className="stat-sub">₹{totalSpent.toLocaleString()} / ₹{budget.toLocaleString()}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Avg Rating</div>
          <div className="stat-value" style={{ color: "var(--gold)" }}>{avgRating ? `${avgRating}★` : "—"}</div>
          <div className="stat-sub">{feedbackList.length} responses</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Would Recommend</div>
          <div className="stat-value" style={{ color: "var(--teal)" }}>
            {feedbackList.length ? Math.round((recommendCount / feedbackList.length) * 100) + "%" : "—"}
          </div>
          <div className="stat-sub">{recommendCount} of {feedbackList.length}</div>
        </div>
      </div>

      <div className="grid-2" style={{ gap: "1.5rem" }}>
        {/* Attendance */}
        <div className="card">
          <div style={{ fontSize: "14px", fontWeight: 500, marginBottom: "1rem" }}>Attendee breakdown</div>
          {total === 0 ? (
            <div style={{ color: "var(--text3)", fontSize: "13px" }}>No attendees added yet</div>
          ) : (
            <>
              <Bar label="Confirmed" value={confirmed} max={total} color="var(--teal)" />
              <Bar label="Declined" value={declined} max={total} color="var(--coral)" />
              <Bar label="Pending" value={pending} max={total} color="var(--gold)" />
              <Bar label="Maybe" value={maybe} max={total} color="var(--accent2)" />
              <div style={{ borderTop: "1px solid var(--border)", paddingTop: "0.75rem", marginTop: "0.5rem", fontSize: "13px", color: "var(--text2)" }}>
                Total invited: <strong style={{ color: "var(--text)" }}>{total}</strong>
                &nbsp;&nbsp;|&nbsp;&nbsp;Expected capacity: <strong style={{ color: "var(--text)" }}>{eventData?.guestCount || "?"}</strong>
              </div>
            </>
          )}
        </div>

        {/* Budget */}
        <div className="card">
          <div style={{ fontSize: "14px", fontWeight: 500, marginBottom: "1rem" }}>Budget utilization</div>
          {expenses.length === 0 ? (
            <div style={{ color: "var(--text3)", fontSize: "13px" }}>No expenses tracked yet</div>
          ) : (
            <>
              {Object.entries(
                expenses.reduce((acc, e) => ({ ...acc, [e.category]: (acc[e.category] || 0) + e.amount }), {})
              ).map(([cat, amt]) => (
                <Bar key={cat} label={cat} value={amt} max={budget} color="var(--accent2)" suffix="" />
              ))}
              <div style={{ borderTop: "1px solid var(--border)", paddingTop: "0.75rem", marginTop: "0.5rem" }}>
                <div className="flex justify-between" style={{ fontSize: "13px" }}>
                  <span style={{ color: "var(--text2)" }}>Total spent</span>
                  <span style={{ fontWeight: 500, color: totalSpent > budget ? "var(--coral)" : "var(--teal)" }}>₹{totalSpent.toLocaleString()}</span>
                </div>
                <div className="flex justify-between mt-1" style={{ fontSize: "13px" }}>
                  <span style={{ color: "var(--text2)" }}>Remaining</span>
                  <span style={{ fontWeight: 500 }}>₹{Math.max(0, budget - totalSpent).toLocaleString()}</span>
                </div>
                
                {aiResults?.budget?.total && (
                  <div className="mt-2 text-center" style={{ padding: "8px", background: "rgba(255,255,255,0.03)", borderRadius: "4px" }}>
                    {totalSpent <= aiResults.budget.total ? (
                      <span style={{ color: "var(--teal)", fontWeight: 500, fontSize: "14px" }}>
                        🎉 You saved ₹{(aiResults.budget.total - totalSpent).toLocaleString()}
                      </span>
                    ) : (
                      <span style={{ color: "var(--coral)", fontWeight: 500, fontSize: "14px" }}>
                        ⚠️ You overspent by ₹{(totalSpent - aiResults.budget.total).toLocaleString()}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Feedback ratings */}
        <div className="card">
          <div style={{ fontSize: "14px", fontWeight: 500, marginBottom: "1rem" }}>Feedback ratings</div>
          {feedbackList.length === 0 ? (
            <div style={{ color: "var(--text3)", fontSize: "13px" }}>No feedback collected yet</div>
          ) : (
            <>
              {[
                { label: "Overall", val: avgRating },
                { label: "Venue & Ambience", val: avgVenue },
                { label: "Food & Catering", val: avgFood },
                { label: "Organisation", val: avgOrg }
              ].map(({ label, val }) => val && (
                <Bar key={label} label={label} value={Number(val)} max={5} color="var(--gold)" />
              ))}
            </>
          )}
        </div>

        {/* Event summary */}
        <div className="card">
          <div style={{ fontSize: "14px", fontWeight: 500, marginBottom: "1rem" }}>Event summary</div>
          {!eventData ? (
            <div style={{ color: "var(--text3)", fontSize: "13px" }}>No event created yet</div>
          ) : (
            <table className="table">
              <tbody>
                {[
                  ["Event", eventData.name || "—"],
                  ["Type", eventData.type || "—"],
                  ["Date", eventData.date || "—"],
                  ["Location", eventData.location || "—"],
                  ["Expected guests", eventData.guestCount || "—"],
                  ["Budget range", eventData.budgetMin ? `₹${Number(eventData.budgetMin).toLocaleString()} – ₹${Number(eventData.budgetMax).toLocaleString()}` : `₹${Number(eventData.budgetMax||0).toLocaleString()}`],
                  ["AI vendors suggested", aiResults?.vendors?.length || 0],
                  ["Timeline tasks", aiResults?.timeline?.length || 0],
                ].map(([k, v]) => (
                  <tr key={k}>
                    <td style={{ color: "var(--text3)", width: "45%" }}>{k}</td>
                    <td style={{ color: "var(--text)", fontWeight: 500 }}>{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
