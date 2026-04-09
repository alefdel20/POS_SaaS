const { startServer } = require("./app");

startServer().catch((error) => {
  console.error("Failed to initialize database compatibility", error);
  process.exit(1);
});

