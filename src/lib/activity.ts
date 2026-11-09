/* Lịch sử hoạt động của admin (không gồm Chủ) – giữ 7 ngày. Ghi tự động từ audit(). */

export type ActivityGroup = "attendance" | "schedule" | "bonus" | "people" | "payroll" | "revenue" | "finance" | "system" | "login";
export const GROUP_LABEL: Record<ActivityGroup, string> = {
  attendance: "Chấm công",
  schedule: "Xếp ca & duyệt ca",
  bonus: "Thưởng / phạt",
  people: "Nhân viên & thiết bị",
  payroll: "Bảng lương",
  revenue: "Chốt ca & doanh thu",
  finance: "Tài chính",
  system: "Cài đặt & khác",
  login: "Đăng nhập",
};

const A: Record<string, [ActivityGroup, string]> = {
  "attendance.manual": ["attendance", "Chấm công hộ"],
  "attendance.bulk": ["attendance", "Chấm công hộ hàng loạt"],
  "attendance.update": ["attendance", "Sửa chấm công"],
  "attendance.delete": ["attendance", "Xoá lượt chấm công"],
  "attendance.request.create": ["attendance", "Duyệt yêu cầu sửa công"],
  "adjustment.approve": ["attendance", "Duyệt yêu cầu sửa công"],
  "adjustment.reject": ["attendance", "Từ chối yêu cầu sửa công"],
  "schedule.add": ["schedule", "Xếp ca"],
  "schedule.remove": ["schedule", "Bỏ ca"],
  "schedule.approve": ["schedule", "Duyệt ca đăng ký"],
  "schedule.reject": ["schedule", "Từ chối ca đăng ký"],
  "schedule.auto": ["schedule", "Xếp ca tự động"],
  "schedule.staffing": ["schedule", "Đổi định mức người / ca"],
  "schedule.requestRegistration": ["schedule", "Yêu cầu nhân viên đăng ký ca"],
  "shift.assign": ["schedule", "Gán ca hàng loạt"],
  "shift.unassign": ["schedule", "Bỏ ca"],
  "shift.copyWeek": ["schedule", "Sao chép lịch tuần trước"],
  "shift.template.create": ["schedule", "Tạo ca mẫu"],
  "shift.template.update": ["schedule", "Sửa ca mẫu"],
  "cover.approve": ["schedule", "Duyệt nhờ làm hộ"],
  "cover.reject": ["schedule", "Từ chối nhờ làm hộ"],
  "bonusPenalty.create": ["bonus", "Thêm thưởng / phạt"],
  "bonusPenalty.update": ["bonus", "Sửa thưởng / phạt"],
  "bonusPenalty.delete": ["bonus", "Xoá thưởng / phạt"],
  "user.approve": ["people", "Duyệt nhân viên mới"],
  "user.reject": ["people", "Từ chối nhân viên"],
  "user.update": ["people", "Sửa thông tin nhân viên"],
  "user.wage": ["people", "Đổi lương giờ"],
  "device.approve": ["people", "Duyệt thiết bị"],
  "device.reject": ["people", "Từ chối thiết bị"],
  "device.revoke": ["people", "Thu hồi thiết bị"],
  "payroll.generate": ["payroll", "Tính bảng lương"],
  "payroll.publish": ["payroll", "Công bố bảng lương"],
  "payroll.paid": ["payroll", "Đánh dấu đã trả lương"],
  "payroll.unlock": ["payroll", "Mở khoá bảng lương"],
  "payroll.item.extras": ["payroll", "Sửa phụ cấp / ghi chú lương"],
  "feedback.reply": ["payroll", "Trả lời phản hồi lương"],
  "closing.revenue.edit": ["revenue", "Sửa doanh thu chốt ca"],
  "closing.delete": ["revenue", "Xoá lượt chốt ca"],
  "closing.admin.create": ["revenue", "Nhập bù chốt ca"],
  "closing.admin.overwrite": ["revenue", "Ghi đè chốt ca"],
  "closing.resend": ["revenue", "Gửi lại chốt ca lên Telegram"],
  "revenue.sheetSync": ["revenue", "Ghi doanh thu lên Google Sheet"],
  "expense.create": ["finance", "Nhập chi phí"],
  "expense.bulkCreate": ["finance", "Nhập chi phí (sao kê)"],
  "expense.update": ["finance", "Sửa chi phí"],
  "expense.delete": ["finance", "Xoá chi phí"],
  "fixedCost.create": ["finance", "Thêm tiền thuê nhà"],
  "fixedCost.update": ["finance", "Sửa tiền thuê nhà"],
  "fixedCost.delete": ["finance", "Xoá tiền thuê nhà"],
  "finance.settings": ["finance", "Đổi cài đặt tài chính"],
  "store.create": ["system", "Thêm cơ sở"],
  "store.update": ["system", "Sửa cơ sở"],
  "settings.config": ["system", "Đổi cấu hình chấm công"],
  "export.excel": ["system", "Xuất Excel"],
  "admin.password.change": ["system", "Đổi mật khẩu admin"],
  "admin.login": ["login", "Đăng nhập"],
  "admin.logout": ["login", "Đăng xuất"],
  "admin.account.approve": ["system", "Duyệt tài khoản admin"],
  "admin.account.update": ["system", "Sửa quyền admin"],
  "admin.account.logout": ["system", "Đăng xuất admin"],
  "admin.account.block": ["system", "Khoá admin"],
  "admin.account.unblock": ["system", "Mở khoá admin"],
  "admin.account.delete": ["system", "Xoá tài khoản admin"],
  "admin.device.approve": ["system", "Duyệt thiết bị admin"],
  "admin.device.remove": ["system", "Xoá thiết bị admin"],
  "user.staffPerms": ["people", "Cấp quyền quản lý cho nhân viên"],
  "user.transfer": ["people", "Chuyển tài khoản Gmail nhân viên"],
  "cash.transfer.create": ["revenue", "Ghi sổ quỹ TM / TK"],
  "cash.transfer.delete": ["revenue", "Xoá phiếu sổ quỹ"],
  "holiday.create": ["payroll", "Thêm ngày lễ"],
  "holiday.update": ["payroll", "Sửa ngày lễ"],
  "holiday.delete": ["payroll", "Xoá ngày lễ"],
  "holiday.addSolar": ["payroll", "Thêm nhanh ngày lễ"],
  "closing.sheetSync": ["revenue", "Ghi Google Sheet (bấm tay)"],
};

