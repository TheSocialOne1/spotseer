import { NextResponse } from "next/server";
import { getSpots, getReports, computeStatus } from "@/lib/store";

export async function GET() {
  const [spots, reports] = await Promise.all([getSpots(), getReports()]);
  const now = Date.now();

  const data = spots.map((spot) => ({
    ...spot,
    status: computeStatus(spot.id, reports, now),
  }));

  return NextResponse.json({ spots: data, now });
}
