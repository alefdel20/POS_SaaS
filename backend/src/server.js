const { startServer } = require("./app");

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

