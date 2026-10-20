// Studio · Staff: test accounts and activation codes (Phase 2).
// Real staff arrive in Phase 4 by importing the roster; until then only test
// accounts can be created here.
import { useEffect, useState } from 'react';
import qrcode from 'qrcode-generator';
import { supabase } from '../lib/supabase';
import { fmtDate, ROLES } from '../lib/types';

interface StaffRow {
  id: string; staff_number: string; first_name: string; last_initial: string; venue_id: string; role: string;
  level: number; active: boolean; is_test: boolean; test_day_offset: number; activated: boolean;
  privacy_accepted_at: string | null; code_expires_at: string | null; last_set_on: string | null;
}
interface Issued { code: string; staff_number: string; expires_at: string; name: string }

function qrSvg(text: string) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 5, margin: 2, scalable: true });
}

export default function Staff() {
  const [rows, setRows] = useState<StaffRow[]>([]);
  const [venues, setVenues] = useState<{ id: string; name: string }[]>([]);
  const [msg, setMsg] = useState<{ kind: 'sky' | 'blush'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState<Issued | null>(null);
  const [form, setForm] = useState({ number: '', first: '', initial: '', venue: '', role: 'server' });

  const load = async () => {
    const [s, v] = await Promise.all([supabase.rpc('list_staff'), supabase.rpc('list_venues')]);
    if (s.error || v.error) { setMsg({ kind: 'blush', text: (s.error || v.error)!.message }); return; }
    setRows(s.data as StaffRow[]);
    setVenues(v.data as { id: string; name: string }[]);
    setForm((f) => ({ ...f, venue: f.venue || (v.data as { id: string }[])[0]?.id || '' }));
  };
  useEffect(() => { void load(); }, []);

  const issue = async (r: Pick<StaffRow, 'id' | 'first_name' | 'last_initial'>) => {
    setBusy(true); setMsg(null);
    const { data, error } = await supabase.rpc('issue_activation_code', { p_staff_id: r.id });
    setBusy(false);
    if (error) { setMsg({ kind: 'blush', text: error.message }); return; }
    setIssued({ ...(data as Omit<Issued, 'name'>), name: `${r.first_name} ${r.last_initial}.` });
    void load();
  };

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setMsg(null);
    const { data, error } = await supabase.rpc('create_staff', {
      p_staff_number: form.number, p_first_name: form.first, p_last_initial: form.initial,
      p_venue_id: form.venue, p_role: form.role, p_is_test: true,
    });
    setBusy(false);
    if (error) {
      setMsg({ kind: 'blush', text: /duplicate|unique/i.test(error.message) ? 'That staff number is already used.' : error.message });
      return;
    }
    const added = { id: data as string, first_name: form.first.trim(), last_initial: form.initial.trim().toUpperCase().slice(0, 1) };
    setForm({ ...form, number: '', first: '', initial: '' });
    await issue(added);
  };

  const setActive = async (r: StaffRow, active: boolean) => {
    const { error } = await supabase.rpc('set_staff_active', { p_staff_id: r.id, p_active: active });
    if (error) setMsg({ kind: 'blush', text: error.message }); else void load();
  };

  const link = issued ? `${location.origin}/activate?code=${issued.code}` : '';
  const venueName = (id: string) => venues.find((v) => v.id === id)?.name ?? id;

  return (
    <div className="wrap" style={{ maxWidth: 960 }}>
      <p className="label">Staff</p>
      <h1>Staff and test accounts</h1>
      <p>Test accounts let you try the staff app and move the date forward to watch the spacing work. They never count in a venue's figures. Real staff are added in Phase 4, from the roster.</p>
      {msg && <p className={'note ' + msg.kind}>{msg.text}</p>}

      {issued && (
        <div className="panel activation-card">
          <div className="no-print actions" style={{ justifyContent: 'space-between' }}>
            <h3 style={{ margin: 0 }}>Activation code</h3>
            <span className="actions">
              <button className="small" onClick={() => window.print()}>Print</button>
              <button className="small outline" onClick={() => setIssued(null)}>Close</button>
            </span>
          </div>
          <div className="print-area">
            <p className="label">Maison Academy</p>
            <h2>{issued.name}</h2>
            <p>Staff number <strong>{issued.staff_number}</strong></p>
            <div className="qr" dangerouslySetInnerHTML={{ __html: qrSvg(link) }} />
            <p className="code">{issued.code}</p>
            <p className="info">Scan the code with your phone's camera, or open {location.host}/activate and type the code. It works once and expires {fmtDate(issued.expires_at)}.</p>
          </div>
          <p className="info no-print">This code is shown only now. If it's lost, issue a new one: the old one stops working.</p>
        </div>
      )}

      <form className="panel" onSubmit={add}>
        <h3>Add a test account</h3>
        <div className="row">
          <label className="field"><span className="label">Staff number</span>
            <input value={form.number} onChange={(e) => setForm({ ...form, number: e.target.value.toUpperCase() })} placeholder="T001" required maxLength={16} />
          </label>
          <label className="field"><span className="label">First name</span>
            <input value={form.first} onChange={(e) => setForm({ ...form, first: e.target.value })} required maxLength={40} />
          </label>
          <label className="field"><span className="label">Last initial</span>
            <input value={form.initial} onChange={(e) => setForm({ ...form, initial: e.target.value.slice(0, 1) })} required maxLength={1} />
          </label>
        </div>
        <div className="row">
          <label className="field"><span className="label">Venue</span>
            <select value={form.venue} onChange={(e) => setForm({ ...form, venue: e.target.value })}>
              {venues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </label>
          <label className="field"><span className="label">Role</span>
            <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
        </div>
        <button disabled={busy}>{busy ? 'Adding…' : 'Add and issue a code'}</button>
      </form>

      <div className="panel scroll-x">
        <h3>Accounts</h3>
        {rows.length === 0 ? <p className="muted">No accounts yet.</p> : (
          <table>
            <thead><tr><th>Name</th><th>Staff no.</th><th>Venue · role</th><th>Status</th><th>Last set</th><th></th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.first_name} {r.last_initial}. {r.is_test && <span className="tag">Test</span>}</td>
                  <td>{r.staff_number}</td>
                  <td>{venueName(r.venue_id)} · {r.role}</td>
                  <td>
                    {!r.active ? 'Inactive' : r.activated ? 'Activated' : r.code_expires_at ? `Code valid until ${fmtDate(r.code_expires_at)}` : 'Needs a code'}
                    {r.is_test && r.test_day_offset > 0 && <div className="info">Date +{r.test_day_offset} days</div>}
                  </td>
                  <td>{r.last_set_on ?? ''}</td>
                  <td className="actions">
                    {r.active && <button className="small outline" disabled={busy} onClick={() => void issue(r)}>{r.activated ? 'Reset PIN' : 'New code'}</button>}
                    <button className="small text" onClick={() => void setActive(r, !r.active)}>{r.active ? 'Deactivate' : 'Reactivate'}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
