// T5.5 — Store a Web Push subscription in push_subscriptions.
//
// Called after the permission prompt, which is shown post-login rather than on
// first paint. Subscriptions expire; a 410 Gone from the push service later
// means soft delete the row (R4), not throw.

export async function POST(): Promise<Response> {
  return new Response("Not implemented — T5.5", { status: 501 });
}

export async function DELETE(): Promise<Response> {
  return new Response("Not implemented — T5.5", { status: 501 });
}
