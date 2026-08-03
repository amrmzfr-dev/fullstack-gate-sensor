import { useAuth } from "@/hooks/useAuth";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useTheme } from "@/hooks/useTheme";
import { DashboardPage } from "@/pages/DashboardPage";
import { LoginPage } from "@/pages/LoginPage";
import { MobileDashboardPage } from "@/pages/MobileDashboardPage";

export function App() {
  const isMobile = useIsMobile();
  const { isAuthenticated, login, logout } = useAuth();

  // Applies the `dark` class to <html> — needed here (not just inside
  // ThemeToggle) so the login page also respects the saved/system theme.
  useTheme();

  if (!isAuthenticated) {
    return <LoginPage onLogin={login} />;
  }

  return isMobile ? (
    <MobileDashboardPage onLogout={logout} />
  ) : (
    <DashboardPage onLogout={logout} />
  );
}
