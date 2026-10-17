# TimeNest Production Starter – App điểm danh ON / xin OFF

Đây là **mã nguồn ứng dụng có backend thật**, không phải bản demo dùng localStorage. Cần triển khai lên Firebase và kết nối Google Sheets bằng tài khoản Google của bạn mới sử dụng thực tế được. Chưa có Firebase project, chưa có Gmail Admin hay dữ liệu thật nào được kết nối sẵn.

## 1. Chức năng đã lập trình

- Đăng nhập Google qua Firebase Authentication; email Google phải xác minh.
- Lần đầu **chỉ đúng email `DEV_EMAIL`** được khởi tạo Dev, không đăng ký tự do. Người khác phải được Dev tạo tài khoản bằng email trước khi đăng nhập.
- Dev tạo/sửa vai trò, nhân viên, gán Lead, tắt quyền truy cập; role templates gồm Dev, Admin, Lead, Assign và Nhân viên.
- Admin có phạm vi toàn hệ thống; Lead chỉ xem/sửa/duyệt nhóm của mình (giới hạn cứng ở backend, không thể mở rộng bằng cách sửa role Lead); Assign xem toàn bộ nhân viên và bảng công; Nhân viên xem dữ liệu bản thân.
- Bất kỳ tài khoản được cấp quyền đều báo **ON đúng một lần/ngày**, thời gian lấy từ máy chủ; không có check-out.
- Nhân viên đăng ký OFF **trước ngày dự kiến nghỉ**; số thứ tự xin OFF cấp tăng dần trong Firestore transaction.
- Lead chỉ duyệt OFF người thuộc nhóm mình. Admin hoặc Dev quyết định **có lương/không lương**, kể cả sau khi Lead đã duyệt. Admin/Lead/Dev được trực tiếp điều chỉnh ON/OFF trong phạm vi của mình; sửa đổi được lưu audit.
- Tìm kiếm tên, mã/email; lọc đợt, Level, trạng thái/ngày; xem ma trận theo tháng; xuất CSV.
- Tạo file Google Sheets thuộc **chính tài khoản Admin** nhờ Admin chạy standalone Apps Script (`SpreadsheetApp.create`). Tự tạo sheet mới mỗi tháng `CC_YYYY_MM` 40 cột A:AN.
- App → Firestore → Google Sheets API; sửa ô ngày ON/OFF trực tiếp trong Sheet → standalone Apps Script installable onEdit → Firebase endpoint có secret → Firestore. Chỉnh mã NV, tên, đợt, level ở Sheet cũng đẩy lại Firestore. **Không** chấp nhận đổi role/Lead bằng Sheet.
- Sheet `NHAN_SU`: nhân viên mới nhập từ Sheet đi vào danh sách **chờ Dev cấp quyền** trong app; không cấp quyền đăng nhập tự động.
- Đơn OFF sinh email trong `EMAIL_QUEUE`; trigger Apps Script của Admin gửi qua MailApp trong khoảng 1 phút (tùy quota và trigger).

## 2. Công nghệ & sơ đồ

```
Website responsive HTML / CSS / JS (Firebase Hosting)
  └── Firebase Authentication: Google Sign-In
       └── Firebase Callable Cloud Functions v2
            ├── Firestore: members / roles / attendance / offRequests / audit
            └── Sheets API (runtime service account được Admin cấp Editor)
                 ├── CC_YYYY_MM (A:AN, ghi chú giờ ON trên ô)
                 ├── NHAN_SU
                 └── EMAIL_QUEUE → Admin Apps Script → MailApp
Admin nhập Sheets → Apps Script standalone onEdit → HTTPS sheetWebhook (secret) → Firestore
```

**Nguồn dữ liệu chuẩn:** Firestore. Google Sheets là bản sao để quản lý và nhập chỉnh sửa. Khi lỗi mạng/quota có thể xảy ra độ trễ hoặc lỗi đồng bộ; Cloud Function ghi lỗi vào `syncErrors`. Dev dùng nút Đồng bộ lại tháng để khôi phục phần dữ liệu công. Email lỗi nằm trong `EMAIL_QUEUE` và có thể xử lý lại bằng `retryFailedEmails()`.

## 3. Chuẩn bị

