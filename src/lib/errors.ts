// Basic error logging (brief section 15, Phase 4): unexpected errors in the
// apps are written to the client_errors table, at most 30 an hour per person.
// Only the page address (without its query), the message and the browser.
import type { SupabaseClient } from '@supabase/supabase-js';

export function installErrorLog(app: 'staff' | 'studio', client: () => SupabaseClient) {
  let sent = 0;
  const send = (message: string, detail: string) => {
    if (sent++ > 20) return;
    void client().rpc('log_client_error', {
      p_app: app, p_message: message.slice(0, 500), p_detail: detail.slice(0, 2000),
      p_url: location.origin + location.pathname, p_user_agent: navigator.userAgent,
    }).then(() => {}, () => {});
  };
  window.addEventListener('error', (e) => send(String(e.message || 'Error'), String(e.error?.stack || `${e.filename}:${e.lineno}`)));
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason as { message?: string; stack?: string } | undefined;
    if (r?.message && /Failed to fetch|NetworkError|Load failed|offline/i.test(r.message)) return; // signal drops aren't app errors
    send(String(r?.message || r || 'Unhandled rejection'), String(r?.stack || ''));
  });
}
