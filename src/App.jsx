import { useState, useEffect, useCallback } from "react";
import EventForm from "./components/EventForm";
import VendorBudget from "./components/VendorBudget";
import Timeline from "./components/Timeline";
import Attendees from "./components/Attendees";
import Feedback from "./components/Feedback";
import Analytics from "./components/Analytics";
import Chat from "./components/Chat";
import VendorProfile from "./components/VendorProfile";
import VendorDashboard from "./components/VendorDashboard";
import { api } from "./api";
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
    } catch {
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

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const [eventData, setEventData] = useState(null);
  const [aiResults, setAiResults] = useState(null);
  const [attendees, setAttendees] = useState([]);
  const [feedbackList, setFeedbackList] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [messages, setMessages] = useState([]);

  const [notionReady, setNotionReady] = useState(null);
  const [showNotionBanner, setShowNotionBanner] = useState(true);

  const refreshData = useCallback(async () => {
    try {
      const [data, health] = await Promise.all([
        api.getData(),
        api.health().catch(() => null),
      ]);
      setEventData(data.event);
      setAiResults(data.aiResults);
      setAttendees(data.attendees || []);
      setFeedbackList(data.feedback || []);
      setExpenses(data.expenses || []);
      setVendors(data.vendors || []);
      setBookings(data.bookings || []);
      setMessages(data.messages || []);
      if (health) setNotionReady(health?.notion?.connected === true);
      setLoadError(null);
    } catch (err) {
      console.error("Failed to load data:", err);
      setLoadError("Could not connect to backend. Make sure the server is running (npm run dev).");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshData();
    const t = setTimeout(() => setShowNotionBanner(false), 6000);
    return () => clearTimeout(t);
  }, [refreshData]);

  // Auto-fetch live vendors from /api/vendors?location=<city> after AI plan generation
  useEffect(() => {
    if (aiResults && eventData?.location) {
      const fetchLiveVendors = async () => {
        try {
          const res = await fetch(`/api/vendors?location=${encodeURIComponent(eventData.location)}`);
          const data = await res.json();
          if (data.vendors && data.vendors.length > 0) {
            setVendors(prev => {
              const merged = [...prev];
              for (const lv of data.vendors) {
                if (!merged.some(v => v.id === lv.id || (v.organization === lv.organization && v.category === lv.category))) {
                  merged.push(lv);
                }
              }
              return merged;
            });
          }
        } catch (e) {
          console.warn("Failed to fetch live vendors:", e.message);
        }
      };
      fetchLiveVendors();
    }
  }, [aiResults, eventData?.location]);

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

  if (loading) {
    return (
      <div className="app" style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>
        <div className="card" style={{ textAlign: "center", padding: "2rem" }}>
          <div className="ai-dot" /><div className="ai-dot" /><div className="ai-dot" />
          <div style={{ marginTop: "1rem", color: "var(--text2)" }}>Loading from server...</div>
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

      {loadError && (
        <div style={{
          background: "rgba(255,100,100,0.08)",
          borderBottom: "1px solid rgba(255,100,100,0.2)",
          padding: "10px 2rem",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "12px",
          fontSize: "13px",
          color: "var(--coral)",
        }}>
          <span>⚠</span>
          <span>{loadError}</span>
          <button className="btn btn-sm btn-outline" onClick={refreshData}>Retry</button>
        </div>
      )}

      {notionReady === false && showNotionBanner && !loadError && (
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
          <span>Notion sync not configured — data is saved on the server locally.</span>
          <button onClick={() => setShowNotionBanner(false)} style={{ background: "none", border: "none", color: "var(--text3)", cursor: "pointer", fontSize: "16px", marginLeft: "4px" }}>×</button>
        </div>
      )}
      {notionReady === true && showNotionBanner && !loadError && (
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
            expenses={expenses}
            setExpenses={setExpenses}
            vendors={vendors}
            setVendors={setVendors}
            bookings={bookings}
            setBookings={setBookings}
            refreshData={refreshData}
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

        {activeTab === "dashboard" && (
          <VendorDashboard bookings={bookings} setBookings={setBookings} />
        )}
        {activeTab === "profile" && (
          <VendorProfile vendors={vendors} setVendors={setVendors} />
        )}

        {activeTab === "chat" && (
          <Chat role={role} messages={messages} setMessages={setMessages} vendors={vendors} eventData={eventData} />
        )}
      </main>
    </div>
  );
}
