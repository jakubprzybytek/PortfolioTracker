import type { APIResponse, Route } from "@playwright/test";

/**
 * The real response to an intercepted request, always with its body. The app keeps each GET's last answer with its
 * ETag and asks again with `x-if-none-match` (api.ts), so a request it has made before gets 304 Not Modified, no
 * body, and a test that reads the response to change it fails ("Unexpected end of JSON input"). Without that header
 * it's a 200 with the body.
 */
export async function fetchFresh(route: Route): Promise<APIResponse> {
  const headers = await route.request().allHeaders();
  delete headers["x-if-none-match"];
  return route.fetch({ headers });
}
