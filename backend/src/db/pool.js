const { Pool } = require("pg");
const { db } = require("../config/env");

module.exports = new Pool(db);
