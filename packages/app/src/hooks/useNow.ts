import { useSyncExternalStore } from "react";

// Ticks once a minute on the client so relative-time strings refresh without
// calling Date.now() during render. `getSnapshot` must return a cached value
// between notifications — returning a fresh Date.now() on every call breaks
// useSyncExternalStore's Object.is comparison and forces a re-render loop.
let currentNowSnapshot = Date.now();
const subscribeNow = (notify: () => void) => {
  currentNowSnapshot = Date.now();
  notify();
  const id = setInterval(() => {
    currentNowSnapshot = Date.now();
    notify();
  }, 60_000);
  return () => clearInterval(id);
};
const getNowSnapshot = () => currentNowSnapshot;
const getNowServerSnapshot = () => 0;

/** Client clock that ticks once a minute, safe to read during render for relative-time formatting. */
export function useNow(): number {
  return useSyncExternalStore(
    subscribeNow,
    getNowSnapshot,
    getNowServerSnapshot,
  );
}
