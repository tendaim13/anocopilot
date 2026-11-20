import "server-only";

import { readFile } from "node:fs/promises";

import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { Pool } from "pg";

const CHECKPOINT_SCHEMA = "ano_langgraph";

let saverPromise: Promise<PostgresSaver> | undefined;

function databaseUrl() {
  if (process.env.ANO_DATABASE_LABEL !== "ano") {
    throw new Error("Ano refused to initialise graph persistence because the dedicated Ano database label is not set.");
  }
  const value = process.env.SUPABASE_DB_URL?.trim();
  if (!value) throw new Error("Ano cannot resume conversations until its server-side Postgres connection is configured.");
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
 * Creates one server-only checkpointer for Ano's dedicated database. LangGraph
 * owns low-level execution checkpoints; Ano's own records remain the source of
 * truth for conversations, approvals, and audit history.
 */
export async function getResearchCheckpointer() {
  if (!saverPromise) {
    saverPromise = (async () => {
      const url = databaseUrl();
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
