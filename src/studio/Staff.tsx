// Studio · Staff: people, roster import and printable activation sheets.
// Real staff can only be added after go-live (setting real_staff_allowed);
// until then imports and new people are test accounts.
import { useEffect, useMemo, useState } from 'react';
import qrcode from 'qrcode-generator';
import { supabase } from '../lib/supabase';
import { parseCsv } from '../lib/csv';
import { fmtDate, ROLES } from '../lib/types';

interface StaffRow {
  id: string; staff_number: string; first_name: string; last_initial: string; venue_id: string; role: string;
  level: number; active: boolean; is_test: boolean; test_day_offset: number; activated: boolean;
  privacy_accepted_at: string | null; code_expires_at: string | null; last_set_on: string | null;
}
interface Issued { staff_id: string; code: string; staff_number: string; expires_at: string; name: string; role?: string }

function qrSvg(text: string) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 5, margin: 2, scalable: true });
}

export default function Staff() {
  const [rows, setRows] = useState<StaffRow[]>([]);
  const [venues, setVenues] = useState<{ id: string; name: string }[]>([]);
  const [venue, setVenue] = useState('');
  const [realAllowed, setRealAllowed] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'sky' | 'blush'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState<Issued[] | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [showLeft, setShowLeft] = useState(false);
  const [form, setForm] = useState({ number: '', first: '', initial: '', role: 'server' });

  const load = async () => {
    const [s, v, r] = await Promise.all([
      supabase.rpc('list_staff'), supabase.rpc('list_venues'),
      supabase.from('settings').select('value').eq('key', 'real_staff_allowed').maybeSingle(),
    ]);
    if (s.error || v.error) { setMsg({ kind: 'blush', text: (s.error || v.error)!.message }); return; }
    setRows(s.data as StaffRow[]);
    const vs = (v.data as { id: string; name: string }[]).filter((x) => x.id !== 'demo');
    setVenues(vs);
    setVenue((cur) => cur || vs[0]?.id || '');
    setRealAllowed(r.data?.value === true);
  };
  useEffect(() => { void load(); }, []);

  const issueFor = async (ids: string[]) => {
    if (!ids.length) return;
    setBusy(true); setMsg(null);
    const { data, error } = await supabase.rpc('issue_codes', { p_staff_ids: ids });
    setBusy(false);
    if (error) { setMsg({ kind: 'blush', text: error.message }); return; }
    setSheet(data as Issued[]); setPicked([]);
    void load();
    window.scrollTo(0, 0);
  };

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setMsg(null);
    const { data, error } = await supabase.rpc('create_staff', {
      p_staff_number: form.number, p_first_name: form.first, p_last_initial: form.initial,
      p_venue_id: venue, p_role: form.role, p_is_test: true,
    });
    setBusy(false);
    if (error) { setMsg({ kind: 'blush', text: /duplicate|unique/i.test(error.message) ? 'That staff number is already used.' : error.message }); return; }
    setForm({ ...form, number: '', first: '', initial: '' });
    await issueFor([data as string]);
  };

  const setActive = async (r: StaffRow, active: boolean) => {
    const { error } = await supabase.rpc('set_staff_active', { p_staff_id: r.id, p_active: active });
    if (error) setMsg({ kind: 'blush', text: error.message }); else void load();
  };

  const shown = useMemo(() => rows.filter((r) => r.venue_id === venue && (showLeft || r.active)), [rows, venue, showLeft]);
  const notActivated = shown.filter((r) => r.active && !r.activated).map((r) => r.id);
  const venueName = (id: string) => venues.find((v) => v.id === id)?.name ?? id;

  if (sheet) return <ActivationSheet sheet={sheet} venue={venueName(venue)} onClose={() => setSheet(null)} />;

  return (
    <div className="wrap" style={{ maxWidth: 1000 }}>
      <p className="label">Staff</p>
      <h1>Staff</h1>
      <p>Add people, import the roster, and print activation codes for pre-shift. Test accounts never count in a venue's figures.</p>
      {!realAllowed && <p className="note cream">Before go-live, imports and new people are <strong>test accounts</strong>. Real staff can be added once the final privacy notice and the paid backup plan are in place (setting "real staff allowed").</p>}
      {msg && <p className={'note ' + msg.kind}>{msg.text}</p>}
      {venues.length > 1 && (
        <label className="inline" style={{ marginBottom: 12 }}><span className="label">Venue</span>
          <select value={venue} onChange={(e) => setVenue(e.target.value)}>{venues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select>
        </label>
      )}

      <div className="panel scroll-x">
        <div className="actions" style={{ justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0 }}>People at {venueName(venue)}</h3>
          <span className="actions">
            <label className="check"><input type="checkbox" checked={showLeft} onChange={(e) => setShowLeft(e.target.checked)} /> Show people who have left</label>
            {notActivated.length > 0 && <button className="small outline" disabled={busy} onClick={() => void issueFor(notActivated)}>Codes for everyone not activated ({notActivated.length})</button>}
            <button className="small" disabled={busy || !picked.length} onClick={() => void issueFor(picked)}>Print codes for selected ({picked.length})</button>
          </span>
        </div>
        {shown.length === 0 ? <p className="muted">No one here yet.</p> : (
          <table style={{ marginTop: 12 }}>
            <thead><tr>
              <th><input type="checkbox" aria-label="Select all" checked={picked.length > 0 && picked.length === shown.filter((r) => r.active).length}
                onChange={(e) => setPicked(e.target.checked ? shown.filter((r) => r.active).map((r) => r.id) : [])} /></th>
              <th>Name</th><th>Staff no.</th><th>Role</th><th>Status</th><th>Last set</th><th></th></tr></thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id} style={{ opacity: r.active ? 1 : 0.55 }}>
                  <td>{r.active && <input type="checkbox" aria-label={`Select ${r.first_name}`} checked={picked.includes(r.id)}
                    onChange={() => setPicked(picked.includes(r.id) ? picked.filter((x) => x !== r.id) : [...picked, r.id])} />}</td>
                  <td>{r.first_name} {r.last_initial}. {r.is_test && <span className="tag">Test</span>}</td>
                  <td>{r.staff_number}</td>
                  <td>{r.role}</td>
                  <td>
                    {!r.active ? 'Left' : r.activated ? 'Activated' : r.code_expires_at ? `Code valid until ${fmtDate(r.code_expires_at)}` : 'Needs a code'}
                    {r.is_test && r.test_day_offset > 0 && <div className="note-s">Date +{r.test_day_offset} days</div>}
                  </td>
                  <td>{r.last_set_on ?? ''}</td>
                  <td className="actions">
                    {r.active && <button className="small outline" disabled={busy} onClick={() => void issueFor([r.id])}>{r.activated ? 'Reset PIN' : 'New code'}</button>}
                    <button className="small text" onClick={() => void setActive(r, !r.active)}>{r.active ? 'Mark as left' : 'Bring back'}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="note-s">A new code replaces the old one, which stops working. Codes work once and last 7 days. "Reset PIN" gives the person a new code to choose a new PIN.</p>
      </div>

      <RosterImport venue={venue} venueName={venueName(venue)} realAllowed={realAllowed} onDone={(t) => { setMsg({ kind: 'sky', text: t }); void load(); }} />

      <form className="panel" onSubmit={add}>
        <h3>Add a test account</h3>
        <div className="row">
          <label className="field"><span className="label">Staff number</span>
            <input value={form.number} onChange={(e) => setForm({ ...form, number: e.target.value.toUpperCase() })} placeholder="T001" required maxLength={16} /></label>
          <label className="field"><span className="label">First name</span>
            <input value={form.first} onChange={(e) => setForm({ ...form, first: e.target.value })} required maxLength={40} /></label>
          <label className="field"><span className="label">Last initial</span>
            <input value={form.initial} onChange={(e) => setForm({ ...form, initial: e.target.value.slice(0, 1) })} required maxLength={1} /></label>
          <label className="field"><span className="label">Role</span>
            <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>{ROLES.map((r) => <option key={r} value={r}>{r}</option>)}</select></label>
        </div>
        <button disabled={busy}>{busy ? 'Adding…' : 'Add and issue a code'}</button>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Roster import: reads a CSV on this computer; only staff number, first name,
// the first letter of the last name, role and start month are sent.
// ---------------------------------------------------------------------------
const ROLE_WORDS: [RegExp, string][] = [
  [/barista|coffee/, 'barista'],
  [/bar ?tender|barman|bar ?back|mixolog|^bar\b|bar staff/, 'bar'],
  [/runner|busser|bus ?boy|food ?runner/, 'runner'],
  [/host|reception|guest relation/, 'host'],
  [/server|waiter|waitress|wait ?staff|captain|steward|f ?& ?b ?attendant|fb attendant/, 'server'],
];
const mapRole = (v: string) => { const s = v.toLowerCase().trim(); return ROLE_WORDS.find(([re]) => re.test(s))?.[1] ?? ''; };
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
function toMonth(v: string): string {
  const s = v.trim();
  let m = s.match(/^(\d{4})[-/.](\d{1,2})/); if (m) return `${m[1]}-${m[2].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/); if (m) return `${m[3]}-${m[2].padStart(2, '0')}`;          // day/month/year
  m = s.match(/^(\d{1,2})[- ]([A-Za-z]{3})[A-Za-z]*[- ,]*(\d{4})/);
  if (m && MONTHS.includes(m[2].toLowerCase())) return `${m[3]}-${String(MONTHS.indexOf(m[2].toLowerCase()) + 1).padStart(2, '0')}`;
  return '';
}
type Field = 'staff_number' | 'first_name' | 'last_name' | 'full_name' | 'role' | 'start';
const GUESS: [Field, RegExp][] = [
  ['staff_number', /(employee|emp|staff|micros).{0,3}(no|num|number|id|code)|^id$|^emp ?id$/i],
  ['first_name', /first.?name|given/i],
  ['last_name', /last.?name|surname|family/i],
  ['full_name', /^(full.?)?name$|employee.?name|staff.?name/i],
  ['role', /role|position|job|designation|title/i],
  ['start', /start|join|hire|doj/i],
];
const FIELD_LABEL: Record<Field, string> = {
  staff_number: 'Staff number', first_name: 'First name', last_name: 'Last name', full_name: 'Full name (if no first/last)',
  role: 'Role', start: 'Start date',
};

function RosterImport({ venue, venueName, realAllowed, onDone }: { venue: string; venueName: string; realAllowed: boolean; onDone: (t: string) => void }) {
  const [table, setTable] = useState<string[][] | null>(null);
  const [cols, setCols] = useState<Record<Field, number>>({ staff_number: -1, first_name: -1, last_name: -1, full_name: -1, role: -1, start: -1 });
  const [roles, setRoles] = useState<Record<number, string>>({});
  const [asTest, setAsTest] = useState(true);
  const [markLeft, setMarkLeft] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ kind: 'sky' | 'blush'; text: string; problems?: { row: number; reason: string }[] } | null>(null);

  const read = async (f: File) => {
    setResult(null);
    const t = parseCsv(await f.text()).filter((r) => r.some((c) => c.trim()));
    if (t.length < 2) { setResult({ kind: 'blush', text: 'No rows found. Save the roster as CSV and try again.' }); return; }
    const head = t[0].map((h) => h.trim());
    const next = { staff_number: -1, first_name: -1, last_name: -1, full_name: -1, role: -1, start: -1 } as Record<Field, number>;
    GUESS.forEach(([field, re]) => { next[field] = head.findIndex((h, i) => re.test(h) && !Object.values(next).includes(i)); });
    setCols(next); setTable(t); setRoles({}); setAsTest(true);
  };

  const people = useMemo(() => {
    if (!table) return [];
    return table.slice(1).map((r, i) => {
      const get = (f: Field) => (cols[f] >= 0 ? (r[cols[f]] ?? '').trim() : '');
      let first = get('first_name'); let last = get('last_name');
      if ((!first || !last) && get('full_name')) {
        const parts = get('full_name').split(/\s+/).filter(Boolean);
        first = first || parts[0] || ''; last = last || (parts.length > 1 ? parts[parts.length - 1] : '');
      }
      const role = roles[i] ?? mapRole(get('role'));
      return { i, staff_number: get('staff_number'), first_name: first, last_initial: last.slice(0, 1).toUpperCase(),
               role, raw_role: get('role'), start_month: toMonth(get('start')) };
    });
  }, [table, cols, roles]);
  const ready = people.filter((p) => p.staff_number && p.first_name && p.last_initial && p.role);

  const run = async () => {
    setBusy(true); setResult(null);
    const { data, error } = await supabase.rpc('import_staff', {
      p_venue: venue, p_as_test: asTest, p_deactivate_missing: markLeft,
      p_rows: people.map((p) => ({ staff_number: p.staff_number, first_name: p.first_name, last_initial: p.last_initial, role: p.role, start_month: p.start_month })),
    });
    setBusy(false);
    if (error) { setResult({ kind: 'blush', text: error.message }); return; }
    const d = data as { added: number; updated: number; unchanged: number; marked_left: number; problems: { row: number; reason: string }[] };
    const text = `Imported to ${venueName}: ${d.added} added, ${d.updated} updated, ${d.unchanged} unchanged${d.marked_left ? `, ${d.marked_left} marked as left` : ''}.`;
    if (d.problems.length) setResult({ kind: 'blush', text: text + ` ${d.problems.length} row(s) need fixing in the file:`, problems: d.problems });
    else { setTable(null); onDone(text + ' Next: print their activation codes.'); }
  };

  return (
    <div className="panel">
      <h3>Import the roster</h3>
      <p className="info">Choose a CSV export of the roster (for example from Bayzat). It's read on this computer: only the staff number, first name, first letter of the last name, role and start month are sent. Nothing else in the file is stored.</p>
      <input type="file" accept=".csv,text/csv" onChange={(e) => e.target.files?.[0] && void read(e.target.files[0])} />
      {result && <div className={'note ' + result.kind} style={{ marginTop: 12 }}>{result.text}
        {result.problems && <ul>{result.problems.slice(0, 30).map((p) => <li key={p.row}>Row {p.row + 1}: {p.reason}</li>)}</ul>}</div>}
      {table && (
        <>
          <div className="row" style={{ marginTop: 12 }}>
            {(Object.keys(FIELD_LABEL) as Field[]).map((f) => (
              <label key={f} className="field"><span className="label">{FIELD_LABEL[f]}</span>
                <select value={cols[f]} onChange={(e) => setCols({ ...cols, [f]: Number(e.target.value) })}>
                  <option value={-1}>(none)</option>
                  {table[0].map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
                </select></label>
            ))}
          </div>
          <div className="scroll-x" style={{ maxHeight: 360, overflowY: 'auto', border: '1px solid var(--line)' }}>
            <table>
              <thead><tr><th>Row</th><th>Staff no.</th><th>First name</th><th>Initial</th><th>Role</th><th>Start</th></tr></thead>
              <tbody>{people.map((p) => (
                <tr key={p.i} style={{ background: p.staff_number && p.first_name && p.last_initial && p.role ? undefined : 'var(--blush)' }}>
                  <td className="note-s">{p.i + 2}</td><td>{p.staff_number || '–'}</td><td>{p.first_name || '–'}</td><td>{p.last_initial || '–'}</td>
                  <td>
                    <select value={p.role} onChange={(e) => setRoles({ ...roles, [p.i]: e.target.value })} aria-label={`Role for row ${p.i + 2}`} style={{ minHeight: 36, padding: '4px 8px' }}>
                      <option value="">{p.raw_role ? `"${p.raw_role}": pick a role` : 'Pick a role'}</option>
                      {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </td>
                  <td>{p.start_month || ''}</td>
                </tr>))}</tbody>
            </table>
          </div>
          <p className="info">{ready.length} of {people.length} rows ready. Rows in pink need a staff number, name or role; they'll be skipped and listed.</p>
          <label className="check"><input type="checkbox" checked={asTest || !realAllowed} disabled={!realAllowed} onChange={(e) => setAsTest(e.target.checked)} /> Import as test accounts{!realAllowed && ' (until go-live)'}</label><br />
          <label className="check"><input type="checkbox" checked={markLeft} onChange={(e) => setMarkLeft(e.target.checked)} /> Mark people at {venueName} who aren't in this file as left</label>
          <div className="actions" style={{ marginTop: 12 }}>
            <button disabled={busy || ready.length === 0} onClick={() => void run()}>{busy ? 'Importing…' : `Import ${ready.length} people`}</button>
            <button className="text" onClick={() => setTable(null)}>Cancel</button>
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Printable activation sheet: one card per person, with the code and a QR code.
// ---------------------------------------------------------------------------
function ActivationSheet({ sheet, venue, onClose }: { sheet: Issued[]; venue: string; onClose: () => void }) {
  return (
    <div className="wrap" style={{ maxWidth: 1000 }}>
      <div className="no-print">
        <p className="label">Staff</p>
        <h1>Activation codes</h1>
        <p>{sheet.length} {sheet.length === 1 ? 'code' : 'codes'} ready. They're shown only now: print the sheet, cut out the cards and hand them out at pre-shift. If one is lost, issue a new code (the old one stops working).</p>
        <div className="actions" style={{ marginBottom: 16 }}>
          <button onClick={() => window.print()}>Print</button>
          <button className="outline" onClick={onClose}>Done</button>
        </div>
      </div>
      <div className="sheet print-area">
        {sheet.map((c) => (
          <div key={c.staff_id} className="act-card">
            <div className="act-top"><span className="label">Maison Academy · {venue}</span></div>
            <div className="act-body">
              <div className="qr" dangerouslySetInnerHTML={{ __html: qrSvg(`${location.origin}/activate?code=${c.code}`) }} />
              <div>
                <div className="act-name">{c.name}</div>
                <div className="note-s">Staff number <strong>{c.staff_number}</strong></div>
                <div className="code">{c.code}</div>
                <div className="note-s">Scan with your phone camera, or open {location.host}/activate and type the code. Then choose a 6-digit PIN. Works once, until {fmtDate(c.expires_at)}.</div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
