module.exports = (err, req, res, next) => {
  const schemaError = ["42P01", "42703", "42704"].includes(String(err?.code || ""));
  const statusCode = schemaError ? 503 : (err.statusCode || 500);

  if (statusCode >= 500) {
    console.error(err);
  }

  res.status(statusCode).json({
    message: schemaError ? "Feature schema is not ready" : (err.message || "Internal server error"),
    details: err.details || null
  });
};
