import { useState } from 'react';
import type { AssignmentData, SubmissionRecord } from '../types';
import { getAssignment } from '../assignments';
import { localSubmissionStore } from '../storage/submissionStore';
import { gradeSubmission } from '../engine/grader';
import { navigate } from '../routing';
import { gradeSubmissions, computeStats, type SubmissionGrade } from './Gradebook';

function formatTime(iso: string): string {
  const d = new Date(iso);
  return (
    d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
    ', ' +
    d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  );
}

function pct(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

export function GradebookView({ id }: { id: string }) {
  const [expanded, setExpanded] = useState<number | null>(null);

  const assignment = getAssignment(id);
  if (!assignment) {
    return (
      <div className="instructor-error">
        <p>Assignment not found.</p>
        <button className="instructor-btn" onClick={() => navigate({ kind: 'instructor' })}>
          Back to dashboard
        </button>
      </div>
    );
  }

  const records = localSubmissionStore.listSubmissions(id);
  const grades = gradeSubmissions(assignment, records);
  const stats = computeStats(grades, assignment);

  return (
    <div className="instructor-gradebook">
      <div className="instructor-page-head">
        <button className="instructor-link" onClick={() => navigate({ kind: 'instructor' })}>
          ← Dashboard
        </button>
        <h3 className="instructor-section-title">{assignment.title} — Submissions</h3>
      </div>

      {/* Summary */}
      <div className="instructor-stats">
        <div className="instructor-stat">
          <span className="instructor-stat-value">{stats.submissionCount}</span>
          <span className="instructor-stat-label">submissions</span>
        </div>
        <div className="instructor-stat">
          <span className="instructor-stat-value">{pct(stats.meanScore)}</span>
          <span className="instructor-stat-label">mean score</span>
        </div>
        {assignment.questions.map((q) => (
          <div className="instructor-stat" key={q.id}>
            <span className="instructor-stat-value">{pct(stats.passByQuestion[q.id] ?? 0)}</span>
            <span className="instructor-stat-label">{q.label} pass rate</span>
          </div>
        ))}
      </div>

      {records.length === 0 ? (
        <p className="instructor-empty">No submissions yet.</p>
      ) : (
        <table className="instructor-table">
          <thead>
            <tr>
              <th>Student</th>
              <th>Submitted</th>
              <th>Attempt</th>
              {assignment.questions.map((q) => (
                <th key={q.id}>{q.label}</th>
              ))}
              <th>Score</th>
            </tr>
          </thead>
          <tbody>
            {grades.map((g, i) => (
              <SubmissionRow
                key={i}
                grade={g}
                assignment={assignment}
                expanded={expanded === i}
                onToggle={() => setExpanded(expanded === i ? null : i)}
              />
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function SubmissionRow({
  grade,
  assignment,
  expanded,
  onToggle,
}: {
  grade: SubmissionGrade;
  assignment: AssignmentData;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { record } = grade;
  const student = record.submission.student || 'Anonymous';
  const colSpan = 4 + assignment.questions.length;

  return (
    <>
      <tr className="instructor-submission-row" onClick={onToggle}>
        <td>{student}</td>
        <td>{formatTime(record.submittedAt)}</td>
        <td>{record.attempt}</td>
        {assignment.questions.map((q) => {
          const qg = grade.grades.find((x) => x.questionId === q.id);
          return (
            <td key={q.id}>
              {qg?.passed ? (
                <span className="instructor-pass">✓</span>
              ) : (
                <span className="instructor-fail">✗</span>
              )}
            </td>
          );
        })}
        <td>{pct(grade.score)}</td>
      </tr>
      {expanded && (
        <tr className="instructor-submission-detail">
          <td colSpan={colSpan}>
            <SubmissionDetail record={record} assignment={assignment} />
          </td>
        </tr>
      )}
    </>
  );
}

function SubmissionDetail({
  record,
  assignment,
}: {
  record: SubmissionRecord;
  assignment: AssignmentData;
}) {
  // Re-run the grader to get per-case detail (the rolled-up grades omit it).
  const result = gradeSubmission(assignment, record.submission);

  return (
    <div className="instructor-detail">
      {result.questions.map((qr) => {
        const q = assignment.questions.find((x) => x.id === qr.questionId);
        if (qr.status === 'skipped') {
          return (
            <div className="instructor-detail-q" key={qr.questionId}>
              <strong>{q?.label ?? `Q${qr.questionId}`}</strong>: skipped — {qr.reason}
            </div>
          );
        }
        const failed = qr.cases.filter((c) => !c.pass);
        return (
          <div className="instructor-detail-q" key={qr.questionId}>
            <strong>{q?.label ?? `Q${qr.questionId}`}</strong>: {qr.passed}/{qr.total} passed
            {failed.length > 0 && (
              <table className="instructor-detail-table">
                <thead>
                  <tr>
                    <th>input</th>
                    <th>expected</th>
                    <th>got</th>
                  </tr>
                </thead>
                <tbody>
                  {failed.map((c, ci) => (
                    <tr key={ci}>
                      <td className="instructor-bits">{c.input.join('')}</td>
                      <td className="instructor-bits">{c.expected.join('')}</td>
                      <td className="instructor-bits instructor-fail">{c.got.join('')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        );
      })}
    </div>
  );
}
