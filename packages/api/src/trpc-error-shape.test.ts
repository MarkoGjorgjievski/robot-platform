import { describe, it, expect } from 'vitest';
import { TRPCError, getTRPCErrorShape } from '@trpc/server';
import { appRouter } from './routers/index.js';
import { VerifyRefusal } from './verify/verify-refusal.js';

// The shape the api-server sends for an error, built from the app router's own config — the
// formatter in trpc.ts included (a createCaller test never runs the formatter).
const shapeOf = (error: TRPCError) =>
  getTRPCErrorShape({ config: appRouter._def._config, error, type: 'mutation', path: 'sources.verify', input: undefined, ctx: undefined });

describe('the error shape (spec 2026-10-20 §3.2)', () => {
  it("carries a refused Verify's problems on data.verifyProblems", () => {
    const problems = [{ reason: 'blank' as const, field: 'Rating', product: 3 }];
    const shape = shapeOf(new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Verify could not start', cause: new VerifyRefusal(problems) }));
    expect(shape.data.verifyProblems).toEqual(problems);
    expect(shape.data.httpStatus).toBe(412);
  });
  it('is null on every other error', () => {
    expect(shapeOf(new TRPCError({ code: 'NOT_FOUND', message: 'x' })).data.verifyProblems).toBeNull();
  });
});
