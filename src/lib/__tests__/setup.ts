/**
 * Shared test bootstrap.
 *
 * The formatters pin `timeZone: "UTC"` themselves, but pinning the process time
 * zone keeps any incidental `Date` maths (e.g. `daysUntil`) stable no matter
 * which machine runs the suite.
 */
process.env.TZ = "UTC";
