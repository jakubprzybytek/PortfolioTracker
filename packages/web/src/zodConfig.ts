import { z } from "zod";

// Without this, zod probes for `new Function` the first time a schema is built; the site's CSP (script-src 'self', no
// 'unsafe-eval') blocks it, and the browser reports a CSP violation even though zod catches it and carries on.
// Imported first in main.tsx: the probe runs when schemas are created, at module load.
z.config({ jitless: true });
