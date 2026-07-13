import { useIsMobile } from "@/hooks/useIsMobile";
import { DashboardPage } from "@/pages/DashboardPage";
import { MobileDashboardPage } from "@/pages/MobileDashboardPage";

export function App() {
  const isMobile = useIsMobile();

  return isMobile ? <MobileDashboardPage /> : <DashboardPage />;
}
