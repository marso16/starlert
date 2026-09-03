import type { Request, Response, NextFunction } from "express";
import { verifySessionCookie, SESSION_COOKIE_NAME } from "../../auth/session";

declare global {
  namespace Express {
    interface Request {
      auth?: { userId: string; tenantId: string };
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const cookieValue = req.cookies?.[SESSION_COOKIE_NAME];
  const session = cookieValue ? verifySessionCookie(cookieValue) : null;
  if (!session) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  req.auth = { userId: session.userId, tenantId: session.tenantId };
  next();
}
