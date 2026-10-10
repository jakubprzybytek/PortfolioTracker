import { useEffect, useState } from "react";
import { api } from "./api.ts";

export function App() {
  const [status, setStatus] = useState<string>("loading…");
  useEffect(() => {
    api<unknown>("/status")
      .then((s) => setStatus(JSON.stringify(s, null, 2)))
      .catch((e) => setStatus(`error: ${(e as Error).message}`));
  }, []);
  return (
    <main>
      <h1>Portfolio Tracker</h1>
      <pre>{status}</pre>
    </main>
  );
}
