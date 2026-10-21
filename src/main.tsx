// Copyright © 2026 Creneau Hospitality. All rights reserved. Proprietary and confidential.
import React from 'react';
import ReactDOM from 'react-dom/client';
import './styles.css';
import App from './App';
import { installErrorLog } from './lib/errors';
import { supabase } from './lib/supabase';
import { staffDb } from './staff/api';

installErrorLog(location.pathname.startsWith('/studio') ? 'studio' : 'staff',
  () => (location.pathname.startsWith('/studio') ? supabase : staffDb));

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// Installable app: cache the app's own files so it opens on low signal.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => {}); });
}
