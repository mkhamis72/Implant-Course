// Heartbeat from <IdleTimer>: the middleware refreshes the last-seen cookie on this request.
export function POST() {
  return new Response(null, { status: 204 });
}
