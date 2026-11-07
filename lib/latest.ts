// Last-request-wins guard for async loads: `start()` returns a token, and only the newest token is still `current`.
// A late reply for an earlier request (a delete dialog opened for A, cancelled, then opened for B) fails the check and is dropped.
export function createLatest() {
  let n = 0;
  return {
    start: () => ++n,
    current: (token: number) => token === n,
  };
}
