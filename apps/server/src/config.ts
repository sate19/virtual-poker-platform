import "dotenv/config";

export const config = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 4000),
  webOrigin: process.env.WEB_ORIGIN ?? "http://localhost:3000",
  jwtSecret: process.env.JWT_SECRET ?? "dev-only-change-this-secret",
  cookieName: "fp_session",
  actionTimeoutSeconds: clamp(Number(process.env.ACTION_TIMEOUT_SECONDS ?? 30), 5, 300),
  offlineRoomCloseGraceSeconds: clamp(Number(process.env.OFFLINE_ROOM_CLOSE_GRACE_SECONDS ?? 30), 5, 3600),
};

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, Math.floor(value)));
}