- Tài khoản Google Admin (sở hữu Google Sheets, tạo dự án Firebase hoặc được cấp quyền quản lý).
- Email Google Dev cố định cho lần khởi tạo đầu tiên. Admin và Dev có thể là cùng một tài khoản.
- Node.js 22, Firebase CLI mới, Firebase project có Firestore, Authentication (Google provider bật) và Billing (Blaze) cho Cloud Functions.
- Bật **Google Sheets API** cho Google Cloud project tương ứng với Firebase.
- Cho phép domain Firebase Hosting trong Firebase Authentication → Settings → Authorized domains.
- KHÔNG chia sẻ file Google Sheets quyền Editor với nhân viên. KHÔNG chia sẻ dự án Apps Script độc lập. KHÔNG tải secrets lên git.

## 4. Triển khai Firebase

Trong thư mục gốc `TimeNest_Production`:

```bash
npm install -g firebase-tools
firebase login
firebase use --add
cd functions
npm install
cd ..
```

Tạo file `functions/.env.<YOUR_FIREBASE_PROJECT_ID>`:

```env
DEV_EMAIL=your-dev-google-email@gmail.com
```

Chỉnh `public/firebase-config.js` theo **Firebase Console → Project settings → Your apps → Web app**:

```js
export const firebaseConfig = {
  apiKey: 'YOUR_PUBLIC_FIREBASE_WEB_API_KEY',
  authDomain: 'YOUR_PROJECT.firebaseapp.com',
  projectId: 'YOUR_PROJECT',
  appId: 'YOUR_APP_ID'
};
export const functionsRegion = 'asia-southeast1';
```

`apiKey` của Web SDK không phải admin secret; **không bao giờ** đặt service account JSON, Admin SDK credential hoặc `SYNC_TOKEN` trong `public/`.

Tạo secret bí mật mạnh, tối thiểu 32 ký tự; sử dụng chung giá trị trên Firebase Functions và private Script Properties của Apps Script. Bạn cần giữ lại giá trị này ở nơi quản lý mật khẩu an toàn.

```bash
firebase functions:secrets:set SYNC_TOKEN
firebase deploy --only firestore,functions,hosting
```

Firebase CLI hiển thị URL Hosting và Function `sheetWebhook`. Không chạy các bước tiếp theo trước khi Functions đã triển khai và bật được Google Sheets API.

Truy cập URL Hosting, đăng nhập Google bằng email `DEV_EMAIL`. Tài khoản Dev đầu tiên tự khởi tạo các role. Không có user nào khác tự đăng ký vào ứng dụng được. Sau đó Dev có thể tạo Admin / Lead / Assign / Staff.

## 5. Tạo Google Sheets bằng chính Email Admin

1. Admin truy cập https://script.google.com/, tạo **Standalone Apps Script** (không gắn trực tiếp vào Sheet đang chia sẻ).
2. Mở file `scripts/Code.gs`, dán toàn bộ vào Apps Script editor của Admin.
3. Project Settings → Script properties, tạo:
   - `FUNCTION_SERVICE_ACCOUNT`: email **runtime service account** của Cloud Functions v2, xem trên Cloud Run / Cloud Functions runtime settings. Không phải client Firebase API key.
   - `SYNC_WEBHOOK_URL`: URL HTTPS `sheetWebhook` được CLI/Console hiển thị.
   - `SYNC_TOKEN`: đúng secret đã tạo ở Firebase Secret Manager.
4. Chạy thủ công `initTimeNest()` lần đầu và chấp nhận quyền được Google yêu cầu cho Sheets, Drive, UrlFetch, MailApp và ScriptApp.
5. Apps Script tạo Google Sheets có chủ sở hữu là Admin, tự thêm sheet `CC_YYYY_MM`, `NHAN_SU`, `EMAIL_QUEUE`, đồng thời cài 2 trigger (onEdit và gửi mail mỗi phút) và chia sẻ Editor cho function service account.
6. Ở Execution log, sao chép `SPREADSHEET_ID`. Đăng nhập Dev → **Kết nối** → dán ID → **Kiểm tra & lưu** → **Đồng bộ ngay** tháng hiện tại.

Lưu ý: Google Workspace có thể cấm chia sẻ file cho service account khác domain; cần cấu hình chia sẻ phù hợp hoặc chạy trong môi trường Google Cloud của cùng tổ chức.

