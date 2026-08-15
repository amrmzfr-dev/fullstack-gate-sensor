import { useAuth } from "@/hooks/useAuth";
import { useIsMobile } from "@/hooks/useIsMobile";
import { DashboardPage } from "@/pages/DashboardPage";
import { LoginPage } from "@/pages/LoginPage";
import { MobileDashboardPage } from "@/pages/MobileDashboardPage";

// Dark-only app now (see index.html's <html class="dark">) — no light
// variant, no toggle.
export function App() {
  const isMobile = useIsMobile();
  const { isAuthenticated, username, login, logout } = useAuth();

  if (!isAuthenticated) {
    return <LoginPage onLogin={login} />;
  }

  return isMobile ? (
    <MobileDashboardPage username={username} onLogout={logout} />
  ) : (
    <DashboardPage username={username} onLogout={logout} />
  );
}
