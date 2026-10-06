import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './theme.css';

// index.html holds an empty <div id="root">. React takes it over and draws the whole app in it.
const container = document.getElementById('root');
if (!container) throw new Error('index.html has no element with the id "root", so the page has nowhere to start.');

// StrictMode is a development aid: it makes React run each effect twice to expose code that
// does not clean up after itself. It changes nothing in the built page.
createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
