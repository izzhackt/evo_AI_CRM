export function logInboxReadinessRequest(input: {
  requestId: string;
  status: number;
  startedAtMs: number;
  completedAtMs: number;
}): void {
  console.info(
    JSON.stringify({
      event_code: 'p7b_readiness_request',
      service: 'evo-inbox-companion',
      request_id: input.requestId,
      method: 'GET',
      route_template: '/api/readiness',
      status_class: `${Math.floor(input.status / 100)}xx`,
      elapsed_ms: Math.max(
        0,
        Math.floor(input.completedAtMs - input.startedAtMs)
      ),
    })
  );
}
