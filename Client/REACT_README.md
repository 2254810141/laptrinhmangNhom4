# 🎨 React Realtime Chat Frontend

Frontend React untuk ứng dụng Realtime Chat ASP.NET Core + SignalR.

## 📋 Cấu Trúc

```
src/
├── App.jsx          # Main App component (imports ChatApp)
├── App.css          # App styles
├── ChatApp.jsx      # Chat component chính
├── ChatApp.css      # Chat styles
├── index.css        # Global styles
├── main.jsx         # Entry point
└── assets/          # Images, SVG
```

## 🚀 Installation & Setup

### 1. Install Dependencies

```bash
npm install
```

Điều này sẽ cài:
- `react` - UI library
- `react-dom` - React DOM rendering
- `@microsoft/signalr` - SignalR client (kết nối backend)
- Vite, ESLint, TypeScript definitions (dev dependencies)

### 2. Start Development Server

```bash
npm run dev
```

Output:
```
Local:   http://localhost:5173
```

Mở browser tại: **http://localhost:5173**

## 🔌 How It Works

### Architecture

```
React Component (ChatApp.jsx)
        ↓
SignalR Connection (@microsoft/signalr)
        ↓
WebSocket to Backend
        ↓
ASP.NET Core ChatHub (/chathub)
```

### Component Structure

**App.jsx** (Main)
- Renders ChatApp component

**ChatApp.jsx** (Chat Logic)
- State management with `useState`
- SignalR connection with `useEffect`
- Message sending/receiving
- Online users tracking
- Connection status

### State Variables

```javascript
const [connection, setConnection]           // SignalR connection
const [currentNickname, setCurrentNickname] // Current user nickname
const [nickname, setNickname]               // Input nickname
const [messages, setMessages]               // Chat messages array
const [messageInput, setMessageInput]       // Message input value
const [onlineCount, setOnlineCount]         // Online users count
const [isConnected, setIsConnected]         // Connection status
const [showChat, setShowChat]               // Show chat or modal
```

## 🎯 Features

