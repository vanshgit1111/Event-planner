import { useState } from "react";

const PRIORITY_COLORS = { high: "var(--coral)", medium: "var(--gold)", low: "var(--teal)" };
const PRIORITY_BADGES = { high: "badge-coral", medium: "badge-gold", low: "badge-teal" };

export default function Timeline({ eventData, aiResults }) {
  const [checked, setChecked] = useState({});
  const [customTask, setCustomTask] = useState({ task: "", daysBeforeEvent: "", priority: "medium" });
  const [extraTasks, setExtraTasks] = useState([]);

  if (!eventData) return (
    <div className="empty">
      <div className="empty-icon">◷</div>
      <div className="empty-text">Create an event to see the timeline</div>
    </div>
  );

  const allTasks = [...(aiResults?.timeline || []), ...extraTasks];
  const eventDate = eventData.date ? new Date(eventData.date) : null;

  const getTaskDate = (days) => {
    if (!eventDate) return `${days} days before`;
    const d = new Date(eventDate);
    d.setDate(d.getDate() - days);
    return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  };

  const sorted = [...allTasks].sort((a, b) => b.daysBeforeEvent - a.daysBeforeEvent);
  const doneCount = Object.values(checked).filter(Boolean).length;
  const doneByPriority = sorted.reduce((acc, task, idx) => {
    if (checked[idx]) acc[task.priority] = (acc[task.priority] || 0) + 1;
    return acc;
  }, {});

  const addTask = () => {
    if (!customTask.task) return;
    setExtraTasks(t => [...t, { ...customTask, daysBeforeEvent: Number(customTask.daysBeforeEvent) || 0 }]);
    setCustomTask({ task: "", daysBeforeEvent: "", priority: "medium" });
  };

  return (
    <div>
      <div className="section-header">
        <div className="flex items-center gap-2 mb-1">
          <span className="badge badge-accent">Step 03</span>
          {allTasks.length > 0 && <span className="badge badge-teal">{doneCount}/{allTasks.length} done</span>}
        </div>
        <h1 className="section-title">Event timeline</h1>
        <p className="section-sub">Track every task from planning to execution</p>
      </div>

      {allTasks.length > 0 && (
        <div className="progress-bar mb-3" style={{ height: "8px" }}>
          <div className="progress-fill" style={{ width: `${allTasks.length ? Math.round((doneCount / allTasks.length) * 100) : 0}%` }} />
        </div>
      )}
      {sorted.length > 0 && (
        <div className="card mb-3 flow-card">
          <div style={{ fontSize: "12px", fontFamily: "DM Mono", color: "var(--text3)", textTransform: "uppercase", marginBottom: "0.85rem" }}>
            Timeline flow diagram
          </div>
          <div className="flow-lane">
            {sorted.map((task, i) => (
              <div key={`flow-${i}`} className={`flow-node ${checked[i] ? "done" : ""}`}>
                <div className="flow-node-head">
                  <span className={`badge ${PRIORITY_BADGES[task.priority]}`}>{task.priority}</span>
                  <span className="flow-day">{task.daysBeforeEvent === 0 ? "D-Day" : `D-${task.daysBeforeEvent}`}</span>
                </div>
                <div className="flow-title">{task.task}</div>
                <div className="flow-date">{task.daysBeforeEvent === 0 ? "Day of event" : getTaskDate(task.daysBeforeEvent)}</div>
                {i < sorted.length - 1 && <div className="flow-arrow">→</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid-2" style={{ gap: "2rem", alignItems: "start" }}>
        <div>
          {sorted.length === 0 ? (
            <div className="card" style={{ borderStyle: "dashed", textAlign: "center", padding: "2rem" }}>
              <div style={{ color: "var(--text3)", fontSize: "13px" }}>Generate AI plan to see timeline tasks</div>
            </div>
          ) : (
            sorted.map((task, i) => (
              <div key={i} className="timeline-item">
                <div className="timeline-line">
                  <div className={`timeline-dot ${checked[i] ? "done" : ""}`} style={{ borderColor: PRIORITY_COLORS[task.priority] || "var(--accent2)" }} />
                  {i < sorted.length - 1 && <div className="timeline-connector" />}
                </div>
                <div className="timeline-content">
                  <div className="flex items-center gap-2" style={{ marginBottom: "2px" }}>
                    <label className="checkbox-label">
                      <input type="checkbox" checked={!!checked[i]} onChange={e => setChecked(c => ({ ...c, [i]: e.target.checked }))} />
                      <span className="timeline-title" style={{ textDecoration: checked[i] ? "line-through" : "none", color: checked[i] ? "var(--text3)" : "var(--text)" }}>
                        {task.task}
                      </span>
                    </label>
                    <span className={`badge ${PRIORITY_BADGES[task.priority]}`}>{task.priority}</span>
                  </div>
                  <div className="timeline-date">
                    {task.daysBeforeEvent === 0 ? "Day of event" : `${getTaskDate(task.daysBeforeEvent)}`}
                    {task.daysBeforeEvent > 0 && <span style={{ color: "var(--text3)" }}> ({task.daysBeforeEvent} days before)</span>}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        <div>
          <div className="card">
            <div style={{ fontSize: "14px", fontWeight: 500, marginBottom: "1rem", color: "var(--text)" }}>Add custom task</div>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              <div className="form-group">
                <label className="form-label">Task name</label>
                <input className="form-input" placeholder="e.g. Order cake" value={customTask.task} onChange={e => setCustomTask(t => ({ ...t, task: e.target.value }))} />
              </div>
              <div className="grid-2">
                <div className="form-group">
                  <label className="form-label">Days before event</label>
                  <input type="number" className="form-input" placeholder="e.g. 10" value={customTask.daysBeforeEvent} onChange={e => setCustomTask(t => ({ ...t, daysBeforeEvent: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label className="form-label">Priority</label>
                  <select className="form-select" value={customTask.priority} onChange={e => setCustomTask(t => ({ ...t, priority: e.target.value }))}>
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                  </select>
                </div>
              </div>
              <button className="btn btn-outline btn-sm" onClick={addTask} style={{ alignSelf: "flex-end" }}>+ Add Task</button>
            </div>
          </div>

          <div className="card mt-2">
            <div style={{ fontSize: "14px", fontWeight: 500, marginBottom: "0.75rem", color: "var(--text)" }}>Progress summary</div>
            {["high", "medium", "low"].map(p => {
              const ptasks = sorted.filter(t => t.priority === p);
              return (
                <div key={p} className="flex justify-between items-center" style={{ padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
                  <span className={`badge ${PRIORITY_BADGES[p]}`}>{p}</span>
                  <span style={{ fontSize: "13px", color: "var(--text2)" }}>{doneByPriority[p] || 0}/{ptasks.length} done</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
