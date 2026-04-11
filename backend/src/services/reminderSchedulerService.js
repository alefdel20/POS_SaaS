const pool = require("../db/pool");
const { ensureAutomaticReminders } = require("./reminderService");

const SCHEDULER_INTERVAL_MS = 30 * 60 * 1000;
const ADVISORY_LOCK_NAMESPACE = 94321;

function isSchemaError(error) {
  return ["42P01", "42703", "42704"].includes(String(error?.code || ""));
}

async function runReminderSyncForBusiness(businessId) {
  const { rows: lockRows } = await pool.query(
    "SELECT pg_try_advisory_lock($1::int, $2::int) AS locked",
    [ADVISORY_LOCK_NAMESPACE, Number(businessId)]
  );

  const locked = Boolean(lockRows[0]?.locked);
  if (!locked) {
    return;
  }

  try {
    await ensureAutomaticReminders({ business_id: Number(businessId), role: "system", username: "scheduler" });
  } catch (error) {
    if (isSchemaError(error)) {
      console.warn("[REMINDER-SCHEDULER] schema not ready for business", businessId);
    } else {
      console.error("[REMINDER-SCHEDULER] business sync failed", { businessId, error: error?.message || error });
    }
  } finally {
    await pool.query(
      "SELECT pg_advisory_unlock($1::int, $2::int)",
      [ADVISORY_LOCK_NAMESPACE, Number(businessId)]
    ).catch(() => {});
  }
}

function startReminderScheduler(options = {}) {
  if (String(process.env.DISABLE_REMINDER_SCHEDULER || "").toLowerCase() === "true") {
    return { stop: () => {} };
  }

  const intervalMs = Number(options.intervalMs) > 0 ? Number(options.intervalMs) : SCHEDULER_INTERVAL_MS;
  let running = false;
  let timer = null;

  const runCycle = async () => {
    if (running) {
      return;
    }
    running = true;
    try {
      const { rows } = await pool.query(
        `SELECT id
         FROM businesses
         WHERE is_active = TRUE
         ORDER BY id ASC`
      );

      for (const row of rows) {
        await runReminderSyncForBusiness(Number(row.id));
      }
    } catch (error) {
      if (isSchemaError(error)) {
        console.warn("[REMINDER-SCHEDULER] schema not ready, skipping cycle");
      } else {
        console.error("[REMINDER-SCHEDULER] cycle failed", error?.message || error);
      }
    } finally {
      running = false;
    }
  };

  void runCycle();
  timer = setInterval(() => {
    void runCycle();
  }, intervalMs);
  timer.unref?.();

  return {
    stop: () => {
      if (!timer) {
        return;
      }
      clearInterval(timer);
      timer = null;
    }
  };
}

module.exports = {
  startReminderScheduler
};
