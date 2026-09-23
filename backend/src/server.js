const { startServer } = require("./app");

// Registrados antes de startServer() para cubrir tambien fallos durante el arranque.
process.on("uncaughtException", (err) => {
  console.error("[FATAL] Uncaught exception:", err);
  process.exit(1);
});
process.on("unhandledRejection", (reason) => {
  console.error("[FATAL] Unhandled rejection:", reason);
  process.exit(1);
});

startServer()
  .then((server) => {
    const shutdown = () => {
      server.close(() => {
        process.exit(0);
      });
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  })
  .catch((error) => {
    console.error("Failed to initialize database compatibility", error);
    process.exit(1);
  });

