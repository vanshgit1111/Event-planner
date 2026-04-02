import { useState, useEffect } from "react";
import EventForm from "./components/EventForm";
import VendorBudget from "./components/VendorBudget";
import Timeline from "./components/Timeline";
import Attendees from "./components/Attendees";
import Feedback from "./components/Feedback";
import Analytics from "./components/Analytics";
import Chat from "./components/Chat";
import VendorProfile from "./components/VendorProfile";
import VendorDashboard from "./components/VendorDashboard";
import "./App.css";

const userTabs = [
  { id: "create", label: "Create Event", icon: "✦" },
  { id: "vendors", label: "Vendors & Budget", icon: "◈" },
  { id: "timeline", label: "Timeline", icon: "◷" },
  { id: "attendees", label: "Attendees", icon: "◉" },
  { id: "feedback", label: "Feedback", icon: "◎" },
  { id: "analytics", label: "Analytics", icon: "◆" },
  { id: "chat", label: "Chat", icon: "💬" }
];

const vendorTabs = [
  { id: "dashboard", label: "Dashboard", icon: "◆" },
  { id: "profile", label: "Profile", icon: "◈" },
  { id: "chat", label: "Chat", icon: "💬" }
];

function useLocalStorage(key, initialValue) {
  const [storedValue, setStoredValue] = useState(() => {
    try {
      const item = window.localStorage.getItem(key);
      return item ? JSON.parse(item) : initialValue;
    } catch (error) {
      console.error(error);
      return initialValue;
    }
  });

  const setValue = value => {
    try {
      const valueToStore = value instanceof Function ? value(storedValue) : value;
      setStoredValue(valueToStore);
      window.localStorage.setItem(key, JSON.stringify(valueToStore));
    } catch (error) {
      console.error(error);
    }
  };
  return [storedValue, setValue];
}

