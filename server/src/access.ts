import type { FastifyRequest } from "fastify";

const ORDER_GET = new Set(["/api/health", "/api/session", "/api/categories", "/api/items", "/api/floor", "/api/live"]);

export function isCashierRequest(request: FastifyRequest): boolean {
  return isLoopback(clientAddress(request));
}

export function orderRouteAllowed(method: string, pathname: string): boolean {
  if (method === "GET" && ORDER_GET.has(pathname)) return true;
  if (method === "POST" && pathname === "/api/unlock") return true;
  if (method === "POST" && /^\/api\/tables\/\d+\/order$/.test(pathname)) return true;
  if (method === "GET" && /^\/api\/orders\/\d+$/.test(pathname)) return true;
  if (method === "POST" && pathname === "/api/parcels") return true;
  if (method === "POST" && /^\/api\/orders\/\d+\/send$/.test(pathname)) return true;
  if (method === "POST" && /^\/api\/orders\/\d+\/release$/.test(pathname)) return true;
  if (method === "DELETE" && /^\/api\/orders\/\d+\/lines\/\d+$/.test(pathname)) return true;
  return false;
}

function clientAddress(request: FastifyRequest): string {
  const socketIp = normalize(request.socket.remoteAddress ?? "");
  if (!isLoopback(socketIp)) return socketIp;
  const forwarded = request.headers["x-forwarded-for"];
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const first = raw?.split(",")[0]?.trim();
  return first ? normalize(first) : socketIp;
}

function normalize(ip: string): string {
  return ip.startsWith("::ffff:") ? ip.slice(7) : ip;
}

function isLoopback(ip: string): boolean {
  return ip === "127.0.0.1" || ip === "::1";
}
