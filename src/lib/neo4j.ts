import neo4j, { type Driver } from "neo4j-driver";

function getEnv(name: "NEO4J_URI" | "NEO4J_USERNAME" | "NEO4J_PASSWORD"): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`[neo4j] Missing env var: ${name}`);
  }
  return value;
}

type Neo4jGlobal = typeof globalThis & {
  __neo4jDriver?: Driver;
};

const globalForNeo4j = globalThis as Neo4jGlobal;

export const neo4jDriver =
  globalForNeo4j.__neo4jDriver ??
  neo4j.driver(
    getEnv("NEO4J_URI"),
    neo4j.auth.basic(getEnv("NEO4J_USERNAME"), getEnv("NEO4J_PASSWORD")),
    {
      disableLosslessIntegers: true,
    },
  );

if (process.env.NODE_ENV !== "production") {
  globalForNeo4j.__neo4jDriver = neo4jDriver;
}

export async function runCypher<T = Record<string, unknown>>(
  query: string,
  params: Record<string, unknown> = {},
): Promise<T[]> {
  const session = neo4jDriver.session();
  try {
    const result = await session.run(query, params);
    return result.records.map((record: { toObject: () => object }) => record.toObject() as T);
  } finally {
    await session.close();
  }
}
