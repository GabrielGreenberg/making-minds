import { useState, type ReactNode } from 'react';
import { instructorRole } from '../auth/instructorRole';

/**
 * Gates the instructor frontend. Mirrors AuthGate, but for the instructor role.
 *
 * When the user is not in instructor mode, renders a simple unlock screen with a
 * single "Enter Instructor Mode" button (no passphrase in the prototype). On
 * click it flips the role flag and forces a re-render. When the user is in
 * instructor mode, renders the wrapped instructor UI.
 *
 * Later, the SSO token carries the role claim; this component is unchanged — only
 * `instructorRole.isInstructor()` gains real behavior.
 */
export function InstructorGate({ children }: { children: ReactNode }) {
  const [, force] = useState(0);

  if (!instructorRole.isInstructor()) {
    return (
      <div className="instructor-unlock">
        <div className="instructor-unlock-card">
          <h1 className="instructor-unlock-title">Instructor Mode</h1>
          <p className="instructor-unlock-text">
            This area lets you author assignments, generate autograder test vectors,
            and review student submissions. It is separate from the student
            experience.
          </p>
          <button
            className="instructor-unlock-button"
            onClick={() => {
              instructorRole.enter();
              force((n) => n + 1);
            }}
          >
            Enter Instructor Mode
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
