import { useState } from 'react';
import type { ChangeEvent } from 'react';
import * as api from '../api/client';
import type { RosterEntryView, AccessRequestView, RosterImportReport } from '../api/client';
import { backendMode } from '../storage/backend';
import { useAsyncValue } from '../useAsyncValue';

/**
 * Roster + accounts, the instructor's half of the sign-in system:
 *
 *   · import the class CSV (paste it or pick the file) — upsert only, so a
 *     mid-quarter re-import never removes anyone or resets a password
 *   · see who has created an account and who hasn't
 *   · reset a forgotten password (clears it; the student registers again)
 *   · add or remove one person
 *   · approve or reject "my email isn't on the roster" requests
 *
 * Remote mode only: local mode has no server to hold a roster, and its two toy
 * accounts are a hardcoded mockup (see auth/accounts.ts).
 */
export function RosterView() {
  if (backendMode !== 'remote') {
    return (
      <div className="instructor-dashboard">
        <h2 className="instructor-page-title">Roster</h2>
        <p className="instructor-empty">
          The roster lives on the server. This build runs in local mode, where the two demo
          accounts are built in — there is nothing to manage here.
        </p>
      </div>
    );
  }
  return <RemoteRosterView />;
}

function RemoteRosterView() {
  const {
    value: roster,
    loading,
    error,
    reload: reloadRoster,
  } = useAsyncValue(() => api.getRoster(), []);
  const { value: requests, reload: reloadRequests } = useAsyncValue(
    () => api.listAccessRequests('pending'),
    [],
  );
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  const run = async (action: () => Promise<string>) => {
    setBusy(true);
    setNotice(null);
    try {
      setNotice(await action());
    } catch (e) {
      setNotice(e instanceof api.ApiError ? `Failed: ${e.message}` : 'Failed: the server could not be reached.');
    } finally {
      setBusy(false);
      reloadRoster();
      reloadRequests();
    }
  };

  const rows = (roster ?? []).filter((r) => {
    const q = filter.trim().toLowerCase();
    if (!q) return true;
    return (
      r.email.includes(q) || r.name.toLowerCase().includes(q) || r.studentId.includes(q)
    );
  });
  const registered = (roster ?? []).filter((r) => r.registered).length;

  return (
    <div className="instructor-dashboard">
      <div className="instructor-page-head">
        <h2 className="instructor-page-title">Roster &amp; accounts</h2>
        <div className="instructor-head-actions">
          <input
            className="roster-filter"
            placeholder="Filter by name, email, ID"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
      </div>

      {notice && <p className="roster-notice">{notice}</p>}

      <ImportPanel busy={busy} onImport={run} />

      {(requests?.length ?? 0) > 0 && (
        <AccessRequestsPanel requests={requests ?? []} busy={busy} onAction={run} />
      )}

      <section className="roster-section">
        <h2 className="instructor-section-title">
          {roster ? `${roster.length} on the roster · ${registered} have created an account` : 'Roster'}
        </h2>
        {loading && !roster && <p className="instructor-empty">Loading…</p>}
        {error && <p className="instructor-empty">Could not load the roster.</p>}
        {roster && rows.length === 0 && (
          <p className="instructor-empty">
            {roster.length === 0 ? 'Nobody on the roster yet — import the class CSV above.' : 'No matches.'}
          </p>
        )}
        {rows.length > 0 && (
          <table className="instructor-table roster-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Student ID</th>
                <th>Role</th>
                <th>Account</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <RosterRow key={row.email} row={row} busy={busy} onAction={run} />
              ))}
            </tbody>
          </table>
        )}
      </section>

      <AddPersonPanel busy={busy} onAdd={run} />
    </div>
  );
}

function RosterRow({
  row,
  busy,
  onAction,
}: {
  row: RosterEntryView;
  busy: boolean;
  onAction: (action: () => Promise<string>) => void;
}) {
  return (
    <tr>
      <td>{row.name}</td>
      <td className="roster-email">{row.email}</td>
      <td>{row.studentId || '—'}</td>
      <td>{row.role === 'instructor' ? 'Instructor' : 'Student'}</td>
      <td>
        <span className={`roster-state roster-state--${row.registered ? 'yes' : 'no'}`}>
          {row.registered ? 'Created' : 'Not yet'}
        </span>
      </td>
      <td className="roster-actions">
        {row.registered && (
          <button
            className="instructor-btn"
            disabled={busy}
            onClick={() =>
              confirm(
                `Reset the password for ${row.email}?\n\n` +
                  'Their password is cleared and they are signed out everywhere. ' +
                  'They create their account again with the same email; their work is untouched.',
              ) &&
              onAction(async () => {
                await api.resetRosterPassword(row.email);
                return `Password reset for ${row.email} — they can create their account again.`;
              })
            }
          >
            Reset password
          </button>
        )}
        <button
          className="instructor-btn"
          disabled={busy}
          onClick={() =>
            confirm(
              `Remove ${row.email} from the roster?\n\n` +
                'They lose access immediately. Any work they already submitted is kept.',
            ) &&
            onAction(async () => {
              await api.removeRosterEntry(row.email);
              return `Removed ${row.email}.`;
            })
          }
        >
          Remove
        </button>
      </td>
    </tr>
  );
}

