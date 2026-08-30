# Sổ Chi Tiêu Cá Nhân

App ghi **chi tiêu riêng của cá nhân**, chạy được trên điện thoại, máy tính và web
từ cùng một bộ code. Dữ liệu lưu trong Google Sheet riêng.

Bản này tách ra từ [sổ chi tiêu gia đình](https://github.com/nguyenthanhchuong/chi-tieu)
và **hoàn toàn độc lập**: Google Sheet riêng, Apps Script riêng, PIN riêng. Lộ PIN
bên này không ảnh hưởng sổ gia đình và ngược lại.

## Khác gì bản gia đình

| | Sổ gia đình | Sổ cá nhân (bản này) |
|---|---|---|
| Số lọ | 6 | **4** |
| Tỉ lệ | 55/10/10/10/10/5 | **45/25/20/10** |
| Chọn người chi | Có (2 người) | Không — sổ một người |
| Danh mục | Có chợ búa, hoá đơn, đồ dùng gia đình | Chỉ chi tiêu riêng |

Bỏ ba lọ *Tự do tài chính*, *Tiết kiệm dài hạn*, *Cho đi* vì đó là việc ở tầm hộ
gia đình — để cả hai nơi sẽ không biết tiền thật nằm ở sổ nào. *Thiết yếu* hạ từ
55% xuống 45% vì phần lớn chi thiết yếu của hộ không đi qua sổ này.

Bốn lọ còn lại:

| Lọ | Tỉ lệ | Kiểu | Dùng cho |
|---|---|---|---|
| Thiết yếu | 45% | theo tháng | Ăn trưa, xăng xe, điện thoại, thuốc men |
| Hưởng thụ | 25% | theo tháng | Cà phê, nhậu, thể thao, đồ công nghệ |
| Tích luỹ riêng | 20% | cộng dồn | Dồn cho món lớn, có cảnh báo khi rút |
| Học tập | 10% | cộng dồn | Khoá học, sách vở |

## Kiến trúc

```
Điện thoại / Máy tính / Web
   (PWA trên GitHub Pages)
            │  POST kèm PIN
            ▼
   Google Apps Script Web App
            │
            ▼
       Google Sheet
```

Không có máy chủ riêng, không tốn phí. Apps Script đóng vai trò lớp trung gian
để trang web ghi được vào Sheet mà không cần lộ thông tin đăng nhập Google.

**Lưu ý kỹ thuật:** hai sổ cùng chạy trên `nguyenthanhchuong.github.io`, mà
localStorage và Cache Storage phân tách theo *origin* chứ không theo đường dẫn.
Vì vậy bản này dùng tiền tố khoá riêng (`ctcn_`) và tên cache riêng. Nếu dùng
chung tiền tố với sổ gia đình thì PIN hai bên đè nhau, và nguy hiểm hơn là hàng
chờ offline của sổ này có thể bị sổ kia gửi nhầm sang Sheet của nó.

## Cài đặt

### 1. Dựng phần Google

1. Tạo một Google Sheet mới.
2. Trong Sheet chọn **Extensions → Apps Script**.
3. Xoá code mẫu, dán toàn bộ nội dung file [`apps-script.gs`](apps-script.gs), bấm lưu.
4. Đặt PIN ở **Project Settings → Script Properties**: thêm khoá `PIN`, giá trị là
   mã riêng của bạn. **Không** ghi PIN vào code — repo này public, ai cũng đọc được.
5. **Deploy → New deployment**:
   - Type: **Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
6. Copy URL Web App nhận được.

### 2. Nối vào app

Mở [`app.js`](app.js), dán URL vừa copy vào biến `API_URL` ở dòng đầu, rồi push lên GitHub.

### 3. Cài lên máy

| Thiết bị | Cách cài |
|---|---|
| iPhone | Mở link bằng Safari → nút Chia sẻ → *Thêm vào MH chính* |
| Android | Mở link bằng Chrome → menu → *Cài đặt ứng dụng* |
| Windows / Mac | Mở link bằng Chrome/Edge → biểu tượng cài đặt trên thanh địa chỉ |

Lần đầu mở app sẽ hỏi PIN. Nhập một lần, máy nhớ cho những lần sau.

## Về bảo mật

Repo phải để public thì GitHub Pages mới chạy miễn phí, nghĩa là URL Apps Script
trong code ai cũng đọc được. Vì vậy mọi yêu cầu đều phải kèm PIN đúng.

PIN **không** nằm trong code ở cả hai phía:
- Phía web: do người dùng nhập, chỉ lưu trên máy họ.
- Phía Google: lưu trong **Script Properties**, đọc lúc chạy.

Nhờ vậy đổi PIN chỉ cần sửa Script Properties, **có hiệu lực ngay, không phải
deploy lại**. Nếu để PIN trong code thì sửa xong mà quên deploy phiên bản mới,
PIN cũ vẫn dùng được mà không hề hay biết.

Chưa đặt khoá `PIN` trong Script Properties thì Web App khoá hẳn, từ chối mọi
yêu cầu — an toàn hơn là lỡ để lọt.

Đây là mức bảo vệ hợp lý cho sổ chi tiêu gia đình, không phải mức dành cho dữ
liệu tài chính nghiêm ngặt. Nếu cần chặt hơn thì phải chuyển sang hạ tầng có
đăng nhập thật (ví dụ Firebase Auth).

## Ghi chú kỹ thuật

- Gọi API bằng `Content-Type: text/plain` là cố ý: Apps Script chuyển hướng khi
  trả kết quả, dùng `application/json` sẽ kích hoạt preflight CORS và bị chặn.
- Khoản chi gửi thất bại được cất vào hàng chờ trong máy và tự gửi lại khi mở
  app lần sau, tránh mất dữ liệu lúc mất sóng.
- Mỗi khoản có `id` riêng, Apps Script bỏ qua `id` đã tồn tại nên gửi lại nhiều
  lần cũng không bị ghi trùng.
- Sửa CSS/JS thì tăng số `?v=` trong `index.html` **và** `CACHE_VERSION` trong
  `sw.js`, nếu không máy đã cài sẽ giữ bản cũ.