### Google Sheets cấu trúc

| Cột | Ý nghĩa |
|---|---|
| A–F | STT, Mã NV, Email, Tên, Đợt, Level |
| G | Tổng ngày OFF có lương (đã phân loại) |
| H | Tổng ngày OFF không lương (đã phân loại) |
| I | Tổng ngày ON, **không phải số giờ online** |
| J–AN | Ngày 1–31, giá trị `ON` / `OFF` / trống |

Ở ô `ON`, **Note** được ghi dạng `Báo ON lúc 16/10/2026, 08:15:23` theo giờ Việt Nam, cộng người sửa nếu sửa bởi quản lý. Ô `OFF` có ghi chú loại nghỉ và lý do. Trong tháng có ít hơn 31 ngày, cột dư để trống.

Bạn có thể **sửa ô ngày ON/OFF, tên, mã NV, đợt, Level** trong Google Sheets do Admin sở hữu; `onEdit` đồng bộ về Firestore. Không cần báo OFF sau ca. Chỉ có đơn OFF tương lai của nhân viên mới là **đăng ký cần duyệt**, còn chỉnh sửa trực tiếp của quản lý trong Sheet là thao tác hành chính và đi vào audit.

**Không tự thêm tài khoản bằng cách đổi role trong Sheet.** Nhân viên chưa có trong app khi nhập vào `NHAN_SU` sẽ xuất hiện trong mục **Nhân sự → chờ Dev cấp quyền**; Dev phải chủ động phê duyệt. Không sửa email chính ở dòng cũ: Dev thực hiện tạo email mới trong app.

### Giới hạn việc chỉnh sửa trực tiếp trong Sheets

- Trigger `onEdit` chỉ kích hoạt khi **người dùng sửa giá trị**, không kích hoạt với chỉnh sửa bằng API/script và không được đảm bảo khi chỉ sửa Note. App → Sheet sử dụng API nên không bị vòng lặp webhook.
- Bảng G/H/I là **giá trị tổng hợp**, thay đổi bằng thao tác chấm công và phân loại trong app; sửa tay G/H/I trong Sheet không phải cách cập nhật phép.
- Không sắp xếp tùy tiện cả bảng, không xóa cột. Nếu đổi thứ tự dòng, backend có kiểm tra lại email cột C trước khi ghi nhưng vẫn nên tránh trong khi có thao tác đồng thời.
- Paste một lần tối đa 300 ô theo trigger script này; dữ liệu nhiều cần nhập thành nhiều lượt hoặc mở rộng webhook hàng đợi.
- Mọi bản cập nhật phân quyền phải thực hiện trong trang Dev, không qua Google Sheets.

## 6. Bảng quyền mặc định

| Tác vụ | Dev | Admin | Lead | Assign | Nhân viên |
|---|---|---|---|---|---|
| Tạo/sửa người dùng và role | ✓ | – | – | – | – |
| Xem ma trận toàn hệ thống | ✓ | ✓ | – | ✓ | – |
| Xem ma trận nhóm | ✓ | ✓ | ✓ | ✓ | – |
| ON bản thân một lần/ngày | ✓ | ✓ | ✓ | ✓ | ✓ |
| Chuyển ON/OFF nhân viên | Toàn bộ | Toàn bộ | Nhóm mình | – | – |
| Duyệt đơn OFF | Toàn bộ | Toàn bộ | Nhóm mình | – | – |
| Phân loại nghỉ có/không lương | ✓ | ✓ | – | – | – |
| Xin OFF tương lai | ✓ | ✓ | ✓ | ✓ | ✓ |

Dev có thể tạo vai trò tùy chỉnh và cấu hình quyền trong app; tuy nhiên **Dev-only user/role management**, **Lead scope của chính role `lead`**, và **Admin/Dev-only phân loại lương** là giới hạn bắt buộc ở backend.

## 7. Bảo mật thực tế