export default function App() {
  const [role, setRole] = useLocalStorage("em_role", null);
  const [activeTab, setActiveTab] = useLocalStorage("em_activeTab", "create");
  const [eventData, setEventData] = useLocalStorage("em_eventData", null);
  const [aiResults, setAiResults] = useLocalStorage("em_aiResults", null);
  const [attendees, setAttendees] = useLocalStorage("em_attendees", []);
  const [feedbackList, setFeedbackList] = useLocalStorage("em_feedbackList", []);
  const [expenses, setExpenses] = useLocalStorage("em_expenses", []);

  // Marketplace states
  const [vendors, setVendors] = useLocalStorage("em_vendors", [
    { id: "v1", category: "Venue", organization: "Grand Palace", priceMin: 50000, priceMax: 150000, rating: 4.8, location: "Mumbai", services: "AC Hall, Valet", contact: "contact@grandpalace.in" },
    { id: "v2", category: "Catering", organization: "Spice Route", priceMin: 20000, priceMax: 80000, rating: 4.5, location: "Mumbai", services: "North Indian, South Indian", contact: "hello@spiceroute.in" },
    { id: "v3", category: "Photography", organization: "Lens Craft", priceMin: 15000, priceMax: 50000, rating: 4.9, location: "Navi Mumbai", services: "Candid, Drone", contact: "lenscraft@gmail.com" }
  ]);
  const [bookings, setBookings] = useLocalStorage("em_bookings", []);
  const [messages, setMessages] = useLocalStorage("em_messages", []);
  const [notionReady, setNotionReady] = useState(null);
  const [showNotionBanner, setShowNotionBanner] = useState(true);

  // Check Notion status on mount + auto-dismiss banner after 6s
  useEffect(() => {
    fetch("/api/health")
      .then(r => r.json())
      .then(d => setNotionReady(d?.notion?.connected === true))
      .catch(() => setNotionReady(false));
    const t = setTimeout(() => setShowNotionBanner(false), 6000);
    return () => clearTimeout(t);
  }, []);

  // Sync tab state when switching roles
  useEffect(() => {
    if (role === "User" && !userTabs.find(t => t.id === activeTab)) setActiveTab("create");
    if (role === "Vendor" && !vendorTabs.find(t => t.id === activeTab)) setActiveTab("dashboard");
  }, [role, activeTab, setActiveTab]);

  if (!role) {
    return (
      <div className="app" style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>
        <div className="card" style={{ textAlign: "center", maxWidth: "400px", padding: "3rem 2rem" }}>
          <div className="logo" style={{ justifyContent: "center", marginBottom: "2rem" }}>
            <span className="logo-icon">◈</span>
            <span className="logo-text" style={{ fontSize: "2rem" }}>EventMind</span>
          </div>
          <h1 style={{ fontSize: "1.25rem", marginBottom: "1.5rem" }}>Select your role</h1>
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <button className="btn btn-primary" style={{ padding: "1rem" }} onClick={() => setRole("User")}>
              I'm Planning an Event
            </button>
            <button className="btn btn-outline" style={{ padding: "1rem" }} onClick={() => setRole("Vendor")}>
              I'm a Vendor / Business
            </button>
          </div>
        </div>
      </div>
    );
  }

  const tabsToRender = role === "User" ? userTabs : vendorTabs;

  return (
    <div className="app">
      <header className="header">
        <div className="header-inner">
          <div className="logo">
            <span className="logo-icon">◈</span>
            <span className="logo-text">EventMind</span>
            <span className="logo-tag">AI Planner</span>
          </div>
          <nav className="nav">
            {tabsToRender.map((t) => (
              <button
                key={t.id}
                className={`nav-btn ${activeTab === t.id ? "active" : ""}`}
                onClick={() => setActiveTab(t.id)}
              >
                <span className="nav-icon">{t.icon}</span>
                <span className="nav-label">{t.label}</span>
              </button>
            ))}
          </nav>
          <button className="btn btn-sm btn-outline" style={{ marginLeft: "1rem" }} onClick={() => setRole(null)}>Switch Role</button>
        </div>
      </header>

      {/* Notion setup banner */}
      {notionReady === false && showNotionBanner && (
        <div style={{
          background: "rgba(245,200,66,0.08)",
          borderBottom: "1px solid rgba(245,200,66,0.2)",
          padding: "10px 2rem",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "12px",
          fontSize: "13px",
          color: "var(--gold)",
        }}>
          <span>⚠</span>
          <span>Notion sync not configured — data is saved locally only.</span>
          <a href="/NOTION_SETUP.md" target="_blank" style={{ color: "var(--gold)", textDecoration: "underline", fontWeight: 500 }}>Setup guide</a>
          <button onClick={() => setShowNotionBanner(false)} style={{ background: "none", border: "none", color: "var(--text3)", cursor: "pointer", fontSize: "16px", marginLeft: "4px" }}>×</button>
        </div>
      )}
      {notionReady === true && showNotionBanner && (
        <div style={{
          background: "rgba(61,207,176,0.06)",
          borderBottom: "1px solid rgba(61,207,176,0.15)",
          padding: "8px 2rem",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "8px",
          fontSize: "12px",
          color: "var(--teal)",
        }}>
          <span>✅</span>
          <span>Notion sync active — your data is automatically backed up to Notion</span>
          <button onClick={() => setShowNotionBanner(false)} style={{ background: "none", border: "none", color: "var(--text3)", cursor: "pointer", fontSize: "16px", marginLeft: "8px" }}>×</button>
        </div>
      )}

      <main className="main">
        {activeTab === "create" && (
          <EventForm
            eventData={eventData}
            setEventData={setEventData}
            setAiResults={setAiResults}
            onNext={() => setActiveTab("vendors")}
          />
        )}
        {activeTab === "vendors" && (
          <VendorBudget
            eventData={eventData}
            aiResults={aiResults}
            setAiResults={setAiResults}
            expenses={expenses}
            setExpenses={setExpenses}
            vendors={vendors}
            setVendors={setVendors}
            bookings={bookings}
            setBookings={setBookings}
          />
        )}
        {activeTab === "timeline" && <Timeline eventData={eventData} aiResults={aiResults} />}
        {activeTab === "attendees" && (
          <Attendees
            eventData={eventData}
            attendees={attendees}
            setAttendees={setAttendees}
          />
        )}
        {activeTab === "feedback" && (
          <Feedback feedbackList={feedbackList} setFeedbackList={setFeedbackList} eventData={eventData} />
        )}
        {activeTab === "analytics" && (
          <Analytics
            eventData={eventData}
            attendees={attendees}
            feedbackList={feedbackList}
            expenses={expenses}
            aiResults={aiResults}
          />
        )}

        {/* Vendor Role Screens */}
        {activeTab === "dashboard" && (
          <VendorDashboard bookings={bookings} setBookings={setBookings} />
        )}
        {activeTab === "profile" && (
          <VendorProfile vendors={vendors} setVendors={setVendors} />
        )}

        {/* Shared Chat Screen */}
        {activeTab === "chat" && (
          <Chat role={role} messages={messages} setMessages={setMessages} vendors={vendors} eventData={eventData} />
        )}
      </main>
    </div>
  );
}
