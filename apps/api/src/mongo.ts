import { MongoClient, type Db } from "mongodb";
import type { Env } from "@relay/shared";

let client: MongoClient | null = null;

export async function connectMongo(env: Env): Promise<Db> {
  if (!client) {
    client = new MongoClient(env.MONGODB_URI);
    await client.connect();
  }
  return client.db("relay");
}

export function getMongoClient(): MongoClient {
  if (!client) {
    throw new Error("mongo not connected");
  }
  return client;
}

export async function closeMongo(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
  }
}

export async function ensureIndexes(db: Db): Promise<void> {
  await db.collection("api_keys").createIndex({ key: 1 }, { unique: true });
  await db.collection("outbox").createIndex({ published: 1, createdAt: 1 });
  await db.collection("tickets").createIndex({ tenantId: 1, createdAt: -1 });
}

export async function ensureDemoTenant(db: Db): Promise<void> {
  const tenants = [
    { _id: "demo", name: "Acme Corp", key: "dev-demo-key" },
    { _id: "demo-b", name: "Globex", key: "dev-demo-b-key" },
  ] as const;
  for (const t of tenants) {
    await db.collection<{ _id: string; name: string }>("tenants").updateOne(
      { _id: t._id },
      { $setOnInsert: { name: t.name, createdAt: new Date() } },
      { upsert: true },
    );
    await db.collection("api_keys").updateOne(
      { key: t.key },
      { $setOnInsert: { tenantId: t._id, createdAt: new Date() } },
      { upsert: true },
    );
  }
}
