import type { ReviewAlert } from './api';

export function subscribeToAlerts(onAlert: (alert: ReviewAlert) => void): () => void {
  const source = new EventSource('/api/realtime/stream', { withCredentials: true });

  source.onmessage = (event) => {
    onAlert(JSON.parse(event.data) as ReviewAlert);
  };

  return () => source.close();
}
