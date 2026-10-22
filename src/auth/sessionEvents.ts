// KZ-13: session expiry is detected deep in the API client (a request was
// refused and the refresh token could not renew it), but only the auth
// provider can sign the user out of the UI. This tiny module carries that one
// signal without the client importing React state.

type Listener = () => void;

const listeners = new Set<Listener>();

export function onSessionExpired(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function emitSessionExpired(): void {
  // Copy first: a listener may unsubscribe while being notified.
  for (const listener of [...listeners]) {
    listener();
  }
}
