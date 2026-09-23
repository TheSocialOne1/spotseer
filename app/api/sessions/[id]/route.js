import { endSession, heartbeat, setBaseline } from "@/lib/network";
import { thankReporter } from "@/lib/push";
import { badDevice, readBody, respond } from "@/lib/request";

export async function PATCH(request, { params }) {
  const { id } = await params;
  const body = await readBody(request);
  const invalid = badDevice(body.deviceId);
  if (invalid) return invalid;

  const deviceId = body.deviceId;
  const lat = Number(body.lat);
  const lng = Number(body.lng);

  switch (body.action) {
    case "heartbeat":
      return respond(await heartbeat({ id, deviceId, lat, lng }));
    case "parked":
    case "gave_up": {
      const { reporterDeviceId, ...result } = await endSession({ id, deviceId, outcome: body.action, lat, lng });
      if (reporterDeviceId && result.usedReport) {
        await thankReporter(reporterDeviceId, result.usedReport).catch(() => {});
      }
      return respond(result);
    }
    case "baseline":
      return respond(await setBaseline({ id, deviceId, minutes: Number(body.minutes) }));
    default:
      return respond({ error: "invalid_action", status: 400 });
  }
}
