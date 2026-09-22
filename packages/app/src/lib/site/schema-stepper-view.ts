// The Schema tab's stepper as pure decisions (spec 2026-09-18 §2): which
// step is open and how the strip reads. Steps 2 and 3 of the spec are one
// interim section here ("Pages and values", today's grid) until the pages
// and mark screens land.
import type { StepState } from './extract-view';

export type SchemaStep = 'fields' | 'pages';

export function stepOf(search: { step?: string }, fieldCount: number): SchemaStep {
  if (fieldCount === 0) return 'fields';
  return search.step === 'fields' ? 'fields' : 'pages';
}

export function stepStates(step: SchemaStep, fieldCount: number): [StepState, StepState] {
  if (step === 'fields') return ['current', fieldCount === 0 ? 'later' : 'locked'];
  return ['done', 'current'];
}

export function sharedNote(websiteCount: number): string | null {
  return websiteCount > 1 ? `shared with ${websiteCount} websites` : null;
}

export function addNote(websiteCount: number): string | null {
  return websiteCount > 1 ? `This adds the field to ${websiteCount} websites` : null;
}
