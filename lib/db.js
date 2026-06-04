require("dotenv").config();
const { Pool } = require("pg");

const pool = new Pool({
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
  database: process.env.POSTGRES_DB,
  port: process.env.POSTGRES_PORT || 5432,
});

// Idle clients emit 'error' on backend disconnect; unhandled it crashes the process
pool.on("error", (err) => {
  console.error("unexpected postgres pool error", err);
});

exports.pool = pool;
