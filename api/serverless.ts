import handler from "../dist/server/vercel.js";

// Vercel's Node runtime treats a default export as `(req, res) => void`, which
// hands Hono an IncomingMessage instead of a Web Request and discards the
// returned Response (the request then hangs). Exporting only `fetch` opts into
// the Web-standard signature the handler actually expects.
export const fetch = handler;
