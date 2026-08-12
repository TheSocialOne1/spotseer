import { NextResponse } from "next/server";
import crypto from "crypto";
import { getSpots, addReport, getReports, computeStatus } from "@/lib/store";
import { distanceMeters, MAX_REPORT_DISTANCE_METERS } from "@/lib/geo";
import { notifySpotOpened } from "@/lib/push";

const ALLOWED_TYPES = new Set(["leaving", "opened", "found", "full"]);

export async function POST(request) {
  const body = await request.json().catch(() => null);

  if (!body || typeof body.spotId !== "string" || !ALLOWED_TYPES.has(body.type)) {
    return NextResponse.json({ error: "Invalid report" }, { status: 400 });
  }

  const spots = await getSpots();
  const spot = spots.find((s) => s.id === body.spotId);
  if (!spot) {
    return NextResponse.json({ error: "Unknown spot" }, { status: 404 });
  }

  const lat = Number(body.lat);
  const lng = Number(body.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ error: "location_required" }, { status: 422 });
  }

  const distance = distanceMeters(lat, lng, spot.lat, spot.lng);
  if (distance > MAX_REPORT_DISTANCE_METERS) {
    return NextResponse.json(
      { error: "too_far", distanceMeters: Math.round(distance), maxMeters: MAX_REPORT_DISTANCE_METERS },
      { status: 422 }
    );
  }

  const report = {
    id: crypto.randomUUID(),
    spotId: spot.id,
    type: body.type,
    createdAt: Date.now(),
    reporterLat: lat,
    reporterLng: lng,
    distanceMeters: Math.round(distance),
  };

  try {
    await addReport(report);
  } catch {
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }

  if (report.type === "opened") {
    try {
      await notifySpotOpened(spot);
    } catch {
      // Never let a push failure break the report submission itself.
    }
  }

  return NextResponse.json({
    report,
    status: computeStatus(spot.id, await getReports()),
  });
}
