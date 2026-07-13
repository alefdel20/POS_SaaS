const express = require("express");
const controller = require("../controllers/internalReminderController");
const requireInternalToken = require("../middleware/internalAuth");

const router = express.Router();

// Every route here is for ankode-agent only (service-to-service, bearer
// ANKODE_INTERNAL_TOKEN) — no JWT user context, mounted with auth: false at
// the app.js table level, same pattern as automationRoutes.js.
router.use(requireInternalToken);

// Mounted at /internal (see app.js) — matches the ankode-agent contract:
// /internal/reminders/... for reminder actions, /internal/daily-digest for
// the business-wide summary (not nested under /reminders).
router.get("/reminders/due", controller.listDueValidation, controller.listDueReminders);
router.post("/reminders/:eventId/mark-sent", controller.markSentValidation, controller.markReminderSent);
router.post("/reminders/:eventId/cancel", controller.eventIdValidation, controller.cancelReminderEvent);
router.post("/reminders/:eventId/reschedule", controller.rescheduleValidation, controller.rescheduleReminderEvent);
router.get("/daily-digest", controller.dailyDigestValidation, controller.getDailyDigest);

module.exports = router;
