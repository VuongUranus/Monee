import { useFinanceStore } from "@/store/finance-store";

export function AuthGate() {
  const auth = useFinanceStore((state) => state.auth);
  const message = useFinanceStore((state) => state.authMessage);
  const beginLogin = useFinanceStore((state) => state.beginLogin);
  const checking = auth === "checking";

  return (
    <main className="auth-gate" aria-live="polite">
      <div className="auth-card">
        <div className="brand-mark" aria-hidden="true">₫</div>
        <p className="eyebrow">Tài chính cá nhân</p>
        <h1>{checking ? "Đang kiểm tra đăng nhập…" : "Theo dõi quỹ và chi tiêu"}</h1>
        <p>{checking ? "Đang tải dữ liệu của bạn…" : "Dữ liệu của mỗi tài khoản được lưu riêng tư và an toàn."}</p>
        {checking ? (
          <div className="auth-progress" role="progressbar" aria-label="Đang tải dữ liệu của bạn">
            <span />
          </div>
        ) : (
          <button className="btn primary" type="button" onClick={beginLogin}>Đăng nhập với Google</button>
        )}
        <div className="auth-status">{message}</div>
      </div>
    </main>
  );
}
