"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { AuthUser } from "@friends-poker/shared";
import { getMe } from "../../lib/api";

export function AppNav() {
  const [me, setMe] = useState<AuthUser | null>();

  useEffect(() => {
    let mounted = true;
    getMe()
      .then((user) => {
        if (mounted) {
          setMe(user);
        }
      })
      .catch(() => {
        if (mounted) {
          setMe(null);
        }
      });
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <nav className="nav">
      <Link href="/rooms">房间</Link>
      <Link href="/rooms/new">创建房间</Link>
      <Link href="/profile">统计</Link>
      {me?.role === "ADMIN" && <Link href="/admin">管理员</Link>}
      <Link href="/login">登录</Link>
    </nav>
  );
}
