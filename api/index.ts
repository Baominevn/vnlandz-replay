import type { IncomingMessage, ServerResponse } from "http";
import app from "../server.ts";

function resolveActualPath(req: IncomingMessage): string {
  const headers = req.headers || {};

  // Headers that might contain the original requested path before rewrites
  const candidateHeaders = [
    headers["x-vercel-matched-path"],
    headers["x-forwarded-uri"],
    headers["x-real-url"],
    headers["x-original-url"],
    headers["x-original-uri"],
    headers["x-rewrite-url"],
    headers["x-invoke-path"],
  ];

  for (const h of candidateHeaders) {
    if (typeof h === "string" && h.trim() && !h.startsWith("/api/index")) {
      return h.trim();
    }
  }

  const rawUrl = req.url || "/";
  if (rawUrl.startsWith("/api/index.ts") || rawUrl.startsWith("/api/index")) {
    const queryPart = rawUrl.includes("?") ? rawUrl.substring(rawUrl.indexOf("?")) : "";
    const cleanPath = rawUrl.split("?")[0].replace(/^\/api\/index(\.ts)?/, "").trim();
    return (cleanPath || "/") + queryPart;
  }

  return rawUrl;
}

export default function handler(req: IncomingMessage, res: ServerResponse) {
  const actualPath = resolveActualPath(req);
  if (actualPath && actualPath !== req.url) {
    req.url = actualPath;
  }
  return (app as any)(req, res);
}


