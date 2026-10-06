import { describe, it, expect } from 'vitest';
import { projectNameProblem } from './project-settings-view';

describe('projectNameProblem', () => {
  it('refuses an empty or whitespace-only name, and nothing else', () => {
    expect(projectNameProblem('')).toBe('Enter a name');
    expect(projectNameProblem('   ')).toBe('Enter a name');
    expect(projectNameProblem('Acme')).toBeNull();
    expect(projectNameProblem('  Acme  ')).toBeNull();
  });
});
