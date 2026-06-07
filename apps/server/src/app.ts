import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import Fastify from "fastify";
import { ZodError } from "zod";
import { registerRoutes } from "./routes";
import { registerSocket } from "./socket";

export async function buildApp() {
  const app = Fastify({ logger: true });
  await app.register(cookie);
  app.server.prependListener("request", (req) => {
    const raw = (req as any).__url_fixed ? undefined : req.url;
    if (raw && /^\/socket\.io(\?|$)/.test(raw)) {
      (req as any).__url_fixed = true;
      Object.defineProperty(req, "url", {
        value: raw.replace("/socket.io", "/socket.io/"),
        writable: true,
        configurable: true,
      });
    }
  });
  await app.register(cors, {
    origin: (_origin, cb) => {
      cb(null, true);
    },
    credentials: true,
  });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      reply.code(400).send({
        code: "VALIDATION_ERROR",
        message: error.issues[0]?.message ?? "参数不合法",
      });
      return;
    }
    app.log.error(error);
    const message = error instanceof Error ? error.message : "服务器错误";
    reply.code(500).send({
      code: "INTERNAL_ERROR",
      message,
    });
  });
  await registerRoutes(app);
  registerSocket(app);
  return app;
}
