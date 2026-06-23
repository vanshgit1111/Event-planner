import { useState, useEffect, useRef } from "react";
import { api } from "../api";

const COLORS = ["var(--accent2)", "var(--teal)", "var(--gold)", "var(--coral)", "#a78bfa", "#34d399"];

export default function VendorBudget({ eventData, aiResults, expenses, setExpenses, vendors, setVendors, bookings, setBookings, refreshData }) {
  const [expForm, setExpForm] = useState({ category: "", description: "", amount: "" });
  const [search, setSearch] = useState("");
  const [filterCat, setFilterCat] = useState("All Categories");
  const [filterLocation, setFilterLocation] = useState("");
  const [filterMaxBudget, setFilterMaxBudget] = useState("");
  const [compareList, setCompareList] = useState([]);
  const [isTagging, setIsTagging] = useState(false);
  const [syncingId, setSyncingId] = useState(null);

  const mapInstanceRef = useRef(null);
  const markersRef = useRef([]);

  // Declare filteredVendors early so useEffect hooks below can safely reference it
  const filteredVendors = (vendors || []).filter(v => {
    const matchSearch = (v.organization || "").toLowerCase().includes(search.toLowerCase());
    const matchCat = filterCat === "All Categories" || v.category === filterCat;
    const matchLoc = !filterLocation || (v.location || "").toLowerCase().includes(filterLocation.toLowerCase());
    const matchBudget = !filterMaxBudget || Number(v.priceMax || 0) <= Number(filterMaxBudget);
    return matchSearch && matchCat && matchLoc && matchBudget;
  });

  const handleSyncVendor = async (vendor) => {
    if (!aiResults) return alert("Please generate an AI plan first.");
    if (!confirm(`Do you want to sync "${vendor.organization}" as your selected ${vendor.category} in your event plan?`)) {
      return;
    }
    
    setSyncingId(vendor.id);
    const updatedVendors = aiResults.vendors.map(v => {
      if (v.category.toLowerCase() === vendor.category.toLowerCase()) {
        return {
          ...v,
          name: vendor.organization,
          priceRange: vendor.priceMin && vendor.priceMax ? `₹${Number(vendor.priceMin).toLocaleString()} - ₹${Number(vendor.priceMax).toLocaleString()}` : (vendor.priceRange || "Request quote"),
          rating: vendor.rating,
          notes: vendor.address || vendor.location,
          isSynced: true,
          realVendorId: vendor.id
        };
      }
      return v;
    });

    const updatedAiResults = {
      ...aiResults,
      vendors: updatedVendors
    };

    try {
      await api.saveAiResults(updatedAiResults);
      if (eventData) {
        await fetch("/api/notion/save-vendor", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            organization: vendor.organization,
            category: vendor.category,
            location: vendor.location || eventData.location,
            priceMin: vendor.priceMin,
            priceMax: vendor.priceMax,
            services: vendor.services || "",
            contact: vendor.contact || "",
            rating: vendor.rating
          })
        }).catch(e => console.warn("Notion vendor save failed:", e.message));
      }
      alert(`Synced "${vendor.organization}" to plan!`);
      if (refreshData) await refreshData();
    } catch (err) {
      console.error(err);
      alert("Failed to sync vendor to plan.");
    } finally {
      setSyncingId(null);
    }
  };

  // Bind the global sync handler so that Leaflet popups can call it
  useEffect(() => {
    window.syncVendorToPlan = (vendorId) => {
      const vendor = filteredVendors.find(v => v.id === vendorId);
      if (vendor) {
        handleSyncVendor(vendor);
      }
    };
    return () => {
      delete window.syncVendorToPlan;
    };
  }, [filteredVendors, aiResults]);

  // Ref-callback: initializes Leaflet the moment the map container div mounts
  // (avoids "Map container not found" when the div is conditionally rendered)
  const mapContainerRef = useRef(null);
  const initMap = (node) => {
    if (!node || !window.L) return;
    if (mapInstanceRef.current) {
      // Already initialized – just invalidate size in case container was hidden
      mapInstanceRef.current.invalidateSize();
      return;
    }
    const defaultCenter = [19.0760, 72.8777]; // Mumbai
    const map = window.L.map(node, { zoomControl: true }).setView(defaultCenter, 11);
    window.L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
      subdomains: 'abcd',
      maxZoom: 20
    }).addTo(map);
    mapInstanceRef.current = map;
    mapContainerRef.current = node;
  };

  // Map Markers Synchronization – runs whenever filteredVendors changes
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !window.L) return;

    // Clear existing markers
    markersRef.current.forEach(marker => marker.remove());
    markersRef.current = [];

    const bounds = [];
    filteredVendors.forEach((v) => {
      if (v.lat && v.lon && Number.isFinite(Number(v.lat)) && Number.isFinite(Number(v.lon))) {
        const latLng = [Number(v.lat), Number(v.lon)];
        bounds.push(latLng);

        const popupHtml = `
          <div style="color: #fff; font-family: system-ui; min-width: 170px; padding: 4px; line-height: 1.4;">
            <div style="font-weight:600; font-size:13px; margin-bottom:2px; color: #fff;">${v.organization}</div>
            <div style="font-size:10px; text-transform:uppercase; color:#9f85ff; font-weight:600; margin-bottom:4px;">${v.category}</div>
            <div style="font-size:12px; color:#2dd4bf; font-weight:600; margin-bottom:6px;">${v.priceMin && v.priceMax ? `₹${Number(v.priceMin).toLocaleString()} - ₹${Number(v.priceMax).toLocaleString()}` : (v.priceRange || 'Request quote')}</div>
            <div style="font-size:11px; color:#bbb; margin-bottom:8px; max-height: 40px; overflow: hidden;">${v.address || v.location}</div>
            <div style="display:flex; gap:6px;">
              <button onclick="window.syncVendorToPlan('${v.id}')" style="background:#9f85ff; border:none; color:#fff; padding:4px 8px; border-radius:4px; font-size:10px; cursor:pointer; font-weight:500; transition: background 0.2s;">Sync with Plan</button>
              ${v.mapUrl ? `<a href="${v.mapUrl}" target="_blank" style="background:#334155; color:#fff; text-decoration:none; padding:4px 8px; border-radius:4px; font-size:10px; font-weight:500;">Nav</a>` : ''}
            </div>
          </div>
        `;

        const marker = window.L.marker(latLng)
          .addTo(map)
          .bindPopup(popupHtml);

        markersRef.current.push(marker);
      }
    });

    if (bounds.length > 0) {
      map.fitBounds(bounds, { padding: [50, 50], maxZoom: 14 });
    }

    // Ensure Leaflet knows the container size after React re-renders
    setTimeout(() => map.invalidateSize(), 100);
  }, [filteredVendors]);

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

  // filteredVendors is declared above (before useEffect hooks) to avoid temporal dead zone

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

        <div style={{ display: "grid", gridTemplateColumns: filteredVendors.length > 0 ? "1fr 400px" : "1fr", gap: "1.5rem", alignItems: "start" }}>
          <div className="grid-2" style={{ gap: "1rem" }}>
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
                  <div style={{ fontSize: "13px", color: "var(--teal)", marginBottom: "4px" }}>
                    {v.priceMin && v.priceMax ? `₹${Number(v.priceMin).toLocaleString()} - ₹${Number(v.priceMax).toLocaleString()}` : (v.priceRange || "Request quote")}
                  </div>
                  {v.aiTag && <div style={{ marginBottom: "8px" }}><span className="badge badge-accent" style={{ fontSize: "10px" }}>AI: {v.aiTag}</span></div>}
                  <div className="flex gap-2 mt-2" style={{ flexWrap: "wrap", alignItems: "center" }}>
                    <button className="btn btn-primary btn-sm" style={{ flex: 1, minWidth: "60px" }} onClick={() => requestBooking(v)} disabled={!!status}>
                      {status ? status : "Book"}
                    </button>
                    <button className="btn btn-outline btn-sm" style={{ flex: 1, minWidth: "60px" }} onClick={() => handleSyncVendor(v)} disabled={syncingId === v.id}>
                      {syncingId === v.id ? "..." : "Sync"}
                    </button>
                    <label style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "12px", cursor: "pointer", color: "var(--text2)", marginLeft: "4px" }}>
                      <input type="checkbox" checked={!!isComparing} onChange={() => toggleCompare(v)} />
                      Compare
                    </label>
                  </div>
                </div>
              );
            })}
          </div>
          {filteredVendors.length > 0 && (
            <div className="card" style={{ padding: "0.5rem", position: "sticky", top: "1rem", zIndex: 10 }}>
              <div style={{ fontSize: "12px", fontFamily: "DM Mono", color: "var(--text3)", textTransform: "uppercase", padding: "0.5rem", borderBottom: "1px solid var(--border)", marginBottom: "0.5rem" }}>
                Interactive map
              </div>
              {/* ref callback: Leaflet inits exactly when this div enters the DOM */}
              <div
                ref={(node) => {
                  if (node && !mapInstanceRef.current) {
                    initMap(node);
                  } else if (!node && mapInstanceRef.current) {
                    // Div is unmounting – destroy map to allow re-init next time
                    mapInstanceRef.current.remove();
                    mapInstanceRef.current = null;
                  }
                }}
                style={{ height: "450px", borderRadius: "8px", background: "var(--bg3)", overflow: "hidden" }}
              />
            </div>
          )}
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
                <div style={{ fontSize: "13px", color: "var(--teal)", margin: "4px 0" }}>
                  Price: {v.priceMin && v.priceMax ? `₹${Number(v.priceMin).toLocaleString()} - ₹${Number(v.priceMax).toLocaleString()}` : (v.priceRange || "Request quote")}
                </div>
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