- Firestore Rules **deny-all** cho tất cả SDK client; Cloud Functions kiểm tra Google Auth token email đã xác minh, membership, quyền và phạm vi dữ liệu theo từng thao tác.
- Chặn thao tác chấm ON lần 2 bằng Firestore transaction; cấp thứ tự đơn OFF bằng transaction.
- Email service account của Cloud Functions có quyền Editor riêng đối với file Sheets của Admin. Không chia sẻ sheet cho mọi người hoặc public trên Internet.
- Webhook Apps Script → Cloud Function có secret trong Script Properties và Google Secret Manager; dùng HTTPS và so sánh constant time. Đổi secret nếu bị lộ. Không có password mẫu hay key quản trị ở browser.
- Bản ghi audit và syncErrors lưu trong Firestore. Thiết lập backup Firestore, cảnh báo lỗi/quota, MFA cho Google account, lịch rà soát cấp quyền, giới hạn truy cập Google Cloud và lưu trữ riêng tư phù hợp.
- **Không có hệ thống nào bảo đảm 'bảo mật tuyệt đối'.** Trước khi dùng dữ liệu nhân viên thật, cần kiểm thử xâm nhập, rà soát quyền IAM/Service Accounts, bật Firebase App Check và giám sát/backup. Bản này là **MVP có backend**, chưa hoàn tất kiểm thử bảo mật độc lập.

## 8. Giới hạn và khôi phục

- Giao diện tải tối đa 800 nhân viên và tối đa 12.000 bản ghi chấm công trong tháng; khi quy mô lớn cần phân trang, index và tối ưu dữ liệu.
- Nếu Sheet chưa kết nối, ON/OFF vẫn lưu Firestore và `syncing=false`. Dev kết nối sau và chạy **Đồng bộ ngay**.
- Nếu gửi email thất bại, bản ghi hàng chờ ở trạng thái `ERROR`. Admin giải quyết nguyên nhân và chạy `retryFailedEmails()` thủ công để thử lại.
- Đơn xin OFF gửi trước ngày làm việc; hệ thống không có tính năng hủy đơn, đổi lịch, ngày lễ/ca làm riêng hoặc workflow nhiều cấp nâng cao ở bản MVP này.
- Thời điểm ON của thao tác app là giờ máy chủ, không tính tổng số giờ làm.
- Các thao tác từ Google Sheets được tin cậy vì **chỉ Admin được sửa Sheet**. Nếu cấp Editor cho người không tin cậy, họ có thể sửa file Sheet trực tiếp bất chấp phân quyền app.

## 9. Checklist thử nghiệm trước khi sử dụng thật

1. Đăng nhập email khác DEV_EMAIL trước khi được Dev cấp quyền → phải bị từ chối.
2. Dev tạo Lead A, Lead B và nhân viên A1 thuộc A, B1 thuộc B. Thử Lead A xem/đổi A1 được, B1 không được.
3. Nhân viên báo ON một lần, thử báo lần 2; kiểm tra giờ chính xác trong Note ô ngày.
4. Nhân viên xin OFF tương lai: xem `#order`, email trong `EMAIL_QUEUE`, Lead duyệt, Admin chọn có lương/không lương.
5. Admin đổi ON ↔ OFF trong app, kiểm tra Firestore và ô Sheets; sửa lại trên Sheets, kiểm tra app sau khi bấm Làm mới.
6. Thử sửa role qua mã trình duyệt/callable trực tiếp của nhân viên → phải bị từ chối.
7. Kiểm tra quyền truy cập Sheets chỉ dành cho Admin + service account, backup và hệ thống theo dõi quota.

## 10. Tệp trong dự án

- `public/index.html`, `styles.css`, `app.js`: ứng dụng web responsive.
- `public/firebase-config.js`: cấu hình công khai của Firebase Web App (thay trước khi triển khai).
- `functions/index.js`, `package.json`, `.env.example`: backend có xác thực và phân quyền.
- `scripts/Code.gs`: standalone Apps Script tạo file Sheets bằng Admin, nhận chỉnh sửa Sheet, gửi email.
- `firestore.rules` deny-all, `firestore.indexes.json` index, `firebase.json` cho Firebase CLI.

Tài liệu tham khảo: https://firebase.google.com/docs/auth/web/google-signin ; https://firebase.google.com/docs/functions/callable ; https://firebase.google.com/docs/firestore/security/get-started ; https://developers.google.com/apps-script/guides/triggers/installable ; https://developers.google.com/workspace/sheets/api/guides/batchupdate
