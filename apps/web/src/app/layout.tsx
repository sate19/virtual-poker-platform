import type { Metadata } from "next";
import Link from "next/link";
import { AppNav } from "./components/AppNav";
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
            <AppNav />
          </header>
          {children}
        </div>
      </body>
    </html>
  );
}
