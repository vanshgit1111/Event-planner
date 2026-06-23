import { Component } from 'react';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("ErrorBoundary caught an error:", error, errorInfo);
    this.setState({ errorInfo });
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "80vh",
          padding: "2rem",
          textAlign: "center",
          color: "var(--text)"
        }}>
          <div style={{
            background: "rgba(255, 100, 100, 0.08)",
            border: "1px solid rgba(255, 100, 100, 0.2)",
            borderRadius: "16px",
            padding: "2.5rem 2rem",
            maxWidth: "600px",
            boxShadow: "0 8px 32px rgba(0, 0, 0, 0.3)"
          }}>
            <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>⚠️</div>
            <h2 style={{ fontSize: "1.5rem", fontWeight: 600, marginBottom: "0.5rem" }}>Something went wrong</h2>
            <p style={{ color: "var(--text3)", fontSize: "14px", marginBottom: "1.5rem" }}>
              An error occurred while rendering this view. Try reloading or resetting the application state.
            </p>
            <div style={{
              background: "rgba(0, 0, 0, 0.3)",
              border: "1px solid var(--border)",
              borderRadius: "8px",
              padding: "1rem",
              textAlign: "left",
              fontFamily: "DM Mono, monospace",
              fontSize: "12px",
              color: "var(--coral)",
              overflowX: "auto",
              marginBottom: "1.5rem",
              maxHeight: "150px"
            }}>
              {this.state.error && this.state.error.toString()}
            </div>
            <div style={{ display: "flex", gap: "1rem", justifyContent: "center" }}>
              <button className="btn btn-primary" onClick={this.handleReset}>
                Reload Page
              </button>
              <button className="btn btn-outline" onClick={() => this.setState({ hasError: false })}>
                Try Again
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
