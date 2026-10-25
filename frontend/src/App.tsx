import { BrowserRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import Nav from "./components/Nav";
import Overview from "./pages/Overview";
import DayView from "./pages/DayView";
import Accuracy from "./pages/Accuracy";

const qc = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

function RoutedPage() {
  const { pathname } = useLocation();
  return (
    <div key={pathname} className="page-in pt-[4.5rem]">
      <main className="mx-auto max-w-7xl px-6 py-6">
        <Routes>
          <Route path="/" element={<Overview />} />
          <Route path="/day" element={<DayView />} />
          <Route path="/day/:day" element={<DayView />} />
          <Route path="/accuracy" element={<Accuracy />} />
        </Routes>
      </main>
      <footer className="mx-auto max-w-7xl px-6 pb-10 pt-2 text-[11px] text-slate-600">
        Contains BMRS data © Elexon Limited copyright and database right. Built for
        the Full Stack SWE challenge — scope limited to FUELHH (actuals) and WINDFOR
        (forecasts).
      </footer>
    </div>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <div className="min-h-screen">
          <Nav />
          <RoutedPage />
        </div>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