export function actionMeta(action: string): { group: ActivityGroup; label: string } {
  const m = A[action];
  return m ? { group: m[0], label: m[1] } : { group: "system", label: action };
}
export const actionsOf = (g: ActivityGroup) => Object.keys(A).filter((k) => A[k][0] === g);

const pad = (n: number) => String(n).padStart(2, "0");
const dm = (d: string) => (/^\d{4}-\d{2}-\d{2}/.test(d) ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : d);
const money = (n: number) => `${Math.round(n).toLocaleString("vi-VN")}đ`;
/** Giờ Việt Nam "HH:mm dd/mm" (không phụ thuộc múi giờ máy chủ). */
export function vnTime(d: Date | string) {
  const t = new Date(new Date(d).getTime() + 7 * 3600_000);
  return `${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())} ${pad(t.getUTCDate())}/${pad(t.getUTCMonth() + 1)}`;
}

type Data = Record<string, unknown>;
export type Names = { users: Map<string, string>; stores: Map<string, string> };

/** Các id nhân viên / cơ sở cần tra tên. */
export function refsOf(d: Data) {
  const users = new Set<string>();
  const stores = new Set<string>();
  for (const k of ["userId", "fromUserId", "toUserId"]) if (d[k]) users.add(String(d[k]));
  if (Array.isArray(d.userIds)) for (const u of d.userIds.slice(0, 20)) users.add(String(u));
  for (const k of ["storeId", "homeStoreId", "fromStoreId"]) if (d[k]) stores.add(String(d[k]));
  return { users, stores };
}

/** Câu mô tả ngắn từ dữ liệu nhật ký: "Lê Nga · 02/11 08:00→13:00 · lý do …". Hàm thuần. */
export function describe(action: string, d: Data, names: Names): string {
  const parts: string[] = [];
  const nm = (id: unknown) => names.users.get(String(id)) ?? "?";
  if (d.userId) parts.push(nm(d.userId));
  if (Array.isArray(d.userIds) && d.userIds.length) {
    const ns = d.userIds.slice(0, 4).map(nm);
    parts.push(ns.join(", ") + (d.userIds.length > 4 ? ` +${d.userIds.length - 4}` : ""));
  }
  if (d.fromUserId && d.toUserId) parts.push(`${nm(d.fromUserId)} → ${nm(d.toUserId)}`);
  if (d.storeId && names.stores.has(String(d.storeId))) parts.push(names.stores.get(String(d.storeId))!);
  if (d.shiftName) parts.push(String(d.shiftName));
  const date = d.date ?? d.workDate;
  if (d.checkInAt) {
    const a = vnTime(d.checkInAt as Date);
    parts.push(`${a.slice(6)} ${a.slice(0, 5)}→${d.checkOutAt ? vnTime(d.checkOutAt as Date).slice(0, 5) : "?"}`);
  } else if (date) parts.push(dm(String(date)));
  if (d.from && d.to) parts.push(d.from === d.to ? dm(String(d.from)) : `${dm(String(d.from))}–${dm(String(d.to))}`);
  if (d.weekStart) parts.push(`tuần ${dm(String(d.weekStart))}`);
  if (d.month) parts.push(`T${String(d.month).slice(5)}/${String(d.month).slice(0, 4)}`);
  if (typeof d.amountVnd === "number") parts.push(`${d.kind === "PENALTY" ? "phạt" : d.kind === "BONUS" ? "thưởng" : ""} ${money(d.amountVnd)}`.trim());
  if (typeof d.amount === "number") parts.push(money(d.amount));
  if (typeof d.hourlyWage === "number") parts.push(`${money(d.hourlyWage)}/giờ`);
  for (const k of ["created", "n", "approved", "added", "count"]) if (typeof d[k] === "number") parts.push(`${d[k]} ${k === "approved" ? "duyệt" : k === "added" ? "thêm" : "mục"}`);
  if (action.startsWith("closing.revenue") && typeof d.tm === "number") parts.push(`TM ${money(d.tm)} · TK ${money(Number(d.tk ?? 0))}`);
  const note = d.content ?? d.reason ?? d.reply ?? d.name;
  if (typeof note === "string" && note.trim()) parts.push(`“${note.trim().slice(0, 80)}”`);
  if (typeof d.ip === "string" && action.startsWith("admin.")) parts.push(`IP ${d.ip}`);
  return [...new Set(parts.filter(Boolean))].join(" · ");
}
