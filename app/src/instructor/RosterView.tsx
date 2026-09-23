import { useState } from 'react';
import type { ChangeEvent } from 'react';
import * as api from '../api/client';
import type { RosterEntryView, AccessRequestView, RosterImportReport } from '../api/client';
import { backendMode } from '../storage/backend';
import { useAsyncValue } from '../useAsyncValue';
import { NO_LONGER_LISTED_TEXT, sentenceCase, skippedLinesText, statusCountText } from './rosterReportText';

/**
 * Roster + accounts, the instructor's half of the sign-in system:
 *
 *   · import the class CSV (paste it or pick the file; the registrar's export
 *     as-is) — upsert only, so a mid-quarter re-import never removes anyone or
 *     resets a password; who the class list no longer carries is listed for
 *     review instead
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
        <h1>Roster</h1>
        <p className="mm-empty">
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
      r.email.includes(q) ||
      r.name.toLowerCase().includes(q) ||
      r.studentId.includes(q) ||
      (r.section ?? '').toLowerCase().includes(q)
    );
  });
  const registered = (roster ?? []).filter((r) => r.registered).length;

  return (
    <div className="instructor-dashboard">
      <div className="mm-head mm-head--row">
        <h1>Roster &amp; accounts</h1>
        <div className="mm-actions">
          <input
            className="mm-input roster-filter"
            placeholder="Filter by name, email, ID, section"
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
        <h2>
          {roster ? `${roster.length} on the roster · ${registered} have created an account` : 'Roster'}
        </h2>
        {loading && !roster && <p className="mm-empty">Loading…</p>}
        {error && <p className="mm-empty">Could not load the roster.</p>}
        {roster && rows.length === 0 && (
          <p className="mm-empty">
            {roster.length === 0 ? 'Nobody on the roster yet — import the class CSV above.' : 'No matches.'}
          </p>
        )}
        {rows.length > 0 && (
          <div className="instructor-table-scroll">
            <table className="mm-table roster-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Student ID</th>
                  <th>Section</th>
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
          </div>
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
      <td>{row.section ?? '—'}</td>
      <td>{row.role === 'instructor' ? 'Instructor' : 'Student'}</td>
      <td>
        <span className={`roster-state roster-state--${row.registered ? 'yes' : 'no'}`}>
          {row.registered ? 'Created' : 'Not yet'}
        </span>
      </td>
      <td className="roster-actions">
        {row.registered && (
          <button
            className="mm-btn"
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
          className="mm-btn"
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
      const skipped = result.statusCounts
        .filter((s) => !s.imported)
        .map((s) => `; ${statusCountText(s)}`)
        .join('');
      return `Imported ${result.total}: ${result.added} added, ${result.updated} updated${skipped}.`;
    });

  return (
    <section className="roster-section">
      <h2>Import a roster CSV</h2>
      <p className="mm-note mm-hint">
        The registrar's class-list export works as-is: its heading lines are skipped, names are
        put in display form, and the section is kept; dropped students are left out, waitlisted
        ones are imported. Any other export with an email column works too — name, student ID
        and role are picked up when present. Importing only adds and updates: nobody is
        removed, and nobody's password is touched, so a mid-quarter re-import is safe.
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
      <button className="mm-btn mm-btn--primary" disabled={busy || csv.trim() === ''} onClick={submit}>
        Import
      </button>
      {report && <ImportReport report={report} />}
    </section>
  );
}

function ImportReport({ report }: { report: RosterImportReport }) {
  const c = report.columns;
  const skippedLines = skippedLinesText(report.headerLine);
  return (
    <div className="roster-report">
      {skippedLines && <p>{sentenceCase(skippedLines)}.</p>}
      <p>
        Columns used — email: {c.email ?? '(none)'} · name: {c.name ?? '(none)'} · ID:{' '}
        {c.studentId ?? '(none)'} · role: {c.role ?? '(none)'} · section: {c.section ?? '(none)'} ·
        status: {c.status ?? '(none)'}
      </p>
      {report.statusCounts.length > 0 && (
        <ul className="roster-statuses">
          {report.statusCounts.map((s) => (
            <li key={`${s.label}:${s.imported}`}>{statusCountText(s)}</li>
          ))}
        </ul>
      )}
      {report.issues.length > 0 && (
        <ul className="roster-issues">
          {report.issues.map((issue, i) => (
            <li key={i}>
              Line {issue.line}: {issue.reason}
            </li>
          ))}
        </ul>
      )}
      {report.noLongerListed.length > 0 && (
        <>
          <p className="roster-review-head">
            {sentenceCase(NO_LONGER_LISTED_TEXT)} ({report.noLongerListed.length}). Nobody was
            removed: remove someone below once you have checked they left the course.
          </p>
          <ul className="roster-issues">
            {report.noLongerListed.map((r) => (
              <li key={r.email}>
                {r.name} <span className="roster-email">{r.email}</span> — {r.reason}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
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
      <h2>
        Access requests ({requests.length} waiting)
      </h2>
      <p className="mm-note mm-hint">
        People who asked to be added under an email the roster doesn't have. Approving adds them —
        they then create their account the same way everyone else does.
      </p>
      <div className="instructor-table-scroll">
        <table className="mm-table roster-table">
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
                    className="mm-btn"
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
                    className="mm-btn"
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
      </div>
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
      <h2>Add one person</h2>
      <div className="roster-add">
        <input
          className="mm-input"
          type="email"
          placeholder="email@ucla.edu"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={busy}
        />
        <input
          className="mm-input"
          type="text"
          placeholder="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={busy}
        />
        <input
          className="mm-input"
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
        <button className="mm-btn mm-btn--primary" disabled={busy || email.trim() === ''} onClick={submit}>
          Add
        </button>
      </div>
    </section>
  );
}
