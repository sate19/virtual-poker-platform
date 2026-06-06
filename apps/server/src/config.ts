import "dotenv/config";

export const config = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 4000),
  webOrigin: process.env.WEB_ORIGIN ?? "http://localhost:3000",
  jwtSecret: process.env.JWT_SECRET ?? "dev-only-change-this-secret",
  cookieName: "fp_session",
};
