// Service worker: giữ phần vỏ app trong máy để mở được cả khi mất mạng.
//
// Chiến lược: ƯU TIÊN MẠNG (network-first), cache chỉ là phương án dự phòng.
//
// Bản đầu dùng cache-first và đó là một sai lầm: máy đã lưu index.html thì
// vĩnh viễn chạy bản cũ, mọi bản sửa đẩy lên đều không tới được người dùng.
// App này luôn cần mạng để lấy dữ liệu từ Google, nên ưu tiên mạng không làm
// mất gì, mà lại bảo đảm người dùng luôn chạy bản mới nhất.
const CACHE_VERSION = "chi-tieu-ca-nhan-v3";
const SHELL = [
  "./",
  "./index.html",
  "./style.css?v=18",
  "./logic.js?v=18",
  "./app.js?v=18",
  "./manifest.json"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then(cache => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const req = event.request;

  // Lệnh gọi Apps Script đi thẳng ra mạng, không đụng tới cache.
  if (req.method !== "GET" || !req.url.startsWith(self.location.origin)) return;

  event.respondWith(
    fetch(req)
      .then(res => {
        // Tải được thì cập nhật lại bản dự phòng cho lần mất mạng sau.
        const copy = res.clone();
        caches.open(CACHE_VERSION).then(c => c.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() =>
        // Mất mạng: dùng bản đã lưu, không có thì trả trang chính.
        caches.match(req).then(hit => hit || caches.match("./index.html"))
      )
  );
});
