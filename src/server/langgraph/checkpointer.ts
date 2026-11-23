import "server-only";

import { readFile } from "node:fs/promises";

import { MemorySaver } from "@langchain/langgraph";
import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { Pool } from "pg";

const CHECKPOINT_SCHEMA = "ano_langgraph";

let saverPromise: Promise<BaseCheckpointSaver> | undefined;
let memorySaver: MemorySaver | undefined;

export function hasPostgresCheckpointerConfig(): boolean {
  return Boolean(process.env.SUPABASE_DB_URL?.trim()) && process.env.ANO_DATABASE_LABEL === "ano";
}

function configuredPostgresUrl(): string | null {
  const value = process.env.SUPABASE_DB_URL?.trim();
  if (!value) {
    return null;
  }
  if (process.env.ANO_DATABASE_LABEL !== "ano") {
    throw new Error("Ano refused to initialise graph persistence because the dedicated Ano database label is not set.");
  }
  return value;
}

async function sslConfig(url: string) {
  if (url.includes("localhost") || url.includes("127.0.0.1")) return false;
  const certificatePath = process.env.SUPABASE_DB_SSL_CA_PATH?.trim();
  if (!certificatePath) return { rejectUnauthorized: true };
  try {
    return { rejectUnauthorized: true, ca: await readFile(certificatePath, "utf8") };
  } catch {
    throw new Error("Ano could not read its configured database certificate for graph persistence.");
  }
}

/**
 * Returns the LangGraph checkpointer for Ano. When `SUPABASE_DB_URL` is absent
 * (as on Vercel serverless runtime where direct Postgres DDL credentials are
 * intentionally omitted), falls back to an in-memory saver because Ano persists
 * all durable workflow state in Supabase RLS tables.
 */
export async function getResearchCheckpointer(): Promise<BaseCheckpointSaver> {
  const url = configuredPostgresUrl();
  if (!url) {
    memorySaver ??= new MemorySaver();
    return memorySaver;
  }
  if (!saverPromise) {
    saverPromise = (async () => {
      const pool = new Pool({ connectionString: url, ssl: await sslConfig(url), max: 4 });
      const saver = new PostgresSaver(pool, undefined, { schema: CHECKPOINT_SCHEMA });
      await saver.setup();
      return saver;
    })().catch((error) => {
      saverPromise = undefined;
      throw error;
    });
  }
  return saverPromise;
}

export { CHECKPOINT_SCHEMA };