### 1. Nickname Input Modal
- User enters nickname before joining
- Modal is required (can't close by clicking outside)
- Enter key or button click to submit

### 2. Real-time Messaging
- Send messages via SignalR
- Messages appear instantly for all connected users
- Automatic scroll to latest message

### 3. Message History
- Automatically loads last 50 messages on join
- Full conversation context provided

### 4. Online Users
- Shows count of online users
- "You" indicator for current user
- Live updates as users join/leave

### 5. Connection Status
- 🟢 Connected - All good
- 🔴 Disconnected - Trying to reconnect
- Auto-reconnect with exponential backoff

### 6. System Messages
- User joined notifications
- User left notifications
- Visual distinction from regular messages

## ⚙️ Configuration

### Backend URL

Edit `ChatApp.jsx` line ~33:

```javascript
const newConnection = new signalR.HubConnectionBuilder()
  .withUrl('http://localhost:5000/chathub', {  // <- Change this
    skipNegotiation: true,
    transport: signalR.HttpTransportType.WebSockets,
  })
```

Change `localhost:5000` to your backend URL if different.

### Room ID

Edit `ChatApp.jsx` line ~176:

```javascript
const roomId = 'default-room'  // <- Change this
```

All users join the same room. To implement multiple rooms:
1. Add room selection UI
2. Store selected room in state
3. Pass `roomId` from state instead of hardcoded

## 📱 Responsive Design

The UI adapts to different screen sizes:

| Breakpoint | Changes |
|-----------|---------|
| Desktop (> 768px) | Full layout with sidebar |
| Tablet (600-768px) | Smaller sidebar (200px) |
| Mobile (< 600px) | Sidebar hidden, full-width chat |

## 🔒 Security

### XSS Protection
```javascript
const escapeHtml = (text) => {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  }
  return text.replace(/[&<>"']/g, m => map[m])
}
```

User input is escaped before display to prevent XSS attacks.

### Input Validation
- Empty messages are rejected
- Nickname is required
- Message length can be limited (edit in backend)

## 🧪 Testing

### Test with Multiple Users

1. Open http://localhost:5173 in Tab 1
2. Open http://localhost:5173 in Tab 2 (or different browser)
3. Enter different nicknames
4. Send messages between tabs
5. Watch messages appear realtime

### Test Connection Issues

1. Stop backend (Ctrl+C on `dotnet run`)
2. Frontend shows: 🔴 Mất kết nối
3. Restart backend
4. Frontend auto-reconnects: 🟢 Kết nối
5. Rejoin room automatically

### Debug with DevTools

Press **F12** to open browser DevTools:

**Console Tab:**
- Check for JavaScript errors
- See SignalR connection logs

**Network Tab:**
- Look for "WS" (WebSocket) connection
- Should show `ws://localhost:5000/chathub`
- Keep connection open while chatting

**Application Tab:**
- View localStorage (if using)
- Check cookies

## 🐛 Troubleshooting

### "Cannot connect to backend"

1. Check backend is running
   ```bash
   # Check if port 5000 is in use
   netstat -ano | findstr :5000
   ```

2. Check CORS is configured
   - Backend should allow `http://localhost:5173`
   - Edit `Program.cs` if needed

3. Check firewall
   - Allow port 5000 through firewall

### "Messages not appearing"

1. Check WebSocket connection (DevTools > Network)
2. Check for JavaScript errors (DevTools > Console)
3. Verify backend is running
4. Try hard refresh (Ctrl+Shift+R)

### "Styling looks weird"

1. Clear browser cache (Ctrl+Shift+Delete)
2. Hard refresh (Ctrl+Shift+R)
3. Check index.css and ChatApp.css are loaded
4. Check for CSS conflicts

## 📦 Build for Production

### Create Optimized Build

```bash
npm run build
```

Creates `dist/` folder with optimized files.

### Preview Build Locally

```bash
npm run preview
```

Serves the built version on http://localhost:4173

### Deploy

1. Build: `npm run build`
2. Upload `dist/` folder to your server
3. Configure backend URL for production
4. Deploy to hosting (Vercel, Netlify, GitHub Pages, etc.)

## 🚀 Performance Tips

### Optimize Messages Array

For better performance with many messages:

```javascript
// Limit to last 100 messages
const MAX_MESSAGES = 100
const [messages, setMessages] = useState([])

// When adding message
setMessages(prev => {
  const updated = [...prev, newMessage]
  return updated.slice(-MAX_MESSAGES)
})
```

### Memoize Components

For large message lists:

```javascript
import { memo } from 'react'

const MessageItem = memo(({ message }) => (
  // ... render message
))
```

## 🎨 Customization

### Change Colors

Edit `ChatApp.css` and replace colors:

```css
/* Change from purple to blue */
background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
/* to */
background: linear-gradient(135deg, #1e3c72 0%, #2a5298 100%);
```

### Change Fonts

Edit `index.css`:

```css
font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
/* to */
font-family: 'Inter', 'Roboto', sans-serif;
```

### Add Dark Mode

Create theme context and toggle:

```javascript
const [isDark, setIsDark] = useState(false)

// Toggle button in UI
<button onClick={() => setIsDark(!isDark)}>
  {isDark ? '☀️' : '🌙'}
</button>
```

## 📚 Useful Resources

- **React Docs:** https://react.dev/
- **Vite Docs:** https://vitejs.dev/
- **SignalR Docs:** https://docs.microsoft.com/en-us/aspnet/core/signalr/
- **HTML/CSS/JS:** https://developer.mozilla.org/

## 🔗 Related Files

### Backend
- `Server/RealtimeChatAPI/Program.cs` - Backend setup
- `Server/RealtimeChatAPI/Hubs/ChatHub.cs` - SignalR Hub
- `Server/RealtimeChatAPI/Services/ChatService.cs` - Database

### Frontend (This Project)
- `package.json` - Dependencies
- `vite.config.js` - Build configuration
- `src/ChatApp.jsx` - Main chat component
- `src/ChatApp.css` - Chat styles

## 🎯 Next Steps

1. ✅ Install dependencies: `npm install`
2. ✅ Start frontend: `npm run dev`
3. ✅ Start backend: `dotnet run` (in Server folder)
4. ✅ Open http://localhost:5173
5. ✅ Start chatting!

## 📝 Notes

- Frontend runs on `http://localhost:5173`
- Backend runs on `http://localhost:5000`
- Make sure both are running for chat to work
- Default room: `default-room`
- Auto-reconnect if connection drops

## 🎉 Happy Chatting!

You now have a modern React frontend connected to real-time backend. Enjoy building more features!
