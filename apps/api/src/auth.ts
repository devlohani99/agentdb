import type { Request, Response, NextFunction } from "express";
import type { Db } from "mongodb";

export type AuthedRequest = Request & { tenantId: string };

export function authMiddleware(db: Db) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const header = req.header("authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : header;
    if (!token) {
      res.status(401).json({ error: "missing api key" });
      return;
    }
    const doc = await db.collection("api_keys").findOne({ key: token });
    if (!doc?.tenantId || typeof doc.tenantId !== "string") {
      res.status(401).json({ error: "invalid api key" });
      return;
    }
    (req as AuthedRequest).tenantId = doc.tenantId;
    next();
  };
}
