import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error('ErrorBoundary caught:', error, info.componentStack); }
  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen bg-page flex items-center justify-center p-6">
          <div className="max-w-lg w-full bg-surface border border-line rounded-xl shadow-sm p-6">
            <h1 className="text-base font-semibold text-ink">Something went wrong on this page</h1>
            <p className="text-xs text-ink-muted mt-1">Try again. If it keeps happening, reload the page.</p>
            <pre className="mt-4 p-3 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-700 whitespace-pre-wrap">
              {this.state.error.toString()}
            </pre>
            <button
              onClick={() => this.setState({ error: null })}
              className="mt-4 px-4 py-2 rounded-lg bg-gold-700 hover:bg-gold-800 text-white text-sm font-semibold"
            >
              Retry
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
)
