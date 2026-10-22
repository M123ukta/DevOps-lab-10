// Unit + structure tests for the AquaGrid dashboard. Run: node tests/dashboard.test.js
// Extracts the pure functions between "// @core-start" and "// @core-end" in index.html and tests them.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const core = html.split("// @core-start")[1].split("// @core-end")[0];
const ctx = {};
vm.createContext(ctx);
vm.runInContext(core + "\nthis.api = { THRESHOLDS, evaluateZone, buildAlerts, supplyState, filterByZone, computeAnalytics, prioritizeMaintenance };", ctx);
const api = ctx.api;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  PASS  ${name}`); }
  catch (e) { failed++; console.error(`  FAIL  ${name}\n        ${e.message}`); }
}
const zone = o => ({ id: "ZX", name: "Test", reservoir: 60, supplyKL: 1000, consumptionKL: 900, pressure: 3, schedule: ["06:00-09:00"], ...o });

console.log("AquaGrid dashboard tests");

// ---- Structure ----
test("page has at least five distribution zones", () => {
  const n = (html.match(/\{ id: "Z\d+"/g) || []).length;
  assert.ok(n >= 5, `found ${n} zones`);
});
["zoneGrid", "alertList", "scheduleTable", "zoneFilter", "totalSupply", "topZone", "leakTable", "maintenanceQueue"]
  .forEach(id => test(`element #${id} exists`, () => assert.ok(html.includes(`id="${id}"`))));
test("leak table has severity, detection time and maintenance status columns", () => {
  ["Severity", "Detected", "Maintenance Status"].forEach(c => assert.ok(html.includes(`<th>${c}</th>`), c));
});

// ---- Thresholds / alerts ----
test("thresholds are 2.0–4.5 bar and 25% reservoir", () => {
  assert.strictEqual(api.THRESHOLDS.PRESSURE_MIN, 2.0);
  assert.strictEqual(api.THRESHOLDS.PRESSURE_MAX, 4.5);
  assert.strictEqual(api.THRESHOLDS.RESERVOIR_MIN_PCT, 25);
});
test("normal zone produces no alert", () => assert.strictEqual(api.evaluateZone(zone()).status, "Normal"));
test("low pressure raises alert", () => {
  const r = api.evaluateZone(zone({ pressure: 1.8 }));
  assert.strictEqual(r.issues[0].type, "LOW_PRESSURE"); assert.strictEqual(r.status, "Warning");
});
test("very low pressure is Critical", () => assert.strictEqual(api.evaluateZone(zone({ pressure: 1.2 })).status, "Critical"));
test("high pressure raises alert", () => assert.strictEqual(api.evaluateZone(zone({ pressure: 4.8 })).issues[0].type, "HIGH_PRESSURE"));
test("reservoir below 25% raises alert", () => assert.strictEqual(api.evaluateZone(zone({ reservoir: 24.9 })).issues[0].type, "LOW_RESERVOIR"));
test("reservoir exactly 25% does not alert", () => assert.strictEqual(api.evaluateZone(zone({ reservoir: 25 })).issues.length, 0));
test("maintenance flag shown when no violations", () => assert.strictEqual(api.evaluateZone(zone({ maintenance: true })).status, "Maintenance"));
test("alerts are sorted Critical first", () => {
  const a = api.buildAlerts([zone({ id: "A", pressure: 1.8 }), zone({ id: "B", reservoir: 10 })]);
  assert.strictEqual(a[0].severity, "Critical"); assert.strictEqual(a[0].zoneId, "B");
});

// ---- Schedule ----
test("supply state ON inside window", () => assert.ok(api.supplyState(zone(), new Date(2026, 0, 1, 7, 0)).on));
test("supply state shows next window", () => {
  const s = api.supplyState(zone({ schedule: ["06:00-09:00", "17:00-20:00"] }), new Date(2026, 0, 1, 12, 0));
  assert.ok(!s.on); assert.ok(s.label.includes("17:00"));
});

// ---- Analytics / filtering ----
const zs = [zone({ id: "Z1", supplyKL: 1000, consumptionKL: 900 }), zone({ id: "Z2", supplyKL: 3000, consumptionKL: 2800 })];
test("total daily supply is summed", () => assert.strictEqual(api.computeAnalytics(zs).totalSupplyKL, 4000));
test("highest consumption zone found", () => assert.strictEqual(api.computeAnalytics(zs).topZone.id, "Z2"));
test("zone filter returns only selected zone", () => assert.deepStrictEqual(api.filterByZone(zs, "Z1").map(z => z.id), ["Z1"]));
test("zone filter ALL returns everything", () => assert.strictEqual(api.filterByZone(zs, "ALL").length, 2));

// ---- Maintenance prioritisation ----
test("maintenance queue: Critical leak first, resolved leaks excluded", () => {
  const leaks = [
    { id: "L1", zoneId: "Z1", location: "x", severity: "Medium", lossKL: 50, status: "Open" },
    { id: "L2", zoneId: "Z2", location: "y", severity: "Critical", lossKL: 400, status: "Open" },
    { id: "L3", zoneId: "Z2", location: "z", severity: "Critical", lossKL: 900, status: "Resolved" },
  ];
  const q = api.prioritizeMaintenance([{ severity: "High", zoneId: "Z1", message: "m" }], leaks);
  assert.strictEqual(q.length, 3); assert.ok(q[0].message.startsWith("L2")); assert.strictEqual(q[1].severity, "High");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
