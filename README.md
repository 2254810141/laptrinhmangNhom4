# 💬 Ứng Dụng Chat Realtime (ASP.NET Core SignalR)

Một ứng dụng chat trực tuyến theo thời gian thực (Realtime Chat) hỗ trợ nhiều phòng nhắn tin. Dự án được xây dựng phục vụ cho bài tập môn Lập trình mạng, áp dụng công nghệ SignalR trên nền tảng C# .NET.

## 🛠️ Công Nghệ Sử Dụng

| Thành phần | Công nghệ |
| --- | --- |
| Backend | C# (.NET 8.0 / ASP.NET Core SignalR) |
| Frontend | React 19 + Vite + SignalR Client SDK |
| Realtime / voice | SignalR signaling + WebRTC mesh audio |
| Lưu media | MongoDB GridFS |

## 1. Định hướng làm đề tài của nhóm là gì

### ✨ Chức Năng Chính

- 👤 Tham gia phòng chat chung: Người dùng chỉ cần nhập Tên hiển thị (Nickname) để bắt đầu trò chuyện.
- 💬 Chat Realtime: Gửi và nhận tin nhắn tức thì cho tất cả mọi người đang online trong phòng.
- 🏠 Tạo và tham gia phòng chat: Tạo phòng nhóm với tên và mã bảo mật, nhập đúng tên phòng cùng mã bảo mật để tham gia hoặc chuyển đổi giữa các phòng đã tham gia.
- 💬 Chat 1-1: Tạo hoặc mở phòng trò chuyện trực tiếp với một thành viên khác trong danh sách thành viên.
- ✏️ Quản lý phòng: Đổi tên phòng nhóm và hiển thị danh sách thành viên trong từng phòng.
- 🖼️ Gửi ảnh: Tải ảnh PNG, JPG, GIF hoặc WebP (tối đa 5 MB) lên MongoDB GridFS và chia sẻ trong phòng chat.
- 🎧 Tin nhắn thoại: Ghi âm tối đa 2 phút, gửi và phát lại trong phòng chat; lưu trên MongoDB GridFS (tối đa 10 MB).
- 🎙️ Voice chat: Tham gia/rời kênh thoại, tắt/bật microphone và truyền âm thanh WebRTC trực tiếp giữa các thành viên; SignalR chỉ trao đổi tín hiệu kết nối.
- ⏰ Thời gian gửi: Hiển thị mốc thời gian (Timestamp) dưới mỗi tin nhắn.

### 🏠 Cách tạo và tham gia phòng

- Chọn nút tạo phòng trên thanh danh sách phòng.
- Nhập tên phòng và mã bảo mật, sau đó chọn **Tạo phòng**.
- Phòng mới được lưu trong MongoDB và người tạo tự động trở thành thành viên.
- Có thể chọn một thành viên trong danh sách để mở chat trực tiếp 1-1.
- Để tham gia phòng nhóm hiện có, nhập tên hiển thị của phòng và mã bảo mật chính xác.
- Danh sách phòng của người dùng được cập nhật theo các phòng mà họ đã tham gia.

Voice chat dùng kết nối mesh và STUN công khai, phù hợp với nhóm nhỏ. Trình duyệt cần quyền microphone và chạy trên HTTPS (localhost được phép). STUN không chuyển tiếp âm thanh; một số mạng cần cấu hình TURN để voice chat kết nối được.

## 2. Các Project tham khảo + Link GitHub của các project đó

Nhóm tham khảo một số tài liệu và dự án liên quan đến SignalR và chat realtime:

| Dự án | Link |
| --- | --- |
| ASP.NET Core / SignalR samples | https://github.com/aspnet/SignalR-samples |
| ASP.NET Core source code | https://github.com/dotnet/aspnetcore |
| SignalR cũ của Microsoft | https://github.com/SignalR/SignalR |

## 3. Tóm tắt nhóm sẽ làm thêm / phát triển thêm những gì mà các project tham khảo chưa có hoặc chưa hoàn thiện

Nhóm dự định phát triển thêm các phần sau:

- Thiết kế giao diện riêng cho bài làm của nhóm.
- Thêm chức năng đặt nickname và hiển thị danh sách người đang online.
- Lưu lại nội dung chat để xem lại lịch sử tin nhắn.
- Quản lý và phân quyền thành viên trong từng phòng.
- Cải thiện giao diện và trải nghiệm chuyển đổi nhiều phòng chat.
