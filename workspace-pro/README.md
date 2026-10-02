# Workspace Pro v3 — GitHub Pages + localStorage

Phiên bản tĩnh, không dùng Google Apps Script.

## Điểm mới v3

- Giao diện dark hiện đại, font **Inter**, màu sắc nhất quán theo token.
- Bootstrap 5 + Bootstrap Icons.
- Bookmark dùng **SortableJS** để kéo thả ổn định:
  - đổi vị trí folder;
  - đổi vị trí bookmark trong cùng folder;
  - kéo bookmark sang folder khác.
- Bookmark mở ngay trong **tab hiện tại**.
- PowerShell Variables là form compact:
  - `{{VARIABLE}}` hiển thị dạng chip nhỏ;
  - chọn `1 dòng` / `Nhiều dòng` ngay trên form;
  - preview code cập nhật theo dữ liệu nhập;
  - Copy chỉ copy code đã thay biến.
- 2FA hỗ trợ **Ctrl + V ảnh QR nhiều lần**, listener tồn tại trong suốt phiên làm việc khi tab 2FA đang active.

## Chức năng

### Bookmark
- CRUD folder / bookmark.
- Search.
- Icon Library bằng URL hoặc file ảnh nhỏ.
- Drag & drop folder và bookmark.

### Todo
- Một lần, hàng ngày, ngày trong tuần, mỗi N tuần, hàng tháng.
- Completion theo occurrence.
- Todo đến giờ hiển thị ở global reminder phía trên nav.

### PowerShell
- Text block + Code block.
- `{{VARIABLE}}`.
- Single-line / multiline variable input.
- Copy từng code block / Copy all code.
- Download `.ps1`.

### 2FA
- Secret / `otpauth://` → OTP.
- Ảnh QR → OTP.
- Ctrl + V QR image.
- Secret → QR.
- Google Authenticator Migration QR.
- Không lưu Secret / OTP vào localStorage.

## Deploy GitHub Pages

1. Upload toàn bộ nội dung thư mục vào root repository.
2. GitHub → **Settings → Pages**.
3. Source: **Deploy from a branch**.
4. Chọn `main` và `/ (root)`.
5. Save.

Không cần npm hoặc build step.

## Dữ liệu

Bookmark, Todo và PowerShell lưu ở `localStorage` của domain GitHub Pages hiện tại.
Dùng **Cài đặt → Xuất backup JSON** để backup định kỳ.
