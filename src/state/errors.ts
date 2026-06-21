// ---------------------------------------------------------------------------
// Structured state-access errors for the LLM repair loop
//
// When an effect executor (generated or hand-written) violates a runtime
// constraint, a StateAccessError is thrown with a machine-readable `kind`
// so the repair loop can diagnose and re-generate the offending code.
// ---------------------------------------------------------------------------

export type StateAccessErrorKind =
  | 'not-found'
  | 'immutable'
  | 'out-of-range'
  | 'invalid-enum';

export class StateAccessError extends Error {
  override readonly name = 'StateAccessError';

  constructor(
    public readonly kind: StateAccessErrorKind,
    public readonly path: string,
    message: string,
  ) {
    super(message);
  }
}
