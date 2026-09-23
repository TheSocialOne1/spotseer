import { NextResponse } from "next/server";
import { hashIp, isValidDeviceId } from "@/lib/network";

export async function readBody(request) {
  return (await request.json().catch(() => null)) ?? {};
}

export function clientIpHash(request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return hashIp(ip);
}

export function badDevice(deviceId) {
  return isValidDeviceId(deviceId) ? null : NextResponse.json({ error: "invalid_device" }, { status: 400 });
}

export function respond(result) {
  if (result?.error) return NextResponse.json(result, { status: result.status ?? 400 });
  return NextResponse.json(result);
}
