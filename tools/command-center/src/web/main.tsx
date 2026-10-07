import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { App } from './App';
import './theme.css';

// index.html holds an empty <div id="root">. React takes it over and draws the whole app in it.
const container = document.getElementById('root');
if (!container) throw new Error('index.html has no element with the id "root", so the page has nowhere to start.');

// StrictMode is a development aid: it makes React run each effect twice to expose code that
// does not clean up after itself. It changes nothing in the built page.
// BrowserRouter keeps the address bar and the page in step, so a link moves to another page of the
// app without loading the page again (the server answers every address with this same page).
createRoot(container).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
