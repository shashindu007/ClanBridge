// The proof /api/verify hands link_verified_player() (migration 077).
//
// The route checks the member's in-game token with Supercell, then signs what it
// checked — who, which tag, when — with VERIFY_LINK_SECRET. The database holds
// the same secret and recomputes the signature, so a session calling the RPC
// directly, without having passed the token check, has nothing to send.
//
// The message format is the migration's, character for character:
//   "<user id>|<tag>|<unix seconds>"
// Change one and the other with it, or every verification fails.

import { createHmac } from "node:crypto";

/** The secret, or null when this deployment has none (verification then refuses). */
export function verifyLinkSecret(): string | null {
  const value = process.env.VERIFY_LINK_SECRET?.trim();
  return value ? value : null;
}

export interface VerifyLinkProof {
  p_issued_at: number;
  p_proof: string;
}

export function verifyLinkProof(
  userId: string,
  tag: string,
  secret: string,
  now: Date = new Date(),
): VerifyLinkProof {
  const issuedAt = Math.floor(now.getTime() / 1000);
  const proof = createHmac("sha256", secret).update(`${userId}|${tag}|${issuedAt}`).digest("hex");
  return { p_issued_at: issuedAt, p_proof: proof };
}
