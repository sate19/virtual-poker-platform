import Link from "next/link";

export default function HomePage() {
  return (
    <main className="page">
      <section className="hero">
        <div>
          <h1>虚拟筹码德州扑克平台</h1>
          <p>
            面向受邀用户的在线德州扑克对局系统。平台仅使用虚拟筹码，牌局流程、行动校验、边池和结算均由服务端统一处理。
          </p>
          <div className="actions">
            <Link className="btn btnPrimary" href="/login">
              登录
            </Link>
            <Link className="btn" href="/rooms">
              进入房间列表
            </Link>
            <Link className="btn" href="/register">
              注册账号
            </Link>
          </div>
        </div>
        <div className="heroTable" aria-hidden="true" />
      </section>
    </main>
  );
}
