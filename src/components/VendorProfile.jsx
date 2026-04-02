import { useState } from "react";

const CATEGORIES = ["Venue", "Catering", "Photography", "Decoration", "Entertainment", "Other"];

export default function VendorProfile({ vendors, setVendors }) {
  // Mock 'my-vendor-id' for the local Vendor user
  const vendorId = "my-vendor-id";
  const existingProfile = vendors.find(v => v.id === vendorId);

  const [form, setForm] = useState(existingProfile || {
    id: vendorId, organization: "", category: "Venue", description: "",
    services: "", priceMin: "", priceMax: "", location: "", contact: "", rating: 5.0
  });
  const [notionToast, setNotionToast] = useState(null); // null | 'saving' | 'saved' | 'error'

  const saveProfile = async () => {
    if (!form.organization || !form.priceMin || !form.priceMax) {
      alert("Please fill in Organization Name and Price Range.");
      return;
    }
    // Save locally first
    setVendors(prev => {
      const idx = prev.findIndex(v => v.id === form.id);
      if (idx !== -1) {
        const newArr = [...prev];
        newArr[idx] = form;
        return newArr;
      }
      return [...prev, form];
    });
    alert("Profile Saved Successfully!");

    // Sync to Notion in background
    setNotionToast('saving');
    try {
      const res = await fetch("/api/notion/save-vendor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      setNotionToast(res.ok ? 'saved' : 'error');
    } catch {
      setNotionToast('error');
    }
    setTimeout(() => setNotionToast(null), 4000);
  };

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  return (
    <div>
      <div className="section-header">
        <h1 className="section-title">Vendor Profile</h1>
        <p className="section-sub">Manage your public listing for users to discover you</p>
      </div>

      <div className="grid-2" style={{ gap: "2rem" }}>
        <div className="card" style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
          <div className="form-group">
            <label className="form-label">Organization Name *</label>
            <input className="form-input" placeholder="e.g. Royal Palace Banquets" value={form.organization} onChange={e => set("organization", e.target.value)} />
          </div>
          <div className="grid-2">
            <div className="form-group">
              <label className="form-label">Category</label>
              <select className="form-select" value={form.category} onChange={e => set("category", e.target.value)}>
                {CATEGORIES.map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Location / City</label>
              <input className="form-input" placeholder="e.g. Mumbai" value={form.location} onChange={e => set("location", e.target.value)} />
            </div>
          </div>
          <div className="grid-2">
            <div className="form-group">
              <label className="form-label">Price Range Min (₹) *</label>
              <input type="number" className="form-input" placeholder="5000" value={form.priceMin} onChange={e => set("priceMin", e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Price Range Max (₹) *</label>
              <input type="number" className="form-input" placeholder="50000" value={form.priceMax} onChange={e => set("priceMax", e.target.value)} />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Key Services Offered</label>
            <input className="form-input" placeholder="e.g. Buffet, Live Counters, Desserts" value={form.services} onChange={e => set("services", e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">Contact Details</label>
            <input className="form-input" placeholder="Email or Phone Number" value={form.contact} onChange={e => set("contact", e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">Description / Bio</label>
            <textarea className="form-textarea" placeholder="Tell clients why they should choose you..." value={form.description} onChange={e => set("description", e.target.value)} />
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "1rem", marginTop: "10px", flexWrap: "wrap" }}>
            <button className="btn btn-primary" onClick={saveProfile}>Save Profile</button>
            {notionToast === 'saving' && (
              <span style={{ fontSize: "12px", color: "var(--text3)" }}>⏳ Syncing to Notion...</span>
            )}
            {notionToast === 'saved' && (
              <span style={{ fontSize: "12px", color: "var(--teal)" }}>✅ Backed up to Notion</span>
            )}
            {notionToast === 'error' && (
              <span style={{ fontSize: "12px", color: "var(--coral)" }}>⚠ Notion sync failed (saved locally)</span>
            )}
          </div>
        </div>

        <div>
          <div style={{ fontSize: "14px", fontWeight: 500, marginBottom: "1rem", color: "var(--text)" }}>Preview your Public Card</div>
          <div className="card" style={{ borderLeft: "3px solid var(--accent)" }}>
            <div className="flex justify-between items-center mb-1">
              <span style={{ fontSize: "12px", fontFamily: "DM Mono", color: "var(--text3)", textTransform: "uppercase" }}>{form.category}</span>
              <span style={{ fontSize: "12px", color: "var(--gold)" }}>{"★".repeat(Math.round(form.rating))} {form.rating}</span>
            </div>
            <div style={{ fontSize: "16px", fontWeight: 500, color: "var(--text)", marginBottom: "4px" }}>{form.organization || "Your Business Name"}</div>
            <div style={{ fontSize: "13px", color: "var(--text2)", marginBottom: "8px" }}>📍 {form.location || "Location"}</div>
            
            <div style={{ fontSize: "13px", color: "var(--teal)", marginBottom: "8px" }}>
              ₹{form.priceMin || "Min"} - ₹{form.priceMax || "Max"}
            </div>
            <div style={{ fontSize: "13px", color: "var(--text3)" }}>{form.services || "Key services listed here..."}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
