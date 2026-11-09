import { test } from "node:test";
import assert from "node:assert/strict";
import { can, canAny, isAdminPerm, managedStoreIds, staffCan } from "../src/lib/permissions";

test("phân quyền admin: Chủ có mọi quyền, admin mặc định không có, chỉ có quyền được cấp", () => {
  const owner = { kind: "OWNER" as const, perms: [] };
  const admin = { kind: "ADMIN" as const, perms: [] as string[] };
  const fin = { kind: "ADMIN" as const, perms: ["finance.bills"] };
  assert.equal(can(owner, "payroll"), true);
  assert.equal(can(admin, "payroll"), false);
  assert.equal(can(admin, "payEstimate"), false);
  assert.equal(can(admin, "adjustments"), false); // duyệt chấm công bù: mặc định chỉ Chủ
  assert.equal(can(fin, "finance.bills"), true);
  assert.equal(can(fin, "finance.rent"), false);
  assert.equal(canAny(fin, ["finance.rent", "finance.bills"]), true);
  assert.equal(can(null, "export"), false);
  assert.equal(isAdminPerm("finance.bills"), true);
  assert.equal(isAdminPerm("revenue"), false); // doanh thu: chỉ Chủ, không cấp được
});

test("quyền nhân viên: cơ sở quản lý = cơ sở gốc + cơ sở thêm (bỏ trùng)", () => {
  assert.deepEqual(managedStoreIds({ storeId: "a", managerStoreIds: ["b", "a"] }), ["a", "b"]);
  assert.deepEqual(managedStoreIds({ storeId: "a" }), ["a"]);
  assert.equal(staffCan({ managerPerms: ["schedule"] }, "schedule"), true);
  assert.equal(staffCan({ managerPerms: ["schedule"] }, "bonus"), false);
  assert.equal(staffCan(null, "cover"), false);
});
