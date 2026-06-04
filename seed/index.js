require("dotenv").config();

const { Client } = require("pg");
const { faker } = require("@faker-js/faker");
const newLoger = require("../lib/logger");
const logger = newLoger.logger(process.env.OTEL_SERVICE_NAME);

const client = new Client({
  host: process.env.POSTGRES_HOST || "localhost",
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
  database: process.env.POSTGRES_DB,
  port: process.env.POSTGRES_PORT || 5432,
});

async function seed() {
  try {
    await client.connect();
    logger.info("connected to PostgreSQL");

    // Cleanup step: Drop tables if they exist
    await client.query(`
      DROP TABLE IF EXISTS orders;
      DROP TABLE IF EXISTS users;
    `);
    logger.info("existing tables dropped");

    // Create the "users" table
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100),
        email VARCHAR(100) UNIQUE,
        age INT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    logger.info("users table created");

    const userData = Array.from({ length: 10 }).map(() => [
      faker.person.fullName(),
      faker.internet.email(),
      faker.number.int({ min: 18, max: 80 }),
    ]);

    const insertUserQuery = `
      INSERT INTO users (name, email, age)
      VALUES ($1, $2, $3) RETURNING id
    `;

    const userIds = [];
    for (const user of userData) {
      const res = await client.query(insertUserQuery, user);
      userIds.push(res.rows[0].id);
    }
    logger.info("users table seeded with fake data");

    await client.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id SERIAL PRIMARY KEY,
        order_number VARCHAR(20) UNIQUE,
        total_amount DECIMAL(10, 2),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        user_id INT REFERENCES users(id) ON DELETE CASCADE
      )
    `);
    logger.info("orders table created");

    const orderData = Array.from({ length: 20 }).map(() => [
      faker.string.uuid().slice(0, 20),
      faker.commerce.price({ min: 10, max: 500 }),
      faker.helpers.arrayElement(userIds),
    ]);

    const insertOrderQuery = `
      INSERT INTO orders (order_number, total_amount, user_id)
      VALUES ($1, $2, $3) ON CONFLICT DO NOTHING
    `;

    for (const order of orderData) {
      await client.query(insertOrderQuery, order);
    }

    logger.info("Orders table seeded with fake data");
  } catch (error) {
    console.error("error seeding database:", error);
  } finally {
    await client.end();
    logger.info("disconnected from PostgreSQL");
  }
}

seed();
