/**
 * The project Settings page's view logic (cut-over Task 1). Pure.
 */

/**
 * Why the project's name can't be saved — the one rule checked in the browser
 * before `projects.rename` ever sees it, said in the app's existing copy for
 * an empty field (`lib/account-view.ts`'s `nameProblem`). Anything else
 * `projects.rename` itself refuses (over 255 characters, say) surfaces as the
 * inline rename's generic "could not be saved" failure instead.
 */
export function projectNameProblem(name: string): string | null {
  return name.trim() === '' ? 'Enter a name' : null;
}
