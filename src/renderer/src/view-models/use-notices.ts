import { useSyncExternalStore } from 'react';
import { notices } from '../lib/notices';

export function useNotices() {
  const current = useSyncExternalStore(
    (listener) => notices.subscribe(listener),
    () => notices.snapshot(),
  );
  return { notices: current, dismiss: (id: number) => notices.dismiss(id) };
}
