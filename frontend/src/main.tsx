import React, { useEffect, useMemo, useState } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { api, type AppConfig } from "./lib/api";
import { AppConfigContext } from "./lib/hooks";
import { makeWagmiConfig } from "./lib/web3";
import { Layout } from "./components/Layout";
import { AccountPage } from "./pages/AccountPage";
import { GamesPage } from "./pages/GamesPage";
import { GamePage } from "./pages/GamePage";
import { ResultsPage } from "./pages/ResultsPage";
import { HostPage } from "./pages/HostPage";
import "@fontsource-variable/archivo/wdth.css";
import "@fontsource-variable/manrope";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "@fontsource/jetbrains-mono/700.css";
import "./index.css";

const queryClient = new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false } } });

function App() {
  const [cfg, setCfg] = useState<AppConfig | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<AppConfig>("/config").then(setCfg).catch((e) => setError(e.message));
  }, []);
  const wagmiConfig = useMemo(() => (cfg ? makeWagmiConfig(cfg) : null), [cfg]);

  if (error) {
    return (
      <div className="min-h-screen grid place-items-center p-6 text-center">
        <div>
          <p className="text-lg font-semibold">Can't reach the game server</p>
          <p className="text-slate-400 mt-2">{error}</p>
          <button className="btn-primary mt-4" onClick={() => location.reload()}>Try again</button>
        </div>
      </div>
    );
  }
  if (!cfg || !wagmiConfig) return <div className="min-h-screen grid place-items-center text-slate-400">Loading…</div>;

  return (
    <AppConfigContext.Provider value={cfg}>
      <WagmiProvider config={wagmiConfig}>
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <Routes>
              <Route element={<Layout />}>
                <Route path="/" element={<GamesPage />} />
                <Route path="/games" element={<Navigate to="/" replace />} />
                <Route path="/account" element={<AccountPage />} />
                <Route path="/games/:gameId" element={<GamePage />} />
                <Route path="/games/:gameId/results" element={<ResultsPage />} />
                <Route path="/host" element={<HostPage />} />
                <Route path="/admin" element={<Navigate to="/host" replace />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Route>
            </Routes>
          </BrowserRouter>
        </QueryClientProvider>
      </WagmiProvider>
    </AppConfigContext.Provider>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
