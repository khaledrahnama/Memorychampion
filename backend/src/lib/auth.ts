import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config.js";

export interface AuthedRequest extends Request {
  accountId?: string;
}

function readToken(req: Request): string | undefined {
  const header = req.headers.authorization;
  return header?.startsWith("Bearer ") ? header.slice(7) : undefined;
}

function verify(token: string): string | undefined {
  try {
    return (jwt.verify(token, config.jwtSecret) as { accountId: string }).accountId;
  } catch {
    return undefined;
  }
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const token = readToken(req);
  const accountId = token && verify(token);
  if (!accountId) return res.status(401).json({ error: "Please sign in again" });
  req.accountId = accountId;
  next();
}

/** Attaches accountId when a valid token is present, but never rejects. */
export function optionalAuth(req: AuthedRequest, _res: Response, next: NextFunction) {
  const token = readToken(req);
  if (token) req.accountId = verify(token);
  next();
}

export function signToken(accountId: string): string {
  return jwt.sign({ accountId }, config.jwtSecret, { expiresIn: "30d" });
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!config.adminKey) return res.status(503).json({ error: "Admin is disabled: set ADMIN_KEY on the server" });
  if (req.headers["x-admin-key"] !== config.adminKey) return res.status(401).json({ error: "Wrong admin key" });
  next();
}
