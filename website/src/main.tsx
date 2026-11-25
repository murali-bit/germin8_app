import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { ErrorBoundary } from './components/system/ErrorBoundary';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>
);

// Fade out the first-visit splash defined in index.html.
const splash = document.getElementById('splash');
if (splash) {
  window.setTimeout(() => {
    splash.classList.add('splash-out');
    window.setTimeout(() => splash.remove(), 500);
  }, 350);
}
