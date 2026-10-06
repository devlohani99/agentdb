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

export async function closeMongo(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
  }
}
