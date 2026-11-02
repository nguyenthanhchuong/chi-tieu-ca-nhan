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

## v14 — Sửa và xoá cũng xong ngay

Nối tiếp bản trước. Giờ cả ba việc đều ghi vào máy trước rồi gửi lên Sheet ở
nền:

| Việc | Trước | Nay |
|---|---|---|
| Ghi khoản mới | 2,5–5 s | 0,012 s |
| Sửa khoản | 2,5–5 s | 0,009 s |
| Xoá khoản | 2,5–5 s | 0,012 s |

Khoản đã sửa trong máy mà bản sửa chưa lên Sheet cũng mang dấu **⏳**, giống
khoản mới. Không đánh dấu thì màn hình hiện số mới trong khi Sheet còn số cũ,
mà nhìn vào không có cách nào biết.

### Bốn hàng chờ, cố ý không gộp chung

| Hàng chờ | Chứa gì |
|---|---|
| `queue` | khoản mới, chưa có trên Sheet |
| `suaCho` | khoản đã có trên Sheet, chờ gửi bản sửa |
| `xoaCho` | mã khoản chờ xoá khỏi Sheet |
| `anhXoaCho` | mã khoản chờ gỡ ảnh (gỡ ảnh, không xoá khoản) |

Gửi theo đúng thứ tự **thêm → sửa → xoá**: sửa và xoá đều cần dòng đã có trên
Sheet, nên thêm phải xong trước.

### Các ca đã thử

| Ca | Kết quả |
|---|---|
| Sửa đi sửa lại nhiều lần | chỉ bản cuối lên Sheet, không gửi từng bản |
| Sửa rồi xoá cùng khoản | lệnh sửa bị bỏ, chỉ gửi lệnh xoá |
| Mất mạng rồi có lại | ba việc giữ nguyên, gửi đúng thứ tự add → update → delete |
| Khoản bị xoá ở máy khác | bỏ lệnh sửa, báo "đã bị xoá ở nơi khác", **không** thử lại vô hạn |
| Gỡ ảnh rồi chọn ảnh mới trong cùng lần sửa | lệnh gỡ bị bỏ, không xoá mất tấm vừa gửi |
| Sai PIN | việc giữ lại trong hàng chờ, báo ra màn hình |

Lệnh xoá gửi lại nhiều lần không sao: Apps Script trả `ok` kèm `daXoaTruocDo`
khi dòng đã biến mất. Lệnh **sửa** thì khác — dòng không còn là hỏng vĩnh viễn,
nên bản sửa đó bị bỏ khỏi hàng chờ thay vì gửi mãi.

**Vẫn giữ nguyên:** hộp sửa chỉ mở cho khoản đã lên Sheet (dòng còn ⏳ chưa bấm
vào được). Nhờ vậy không có ca "sửa khoản đang bay lên mạng", đổi lại phải chờ
vài giây mới sửa được khoản vừa ghi.

Không đổi Apps Script, không thêm cột nào trên Sheet.

## v13 — Lưu xong ngay, không phải ngồi chờ mạng

Trước đây bấm **Lưu** là phải chờ **2,5–5 giây** nhìn chữ "Đang lưu…". Đo thật
trên máy chủ Apps Script:

| Lần gọi | Thời gian |
|---|---|
| 1 (nguội) | 5,43 s |
| 2 | 2,71 s |
| 3 | 2,53 s |
| 4 | 2,91 s |

Trong đó nối mạng và mã hoá chỉ tốn 0,25 s; phần còn lại là Google khởi động
container Apps Script rồi chuyển hướng sang `script.googleusercontent.com`.
**Không sửa được từ phía app.**

Nay đảo thứ tự: khoản được ghi vào máy trước, màn hình trả lại ngay, việc gửi
lên Sheet chạy ở nền. Đo lại: **0,012 giây** — nhanh hơn khoảng 250 lần.

Đây chính là đường đi cũ khi mất mạng, nay thành đường đi duy nhất. Lúc có mạng
và lúc mất mạng dùng chung một mã, nên chỉ còn một nhánh cần thử kỹ thay vì hai.

**Thay đổi anh sẽ thấy:** khoản vừa ghi hiện ngay kèm dấu ⏳ và nền khác màu,
chưa sửa/xoá được cho tới khi lên Sheet xong (vài giây). Trước đây anh cũng
không làm gì được trong chừng đó thời gian, chỉ khác là phải ngồi nhìn.

Ảnh hoá đơn cũng không còn chặn: cất vào máy trước, gửi Drive ở nền.

### Lỗi mất dữ liệu đã tìm ra và sửa trong cùng bản này

Bản nháp đầu tiên chụp hàng chờ một lần rồi gán đè `store.queue = remain` ở
cuối. Thử ghi nhanh ba khoản liền tay: **chỉ khoản đầu lên Sheet, hai khoản sau
biến mất không dấu vết** — vì chúng được thêm vào hàng chờ trong lúc khoản đầu
còn đang bay lên mạng, nên không có trong bản chụp và bị câu gán đè xoá sạch.

Đã sửa: vòng gửi đọc lại hàng chờ ở mỗi bước thay vì dùng bản chụp. Thêm chốt
chặn hai lượt gửi chạy chồng lên nhau. Đã thử lại: 3 khoản → 3 lượt gửi, không
trùng, không mất.

Lỗi PIN khi gửi nền cũng được báo ra màn hình. Trước đó nó bị nuốt im lặng —
nguy hiểm nhất của cách lưu nền, vì anh đã thấy chữ "Đã ghi" nên tưởng xong rồi
trong khi khoản nằm mãi trong hàng chờ.

