# Workspace Pro — GitHub Pages / localStorage

Phiên bản tĩnh, không dùng Google Apps Script.

## Chức năng

- **Bookmark**
  - CRUD folder và bookmark
  - kéo đổi vị trí folder
  - kéo reorder bookmark
  - kéo bookmark sang folder khác
  - Icon Library bằng URL hoặc file ảnh nhỏ (Data URL)
  - tìm kiếm
- **Todo**
  - một lần
  - hàng ngày
  - các ngày trong tuần
  - mỗi N tuần
  - hàng tháng
  - completion theo từng occurrence
  - Todo đến giờ xuất hiện ở thanh nhắc toàn cục phía trên nav
- **PowerShell**
  - CRUD tài liệu
  - sidebar kiểu ChatGPT
  - text block + code block
  - copy từng code block
  - copy all chỉ lấy code
  - `{{VARIABLE}}`
  - input biến một dòng / nhiều dòng
  - download `.ps1`
- **2FA**
  - Secret / otpauth:// → OTP
  - ảnh QR → OTP
  - Secret → QR
  - Google Authenticator Migration QR
  - **không lưu Secret/OTP vào localStorage**
- Backup / restore JSON

## Chạy trên GitHub Pages

1. Tạo repository.
2. Upload toàn bộ nội dung thư mục này vào root repo.
3. GitHub → Settings → Pages.
4. Source: `Deploy from a branch`.
5. Chọn branch `main`, folder `/ (root)`.
6. Save.

Không có build step.

## Lưu ý localStorage

Dữ liệu chỉ tồn tại trong **trình duyệt + profile + domain GitHub Pages hiện tại**.
Nếu xóa dữ liệu trình duyệt hoặc đổi máy/trình duyệt, dữ liệu không tự đồng bộ.

Hãy dùng **Cài đặt → Xuất backup JSON** định kỳ.

`localStorage` thường chỉ khoảng vài MB. Với Icon Library, nên dùng URL hoặc file icon nhỏ.

## Bảo mật 2FA

Module 2FA cố ý chỉ giữ dữ liệu trong bộ nhớ trang hiện tại và không ghi vào localStorage.
Các thư viện 2FA đang được tải từ CDN đã ghim phiên bản.
