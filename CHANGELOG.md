# Nhật ký phiên bản — Sổ Chi Tiêu Cá Nhân

Số bản hiện lên màn hình PIN (góc dưới) để biết máy đang chạy bản nào.

## Cách quay về bản cũ

```bash
git log --oneline --decorate    # xem các bản đã đánh dấu
git revert --no-commit v8..HEAD && git commit -m "Quay về bản v8"
git push origin master
```

Sau khi push, đợi khoảng 1 phút rồi mở app kèm đuôi chống đệm để nhận bản mới:
`https://nguyenthanhchuong.github.io/chi-tieu-ca-nhan/?moi=1`

Nếu đã cài app ra màn hình chính thì bấm **Tải lại bản mới** ở cuối màn hình PIN.

> **Lưu ý về Apps Script:** quay lui code web KHÔNG tự quay lui phần chạy trên
> Google. Nếu bản cần quay về có thay đổi Apps Script, phải vào
> *Deploy → Manage deployments → Version* chọn lại đúng phiên bản cũ.

---

## v10 — Nội dung khoản: bắt buộc nhập, có gợi ý, có tổng hợp
*Apps Script: không đổi — dữ liệu vẫn nằm ở cột "Ghi chú" có sẵn*

Ô **Ghi chú** đổi tên thành **Nội dung** và thành **bắt buộc**. Danh mục chỉ
nói "Ăn uống", nội dung mới nói "Hủ tíu Nam Vang".

- **Bắt buộc ở CẢ hai chỗ**: màn nhập và hộp sửa. Bắt buộc một nơi mà bỏ ngỏ
  nơi kia thì sửa một cái là xoá sạch được, coi như không bắt buộc.
- **Chip gợi ý ngay dưới ô nhập**, lấy đúng nội dung đã ghi trong danh mục
  đang chọn, hay dùng nhất lên đầu. Bấm một cái thay cho gõ cả câu.
- **Lọc gợi ý không cần gõ dấu**: gõ `hu` ra "Hủ tíu Nam Vang", gõ `coop` ra
  "Coop Trần Văn Quang". Đây là lý do chính của tính năng — gõ tiếng Việt có
  dấu trên điện thoại chậm nên dễ bỏ cuộc rồi bấm bừa danh mục "Khác".
- Khớp theo **đầu âm tiết**, không phải chuỗi con: gõ `am` không ra "Nam".
- **Gom bản gõ lệch dấu làm một**: "Coop Trần Văn Quang" và "coop tran van
  quang" tính là một, giữ cách viết của lần gần nhất. Không có chỗ này thì
  báo cáo tách đôi cùng một cái chợ.
- **Bảng "Theo nội dung"** trong hộp chi tiết thống kê: bấm vào danh mục
  Ăn uống là thấy hủ tíu bao nhiêu, Coop bao nhiêu, kèm số lần.
- Tách `khoanCuaMuc` khỏi `chiTietMuc` để bảng tổng hợp và danh sách dùng
  chung đúng một bộ lọc — hai nơi lọc hai kiểu là bug số liệu khó thấy nhất.
- Số ca test: 163 → 175

> Dữ liệu cũ **không cần làm gì**: khoản nào đã có ghi chú thì gợi ý lấy luôn
> từ đó. Khoản bỏ trống vẫn đọc bình thường, chỉ khi nào anh mở ra sửa thì mới
> phải điền nội dung.

## v9 — Vay nợ & Sổ tiết kiệm
*Apps Script: **CÓ ĐỔI** — phải deploy lại (thêm cột "Đối tượng" + hàm nhắc đáo hạn)*

Cùng bộ tính năng vừa làm cho sổ gia đình, giữ nguyên cấu hình riêng của sổ này
(4 lọ 45/25/20/10, không chọn người chi).

Tab mới **Nợ & TK**, gộp hai thứ cùng bản chất: tiền ở ngoài ví.

**Theo dõi vay nợ**
- Bốn loại giao dịch mới: `Cho vay`, `Thu nợ`, `Đi vay`, `Trả nợ`
- **Không loại nào tính vào thu/chi.** Cho vay 20 triệu thì tiền vẫn của anh,
  chỉ đang nằm chỗ khác — cộng vào chi tiêu là làm sai cả báo cáo tháng.
- Nhưng **số dư ví vẫn đổi đúng**: cho vay/trả nợ làm tiền rời ví, thu nợ/đi
  vay làm tiền vào ví
- Số dư nợ **theo từng người**, kèm cả bốn con số cộng dồn để kiểm lại được
- Gợi ý tên đã từng ghi, tránh "Anh Hùng" và "anh hung" bị tách thành hai người
- Lọc riêng khoản nợ trong bảng tìm kiếm

**Sổ tiết kiệm có nhắc đáo hạn**
- Ghi sổ có kỳ hạn: số tiền, nơi gửi, lãi suất, ngày gửi, kỳ hạn
- Tự tính **ngày đáo hạn**, lãi dự kiến và tiền nhận về, xem trước ngay lúc gõ
- Gửi ngày 31 mà tháng đích chỉ có 30 ngày thì lùi về ngày cuối tháng
- Lãi tính **đơn**, không kép: sổ có kỳ hạn ở VN trả lãi cuối kỳ
- Màu viền theo mức độ: quá hạn (đỏ), còn dưới 7 ngày (vàng), còn hạn
- **Email nhắc lúc 8h sáng** mỗi ngày khi có sổ sắp/đã đáo hạn, tiêu đề
  `[Sổ cá nhân]` để phân biệt với email của sổ gia đình

Sửa kèm:
- Khoản **chuyển ví** trước đây bị cộng vào phần đã chi của lọ, và hiện trong
  danh sách gần đây y như một khoản chi
- Danh sách gần đây giờ hiện cả tên ví
- Service worker trước đây nạp sẵn `?v=18` — địa chỉ không ai gọi tới
- Số ca test: 142 → 163

> **Việc anh cần làm:** mở Apps Script của sổ cá nhân, dán lại `apps-script.gs`,
> rồi *Deploy → Manage deployments → sửa → Version: New version → Deploy*.
> Sau đó chọn hàm `caiDatNhacDaoHan` và bấm **Chạy** một lần để bật email nhắc.
>
> **Rồi chạy tiếp hàm `guiThuMotEmail` một lần nữa.** Chạy `caiDatNhacDaoHan`
> KHÔNG đủ: Google chỉ xin quyền cho đúng nhánh code đang chạy, mà hàm đó
> không đụng tới mail nên quyền gửi mail không được xin. Trigger tạo ra nhìn
> rất bình thường, nhưng 8h sáng sẽ văng lỗi quyền trong im lặng.

## v8 trở về trước

Xem `git log`. Tóm tắt: v8 nối `renderHanMuc` vào `renderStats` (v7 có logic
hạn mức nhưng chưa vẽ ra màn hình), v7 mang sang tìm kiếm + hạn mức hai tầng +
ví/nguồn tiền từ sổ gia đình.
