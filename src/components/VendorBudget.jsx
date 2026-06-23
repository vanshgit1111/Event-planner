import { useState } from "react";
import { api } from "../api";

const COLORS = ["var(--accent2)", "var(--teal)", "var(--gold)", "var(--coral)", "#a78bfa", "#34d399"];

export default function VendorBudget({ eventData, aiResults, expenses, setExpenses, vendors, setVendors, bookings, setBookings }) {
  const [expForm, setExpForm] = useState({ category: "", description: "", amount: "" });
  const [search, setSearch] = useState("");
  const [filterCat, setFilterCat] = useState("All Categories");
  const [filterLocation, setFilterLocation] = useState("");
  const [filterMaxBudget, setFilterMaxBudget] = useState("");
  const [compareList, setCompareList] = useState([]);
  const [isTagging, setIsTagging] = useState(false);

  const requestBooking = async (vendor) => {
    if (!eventData) return alert("Please create an event first.");
    const eventId = eventData.id || "evt-1";
    const exists = bookings.find(b => b.vendorId === vendor.id && b.eventId === eventId);
    if (exists) return alert("Booking already requested!");
    const booking = {
      id: Date.now(), vendorId: vendor.id, eventId,
      eventName: eventData.name, date: eventData.date,
      budget: Number(eventData.budgetMax), status: "Pending"
    };
    try {
      const saved = await api.createBooking(booking);
      setBookings(b => [...b, saved]);
      alert("Booking Request Sent!");
      fetch("/api/notion/save-booking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventName: eventData.name,
          vendorName: vendor.organization,
          date: eventData.date,
          budget: Number(eventData.budgetMax),
          status: "Pending",
        }),
      }).catch(e => console.warn("Notion booking sync failed:", e.message));
    } catch (err) {
      console.error(err);
      alert("Failed to create booking.");
    }
  };

  const autoTagVendors = async () => {
    if (vendors.length === 0) return;
    setIsTagging(true);
    try {
      const payload = vendors.map(v => ({ id: v.id, category: v.category, min: v.priceMin, max: v.priceMax }));
      await api.tagVendors(payload);
      const updated = await api.getVendors();
      setVendors(updated);
    } catch (err) {
      console.error(err);
      alert("AI Tagging failed");
    } finally {
      setIsTagging(false);
    }
  };

  const filteredVendors = (vendors || []).filter(v => {
    const matchSearch = (v.organization || "").toLowerCase().includes(search.toLowerCase());
    const matchCat = filterCat === "All Categories" || v.category === filterCat;
    const matchLoc = !filterLocation || (v.location || "").toLowerCase().includes(filterLocation.toLowerCase());
    const matchBudget = !filterMaxBudget || Number(v.priceMax || 0) <= Number(filterMaxBudget);
    return matchSearch && matchCat && matchLoc && matchBudget;
  });

  const toggleCompare = (v) => {
    if (compareList.find(c => c.id === v.id)) {
      setCompareList(compareList.filter(c => c.id !== v.id));
    } else {
      if (compareList.length >= 3) return alert("You can compare up to 3 vendors.");
      setCompareList([...compareList, v]);
    }
  };

  const addExpense = async () => {
    if (!expForm.category || !expForm.amount) return;
    try {
      const saved = await api.addExpense({ ...expForm, amount: Number(expForm.amount) });
      setExpenses(e => [...e, saved]);
      setExpForm({ category: "", description: "", amount: "" });
    } catch (err) {
      console.error(err);
      alert("Failed to add expense.");
    }
  };

  const totalSpent = expenses.reduce((s, e) => s + e.amount, 0);
  const budget = aiResults?.budget?.total || Number(eventData?.budgetMax) || 0;
  const utilPct = budget ? Math.min(100, Math.round((totalSpent / budget) * 100)) : 0;

  return (
    <div>
      <div className="section-header">
        <div className="flex items-center gap-2 mb-1">
          <span className="badge badge-teal">Step 02</span>
          {!aiResults && <span className="badge badge-coral">No AI data yet — generate from Event form</span>}
        </div>
        <h1 className="section-title">Vendors & Budget</h1>
        <p className="section-sub">AI-suggested vendors and smart budget allocation</p>
      </div>

      {!eventData && (
        <div className="card mb-3" style={{ borderStyle: "dashed", textAlign: "center", padding: "2rem" }}>
          <div className="empty-icon">◈</div>
          <div className="empty-text">Create an event first to see budget suggestions and AI vendor recommendations</div>
        </div>
      )}

      {eventData && (
      <div className="grid-4 mb-3">
        <div className="stat-card">
          <div className="stat-label">Total Budget</div>
          <div className="stat-value" style={{ fontSize: "20px" }}>₹{Number(budget).toLocaleString()}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Spent</div>
          <div className="stat-value" style={{ fontSize: "20px", color: totalSpent > budget ? "var(--coral)" : "var(--teal)" }}>₹{totalSpent.toLocaleString()}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Remaining</div>
          <div className="stat-value" style={{ fontSize: "20px" }}>₹{Math.max(0, budget - totalSpent).toLocaleString()}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Utilization</div>
          <div className="stat-value" style={{ fontSize: "20px", color: utilPct > 90 ? "var(--coral)" : "var(--accent)" }}>{utilPct}%</div>
        </div>
      </div>
      )}

      {eventData && (
      <div className="grid-2" style={{ gap: "1.5rem" }}>
        <div>
          <div style={{ fontSize: "14px", fontWeight: 500, marginBottom: "1rem", color: "var(--text)" }}>Suggested vendors</div>
          {aiResults?.vendors ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              {aiResults.vendors.map((v, i) => (
                <div key={i} className="card" style={{ padding: "1rem", borderLeft: `3px solid ${COLORS[i % COLORS.length]}` }}>
                  <div className="flex justify-between items-center mb-1">
                    <span style={{ fontSize: "12px", fontFamily: "DM Mono", color: "var(--text3)", textTransform: "uppercase" }}>{v.category}</span>
                    <span style={{ fontSize: "12px", color: "var(--gold)" }}>{"★".repeat(Math.round(v.rating))} {v.rating}</span>
                  </div>
                  <div style={{ fontSize: "15px", fontWeight: 500, color: "var(--text)", marginBottom: "4px" }}>{v.name}</div>
                  <div className="flex justify-between">
                    <span style={{ fontSize: "13px", color: "var(--teal)" }}>{v.priceRange}</span>
                    <span style={{ fontSize: "12px", color: "var(--text3)" }}>{v.notes}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="card" style={{ borderStyle: "dashed", textAlign: "center", padding: "2rem" }}>
              <div style={{ color: "var(--text3)", fontSize: "13px" }}>Generate AI plan to see vendor suggestions</div>
            </div>
          )}
        </div>

        <div>
          <div style={{ fontSize: "14px", fontWeight: 500, marginBottom: "1rem", color: "var(--text)" }}>Budget allocation</div>
          {aiResults?.budget?.breakdown ? (
            <div className="card" style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              {aiResults.budget.breakdown.map((b, i) => (
                <div key={i}>
                  <div className="flex justify-between mb-1">
                    <span style={{ fontSize: "13px", color: "var(--text2)" }}>{b.category}</span>
                    <span style={{ fontSize: "13px", color: "var(--text)" }}>₹{Number(b.amount).toLocaleString()} <span style={{ color: "var(--text3)" }}>({b.percentage}%)</span></span>
                  </div>
                  <div className="progress-bar">
                    <div className="progress-fill" style={{ width: `${b.percentage}%`, background: COLORS[i % COLORS.length] }} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="card" style={{ borderStyle: "dashed", textAlign: "center", padding: "2rem" }}>
              <div style={{ color: "var(--text3)", fontSize: "13px" }}>Budget breakdown will appear after AI generation</div>
            </div>
          )}

          <div style={{ fontSize: "14px", fontWeight: 500, margin: "1.25rem 0 0.75rem", color: "var(--text)" }}>Track expenses</div>
          <div className="card" style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            <div className="grid-2">
              <div className="form-group">
                <label className="form-label">Category</label>
                <input className="form-input" placeholder="Venue, Food..." value={expForm.category} onChange={e => setExpForm(f => ({ ...f, category: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="form-label">Amount (₹)</label>
                <input type="number" className="form-input" placeholder="5000" value={expForm.amount} onChange={e => setExpForm(f => ({ ...f, amount: e.target.value }))} />
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Description</label>
              <input className="form-input" placeholder="Brief description" value={expForm.description} onChange={e => setExpForm(f => ({ ...f, description: e.target.value }))} />
            </div>
            <button className="btn btn-outline btn-sm" onClick={addExpense} style={{ alignSelf: "flex-end" }}>+ Add Expense</button>
            {expenses.length > 0 && (
              <table className="table" style={{ marginTop: "0.5rem" }}>
                <thead><tr><th>Category</th><th>Description</th><th>Amount</th><th></th></tr></thead>
                <tbody>
                  {expenses.map(ex => (
                    <tr key={ex.id}>
                      <td><span className="badge badge-accent">{ex.category}</span></td>
                      <td>{ex.description || "—"}</td>
                      <td style={{ color: "var(--text)" }}>₹{ex.amount.toLocaleString()}</td>
                      <td><button className="btn btn-danger btn-sm" onClick={async () => {
                        try {
                          await api.removeExpense(ex.id);
                          setExpenses(e => e.filter(x => x.id !== ex.id));
                        } catch (err) {
                          console.error(err);
                        }
                      }}>×</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="card-sm mt-2">
            <div className="flex justify-between mb-1">
              <span style={{ fontSize: "12px", color: "var(--text2)" }}>Budget used</span>
              <span style={{ fontSize: "12px", color: utilPct > 90 ? "var(--coral)" : "var(--teal)" }}>{utilPct}%</span>
            </div>
            <div className="progress-bar" style={{ height: "10px" }}>
              <div className="progress-fill" style={{ width: `${utilPct}%`, background: utilPct > 90 ? "var(--coral)" : utilPct > 70 ? "var(--gold)" : "var(--teal)" }} />
            </div>
          </div>
        </div>
      </div>
      )}

      {eventData && aiResults?.tips && (
        <div className="card mt-3" style={{ borderColor: "rgba(61,207,176,0.2)" }}>
          <div style={{ fontSize: "12px", fontFamily: "DM Mono", color: "var(--text3)", textTransform: "uppercase", marginBottom: "0.75rem" }}>AI Tips for your event</div>
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            {aiResults.tips.map((tip, i) => (
              <div key={i} style={{ fontSize: "14px", color: "var(--text2)", display: "flex", gap: "10px" }}>
                <span style={{ color: "var(--teal)", flexShrink: 0 }}>✦</span> {tip}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="section-header" style={{ marginTop: "3rem" }}>
        <h2 className="section-title">Browse Actual Vendors</h2>
        <p className="section-sub">Discover, tag, compare, and book vendors from our marketplace</p>
      </div>

      <div className="card mb-3">
        <div className="flex justify-between items-end mb-2" style={{ flexWrap: "wrap", gap: "1rem" }}>
          <div className="flex gap-2" style={{ flexWrap: "wrap", flex: 1 }}>
            <input className="form-input" placeholder="Search vendors..." value={search} onChange={e => setSearch(e.target.value)} style={{ minWidth: "150px" }} />
            <select className="form-select" value={filterCat} onChange={e => setFilterCat(e.target.value)}>
              <option>All Categories</option>
              {["Venue", "Catering", "Photography", "Decoration", "Entertainment", "Other"].map(c => <option key={c}>{c}</option>)}
            </select>
            <input className="form-input" placeholder="Location (e.g. Mumbai)" value={filterLocation} onChange={e => setFilterLocation(e.target.value)} style={{ minWidth: "130px" }} />
            <input type="number" className="form-input" placeholder="Max Budget (₹)" value={filterMaxBudget} onChange={e => setFilterMaxBudget(e.target.value)} style={{ minWidth: "130px" }} />
          </div>
          <button className="btn btn-ai" onClick={autoTagVendors} disabled={isTagging}>
            {isTagging ? "Tagging..." : "✦ Auto-Tag by Price (AI)"}
          </button>
        </div>

        <div className="grid-3" style={{ gap: "1rem" }}>
          {filteredVendors.length === 0 ? (
            <div className="card" style={{ gridColumn: "1 / -1", borderStyle: "dashed", textAlign: "center", padding: "2rem" }}>
              <div style={{ color: "var(--text3)", fontSize: "13px" }}>No vendors listed yet. Vendors can register via the Vendor role.</div>
            </div>
          ) : filteredVendors.map((v, i) => {
            const isComparing = compareList.find(c => c.id === v.id);
            const status = bookings?.find(b => b.vendorId === v.id)?.status;
            return (
              <div key={v.id} className="card" style={{ padding: "1rem", borderLeft: `3px solid ${COLORS[i % COLORS.length]}` }}>
                <div className="flex justify-between items-center mb-1">
                  <span style={{ fontSize: "12px", fontFamily: "DM Mono", color: "var(--text3)", textTransform: "uppercase" }}>{v.category}</span>
                  <span style={{ fontSize: "12px", color: "var(--gold)" }}>{"★".repeat(Math.round(v.rating))} {v.rating}</span>
                </div>
                <div style={{ fontSize: "15px", fontWeight: 500, color: "var(--text)", marginBottom: "4px" }}>{v.organization}</div>
                <div style={{ fontSize: "13px", color: "var(--teal)", marginBottom: "4px" }}>₹{v.priceMin} - ₹{v.priceMax}</div>
                {v.aiTag && <div style={{ marginBottom: "8px" }}><span className="badge badge-accent" style={{ fontSize: "10px" }}>AI: {v.aiTag}</span></div>}
                <div className="flex gap-2 mt-2">
                  <button className="btn btn-primary btn-sm" style={{ flex: 1 }} onClick={() => requestBooking(v)} disabled={!!status}>
                    {status ? status : "Book"}
                  </button>
                  <label style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "12px", cursor: "pointer", color: "var(--text2)" }}>
                    <input type="checkbox" checked={!!isComparing} onChange={() => toggleCompare(v)} />
                    Compare
                  </label>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {compareList.length > 0 && (
        <div className="card" style={{ border: "1px solid var(--accent2)", marginTop: "1rem" }}>
          <div className="flex justify-between items-center mb-2">
            <div style={{ fontSize: "14px", fontWeight: 500 }}>Comparing {compareList.length} vendor(s)</div>
            <button className="btn btn-outline btn-sm" onClick={() => setCompareList([])}>Clear</button>
          </div>
          <div className="grid-3" style={{ gap: "1rem" }}>
            {compareList.map(v => (
              <div key={v.id} style={{ background: "rgba(255,255,255,0.03)", padding: "1rem", borderRadius: "8px" }}>
                <div style={{ fontWeight: 500 }}>{v.organization}</div>
                <div style={{ fontSize: "13px", color: "var(--text2)", margin: "4px 0" }}>Category: {v.category}</div>
                <div style={{ fontSize: "13px", color: "var(--teal)", margin: "4px 0" }}>Price: ₹{v.priceMin} - ₹{v.priceMax}</div>
                <div style={{ fontSize: "13px", color: "var(--gold)", margin: "4px 0" }}>Rating: {v.rating}★</div>
                <div style={{ fontSize: "12px", color: "var(--text3)", margin: "4px 0" }}>Services: {v.services || "N/A"}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
