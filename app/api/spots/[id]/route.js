import { NextResponse } from "next/server";
import { updateSpotLocation } from "@/lib/store";

export async function PATCH(request, { params }) {
  const { id } = await params;
  const body = await request.json().catch(() => null);

  const lat = Number(body?.lat);
  const lng = Number(body?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ error: "Invalid coordinates" }, { status: 400 });
  }

  const spot = await updateSpotLocation(id, lat, lng);
  if (!spot) {
    return NextResponse.json({ error: "Unknown spot" }, { status: 404 });
  }

  return NextResponse.json({ spot });
}
