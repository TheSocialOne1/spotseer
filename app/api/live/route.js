import { NextResponse } from "next/server";
import { getLiveEvents } from "@/lib/network";
import { PILOT_ZONE } from "@/lib/pilot";

export const dynamic = "force-dynamic";

export async function GET() {
  const now = Date.now();
  const events = await getLiveEvents(now);
  return NextResponse.json({ now, zone: PILOT_ZONE, events }, { headers: { "Cache-Control": "no-store" } });
}
