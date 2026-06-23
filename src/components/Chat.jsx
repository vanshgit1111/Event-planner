import { useState, useRef, useEffect } from "react";

// AI Chatbot — talks to /api/chat which uses Gemini 2.5 Flash
export default function Chat({ role, messages, setMessages, vendors, eventData }) {
  const [activeChat, setActiveChat] = useState(null);
  const [msg, setMsg] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [error, setError] = useState(null);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  const wsRef = useRef(null);
  const [wsStatus, setWsStatus] = useState("connecting");
  const reconnectDelayRef = useRef(1000);

  const me = role === "Vendor" ? "Vendor" : "User";
  const vendorSelfId = "my-vendor-id";

  // WebSocket Connection Hook
  useEffect(() => {
    let active = true;

    function connect() {
      if (!active) return;

      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const host = window.location.host;
      const wsUrl = import.meta.env.VITE_WS_URL || `${protocol}//${host}/api/chat-ws`;

      console.log(`Connecting to WebSocket: ${wsUrl}`);
      const socket = new WebSocket(wsUrl);
      wsRef.current = socket;

      socket.onopen = () => {
        if (!active) return;
        setWsStatus("open");
        reconnectDelayRef.current = 1000;

        const clientId = role === "Vendor" ? vendorSelfId : "user-client";
        socket.send(JSON.stringify({
          type: "register",
          clientId,
          role
        }));

        if (activeChat && !activeChat.isAI) {
          socket.send(JSON.stringify({
            type: "read-receipt",
            vendorId: activeChat.id,
            senderRole: role
          }));
        }
      };

      socket.onmessage = (event) => {
        if (!active) return;
        try {
          const packet = JSON.parse(event.data);
          if (packet.type === "message") {
            const receivedMsg = packet.message;
            setMessages(prev => {
              if (prev.some(m => m.id === receivedMsg.id)) return prev;
              return [...prev, receivedMsg];
            });

            if (activeChat && activeChat.id === receivedMsg.vendorId) {
              socket.send(JSON.stringify({
                type: "read-receipt",
                vendorId: activeChat.id,
                senderRole: role
              }));
            }
          } else if (packet.type === "status-update") {
            const { msgId, status } = packet;
            setMessages(prev => prev.map(m => m.id === msgId ? { ...m, status } : m));
          }
        } catch (err) {
          console.error("Failed to parse WS packet:", err);
        }
      };

      socket.onclose = () => {
        if (!active) return;
        setWsStatus("closed");
        console.log(`WebSocket closed. Reconnecting in ${reconnectDelayRef.current}ms...`);
        setTimeout(connect, reconnectDelayRef.current);
        reconnectDelayRef.current = Math.min(reconnectDelayRef.current * 2, 15000);
      };

      socket.onerror = (err) => {
        console.error("WebSocket error:", err);
        socket.close();
      };
    }

    connect();

    return () => {
      active = false;
      if (wsRef.current) wsRef.current.close();
    };
  }, [role, activeChat]);

  // Handle read receipt trigger on chat open
  useEffect(() => {
    if (wsRef.current && wsRef.current.readyState === 1 && activeChat && !activeChat.isAI) {
      wsRef.current.send(JSON.stringify({
        type: "read-receipt",
        vendorId: activeChat.id,
        senderRole: role
      }));
    }
  }, [activeChat]);

  const vendorSelfProfile = (vendors || []).find((v) => v.id === vendorSelfId);
  const vendorInboxContacts =
    role === "Vendor" && messages.some((m) => m.vendorId === vendorSelfId)
      ? [{
          id: vendorSelfId,
          organization: vendorSelfProfile?.organization || "Client Inquiries",
          category: vendorSelfProfile?.category || "Your Vendor Inbox",
          isAI: false,
          isVendorInbox: true,
        }]
      : [];

  // Contacts list — vendors for users, a generic client for vendors
  const contacts =
    role === "User"
      ? [
          // AI EventMind assistant always available
          { id: "ai-assistant", organization: "EventMind AI", category: "Your AI Event Planner", isAI: true },
          ...(vendors || []),
        ]
      : [
          { id: "ai-assistant", organization: "EventMind AI", category: "Your AI Business Assistant", isAI: true },
          ...vendorInboxContacts,
        ];

  const localFallbackReply = (questionText) => {
    if (eventData?.name) {
      return `I could not answer "${questionText}" live right now, but I can still help with ${eventData.name}. Ask a more specific follow-up about budget, vendors, or timeline.`;
    }
    return `I could not answer "${questionText}" live right now. Please share event type, city, guest count, and budget for a more useful answer.`;
  };

  // Filter messages for the active chat thread
  const threadMessages = messages.filter((m) => m.vendorId === activeChat?.id);

  // Auto-scroll to latest message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [threadMessages, isTyping]);

  // Focus input when chat opens
  useEffect(() => {
    if (activeChat) inputRef.current?.focus();
  }, [activeChat]);

  // Default to AI assistant when opening chat
  useEffect(() => {
    if (!activeChat && contacts.length > 0) {
      const ai = contacts.find((c) => c.isAI) || contacts[0];
      if (ai) setActiveChat(ai);
    }
  }, [activeChat, contacts]);

  const sendMessage = async () => {
    if (!msg.trim() || !activeChat || isTyping) return;
    setError(null);

    const userMsg = {
      id: Date.now(),
      vendorId: activeChat.id,
      role: "user",
      sender: me,
      text: msg.trim(),
      timestamp: new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }),
      status: "sent"
    };

    const updatedMessages = [...messages, userMsg];
    setMsg("");

    // Peer-to-peer vendor/user message: send via WebSocket
    if (!activeChat.isAI) {
      if (wsRef.current && wsRef.current.readyState === 1) {
        setMessages(updatedMessages);
        wsRef.current.send(JSON.stringify({
          type: "message",
          message: userMsg
        }));
      } else {
        setError("Reconnecting to chat server... Please wait.");
        // Try fallback save via POST request
        try {
          const saved = await api.addMessage(userMsg);
          setMessages([...messages, saved]);
        } catch (err) {
          console.error("Local backup send failed:", err);
          setError("Chat connection offline. Message could not be sent.");
        }
      }
      return;
    }

    setMessages(updatedMessages);

    // AI reply — call Gemini via backend
    setIsTyping(true);
    try {
      // Build history for this thread (last 10 messages for context)
      const threadHistory = updatedMessages
        .filter((m) => m.vendorId === activeChat.id)
        .slice(-10)
        .map((m) => ({ role: m.role || (m.sender === "User" ? "user" : "assistant"), text: m.text }));

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: threadHistory,
          eventContext: eventData || null,
          vendorContext: activeChat.isAI ? null : activeChat,
        }),
      });

      if (!response.ok) throw new Error("Chat API failed");
      const data = await response.json();

      const aiMsg = {
        id: Date.now() + 1,
        vendorId: activeChat.id,
        role: "assistant",
        sender: activeChat.isAI ? "EventMind AI" : activeChat.organization,
        text: data.reply,
        timestamp: new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }),
        isAI: true,
      };
      setMessages((prev) => [...prev, aiMsg]);
    } catch (err) {
      console.error("Chat error:", err);
      const fallbackMsg = {
        id: Date.now() + 1,
        vendorId: activeChat.id,
        role: "assistant",
        sender: activeChat.isAI ? "EventMind AI" : activeChat.organization,
        text: localFallbackReply(userMsg.text),
        timestamp: new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }),
        isAI: true,
      };
      setMessages((prev) => [...prev, fallbackMsg]);
      setError("Live AI reply failed, so a contextual fallback response was shown.");
    } finally {
      setIsTyping(false);
    }
  };

  const handleNewChat = (contact) => {
    setActiveChat(contact);
    setError(null);

    // Auto-send a welcome if no messages yet for this contact
    const existing = messages.filter((m) => m.vendorId === contact.id);
    if (existing.length === 0 && contact.isAI) {
      const welcome = {
        id: Date.now(),
        vendorId: contact.id,
        role: "assistant",
        sender: "EventMind AI",
        text: eventData
          ? `Hi! I'm your EventMind AI assistant 👋\n\nI can see you're planning **${eventData.name}** — a ${eventData.type} for ${eventData.guestCount || "?"} guests in ${eventData.location || "your city"} with a budget of ₹${eventData.budgetMax || "?"}\n\nHow can I help you today? You can ask me about vendors, budget tips, timeline planning, or anything about your event!`
          : "Hi! I'm your EventMind AI assistant 👋 I'm here to help you plan your perfect event. Ask me anything about vendors, budgets, timelines, or event management!",
        timestamp: new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }),
        isAI: true,
      };
      setMessages((prev) => [...prev, welcome]);
    }
  };

  const clearChat = () => {
    if (!activeChat) return;
    setMessages((prev) => prev.filter((m) => m.vendorId !== activeChat.id));
  };

  return (
    <div>
      <div className="section-header">
        <h1 className="section-title">Messages</h1>
        <p className="section-sub">
          Chat with {role === "User" ? "vendors & your AI assistant" : "clients & AI assistant"}
        </p>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "280px 1fr",
          gap: "1.5rem",
          height: "68vh",
          alignItems: "start",
        }}
      >
        {/* ── Contacts sidebar ── */}
        <div className="card" style={{ height: "100%", overflowY: "auto", padding: "0" }}>
          <div
            style={{
              padding: "1rem",
              fontSize: "12px",
              fontFamily: "DM Mono, monospace",
              color: "var(--text3)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              borderBottom: "1px solid var(--border)",
            }}
          >
            Conversations
          </div>

          {contacts.map((c) => {
            const unread = messages.filter((m) => m.vendorId === c.id && m.role === "assistant").length;
            const lastMsg = messages.filter((m) => m.vendorId === c.id).slice(-1)[0];
            return (
              <div
                key={c.id}
                onClick={() => handleNewChat(c)}
                style={{
                  padding: "0.875rem 1rem",
                  borderBottom: "1px solid var(--border)",
                  cursor: "pointer",
                  background: activeChat?.id === c.id ? "rgba(159,133,255,0.12)" : "transparent",
                  borderLeft: activeChat?.id === c.id ? "3px solid var(--accent2)" : "3px solid transparent",
                  transition: "background 0.15s",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "2px" }}>
                  <div
                    style={{
                      width: "8px",
                      height: "8px",
                      borderRadius: "50%",
                      background: c.isAI ? "var(--accent2)" : "var(--teal)",
                      flexShrink: 0,
                    }}
                  />
                  <span style={{ fontWeight: 500, fontSize: "14px", color: "var(--text)" }}>{c.organization}</span>
                  {c.isAI && (
                    <span
                      style={{
                        fontSize: "10px",
                        background: "rgba(159,133,255,0.2)",
                        color: "var(--accent2)",
                        padding: "1px 6px",
                        borderRadius: "4px",
                        marginLeft: "auto",
                      }}
                    >
                      AI
                    </span>
                  )}
                </div>
                <div style={{ fontSize: "12px", color: "var(--text3)", paddingLeft: "1rem" }}>
                  {lastMsg ? lastMsg.text.slice(0, 45) + (lastMsg.text.length > 45 ? "…" : "") : c.category}
                </div>
              </div>
            );
          })}
        </div>

        {/* ── Chat window ── */}
        <div className="card" style={{ height: "100%", display: "flex", flexDirection: "column", padding: 0 }}>
          {activeChat ? (
            <>
              {/* Header */}
              <div
                style={{
                  padding: "0.875rem 1rem",
                  borderBottom: "1px solid var(--border)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                  <div
                    style={{
                      width: "36px",
                      height: "36px",
                      borderRadius: "50%",
                      background: activeChat.isAI
                        ? "linear-gradient(135deg, var(--accent2), var(--accent))"
                        : "linear-gradient(135deg, var(--teal), #2dd4bf)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: "16px",
                    }}
                  >
                    {activeChat.isAI ? "✦" : "◈"}
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: "14px", color: "var(--text)" }}>
                      {activeChat.organization}
                    </div>
                    <div style={{ fontSize: "11px", color: "var(--text3)" }}>
                      {activeChat.isAI ? "Powered by Gemini 2.5 Flash · Always online" : activeChat.isVendorInbox ? "Messages sent by users to your vendor profile" : activeChat.category}
                    </div>
                  </div>
                </div>
                <button
                  className="btn btn-sm btn-outline"
                  onClick={clearChat}
                  style={{ fontSize: "11px" }}
                >
                  Clear chat
                </button>
              </div>

              {/* Messages */}
              <div
                style={{
                  flex: 1,
                  overflowY: "auto",
                  padding: "1rem",
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.75rem",
                  background: "rgba(0,0,0,0.1)",
                }}
              >
                {threadMessages.length === 0 ? (
                  <div
                    style={{
                      flex: 1,
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: "0.75rem",
                      color: "var(--text3)",
                      marginTop: "3rem",
                    }}
                  >
                    <span style={{ fontSize: "2rem" }}>{activeChat.isAI ? "✦" : "💬"}</span>
                    <div style={{ fontSize: "14px", fontWeight: 500 }}>
                      {activeChat.isAI ? "Ask me anything about your event!" : `Start chatting with ${activeChat.organization}`}
                    </div>
                    {activeChat.isAI && (
                      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", justifyContent: "center", marginTop: "0.5rem" }}>
                        {["What vendors do I need?", "Give me a budget breakdown", "Create a timeline for me", "Suggest decor ideas"].map((q) => (
                          <button
                            key={q}
                            className="btn btn-sm btn-outline"
                            style={{ fontSize: "12px" }}
                            onClick={() => { setMsg(q); inputRef.current?.focus(); }}
                          >
                            {q}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  threadMessages.map((m) => (
                    <div
                      key={m.id}
                      style={{
                        alignSelf: m.role === "user" ? "flex-end" : "flex-start",
                        maxWidth: "80%",
                        display: "flex",
                        flexDirection: "column",
                        gap: "4px",
                      }}
                    >
                      {m.role !== "user" && (
                        <div style={{ fontSize: "11px", color: "var(--text3)", paddingLeft: "4px" }}>
                          {m.sender}
                        </div>
                      )}
                      <div
                        style={{
                          background:
                            m.role === "user"
                              ? "linear-gradient(135deg, var(--accent2), var(--accent))"
                              : m.isAI
                              ? "rgba(159,133,255,0.08)"
                              : "var(--bg3)",
                          border: m.role === "user" ? "none" : "1px solid var(--border)",
                          padding: "10px 14px",
                          borderRadius: m.role === "user" ? "12px 12px 4px 12px" : "4px 12px 12px 12px",
                          boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
                        }}
                      >
                        <div
                          style={{
                            fontSize: "14px",
                            color: m.role === "user" ? "#fff" : "var(--text)",
                            lineHeight: "1.5",
                            whiteSpace: "pre-wrap",
                          }}
                        >
                          {m.text}
                        </div>
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "flex-end",
                            gap: "4px",
                            fontSize: "10px",
                            color: m.role === "user" ? "rgba(255,255,255,0.6)" : "var(--text3)",
                            marginTop: "4px",
                          }}
                        >
                          <span>{m.timestamp}</span>
                          {m.sender === me && (
                            <span style={{ 
                              fontSize: "11px", 
                              color: m.status === "read" ? "var(--teal)" : "rgba(255,255,255,0.5)",
                              marginLeft: "2px",
                              lineHeight: 1
                            }}>
                              {m.status === "read" ? "✓✓" : m.status === "delivered" ? "✓✓" : "✓"}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))
                )}

                {/* Typing indicator */}
                {isTyping && (
                  <div style={{ alignSelf: "flex-start", display: "flex", alignItems: "center", gap: "8px" }}>
                    <div
                      style={{
                        background: "rgba(159,133,255,0.08)",
                        border: "1px solid var(--border)",
                        padding: "10px 14px",
                        borderRadius: "4px 12px 12px 12px",
                        display: "flex",
                        gap: "4px",
                        alignItems: "center",
                      }}
                    >
                      <div className="ai-dot" />
                      <div className="ai-dot" />
                      <div className="ai-dot" />
                    </div>
                  </div>
                )}

                {/* Error banner */}
                {error && (
                  <div style={{ padding: "8px 12px", background: "rgba(255,100,100,0.1)", border: "1px solid rgba(255,100,100,0.3)", borderRadius: "8px", fontSize: "13px", color: "var(--coral)" }}>
                    ⚠ {error}
                  </div>
                )}

                <div ref={messagesEndRef} />
              </div>

              {/* Input bar */}
              <div
                style={{
                  padding: "0.875rem 1rem",
                  borderTop: "1px solid var(--border)",
                  display: "flex",
                  gap: "0.5rem",
                  background: "var(--bg2)",
                }}
              >
                <input
                  ref={inputRef}
                  className="form-input"
                  style={{ flex: 1 }}
                  placeholder={activeChat.isAI ? "Ask me about vendors, budget, timeline…" : "Type a message…"}
                  value={msg}
                  onChange={(e) => setMsg(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && sendMessage()}
                  disabled={isTyping}
                />
                <button
                  className={`btn ${activeChat.isAI ? "btn-ai" : "btn-primary"}`}
                  onClick={sendMessage}
                  disabled={isTyping || !msg.trim()}
                  style={{ minWidth: "80px" }}
                >
                  {isTyping ? "…" : activeChat.isAI ? "✦ Ask" : "Send"}
                </button>
              </div>
            </>
          ) : (
            <div
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: "1rem",
                color: "var(--text3)",
              }}
            >
              <span style={{ fontSize: "2.5rem" }}>💬</span>
              <div style={{ fontSize: "15px", fontWeight: 500 }}>Select a conversation to start</div>
              <div style={{ fontSize: "13px", color: "var(--text3)", textAlign: "center", maxWidth: "280px" }}>
                Chat with the EventMind AI assistant or message vendors directly
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
