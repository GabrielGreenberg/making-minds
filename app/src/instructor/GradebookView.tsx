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

/** One student's submissions, oldest first; `latest` is the graded one. */
interface StudentGrades {
  student: string;
  all: SubmissionGrade[]; // oldest → newest
  latest: SubmissionGrade;
}

export function GradebookView({ id }: { id: string }) {
  const [expandedStudent, setExpandedStudent] = useState<string | null>(null);

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

  // Group by student. Only the LATEST submission counts toward the grade;
  // earlier attempts stay visible under the expanded student row.
  const byStudent = new Map<string, SubmissionGrade[]>();
  for (const g of grades) {
    const student = g.record.submission.student || 'Anonymous';
    const list = byStudent.get(student) ?? [];
    list.push(g);
    byStudent.set(student, list);
  }
  const students: StudentGrades[] = [...byStudent.entries()]
    .map(([student, all]) => ({ student, all, latest: all[all.length - 1] }))
    .sort((a, b) => a.student.localeCompare(b.student));

  // Stats reflect what counts for grading: each student's latest submission.
  const stats = computeStats(students.map((s) => s.latest), assignment);

  return (
    <div className="instructor-gradebook">
      <div className="instructor-page-head">
        <button className="instructor-link" onClick={() => navigate({ kind: 'instructor' })}>
          ← Dashboard
        </button>
        <h3 className="instructor-section-title">{assignment.title} — Submissions</h3>
      </div>

      {/* Summary (over each student's latest submission) */}
      <div className="instructor-stats">
        <div className="instructor-stat">
          <span className="instructor-stat-value">{students.length}</span>
          <span className="instructor-stat-label">students</span>
        </div>
        <div className="instructor-stat">
          <span className="instructor-stat-value">{grades.length}</span>
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
              <th>Last submitted</th>
              <th>Attempts</th>
              {assignment.questions.map((q) => (
                <th key={q.id}>{q.label}</th>
              ))}
              <th>Score</th>
            </tr>
          </thead>
          <tbody>
            {students.map((s) => (
              <StudentRow
                key={s.student}
                studentGrades={s}
                assignment={assignment}
                expanded={expandedStudent === s.student}
                onToggle={() =>
                  setExpandedStudent(expandedStudent === s.student ? null : s.student)
                }
              />
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function QuestionMarks({
  grade,
  assignment,
}: {
  grade: SubmissionGrade;
  assignment: AssignmentData;
}) {
  return (
    <>
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
    </>
  );
}

/** The per-student row: latest submission's scores; expands to the full
 *  submission history (earlier attempts and their per-question results). */
function StudentRow({
  studentGrades,
  assignment,
  expanded,
  onToggle,
}: {
  studentGrades: StudentGrades;
  assignment: AssignmentData;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { student, all, latest } = studentGrades;
  const colSpan = 4 + assignment.questions.length;

  return (
    <>
      <tr className="instructor-submission-row" onClick={onToggle}>
        <td>
          <span className="instructor-expand-caret">{expanded ? '▾' : '▸'}</span> {student}
        </td>
        <td>{formatTime(latest.record.submittedAt)}</td>
        <td>{all.length}</td>
        <QuestionMarks grade={latest} assignment={assignment} />
        <td>{pct(latest.score)}</td>
      </tr>
      {expanded && (
        <tr className="instructor-submission-detail">
          <td colSpan={colSpan}>
            <table className="instructor-table instructor-attempt-table">
              <thead>
                <tr>
                  <th>Attempt</th>
                  <th>Submitted</th>
                  {assignment.questions.map((q) => (
                    <th key={q.id}>{q.label}</th>
                  ))}
                  <th>Score</th>
                </tr>
              </thead>
              <tbody>
                {all
                  .map((g, i) => ({ g, attempt: i + 1 }))
                  .reverse()
                  .map(({ g, attempt }) => (
                    <AttemptRow
                      key={attempt}
                      grade={g}
                      attempt={attempt}
                      isLatest={attempt === all.length}
                      assignment={assignment}
                    />
                  ))}
              </tbody>
            </table>
          </td>
        </tr>
      )}
    </>
  );
}

function AttemptRow({
  grade,
  attempt,
  isLatest,
  assignment,
}: {
  grade: SubmissionGrade;
  attempt: number;
  isLatest: boolean;
  assignment: AssignmentData;
}) {
  const [showDetail, setShowDetail] = useState(false);
  const colSpan = 3 + assignment.questions.length;

  return (
    <>
      <tr className="instructor-submission-row" onClick={() => setShowDetail(!showDetail)}>
        <td>
          {attempt}
          {isLatest && <span className="instructor-latest-tag"> (graded)</span>}
        </td>
        <td>{formatTime(grade.record.submittedAt)}</td>
        <QuestionMarks grade={grade} assignment={assignment} />
        <td>{pct(grade.score)}</td>
      </tr>
      {showDetail && (
        <tr className="instructor-submission-detail">
          <td colSpan={colSpan}>
            <SubmissionDetail record={grade.record} assignment={assignment} />
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
  // Prefer the grade stored at submission time (it carries full per-case
  // detail); re-grade only for legacy records that predate autograde-on-submit.
  const result = record.result ?? gradeSubmission(assignment, record.submission);

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
        // Turbot questions grade against arenas, not value cases — their
        // failures report steps taken + final pose instead of expected/got.
        if (qr.turbotCases) {
          const failedRuns = qr.turbotCases
            .map((c, i) => ({ ...c, arenaIndex: i + 1 }))
            .filter((c) => !c.pass);
          return (
            <div className="instructor-detail-q" key={qr.questionId}>
              <strong>{q?.label ?? `Q${qr.questionId}`}</strong>: {qr.passed}/{qr.total} arenas passed
              {failedRuns.length > 0 && (
                <table className="instructor-detail-table">
                  <thead>
                    <tr>
                      <th>arena</th>
                      <th>steps</th>
                      <th>final position</th>
                      <th>why it failed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {failedRuns.map((c, ci) => (
                      <tr key={ci}>
                        <td className="instructor-bits">#{c.arenaIndex}</td>
                        <td className="instructor-bits">{c.stepsTaken}</td>
                        <td className="instructor-bits">
                          ({c.finalPosition.x}, {c.finalPosition.y}) {c.finalPosition.facing}
                        </td>
                        <td className="instructor-bits instructor-fail">
                          {c.reason ?? 'criterion not met'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
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
                      <td className="instructor-bits">{c.input.join(', ')}</td>
                      <td className="instructor-bits">{c.expected.join(', ')}</td>
                      <td className="instructor-bits instructor-fail">
                        {c.reason ?? c.got.join(', ')}
                      </td>
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
