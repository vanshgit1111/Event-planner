export default function VendorDashboard({ bookings, setBookings }) {
  const vendorId = "my-vendor-id";
  const myBookings = bookings.filter(b => b.vendorId === vendorId);

  const pending = myBookings.filter(b => b.status === "Pending");
  const accepted = myBookings.filter(b => b.status === "Confirmed");
  const revenue = accepted.reduce((sum, b) => sum + (b.budget || 0), 0);

  const updateStatus = (id, newStatus) => {
    setBookings(prev => prev.map(b => b.id === id ? { ...b, status: newStatus } : b));
  };

  return (
    <div>
      <div className="section-header">
        <h1 className="section-title">Vendor Dashboard</h1>
        <p className="section-sub">Manage your booking requests and earnings</p>
      </div>

      <div className="grid-4 mb-3">
        <div className="stat-card">
          <div className="stat-label">Total Requests</div>
          <div className="stat-value">{myBookings.length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Pending Requests</div>
          <div className="stat-value" style={{ color: "var(--gold)" }}>{pending.length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Confirmed Events</div>
          <div className="stat-value" style={{ color: "var(--teal)" }}>{accepted.length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Est. Revenue</div>
          <div className="stat-value" style={{ color: "var(--accent2)" }}>₹{revenue.toLocaleString()}</div>
        </div>
      </div>

      <div className="grid-2" style={{ gap: "1.5rem", alignItems: "start" }}>
        <div>
          <div style={{ fontSize: "14px", fontWeight: 500, marginBottom: "1rem", color: "var(--text)" }}>Pending Requests</div>
          {pending.length === 0 ? (
            <div className="card" style={{ borderStyle: "dashed", textAlign: "center", padding: "2rem" }}>
              <div style={{ color: "var(--text3)", fontSize: "13px" }}>No new booking requests</div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              {pending.map(b => (
                <div key={b.id} className="card" style={{ borderLeft: "3px solid var(--gold)" }}>
                  <div className="flex justify-between items-center mb-1">
                    <span style={{ fontSize: "15px", fontWeight: 500 }}>{b.eventName || "Event"}</span>
                    <span className="badge badge-gold">Pending</span>
                  </div>
                  <div style={{ fontSize: "13px", color: "var(--text2)", marginBottom: "4px" }}>📅 {b.date || "TBD"}</div>
                  <div style={{ fontSize: "13px", color: "var(--text3)", marginBottom: "12px" }}>Client Budget: ₹{b.budget ? b.budget.toLocaleString() : "Unknown"}</div>
                  
                  <div className="flex gap-2">
                    <button className="btn btn-primary btn-sm" onClick={() => updateStatus(b.id, "Confirmed")}>Accept</button>
                    <button className="btn btn-danger btn-sm" onClick={() => updateStatus(b.id, "Rejected")}>Reject</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <div style={{ fontSize: "14px", fontWeight: 500, marginBottom: "1rem", color: "var(--text)" }}>Confirmed Events</div>
          {accepted.length === 0 ? (
            <div className="card" style={{ borderStyle: "dashed", textAlign: "center", padding: "2rem" }}>
              <div style={{ color: "var(--text3)", fontSize: "13px" }}>No confirmed events yet</div>
            </div>
          ) : (
             <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              {accepted.map(b => (
                <div key={b.id} className="card" style={{ borderLeft: "3px solid var(--teal)" }}>
                  <div className="flex justify-between items-center mb-1">
                    <span style={{ fontSize: "15px", fontWeight: 500 }}>{b.eventName || "Event"}</span>
                    <span className="badge badge-teal">Confirmed</span>
                  </div>
                  <div style={{ fontSize: "13px", color: "var(--text2)" }}>📅 {b.date || "TBD"}</div>
                  <div style={{ fontSize: "13px", color: "var(--text3)" }}>Revenue: ₹{b.budget ? b.budget.toLocaleString() : "Unknown"}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
