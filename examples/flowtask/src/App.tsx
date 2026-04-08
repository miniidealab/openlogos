import { useEffect, useState } from "react";
import { checkHasUser } from "./lib/ipc";
import { useAppStore } from "./store/appStore";
import AuthPage from "./pages/AuthPage";
import TasksPage from "./pages/TasksPage";
import SettingsPage from "./pages/SettingsPage";

type AppView = "loading" | "auth" | "tasks" | "settings";

export default function App() {
  const currentUser = useAppStore((s) => s.currentUser);
  const [view, setView] = useState<AppView>("loading");

  useEffect(() => {
    checkHasUser()
      .then(() => setView("auth"))
      .catch(() => setView("auth"));
  }, []);

  useEffect(() => {
    if (currentUser && (view === "loading" || view === "auth")) setView("tasks");
    if (!currentUser && (view === "tasks" || view === "settings")) setView("auth");
  }, [currentUser]);

  if (view === "loading") {
    return (
      <div className="min-h-screen bg-[#FAFAFA] flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-[#18181B] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (view === "auth") return <AuthPage />;
  if (view === "settings") return <SettingsPage onBack={() => setView("tasks")} />;
  return <TasksPage onSettings={() => setView("settings")} />;
}
