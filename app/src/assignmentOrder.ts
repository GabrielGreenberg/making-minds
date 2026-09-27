// The one ordering rule for assignments (pure, so the server imports it too:
// the grading summaries list assignments the way the catalog does).

/** The order the catalog and the dashboard both list assignments in: the
 *  instructor's chosen positions first, in ascending order, then everything
 *  that has never been moved, alphabetically. Pure, so both backends and the
 *  headless checks agree. */
export function sortAssignments<T extends { title: string; order?: number }>(rows: T[]): T[] {
  return rows.slice().sort((a, b) => {
    const ao = a.order ?? Number.POSITIVE_INFINITY;
    const bo = b.order ?? Number.POSITIVE_INFINITY;
    if (ao !== bo) return ao - bo;
    return a.title.localeCompare(b.title);
  });
}
