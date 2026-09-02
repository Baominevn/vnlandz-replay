import type { IncomingMessage, ServerResponse } from "http";
import app from "../server.ts";

export default function handler(req: IncomingMessage, res: ServerResponse) {
  // If running in Vercel or Serverless with rewrites, restore original path
  const headers = req.headers || {};
  const matchedPath =
    (headers["x-matched-path"] as string) ||
    (headers["x-vercel-matched-path"] as string) ||
    (headers["x-forwarded-uri"] as string) ||
    (headers["x-real-url"] as string) ||
    (headers["x-original-url"] as string);

  if (matchedPath && typeof matchedPath === "string") {
    const originalQuery = req.url && req.url.includes("?") ? "?" + req.url.split("?")[1] : "";
    req.url = matchedPath.includes("?") ? matchedPath : matchedPath + originalQuery;
  } else if (req.url) {
    if (req.url.startsWith("/api/index.ts")) {
      const query = req.url.includes("?") ? "?" + req.url.split("?")[1] : "";
      const pathOnly = req.url.split("?")[0].replace(/^\/api\/index\.ts/, "") || "/";
      req.url = pathOnly + query;
    } else if (req.url.startsWith("/api/index")) {
      const query = req.url.includes("?") ? "?" + req.url.split("?")[1] : "";
      const pathOnly = req.url.split("?")[0].replace(/^\/api\/index/, "") || "/";
      req.url = pathOnly + query;
    }
  }

  return (app as any)(req, res);
}