**Chưa đụng tới:** sửa và xoá khoản vẫn chờ mạng như cũ (2,5–5 giây). Hàng chờ
hiện chỉ xử lý việc thêm mới; muốn sửa/xoá cũng chạy nền thì phải làm thêm hàng
chờ riêng cho hai việc đó.

Không đổi Apps Script, không thêm cột nào trên Sheet.

## v12 — Tình hình hiện tại ở đầu tab Thống kê

Thêm khối **Tình hình hiện tại** lên trên cùng tab Thống kê. Khác với phần còn
lại của tab, khối này là ảnh chụp tại hôm nay và **không chịu ảnh hưởng của bộ
chọn tuần/tháng/quý/năm** bên dưới.

Năm dòng:

| Dòng | Nghĩa |
|---|---|
| Tiền còn | tổng số dư các ví — tiền thật đang nắm |
| Gửi tiết kiệm | chỉ hiện khi có sổ; tiền của mình nhưng đã rời ví |
| Người ta nợ mình | cho vay − thu nợ |
| Mình đang nợ | đi vay − trả nợ |
| Tiền mặt ròng | cộng hết lại, trừ phần phải trả |

Bấm vào một dòng thì nhảy sang tab tương ứng (Ví, hoặc Nợ & TK) để xem chi tiết
từng ví, từng người.

**"Tiền mặt ròng" không phải tài sản ròng.** Sổ này không có chỗ ghi nhà, đất,
xe. Vay 1,1 tỷ mua nhà thì dòng này âm hơn 1 tỷ — đúng về số nhưng sai về tình
hình, vì căn nhà đối ứng không nằm ở đâu cả. Vì vậy dòng chú thích *"Chưa tính
nhà, đất, xe và tài sản khác"* luôn đi liền ngay dưới, không được tách ra.

Thêm danh mục chi **Mua tài sản**, trỏ vào lọ *Tiết kiệm*. Trước đó khoản
mua nhà phải ghi vào "Khác", mà "Khác" rơi vào lọ *Thiết yếu* — một khoản 1,1 tỷ
nằm trong lọ Thiết yếu làm mọi hạn mức chi tiêu hằng tháng thành vô nghĩa.

Không đụng tới Apps Script, không thêm cột nào trên Sheet. Chỉ cần tải lại web.

## v11 — Ảnh hoá đơn, chụp được cả lúc mất mạng
*Apps Script: **CÓ ĐỔI** — phải deploy lại (thêm cột "Ảnh" + quyền Drive)*

Mỗi khoản gắn được một ảnh hoá đơn. Ảnh nằm trên Google Drive của anh, Sheet
chỉ giữ mã file.

- **Nút 📷 Ảnh hoá đơn** ở màn nhập, chọn được giữa chụp mới và lấy ảnh có sẵn
- **Nén ngay trên máy trước khi gửi**: cạnh dài về 1400px, JPEG 72%. Ảnh gốc
  4MB xuống còn khoảng 200KB. Không có bước này thì ghi một khoản bằng 4G phải
  chờ cả phút
- **Dấu 📎** ở danh sách cho biết khoản nào có hoá đơn. Ảnh chỉ tải khi anh bấm
  vào khoản — tải sẵn cả 25 dòng là vài MB mỗi lần vẽ
- Hộp sửa: xem, đổi, gỡ ảnh. Thay đổi chỉ áp dụng khi bấm **Lưu**, bấm nhầm rồi
  đóng hộp thì không mất gì
- Xoá khoản thì ảnh cũng vào thùng rác Drive, không để lại file mồ côi

**Chụp lúc mất mạng**
- Ảnh cất vào **IndexedDB**, không phải localStorage. Chỗ localStorage chỉ có
  ~5MB cho cả sổ mà hàng chờ khoản cũng nằm đó — vài tấm ảnh là đầy, và khi đầy
  thì khoản ghi lúc mất mạng mất theo
- Gửi lại **tự động**: khi mở lại app, khi quay lại từ màn hình khoá, và ngay
  khi máy có sóng trở lại
- Ảnh gửi **sau** khoản, vì ảnh chỉ gắn được vào khoản đã nằm trên Sheet. Gửi
  hỏng thì **giữ nguyên ảnh** chờ vòng sau, không bao giờ vứt đi
- Ảnh đã xem được giữ lại trong máy (50 tấm gần nhất) nên mất mạng vẫn mở lại
  được hoá đơn cũ

**Riêng tư**
- File trên Drive **không** đặt chia sẻ công khai. Hoá đơn lộ ra anh mua gì, ở
  đâu, lúc nào. Muốn xem phải gọi qua Apps Script kèm đúng PIN
- Apps Script chỉ trả ảnh đang được một khoản trong Sheet trỏ tới. Không có
  chốt này thì ai có PIN sẽ đọc được mọi file trong Drive của anh, vì Web App
  chạy bằng quyền của anh

Số ca test: 175 → 184

> **Việc anh cần làm:** dán lại `apps-script.gs`, rồi *Deploy → Manage
> deployments → sửa → Version: New version → Deploy*.
>
> **Rồi chạy hàm `thuTaiAnh` một lần** để Google xin quyền Drive. Không chạy
> thì lần đầu chụp hoá đơn sẽ văng lỗi quyền — Google chỉ xin quyền cho đúng
> nhánh code chạy tới, y như vụ gửi mail nhắc đáo hạn ở v9.

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
