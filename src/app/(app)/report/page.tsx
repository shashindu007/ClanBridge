// /report was "Participation". It is Season donations now, under Player rating;
// this keeps old links and bookmarks working, season included.

import { redirect } from "next/navigation";

export default async function ReportRedirect({
  searchParams,
}: {
  searchParams: Promise<{ season?: string }>;
}) {
  const { season } = await searchParams;
  redirect(season ? `/rating/donations?season=${encodeURIComponent(season)}` : "/rating/donations");
}
