// Affine-arithmetic formula evaluator (instructor authoring tooling).
//
// Framework-agnostic and free of any encoding logic: it maps variable names to
// integer values, evaluates a small arithmetic/bitwise expression, and returns a
// non-negative integer. Encoding (bits ↔ integers) lives in testVectorGen.ts.
//
// Safety: evaluation uses `new Function()`. This is acceptable because the
// language accepted here is restricted to a vetted character set (digits,
// declared variable names, and the operators + - * & | ^ ~ and parentheses) and
// the formula is instructor-authored, never student-supplied. The whitelist
// validation below rejects anything that could reach a global, call a function,
// or read a property.

/** Thrown for any invalid formula: parse error, bad token, non-integer or
 *  negative result. Carries a human-readable `.message` for inline display. */
export class FormulaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FormulaError';
  }
}

// The full set of operators the language supports (see the spec's "arithmetic
// language" section): + - * and the bitwise & | ^ ~, plus parentheses.
const ALLOWED_OPERATOR_CHARS = new Set(['+', '-', '*', '&', '|', '^', '~', '(', ')']);

/** A valid variable name: a short identifier (letters, then letters/digits). */
const IDENTIFIER_RE = /^[A-Za-z][A-Za-z0-9_]*$/;

/**
 * Tokenize and validate the expression against the language whitelist. Every
 * token must be an integer literal, a declared variable name, or an allowed
 * operator/paren. Anything else (a stray identifier, `.`, `/`, `%`, `=`, etc.)
 * is a FormulaError. Returns nothing; throws on the first offending token.
 */
function validateTokens(expr: string, varNames: Set<string>): void {
  // Match runs of: identifiers, integer literals, or single operator chars.
  const tokenRe = /[A-Za-z_][A-Za-z0-9_]*|\d+|\S/g;
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(expr)) !== null) {
    const tok = m[0];
    if (/^\d+$/.test(tok)) continue; // integer literal
    if (IDENTIFIER_RE.test(tok)) {
      if (!varNames.has(tok)) {
        throw new FormulaError(`Unknown variable "${tok}"`);
      }
      continue;
    }
    if (tok.length === 1 && ALLOWED_OPERATOR_CHARS.has(tok)) continue;
    throw new FormulaError(`Unexpected token "${tok}"`);
  }
}

/**
 * Evaluate an affine/bitwise expression with the given variable bindings.
 *
 * Throws FormulaError when the expression is malformed, references an undeclared
 * variable, fails to evaluate, or produces a value that a circuit cannot
 * represent (non-integer or negative). On success returns a non-negative integer
 * — the caller (testVectorGen) extracts the output bits under the group's width
 * and encoding.
 */
export function evalFormula(expr: string, vars: Record<string, number>): number {
  const trimmed = expr.trim();
  if (trimmed === '') {
    throw new FormulaError('Formula is empty');
  }

  const varNames = new Set(Object.keys(vars));
  validateTokens(trimmed, varNames);

  // Bind each declared variable as a parameter; the body returns the expression.
  const names = Object.keys(vars);
  let fn: (...args: number[]) => unknown;
  try {
    fn = new Function(...names, `"use strict"; return (${trimmed});`) as (
      ...args: number[]
    ) => unknown;
  } catch {
    throw new FormulaError('Could not parse formula');
  }

  let result: unknown;
  try {
    result = fn(...names.map((n) => vars[n]));
  } catch {
    throw new FormulaError('Could not evaluate formula');
  }

  if (typeof result !== 'number' || !Number.isFinite(result)) {
    throw new FormulaError('Formula did not produce a number');
  }
  if (!Number.isInteger(result)) {
    throw new FormulaError(`Formula produced a non-integer result (${result})`);
  }
  if (result < 0) {
    throw new FormulaError(
      `Formula produced a negative result (${result}); circuits cannot represent negative numbers`,
    );
  }
  return result;
}
