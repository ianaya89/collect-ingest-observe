require("dotenv").config();
const express = require("express");
const axios = require("axios");
const newLoger = require("../../lib/logger");
const { version } = require("./package.json");
const { metrics } = require("@opentelemetry/api");
const { trace } = require("@opentelemetry/api");

const service = process.env.OTEL_SERVICE_NAME;
const logger = newLoger.logger(service);

const app = express();
const port = process.env.PORT;

const SERVICES = {
  users: process.env.USERS_URL || "http://localhost:9998/",
  orders: process.env.ORDERS_URL || "http://localhost:9997/",
};

// Custom metric counter for http requests
const meter = metrics.getMeter("gateway-meter");
const requestCounter = meter.createCounter("gateway_request_count", {
  description: "gatway request count",
});

app.use((req, res, next) => {
  requestCounter.add(1);

  // Add a custom attribute to the active span
  const activeSpan = trace.getActiveSpan();
  if (activeSpan) {
    activeSpan.setAttribute("user", "root");
  }

  next();
});

app.get("/", async (_, res) => {
  res.send(`${service} v${version}`);
});

app.get("/orders", async (_, res) => {
  try {
    const apiRes = await axios.get(SERVICES.orders);
    res.send(apiRes.data);
  } catch (err) {
    logger.error("orders service failed", err);
    res.status(500).send();
  }
});

app.get("/users/:userId/orders", async (req, res) => {
  try {
    const apiRes = await axios.get(SERVICES.orders + req.params.userId);
    res.send(apiRes.data);
  } catch (err) {
    logger.error("orders service failed", err);
    res.status(500).send();
  }
});

app.get("/users", async (_, res) => {
  try {
    const apiRes = await axios.get(SERVICES.users);
    res.send(apiRes.data);
  } catch (err) {
    logger.error("users service failed", err);
    res.status(500).send();
  }
});

app.get("/error", async (_, res) => {
  logger.error("not implemented");
  res.status(500).send();
});

app.listen(port, () => {
  logger.info(`${service} v${version}: localhost:${port}`);
});
