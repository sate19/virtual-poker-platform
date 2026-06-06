import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "虚拟筹码德州扑克平台",
  description: "基于虚拟筹码的在线德州扑克对局平台",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <div className="appShell">
          <header className="topbar">
            <Link className="brand" href="/">
              虚拟筹码德州扑克平台
            </Link>
            <nav className="nav">
              <Link href="/rooms">房间</Link>
              <Link href="/rooms/new">创建房间</Link>
              <Link href="/profile">统计</Link>
              <Link href="/admin">管理员</Link>
              <Link href="/login">登录</Link>
            </nav>
          </header>
          {children}
        </div>
      </body>
    </html>
  );
}
