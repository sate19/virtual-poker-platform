import type { FastifyReply, FastifyRequest } from "fastify";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import type { AuthUser } from "@friends-poker/shared";
import { config } from "./config";
import { prisma } from "./prisma";

const tokenSchema = z.object({ userId: z.string() });

export function signSession(userId: string): string {
  return jwt.sign({ userId }, config.jwtSecret, { expiresIn: "14d" });
}

export function setSessionCookie(reply: FastifyReply, token: string): void {
  reply.setCookie(config.cookieName, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: config.nodeEnv === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 14,
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(config.cookieName, { path: "/" });
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function getUserFromToken(token?: string): Promise<AuthUser | undefined> {
  if (!token) {
    return undefined;
  }
  try {
    const payload = tokenSchema.parse(jwt.verify(token, config.jwtSecret));
    const user = await prisma.user.findUnique({ where: { id: payload.userId } });
    if (!user || user.isBanned) {
      return undefined;
    }
    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      virtualChips: user.virtualChips,
      isBanned: user.isBanned,
    };
  } catch {
    return undefined;
  }
}

export async function requireUser(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const token = request.cookies[config.cookieName];
  const user = await getUserFromToken(token);
  if (!user) {
    reply.code(401).send({ code: "UNAUTHORIZED", message: "请先登录" });
    return;
  }
  (request as FastifyRequest & { user: AuthUser }).user = user;
}

export async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  await requireUser(request, reply);
  const user = (request as FastifyRequest & { user?: AuthUser }).user;
  if (!user || user.role !== "ADMIN") {
    reply.code(403).send({ code: "FORBIDDEN", message: "需要管理员权限" });
  }
}

export function requestUser(request: FastifyRequest): AuthUser {
  const user = (request as FastifyRequest & { user?: AuthUser }).user;
  if (!user) {
    throw new Error("missing authenticated user");
  }
  return user;
}

export function parseCookie(header?: string): Record<string, string> {
  return Object.fromEntries(
    (header ?? "")
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const [key, ...value] = part.split("=");
        return [key, decodeURIComponent(value.join("="))];
      }),
  );
}
