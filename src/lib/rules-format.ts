/*
 * Định dạng nội quy cho nhân viên dễ đọc (admin gõ chữ thường, không cần biết HTML):
 *   # Tiêu đề nhóm        → tiêu đề
 *   1. Nội dung điều 1     → thẻ có số thứ tự (dòng tiếp theo không đánh số = giải thích thêm của điều đó)
 *   - gạch đầu dòng        → ý nhỏ
 *   **chữ đậm**            → in đậm
 *   ! Lưu ý quan trọng     → khung cảnh báo
 */
export type RuleBlock =
  | { kind: "heading"; text: string }
  | { kind: "item"; no: string; text: string; sub: string[] }
  | { kind: "bullet"; text: string }
  | { kind: "note"; text: string }
  | { kind: "para"; text: string };

export function parseRules(src: string): RuleBlock[] {
  const out: RuleBlock[] = [];
  for (const raw of (src || "").replace(/\r/g, "").split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const last = out[out.length - 1];
    let m: RegExpExecArray | null;
    if ((m = /^#{1,3}\s*(.+)$/.exec(line))) out.push({ kind: "heading", text: m[1] });
    else if ((m = /^(\d{1,2})[.)]\s*(.+)$/.exec(line))) out.push({ kind: "item", no: m[1], text: m[2], sub: [] });
    else if ((m = /^!\s*(.+)$/.exec(line))) out.push({ kind: "note", text: m[1] });
    else if ((m = /^[-•*+]\s+(.+)$/.exec(line))) {
      if (last?.kind === "item") last.sub.push(m[1]);
      else out.push({ kind: "bullet", text: m[1] });
    } else if (last?.kind === "item") last.sub.push(line);
    else out.push({ kind: "para", text: line });
  }
  return out;
}

/** "**đậm** thường" → các đoạn [text, bold]. */
export function boldParts(text: string): [string, boolean][] {
  return text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((p) => (p.startsWith("**") && p.endsWith("**") ? [p.slice(2, -2), true] : [p, false]));
}

/** Mẫu 10 điều nội quy – admin sửa lại cho đúng quán (Cài đặt → AI → Nội quy, quy định). */
export const RULES_TEMPLATE = `# NỘI QUY CỬA HÀNG TIỆM BƠ SẦU
! Mẫu tham khảo – Admin vui lòng chỉnh mức phạt / thời gian cho đúng quy định của quán.

1. **Đúng giờ:** có mặt trước giờ vào ca **5 phút** để thay đồng phục, nhận bàn giao.
- Đi muộn quá 5 phút: nhắc nhở lần 1, từ lần 2 trong tháng phạt **20.000 ₫ / lần**.
- Chấm công trên app ngay khi đến quán (CHECK-IN) và khi về (CHECK-OUT).
2. **Đồng phục & vệ sinh cá nhân:** mặc áo đồng phục, đeo tạp dề, buộc gọn tóc, móng tay sạch, không đeo trang sức ở tay khi pha chế.
3. **Thái độ phục vụ:** luôn chào khách, mỉm cười, lễ phép. Không tranh cãi với khách – có vấn đề báo ngay quản lý ca.
4. **Điện thoại:** không dùng điện thoại cá nhân khi đang pha chế / phục vụ. Chỉ dùng khi nghỉ hoặc có việc gấp (báo quản lý).
5. **Vệ sinh an toàn thực phẩm:** rửa tay trước khi pha chế, dùng găng tay khi xử lý sầu riêng & topping, lau dọn quầy sau mỗi đơn.
6. **Bảo quản nguyên liệu:** làm đúng quy trình bảo quản, ghi ngày mở lên hộp / chai. Nguyên liệu có dấu hiệu hỏng → **ngừng dùng ngay** và báo quản lý.
7. **Tiền & két:** nhận – trả tiền rõ ràng, không để tiền ngoài két. Mọi khoản chi từ két phải có ghi chú. Cuối ca **chốt ca trên app** đầy đủ, đúng số.
8. **Đổi ca / nghỉ ca:** báo trước ít nhất **24 giờ**, nhờ người làm hộ hoặc đổi ca **trên app** và chờ admin duyệt. Nghỉ không báo: phạt theo quy định.
9. **Tài sản quán:** giữ gìn máy móc, dụng cụ. Làm hỏng / mất do lỗi cá nhân phải báo ngay và bồi thường theo quy định.
10. **Bảo mật & tôn trọng:** không chia sẻ công thức, giá nhập, thông tin khách và đồng nghiệp ra ngoài. Tôn trọng, hỗ trợ đồng nghiệp.

! Có thắc mắc về nội quy: hỏi quản lý ca hoặc bấm “Hỏi trợ lý” trong app.`;
