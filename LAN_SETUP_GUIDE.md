# Hướng dẫn chạy Chat App qua mạng LAN

## Bước 1: Tìm IP LAN của máy server

Mở Command Prompt và chạy:
```
ipconfig
```

Tìm địa chỉ IPv4 Address trong phần "Wireless LAN adapter Wi-Fi" hoặc "Ethernet adapter".
Ví dụ: `192.168.1.100`

## Bước 2: Chạy Server

Mở terminal tại thư mục Server:
```bash
cd D:\.NET\LaptrinhmangNhom4\Server\RealtimeChatAPI
dotnet run
```

Server sẽ chạy trên:
- `http://localhost:5000` (máy local)
- `http://0.0.0.0:5000` (cho phép kết nối từ LAN)

## Bước 3: Chạy Client

Mở terminal mới tại thư mục Client:
```bash
cd D:\.NET\LaptrinhmangNhom4\Client
npm run dev
```

Client sẽ hiển thị URL dạng:
```
  VITE v8.3.0  ready in xxx ms

  ➜  Local:   http://localhost:5173/
  ➜  Network: http://192.168.1.100:5173/
```

## Bước 4: Máy khác trong LAN truy cập

Trên máy khác (cùng mạng WiFi/LAN):

1. **Truy cập Client:**
   - Mở trình duyệt
   - Nhập: `http://192.168.1.100:5173` (thay bằng IP LAN của bạn)
   - Nhập nickname và vào phòng chat

2. **Kết nối SignalR:**
   - Client sẽ tự động kết nối đến server tại `http://192.168.1.100:5000/chathub`
   - Không cần cấu hình thủ công

## Bước 5: Test kết nối nhiều người

- Máy 1 (Server): `http://localhost:5173` → Nickname "Alice"
- Máy 2 (LAN): `http://192.168.1.100:5173` → Nickname "Bob"
- Máy 3 (LAN): `http://192.168.1.100:5173` → Nickname "Charlie"

Tin nhắn từ bất kỳ máy nào sẽ hiển thị trên tất cả máy.

## Lưu ý quan trọng

### Firewall Windows
Nếu máy khác không kết nối được, có thể firewall đang chặn port 5000 và 5173:

1. Mở "Windows Defender Firewall with Advanced Security"
2. Inbound Rules → New Rule
3. Port → TCP → Specific local ports: 5000, 5173
4. Allow the connection
5. Chọn Domain, Private, Public
6. Đặt tên: "Chat App Ports"

### Tắt antivirus tạm thời
Một số antivirus có thể chặn kết nối LAN. Tắt tạm thời nếu cần.

### Kiểm tra kết nối
Test xem máy khác có ping được server không:
```
ping 192.168.1.100
```

## Xác nhận hoạt động

- ✅ Server chạy trên port 5000
- ✅ Client chạy trên port 5173
- ✅ Máy khác truy cập được `http://192.168.1.100:5173`
- ✅ Tin nhắn realtime giữa các máy
- ✅ Online users hiển thị đúng số lượng

## Troubleshooting

**Lỗi: "Connection refused"**
- Kiểm tra server có đang chạy không
- Kiểm tra IP LAN có đúng không
- Kiểm tra firewall

**Lỗi: "CORS error"**
- CORS đã cấu hình cho phép tất cả origin trong Program.cs
- Restart server sau khi thay đổi

**Lỗi: Client không load được**
- Đảm bảo client đang chạy với `npm run dev`
- Dùng URL Network (có IP LAN) thay vì Local
