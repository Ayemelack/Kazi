import { useMemo, useRef } from 'react';
import { newClientOpId } from '@kazi/shared';

// KZ-11: one idempotency key (`clientOpId`) per form submission.
//
// `opId(values)` is called on Save with exactly what is about to be sent. The
// first tap creates an id; tapping Save again with the same values (a retry
// after a timeout or a lost response) reuses it, so the API replays the first
// answer instead of recording the sale twice. Any change to the values gets a
// new id, so one id never covers two different requests (the API would replay
// the old record for the new body). `succeeded()` drops the id after the
// server confirmed the write, so the next submission starts fresh.
//
// The id is an idempotency key, not a secret (see @kazi/shared clientOpId.ts).

interface Pending {
  key: string;
  id: string;
}

export interface Submission {
  opId: (values: unknown) => string;
  succeeded: () => void;
}

export function useSubmission(): Submission {
  const pending = useRef<Pending | null>(null);
  return useMemo(
    () => ({
      opId(values: unknown) {
        const key = JSON.stringify(values) ?? '';
        if (pending.current === null || pending.current.key !== key) {
          pending.current = { key, id: newClientOpId() };
        }
        return pending.current.id;
      },
      succeeded() {
        pending.current = null;
      },
    }),
    [],
  );
}
