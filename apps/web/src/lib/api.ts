import type { AuthUser } from "@friends-poker/shared";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const base = typeof window !== "undefined" ? "/api" : API_URL;
  const hasBody = init?.body !== undefined && init?.body !== null;
  const response = await fetch(`${base}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      ...(hasBody ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message ?? "请求失败");
  }
  return data as T;
}

export async function getMe(): Promise<AuthUser | undefined> {
  try {
    return await apiFetch<AuthUser>("/auth/me");
  } catch {
    return undefined;
  }
}
