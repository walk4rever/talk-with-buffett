import neo4j from "neo4j-driver";

function required(name: "NEO4J_URI" | "NEO4J_USERNAME" | "NEO4J_PASSWORD"): string {
  const v = process.env[name];
  if (!v) throw new Error(`[neo4j-smoke-test] Missing env var: ${name}`);
  return v;
}

async function main() {
  const driver = neo4j.driver(
    required("NEO4J_URI"),
    neo4j.auth.basic(required("NEO4J_USERNAME"), required("NEO4J_PASSWORD")),
    { disableLosslessIntegers: true },
  );

  const session = driver.session();
  try {
    const result = await session.run(
      "RETURN 'neo4j ok' AS msg, datetime() AS now, 1 + 1 AS two",
    );
    const row = result.records[0];
    console.log({
      msg: row?.get("msg"),
      now: row?.get("now")?.toString?.() ?? row?.get("now"),
      two: row?.get("two"),
    });
  } finally {
    await session.close();
    await driver.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
