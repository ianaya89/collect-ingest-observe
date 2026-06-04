#!/usr/bin/env bash
# End-to-end smoke test: drives the gateway, then asserts telemetry landed in
# ClickHouse. Assumes the full stack is already up (docker compose up -d --build).
set -euo pipefail

GW=${GATEWAY_URL:-http://localhost:9999}
CH=${CLICKHOUSE_URL:-http://localhost:8123}

echo "==> waiting for gateway at $GW"
code=000
for _ in $(seq 1 30); do
  code=$(curl -s -o /dev/null -w '%{http_code}' "$GW/" || true)
  [ "$code" = "200" ] && break
  sleep 2
done
[ "$code" = "200" ] || { echo "FAIL: gateway not ready (last code $code)"; exit 1; }

echo "==> checking routes"
check() {
  local c
  c=$(curl -s -o /dev/null -w '%{http_code}' "$GW$1")
  [ "$c" = "$2" ] || { echo "FAIL: $1 expected $2 got $c"; exit 1; }
  echo "  ok $1 -> $c"
}
check / 200
check /users 200
check /orders 200
check /users/1/orders 200
check /error 500

echo "==> generating load"
for i in $(seq 1 20); do curl -s -o /dev/null "$GW/users/$((i % 10 + 1))/orders"; done

echo "==> waiting for collector batch flush + metric export interval"
sleep 20

echo "==> asserting traces in ClickHouse"
for svc in gateway-service user-service orders-service; do
  n=$(curl -s "$CH/" --data-binary "SELECT count() FROM default.otel_traces WHERE ServiceName='$svc'")
  echo "  $svc traces: ${n:-0}"
  [ "${n:-0}" -gt 0 ] || { echo "FAIL: no traces for $svc"; exit 1; }
done

echo "==> asserting gateway_request_count metric"
m=$(curl -s "$CH/" --data-binary "SELECT count() FROM default.otel_metrics_sum WHERE MetricName='gateway_request_count'")
echo "  metric rows: ${m:-0}"
[ "${m:-0}" -gt 0 ] || { echo "FAIL: no gateway_request_count metric"; exit 1; }

echo "SMOKE TEST PASSED"