function ImportPanel({
  busy,
  onImport,
}: {
  busy: boolean;
  onImport: (action: () => Promise<string>) => void;
}) {
  const [csv, setCsv] = useState('');
  const [role, setRole] = useState<'student' | 'instructor'>('student');
  const [report, setReport] = useState<RosterImportReport | null>(null);

  const handleFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    void file.text().then(setCsv);
    e.target.value = '';
  };

  const submit = () =>
    onImport(async () => {
      const result = await api.importRoster(csv, role);
      setReport(result);
      setCsv('');
      return `Imported ${result.total} row(s): ${result.added} added, ${result.updated} updated.`;
    });

  return (
    <section className="roster-section">
      <h2 className="instructor-section-title">Import a roster CSV</h2>
      <p className="instructor-hint">
        Any export with an email column works — name, student ID and role are picked up when
        present. Importing only adds and updates: nobody is removed, and nobody's password is
        touched, so a mid-quarter re-import is safe.
      </p>
      <div className="roster-import-controls">
        <input type="file" accept=".csv,text/csv" onChange={handleFile} disabled={busy} />
        <label className="roster-role">
          Rows with no role are:
          <select value={role} onChange={(e) => setRole(e.target.value as 'student' | 'instructor')}>
            <option value="student">Students</option>
            <option value="instructor">Instructors</option>
          </select>
        </label>
      </div>
      <textarea
        className="roster-csv"
        rows={5}
        placeholder={'Email,Name,Student ID\njane@ucla.edu,Jane Doe,004123456'}
        value={csv}
        onChange={(e) => setCsv(e.target.value)}
        disabled={busy}
      />
      <button className="instructor-btn instructor-btn--primary" disabled={busy || csv.trim() === ''} onClick={submit}>
        Import
      </button>
      {report && (
        <div className="roster-report">
          <p>
            Columns used — email: {report.columns.email ?? '(none)'} · name:{' '}
            {report.columns.name ?? '(none)'} · ID: {report.columns.studentId ?? '(none)'} · role:{' '}
            {report.columns.role ?? '(none)'}
          </p>
          {report.issues.length > 0 && (
            <ul className="roster-issues">
              {report.issues.map((issue, i) => (
                <li key={i}>
                  Line {issue.line}: {issue.reason}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

function AccessRequestsPanel({
  requests,
  busy,
  onAction,
}: {
  requests: AccessRequestView[];
  busy: boolean;
  onAction: (action: () => Promise<string>) => void;
}) {
  return (
    <section className="roster-section">
      <h2 className="instructor-section-title">
        Access requests ({requests.length} waiting)
      </h2>
      <p className="instructor-hint">
        People who asked to be added under an email the roster doesn't have. Approving adds them —
        they then create their account the same way everyone else does.
      </p>
      <table className="instructor-table roster-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Student ID</th>
            <th>Message</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {requests.map((req) => (
            <tr key={req.id}>
              <td>{req.name}</td>
              <td className="roster-email">{req.email}</td>
              <td>{req.studentId || '—'}</td>
              <td className="roster-message">{req.message || '—'}</td>
              <td className="roster-actions">
                <button
                  className="instructor-btn"
                  disabled={busy}
                  onClick={() =>
                    onAction(async () => {
                      await api.approveAccessRequest(req.id, 'student');
                      return `${req.email} added to the roster.`;
                    })
                  }
                >
                  Approve
                </button>
                <button
                  className="instructor-btn"
                  disabled={busy}
                  onClick={() =>
                    onAction(async () => {
                      await api.rejectAccessRequest(req.id);
                      return `Rejected the request from ${req.email}.`;
                    })
                  }
                >
                  Reject
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function AddPersonPanel({
  busy,
  onAdd,
}: {
  busy: boolean;
  onAdd: (action: () => Promise<string>) => void;
}) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [studentId, setStudentId] = useState('');
  const [role, setRole] = useState<'student' | 'instructor'>('student');

  const submit = () =>
    onAdd(async () => {
      await api.addRosterEntry({
        email: email.trim(),
        name: name.trim() || undefined,
        studentId: studentId.trim() || undefined,
        role,
      });
      const added = email.trim();
      setEmail('');
      setName('');
      setStudentId('');
      return `${added} is on the roster — they can now create their account.`;
    });

  return (
    <section className="roster-section">
      <h2 className="instructor-section-title">Add one person</h2>
      <div className="roster-add">
        <input
          className="login-email"
          type="email"
          placeholder="email@ucla.edu"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={busy}
        />
        <input
          className="login-email"
          type="text"
          placeholder="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={busy}
        />
        <input
          className="login-email"
          type="text"
          placeholder="Student ID"
          value={studentId}
          onChange={(e) => setStudentId(e.target.value)}
          disabled={busy}
        />
        <select value={role} onChange={(e) => setRole(e.target.value as 'student' | 'instructor')}>
          <option value="student">Student</option>
          <option value="instructor">Instructor</option>
        </select>
        <button className="instructor-btn instructor-btn--primary" disabled={busy || email.trim() === ''} onClick={submit}>
          Add
        </button>
      </div>
    </section>
  );
}
