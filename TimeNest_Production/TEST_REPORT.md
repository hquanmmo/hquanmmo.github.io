# Kết quả kiểm tra trước bàn giao

- [x] JavaScript frontend: `node --check public/app.js`
- [x] JavaScript backend: `node --check functions/index.js`
- [x] Apps Script: kiểm tra cú pháp bằng Node với bản `.js` tạm
- [x] Kiểm tra tĩnh kiểm soát Firebase Auth token, phạm vi Lead, webhook secret, App↔Sheet và deny-all rules: `node tests/verify.mjs`
- [x] Có cấu hình Firebase CLI / Firestore indexes / Apps Script / README triển khai
- [ ] Chưa triển khai lên Firebase project thật
- [ ] Chưa kiểm thử tích hợp Firebase Auth/Firestore/Google Sheets dưới tài khoản thật
- [ ] Chưa kiểm thử trình duyệt đầy đủ khi triển khai với dữ liệu thật
- [ ] Chưa thực hiện pentest, kiểm toán quyền IAM hoặc bật App Check

**Vì vậy đây là MVP có mã backend thật, cần cấu hình/triển khai/kiểm thử tích hợp trước khi sử dụng thực tế; không phải ứng dụng đã chạy công khai.**
