// Server-synced clock. Every browser computes the game phase from the same
// schedule, so what matters is that everyone agrees on "now". We estimate the
// offset between this device's clock and the server's from API responses,
// keeping the sample with the lowest round-trip time (most accurate).

let offsetMs = 0;
let bestRtt = Infinity;

export function syncClock(serverTime: number, sentAt: number, receivedAt: number) {
  const rtt = receivedAt - sentAt;
  if (rtt > bestRtt) return;
  bestRtt = rtt;
  offsetMs = serverTime - (sentAt + rtt / 2);
}

export function serverNow() {
  return Date.now() + offsetMs;
}
