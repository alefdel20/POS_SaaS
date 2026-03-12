const app = require("./app");
const pool = require("./db/pool");
const { port } = require("./config/env");

async function start() {
  await pool.query("SELECT 1");

  app.listen(port, () => {
    console.log(`Backend listening on port ${port}`);
  });
}

start().catch((error) => {
  console.error("Failed to start backend", error);
  process.exit(1);
});
