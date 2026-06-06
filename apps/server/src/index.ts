import { buildApp } from "./app";
import { config } from "./config";
import { hydrateRoomsFromDatabase } from "./roomStore";

async function main() {
  const app = await buildApp();
  await hydrateRoomsFromDatabase();
  await app.listen({ host: "0.0.0.0", port: config.port });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
