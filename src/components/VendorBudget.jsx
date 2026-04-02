import { useEffect, useMemo, useState } from "react";

const COLORS = ["var(--accent2)", "var(--teal)", "var(--gold)", "var(--coral)", "#a78bfa", "#34d399"];

export default function VendorBudget({ eventData, aiResults, setAiResults, expenses, setExpenses, vendors, setVendors, bookings, setBookings }) {
  const [expForm, setExpForm] = useState({ category: "", description: "", amount: "" });
  
  // New features state
  const [search, setSearch] = useState("");
  const [filterCat, setFilterCat] = useState("All Categories");
  const [filterLocation, setFilterLocation] = useState("");
  const [filterMaxBudget, setFilterMaxBudget] = useState("");
  const [compareList, setCompareList] = useState([]);
  const [isTagging, setIsTagging] = useState(false);
  const [selectedMapVendor, setSelectedMapVendor] = useState(null);
  const [marketVendors, setMarketVendors] = useState([]);
  const [isLoadingMarket, setIsLoadingMarket] = useState(false);
  const [marketError, setMarketError] = useState("");

  const requestBooking = (vendor) => {
    if (!eventData) return alert("Please create an event first.");
    const eventId = eventData.id || "evt-1";
    const exists = bookings.find(b => b.vendorId === vendor.id && b.eventId === eventId);
    if (exists) return alert("Booking already requested!");
    const booking = {
      id: Date.now(), vendorId: vendor.id, eventId,
      eventName: eventData.name, date: eventData.date,
      budget: Number(eventData.budgetMax), status: "Pending"
    };
    setBookings(b => [...b, booking]);
    alert("Booking Request Sent!");

    // Sync to Notion non-blocking
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
    }).then(r => r.ok && console.log("Notion: booking saved"))
      .catch(e => console.warn("Notion booking sync failed:", e.message));
  };

  const autoTagVendors = async () => {
    if (marketVendors.length === 0) return;
    setIsTagging(true);
    try {
      const payload = marketVendors.map(v => ({
        id: v.id,
        category: v.category,
        organization: v.organization,
        rating: v.rating,
        priceLevel: v.priceLevel,
        services: v.services,
        address: v.address,
        location: v.location,
        priceMin: v.priceMin,
        priceMax: v.priceMax,
      }));
      const response = await fetch("/api/tag-vendors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vendors: payload })
      });
      if (!response.ok) throw new Error("Tagging API failed");
      const parsed = await response.json();
      setMarketVendors(prev => prev.map(v => {
        const tag = parsed?.[v.id];
        if (!tag) return v;
        if (typeof tag === "string") return { ...v, aiTag: tag };
        return { ...v, aiTag: `${tag.segment} • ${tag.quality}`, aiTagReason: tag.reason };
      }));
    } catch (err) {
      console.error(err);
      alert("AI Tagging failed");
    } finally {
      setIsTagging(false);
    }
  };

  const effectiveLocation = (filterLocation || eventData?.location || "").trim();

  useEffect(() => {
    const loc = effectiveLocation;
    let ignore = false;
    setIsLoadingMarket(true);
    setMarketError("");
    const qs = new URLSearchParams();
    if (loc) qs.set("location", loc);
    if (filterCat && filterCat !== "All Categories") qs.set("category", filterCat);
    if (search) qs.set("q", search);
    qs.set("limit", "60");
    fetch(`/api/notion/vendors?${qs.toString()}`)
      .then(r => r.json())
      .then(d => {
        if (ignore) return;
        const list = Array.isArray(d?.vendors) ? d.vendors : [];
        setMarketVendors(list);
        if (!list.length) setMarketError("No vendors found in Notion yet. Switch to Vendor role and save a profile.");
      })
      .catch(() => {
        if (ignore) return;
        setMarketError("Could not load vendors from Notion.");
        setMarketVendors([]);
      })
      .finally(() => !ignore && setIsLoadingMarket(false));
    return () => { ignore = true; };
  }, [effectiveLocation, filterCat, search]);

  const filteredVendors = (marketVendors || []).filter(v => {
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


  // NOTE: We no longer early-return when eventData is missing — the Browse Vendors
  // section must always be visible so users can discover vendor profiles.
  // Only the budget/AI sections are gated on eventData.

  const addExpense = () => {
    if (!expForm.category || !expForm.amount) return;
    setExpenses(e => [...e, { ...expForm, id: Date.now(), amount: Number(expForm.amount) }]);
    setExpForm({ category: "", description: "", amount: "" });
  };

  const totalSpent = expenses.reduce((s, e) => s + e.amount, 0);
  const budget = aiResults?.budget?.total || Number(eventData?.budgetMax) || 0;
  const utilPct = budget ? Math.min(100, Math.round((totalSpent / budget) * 100)) : 0;
  const quickBestWithinBudget = (aiResults?.budget?.breakdown || [])
    .filter(item => Number(item.amount) > 0)
    .slice(0, 3)
    .map(item => ({ category: item.category, amount: Number(item.amount) }));
  const mapCandidates = useMemo(
    () => (aiResults?.vendors || []).filter(v => Number.isFinite(Number(v.lat)) && Number.isFinite(Number(v.lon))),
    [aiResults?.vendors]
  );

  useEffect(() => {
    if (!mapCandidates.length) {
      setSelectedMapVendor(null);
      return;
    }
    setSelectedMapVendor(prev => {
      if (prev && mapCandidates.some(v => v.name === prev.name)) return prev;
      return mapCandidates[0];
    });
  }, [mapCandidates]);

  const getEmbedUrl = (vendor) => {
    if (!vendor) return null;
    const lat = Number(vendor.lat);
    const lon = Number(vendor.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    const left = lon - 0.02;
    const right = lon + 0.02;
    const top = lat + 0.02;
    const bottom = lat - 0.02;
    return `https://www.openstreetmap.org/export/embed.html?bbox=${left}%2C${bottom}%2C${right}%2C${top}&layer=mapnik&marker=${lat}%2C${lon}`;
  };

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
      {eventData && aiResults?.estimatedCost && (
        <div className="card mb-3" style={{ borderColor: "rgba(61,207,176,0.2)" }}>
          <div style={{ fontSize: "12px", fontFamily: "DM Mono", color: "var(--text3)", textTransform: "uppercase", marginBottom: "0.75rem" }}>
            Location-based estimated event cost
          </div>
          <div className="grid-3" style={{ gap: "1rem" }}>
            <div>
              <div style={{ fontSize: "12px", color: "var(--text3)" }}>Location</div>
              <div style={{ fontSize: "15px", color: "var(--text)", fontWeight: 500 }}>{aiResults.estimatedCost.location || eventData.location || "India"}</div>
            </div>
            <div>
              <div style={{ fontSize: "12px", color: "var(--text3)" }}>Estimated Minimum</div>
              <div style={{ fontSize: "15px", color: "var(--teal)", fontWeight: 500 }}>₹{Number(aiResults.estimatedCost.estimatedMin || 0).toLocaleString()}</div>
            </div>
            <div>
              <div style={{ fontSize: "12px", color: "var(--text3)" }}>Estimated Maximum</div>
              <div style={{ fontSize: "15px", color: "var(--gold)", fontWeight: 500 }}>₹{Number(aiResults.estimatedCost.estimatedMax || 0).toLocaleString()}</div>
            </div>
          </div>
          {aiResults.estimatedCost.note && (
            <div style={{ marginTop: "0.75rem", fontSize: "12px", color: "var(--text3)" }}>{aiResults.estimatedCost.note}</div>
          )}
        </div>
      )}
      {eventData && aiResults?.budgetAdvice && !aiResults.budgetAdvice.withinBudget && (
        <div className="card mb-3" style={{ borderColor: "rgba(255,107,107,0.35)", background: "rgba(255,107,107,0.06)" }}>
          <div style={{ fontSize: "12px", fontFamily: "DM Mono", color: "var(--coral)", textTransform: "uppercase", marginBottom: "0.75rem" }}>
            Budget advisory
          </div>
          <div style={{ fontSize: "14px", color: "var(--text)", marginBottom: "0.5rem" }}>
            {aiResults.budgetAdvice.message}
          </div>
          <div className="grid-3" style={{ gap: "0.75rem" }}>
            <div>
              <div style={{ fontSize: "12px", color: "var(--text3)" }}>Current Budget</div>
              <div style={{ fontSize: "14px", color: "var(--text)" }}>₹{Number(budget).toLocaleString()}</div>
            </div>
            <div>
              <div style={{ fontSize: "12px", color: "var(--text3)" }}>Suggested Minimum</div>
              <div style={{ fontSize: "14px", color: "var(--gold)" }}>₹{Number(aiResults.budgetAdvice.suggestedBudget || 0).toLocaleString()}</div>
            </div>
            <div>
              <div style={{ fontSize: "12px", color: "var(--text3)" }}>Gap</div>
              <div style={{ fontSize: "14px", color: "var(--coral)" }}>₹{Number(aiResults.budgetAdvice.overBy || 0).toLocaleString()}</div>
            </div>
          </div>
          {quickBestWithinBudget.length > 0 && (
            <div style={{ marginTop: "0.75rem", fontSize: "12px", color: "var(--text2)" }}>
              Best possible within your current budget:
              {" "}
              {quickBestWithinBudget.map(item => `${item.category} ~ ₹${item.amount.toLocaleString()}`).join(" • ")}
            </div>
          )}
        </div>
      )}

      {eventData && (
      <div className="grid-2" style={{ gap: "1.5rem" }}>
        {/* Suggested Vendors (AI) */}
        <div>
          <div style={{ fontSize: "14px", fontWeight: 500, marginBottom: "1rem", color: "var(--text)" }}>Suggested vendors</div>
          {Array.isArray(aiResults?.vendors) && aiResults.vendors.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              {aiResults.vendors.map((v, i) => (
                <div key={i} className="card" style={{ padding: "1rem", borderLeft: `3px solid ${COLORS[i % COLORS.length]}` }}>
                  <div className="flex justify-between items-center mb-1">
                    <span style={{ fontSize: "12px", fontFamily: "DM Mono", color: "var(--text3)", textTransform: "uppercase" }}>{v.category}</span>
                    <span style={{ fontSize: "12px", color: "var(--gold)" }}>{"★".repeat(Math.round(v.rating))} {v.rating}</span>
                  </div>
                  <div style={{ fontSize: "15px", fontWeight: 500, color: "var(--text)", marginBottom: "4px" }}>{v.name}</div>
                  <div className="flex justify-between">
                    <span style={{ fontSize: "13px", color: v.priceSource === "notion" ? "var(--teal)" : "var(--gold)" }}>
                      {v.priceRange}
                    </span>
                    <span style={{ fontSize: "12px", color: "var(--text3)" }}>{v.notes}</span>
                  </div>
                  {v.priceSource === "notion" ? (
                    <div style={{ marginTop: "8px" }}>
                      <span className="badge badge-teal" style={{ fontSize: "10px" }}>Verified price (Notion)</span>
                    </div>
                  ) : (
                    <div style={{ marginTop: "8px" }}>
                      <span className="badge badge-gold" style={{ fontSize: "10px" }}>Price not listed — request quote</span>
                    </div>
                  )}
                  {(Number.isFinite(Number(v.lat)) && Number.isFinite(Number(v.lon))) && (
                    <div className="vendor-map-actions">
                      <button
                        className="btn btn-outline btn-sm"
                        onClick={() => setSelectedMapVendor(v)}
                      >
                        View on map
                      </button>
                      {v.mapUrl && (
                        <a
                          href={v.mapUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="btn btn-sm"
                          style={{ textDecoration: "none", border: "1px solid var(--border2)", color: "var(--text2)", background: "transparent" }}
                        >
                          Open map
                        </a>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="card" style={{ borderStyle: "dashed", textAlign: "center", padding: "2rem" }}>
              <div style={{ color: "var(--text3)", fontSize: "13px" }}>
                No live vendors found for this location yet. Try nearby city names or configure `GOOGLE_PLACES_API_KEY`.
              </div>
            </div>
          )}
        </div>

        {/* Budget */}
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

          {/* Expense tracker */}
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
                      <td><button className="btn btn-danger btn-sm" onClick={() => setExpenses(e => e.filter(x => x.id !== ex.id))}>×</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Budget utilization bar */}
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
      {eventData && selectedMapVendor && getEmbedUrl(selectedMapVendor) && (
        <div className="card mt-3" style={{ borderColor: "rgba(159,133,255,0.25)" }}>
          <div className="flex justify-between items-center mb-2">
            <div>
              <div style={{ fontSize: "12px", fontFamily: "DM Mono", color: "var(--text3)", textTransform: "uppercase" }}>
                Local vendor map
              </div>
              <div style={{ fontSize: "15px", fontWeight: 500, color: "var(--text)", marginTop: "4px" }}>
                {selectedMapVendor.name}
              </div>
            </div>
            <span className="badge badge-accent">{selectedMapVendor.category}</span>
          </div>
          <iframe
            title={`Map of ${selectedMapVendor.name}`}
            src={getEmbedUrl(selectedMapVendor)}
            style={{ width: "100%", height: "280px", border: "1px solid var(--border)", borderRadius: "10px" }}
            loading="lazy"
          />
          <div style={{ marginTop: "0.65rem", fontSize: "12px", color: "var(--text3)" }}>
            Showing nearest live vendor location from your selected city.
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
      {eventData && aiResults?.bestOptions?.length > 0 && (
        <div className="card mt-3" style={{ borderColor: "rgba(159,133,255,0.25)" }}>
          <div style={{ fontSize: "12px", fontFamily: "DM Mono", color: "var(--text3)", textTransform: "uppercase", marginBottom: "0.75rem" }}>
            Best options from your preferences
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            {aiResults.bestOptions.map((item, i) => (
              <div key={`${item.category}-${i}`} className="card-sm" style={{ border: "1px solid rgba(159,133,255,0.2)" }}>
                <div className="flex justify-between items-center mb-1">
                  <span className="badge badge-accent">{item.category}</span>
                  <span style={{ fontSize: "12px", color: "var(--teal)" }}>{item.estimatedCost}</span>
                </div>
                <div style={{ fontSize: "14px", color: "var(--text)", fontWeight: 500, marginBottom: "4px" }}>{item.option}</div>
                <div style={{ fontSize: "12px", color: "var(--text2)" }}>{item.reason}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* New Browse Vendors Section */}
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

        <div className="flex justify-between items-center mb-2" style={{ gap: "10px", flexWrap: "wrap" }}>
          <div style={{ fontSize: "12px", color: "var(--text3)" }}>
            {effectiveLocation ? (
              isLoadingMarket ? `Loading marketplace vendors for ${effectiveLocation}...` : `Showing marketplace vendors in ${effectiveLocation}`
            ) : (isLoadingMarket ? "Loading marketplace vendors..." : "Showing all marketplace vendors (from Notion)")}
          </div>
          {marketError && <div style={{ fontSize: "12px", color: "var(--coral)" }}>{marketError}</div>}
        </div>

        <div className="grid-3" style={{ gap: "1rem" }}>
          {filteredVendors.map((v, i) => {
            const isComparing = compareList.find(c => c.id === v.id);
            const status = bookings?.find(b => b.vendorId === v.id)?.status;
            return (
              <div key={v.id} className="card" style={{ padding: "1rem", borderLeft: `3px solid ${COLORS[i % COLORS.length]}` }}>
                <div className="flex justify-between items-center mb-1">
                  <span style={{ fontSize: "12px", fontFamily: "DM Mono", color: "var(--text3)", textTransform: "uppercase" }}>{v.category}</span>
                  <span style={{ fontSize: "12px", color: "var(--gold)" }}>{"★".repeat(Math.round(v.rating))} {v.rating}</span>
                </div>
                <div style={{ fontSize: "15px", fontWeight: 500, color: "var(--text)", marginBottom: "4px" }}>{v.organization}</div>
                {v.location && <div style={{ fontSize: "12px", color: "var(--text3)", marginBottom: "4px" }}>📍 {v.location}</div>}
                {(Number(v.priceMin) > 0 || Number(v.priceMax) > 0) && (
                  <div style={{ fontSize: "13px", color: "var(--teal)", marginBottom: "4px" }}>
                    ₹{Number(v.priceMin || 0).toLocaleString()} - ₹{Number(v.priceMax || 0).toLocaleString()}
                  </div>
                )}
                {v.services && <div style={{ fontSize: "12px", color: "var(--text2)", marginBottom: "4px" }}>{v.services}</div>}
                {v.aiTag && (
                  <div style={{ marginBottom: "8px", display: "flex", flexDirection: "column", gap: "6px" }}>
                    <div><span className="badge badge-accent" style={{ fontSize: "10px" }}>AI: {v.aiTag}</span></div>
                    {v.aiTagReason && <div style={{ fontSize: "12px", color: "var(--text3)" }}>{v.aiTagReason}</div>}
                  </div>
                )}
                
                <div className="flex gap-2 mt-2">
                  <button className="btn btn-primary btn-sm" style={{ flex: 1 }} onClick={() => requestBooking({ ...v, organization: v.organization })} disabled={!!status}>
                    {status ? status : "Book"}
                  </button>
                  {v.mapUrl && (
                    <a
                      href={v.mapUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="btn btn-outline btn-sm"
                      style={{ textDecoration: "none" }}
                    >
                      Map
                    </a>
                  )}
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

      {/* Comparison Drawer */}
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
