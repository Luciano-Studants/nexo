
import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "A variável DATABASE_URL não foi configurada."
  );
}

export const db = new Pool({
  connectionString,
  ssl:
    process.env.DATABASE_SSL === "true"
      ? { rejectUnauthorized: true }
      : undefined,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 15_000,
});

db.on("error", (error) => {
  console.error(
    "Erro inesperado no pool do banco:",
    error.message
  );
});
