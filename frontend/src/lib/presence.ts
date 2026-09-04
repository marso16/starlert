import { sendPresenceHeartbeat } from './api';

const HEARTBEAT_INTERVAL_MS = 60 * 1000;

export function startPresenceHeartbeat(): () => void {
  void sendPresenceHeartbeat();
  const interval = setInterval(() => {
    if (document.visibilityState === 'visible') {
      void sendPresenceHeartbeat();
    }
  }, HEARTBEAT_INTERVAL_MS);

  return () => clearInterval(interval);
}
