const API_BASE = "/api";

export async function requestLoginLink(email: string): Promise<void> {
  await fetch(`${API_BASE}/auth/request-link`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ email }),
  });
}

export async function verifyLoginToken(token: string): Promise<boolean> {
  const response = await fetch(`${API_BASE}/auth/verify?token=${encodeURIComponent(token)}`, {
    credentials: "include",
  });
  return response.ok;
}

export interface ReviewAlert {
  id: string;
  reviewId: string;
  rating: number;
  text: string | null;
  author: string | null;
  reviewTime: string;
}

export async function fetchAlerts(): Promise<ReviewAlert[]> {
  const response = await fetch(`${API_BASE}/alerts`, { credentials: "include" });
  if (!response.ok) throw new Error("Failed to load alerts");
  return response.json();
}

export async function sendPresenceHeartbeat(): Promise<void> {
  await fetch(`${API_BASE}/presence/heartbeat`, { method: "POST", credentials: "include" });
}

export type GoogleConnectionStatus = "connected" | "needs_reconnect" | "not_connected";

export async function fetchGoogleStatus(): Promise<GoogleConnectionStatus> {
  const response = await fetch(`${API_BASE}/google/status`, { credentials: "include" });
  if (!response.ok) return "not_connected";
  const data = (await response.json()) as { status: GoogleConnectionStatus };
  return data.status;
}
