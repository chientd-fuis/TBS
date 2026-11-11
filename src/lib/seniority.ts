/*
 * Thâm niên nhân viên = từ ngày bắt đầu làm (sớm nhất trong: ngày vào làm admin duyệt, ngày đi làm đầu tiên đã lưu
 * khi dọn chấm công cũ, lượt chấm công sớm nhất còn lại) đến hôm nay.
 * Không phụ thuộc bảng chấm công → dọn chấm công cũ vẫn giữ đúng thâm niên.
 */

/** Ngày bắt đầu (YYYY-MM-DD) – lấy ngày sớm nhất có được. */
export function seniorityStart(dates: (string | null | undefined)[]): string | null {
  const ok = dates.filter((d): d is string => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  return ok[0] ?? null;
}

/** "2 năm 3 tháng" · "5 tháng 12 ngày" · "12 ngày" */
export function seniorityText(from: string, today: string): string {
  const [y1, m1, d1] = from.split("-").map(Number);
  const [y2, m2, d2] = today.split("-").map(Number);
  if (from > today) return "chưa bắt đầu";
  let months = (y2 - y1) * 12 + (m2 - m1);
  let days = d2 - d1;
  if (days < 0) {
    months -= 1;
    days += new Date(Date.UTC(y2, m2 - 1, 0)).getUTCDate(); // số ngày của tháng trước tháng hiện tại
  }
  const y = Math.floor(months / 12);
  const m = months % 12;
  if (y) return m ? `${y} năm ${m} tháng` : `${y} năm`;
  if (m) return days ? `${m} tháng ${days} ngày` : `${m} tháng`;
  return `${days} ngày`;
}
