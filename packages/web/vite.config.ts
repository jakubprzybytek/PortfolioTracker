import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Libraries in chunks of their own: they change less often than the app, so a deploy doesn't make the browser fetch
// them again, and the charts (Recharts, d3) only load with the first view that draws one.
const VENDOR_CHUNKS: [string, RegExp][] = [
  ["react", /node_modules\/(react|react-dom|scheduler|use-sync-external-store)\//],
  ["amplify", /node_modules\/(@aws-amplify|aws-amplify|@aws-crypto|@aws-sdk|@smithy)\//],
  ["charts", /node_modules\/(recharts|d3-[a-z-]+|victory-vendor|internmap|decimal\.js-light)\//],
];

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, strictPort: true },
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: VENDOR_CHUNKS.map(([name, test]) => ({ name, test })),
        },
      },
    },
  },
});
