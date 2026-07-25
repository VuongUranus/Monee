import { useFinanceStore } from "@/store/finance-store";

export function AuthGate() {
  const auth = useFinanceStore((state) => state.auth);
  const message = useFinanceStore((state) => state.authMessage);
  const beginLogin = useFinanceStore((state) => state.beginLogin);

  return (
    <main className="auth-gate" aria-live="polite">
      <div className="auth-card">
        <div className="brand-mark" aria-hidden="true">₫</div>
        <p className="eyebrow">Tài chính cá nhân</p>
        <h1>{auth === "checking" ? "Đang kiểm tra đăng nhập…" : "Theo dõi quỹ và chi tiêu"}</h1>
        <p>Dữ liệu của mỗi tài khoản được lưu riêng trong file dữ liệu trên server.</p>
        {auth !== "checking" ? (
          <button className="btn primary" type="button" onClick={beginLogin}>Đăng nhập với Google</button>
        ) : null}
        <div className="auth-status">{message}</div>
      </div>
    </main>
  );
}
