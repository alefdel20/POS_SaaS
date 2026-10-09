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

// 55P03 = lock_not_available (lock_timeout de la migracion de arranque). Es transitorio: otra sesion
// retiene un lock; se reintenta con backoff exponencial antes de salir. Cualquier otro error es fatal.
const LOCK_TIMEOUT_RETRY_DELAYS_MS = [2000, 4000, 8000, 16000, 32000];

async function startServerWithLockRetry() {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await startServer();
    } catch (error) {
      if (error?.code !== "55P03" || attempt >= LOCK_TIMEOUT_RETRY_DELAYS_MS.length) {
        throw error;
      }
      const delayMs = LOCK_TIMEOUT_RETRY_DELAYS_MS[attempt];
      console.warn(
        `[STARTUP] lock_timeout (55P03) during database migration; retry ${attempt + 1}/${LOCK_TIMEOUT_RETRY_DELAYS_MS.length} in ${delayMs / 1000}s`
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

startServerWithLockRetry()
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

