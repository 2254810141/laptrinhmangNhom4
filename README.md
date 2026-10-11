# 💬 Ứng Dụng Chat Realtime (ASP.NET Core SignalR)

Một ứng dụng chat trực tuyến đơn giản theo thời gian thực (Realtime Chat) dành cho một phòng nhắn tin chung. Dự án được xây dựng phục vụ cho bài tập môn Lập trình mạng, áp dụng công nghệ SignalR trên nền tảng C# .NET.

## 🛠️ Công Nghệ Sử Dụng

| Thành phần | Công nghệ |
| --- | --- |
| Backend | C# (.NET 10.0 / ASP.NET Core SignalR) |
| Frontend | HTML5, CSS3, JavaScript (SignalR Client SDK) |
| Giao thức truyền tải | WebSocket (SignalR tự động quản lý kết nối ở tầng ứng dụng - L7) |

## 1. Định hướng làm đề tài của nhóm là gì

### ✨ Chức Năng Chính

- 👤 Tham gia phòng chat chung: Người dùng chỉ cần nhập Tên hiển thị (Nickname) để bắt đầu trò chuyện.
- 💬 Chat Realtime: Gửi và nhận tin nhắn tức thì cho tất cả mọi người đang online trong phòng.
- ⏰ Thời gian gửi: Hiển thị mốc thời gian (Timestamp) dưới mỗi tin nhắn.

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
- Nếu kịp thời gian, nhóm sẽ mở rộng sang nhiều phòng chat và cải thiện trải nghiệm người dùng.
