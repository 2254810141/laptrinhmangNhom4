import { useEffect, useMemo, useRef, useState } from 'react'
import * as signalR from '@microsoft/signalr'
import './ChatApp.css'

function ChatApp() {
  const savedNickname = window.localStorage.getItem('chat.nickname') || ''
  const defaultAvatarSrc = '/default-avatar.svg'
  const [connection, setConnection] = useState(null)
  const [nickname, setNickname] = useState(savedNickname)
  const [currentNickname, setCurrentNickname] = useState(savedNickname)
  const [messages, setMessages] = useState([])
  const [messageInput, setMessageInput] = useState('')
  const [onlineUsers, setOnlineUsers] = useState([])
  const [onlineCount, setOnlineCount] = useState(0)
  const [roomInfo, setRoomInfo] = useState({ roomId: 'default-room', displayName: 'Phòng chat' })
  const [roomNameDraft, setRoomNameDraft] = useState('')
  const [isEditingRoomName, setIsEditingRoomName] = useState(false)
  const [isSavingRoomName, setIsSavingRoomName] = useState(false)
  const [isConnected, setIsConnected] = useState(false)
  const [showChat, setShowChat] = useState(Boolean(savedNickname))
  const messagesEndRef = useRef(null)
  const roomId = roomInfo.roomId
  const signalRUrl = import.meta.env.VITE_SIGNALR_URL || `http://${window.location.hostname}:5000/chathub`

  const roomLabel = useMemo(() => roomInfo.displayName || 'Phòng chat', [roomInfo.displayName])

  useEffect(() => {
    if (!showChat || !currentNickname) return undefined

    let activeConnection = null
    let cancelled = false

    const initializeConnection = async () => {
      try {
        const newConnection = new signalR.HubConnectionBuilder()
          .withUrl(signalRUrl, {
            skipNegotiation: true,
            transport: signalR.HttpTransportType.WebSockets,
          })
          .withAutomaticReconnect()
          .build()

        activeConnection = newConnection

        newConnection.onreconnecting(() => {
          setIsConnected(false)
        })

        newConnection.onreconnected(() => {
          setIsConnected(true)
          newConnection.invoke('JoinRoom', roomId, currentNickname).catch(console.error)
        })

        newConnection.on('RoomInfoLoaded', (room) => {
          setRoomInfo(room)
          setRoomNameDraft(room.displayName)
        })

        newConnection.on('RoomNameUpdated', (room) => {
          setRoomInfo(room)
          setRoomNameDraft(room.displayName)
          setIsEditingRoomName(false)
          setIsSavingRoomName(false)
        })

        newConnection.on('ReceiveMessage', (data) => {
          setMessages((prev) => [
            ...prev,
            {
              nickname: data.nickname,
              content: data.content,
              timestamp: data.timestamp,
              type: 'message',
              isMine: data.nickname === currentNickname,
            },
          ])
        })

        newConnection.on('LoadHistory', (history) => {
          setMessages(
            history.map((msg) => ({
              ...msg,
              type: 'message',
              isMine: msg.nickname === currentNickname,
            })),
          )
        })

        newConnection.on('UpdateOnlineUsers', (users) => {
          setOnlineUsers(users)
          setOnlineCount(users.length)
        })

        newConnection.on('NotifyUserJoined', (joinedNickname) => {
          setMessages((prev) => [
            ...prev,
            {
              nickname: 'System',
              content: `✅ ${joinedNickname} đã vào phòng`,
              timestamp: new Date().toISOString(),
              type: 'system',
            },
          ])
        })

        newConnection.on('NotifyUserLeft', (leftNickname) => {
          setMessages((prev) => [
            ...prev,
            {
              nickname: 'System',
              content: `❌ ${leftNickname} đã rời phòng`,
              timestamp: new Date().toISOString(),
              type: 'system',
            },
          ])
        })

        await newConnection.start()
        if (cancelled) {
          await newConnection.stop()
          return
        }

        setConnection(newConnection)
        setIsConnected(true)

        await newConnection.invoke('JoinRoom', roomId, currentNickname)
      } catch (error) {
        console.error('Connection failed:', error)
        setIsConnected(false)
        setTimeout(() => initializeConnection(), 5000)
      }
    }

    initializeConnection()

    return () => {
      cancelled = true
      if (activeConnection) {
        activeConnection.stop()
      }
    }
  }, [showChat, currentNickname, roomId, signalRUrl])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    if (!isEditingRoomName) {
      setRoomNameDraft(roomInfo.displayName)
    }
  }, [roomInfo.displayName, isEditingRoomName])

  const handleStartChat = () => {
    if (!nickname.trim()) {
      alert('Vui lòng nhập nickname!')
      return
    }

    setCurrentNickname(nickname.trim())
    window.localStorage.setItem('chat.nickname', nickname.trim())
    setShowChat(true)
  }

  const handleSendMessage = async () => {
    const content = messageInput.trim()
    if (!content || !connection) return

    try {
      await connection.invoke('SendMessage', roomId, currentNickname, content)
      setMessageInput('')
    } catch (error) {
      console.error('Error sending message:', error)
    }
  }

  const handleSaveRoomName = async () => {
    const nextName = roomNameDraft.trim()
    if (!nextName || !connection || nextName === roomInfo.displayName) {
      setIsEditingRoomName(false)
      return
    }

    try {
      setIsSavingRoomName(true)
      await connection.invoke('UpdateRoomName', roomId, nextName)
    } catch (error) {
      console.error('Error updating room name:', error)
      setIsSavingRoomName(false)
      setIsEditingRoomName(true)
    }
  }

  const handleKeyPress = (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      handleSendMessage()
    }
  }

  const handleNicknameKeyPress = (event) => {
    if (event.key === 'Enter') {
      handleStartChat()
    }
  }

  const handleRoomNameKeyPress = (event) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      handleSaveRoomName()
    }

    if (event.key === 'Escape') {
      setRoomNameDraft(roomInfo.displayName)
      setIsEditingRoomName(false)
    }
  }

  const escapeHtml = (text) => {
    const map = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;',
    }

    return text.replace(/[&<>"']/g, (match) => map[match])
  }

  const formatTime = (timestamp) => new Date(timestamp).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })

  if (!showChat) {
    return (
      <div className="nickname-container">
        <div className="nickname-modal">
          <div className="brand-mark">💬</div>
          <h1>Realtime Chat</h1>
          <p>Nhập nickname để vào phòng chat nội bộ</p>
          <input
            type="text"
            className="nickname-input"
            placeholder="Nhập nickname..."
            maxLength="20"
            value={nickname}
            onChange={(event) => setNickname(event.target.value)}
            onKeyDown={handleNicknameKeyPress}
            autoFocus
          />
          <button className="start-button" onClick={handleStartChat}>
            Vào Phòng Chat
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="chat-container active">
      <div className="chat-shell">
        <aside className="chat-sidebar">
          <div className="sidebar-profile">
            <img className="profile-avatar" src={defaultAvatarSrc} alt="Avatar mặc định" />
            <div>
              <div className="profile-label">Tài khoản của bạn</div>
              <div className="profile-name">{currentNickname}</div>
            </div>
          </div>

          <div className="sidebar-block">
            <div className="sidebar-block-title">
              <span>👥</span>
              <span>Đang online</span>
              <span className="sidebar-pill">{onlineCount}</span>
            </div>
            <div className="online-users-list">
                {onlineUsers.length === 0 ? (
                  <div className="empty-state">Chưa có ai online</div>
                ) : (
                  onlineUsers.map((user) => (
                    <div key={user.connectionId} className={`online-user ${user.nickname === currentNickname ? 'self' : ''}`}>
                      <img className="member-avatar" src={defaultAvatarSrc} alt="Avatar mặc định" />
                      <div className="member-meta">
                        <div className="member-name">
                          {user.nickname}
                        {user.nickname === currentNickname && <span className="member-badge">Bạn</span>}
                      </div>
                      <div className="member-status">Đang hoạt động</div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className={`connection-status ${isConnected ? 'connected' : 'disconnected'}`}>
            {isConnected ? '🟢 Kết nối' : '🔴 Mất kết nối'}
          </div>
        </aside>

        <main className="chat-main">
          <header className="chat-header">
            <div className="chat-header-left">
              <div className="chat-room-icon">💬</div>
              <div className="room-title-wrap">
                <div className="room-title-row">
                  {isEditingRoomName ? (
                    <input
                      className="room-name-input"
                      value={roomNameDraft}
                      onChange={(event) => setRoomNameDraft(event.target.value)}
                      onKeyDown={handleRoomNameKeyPress}
                      autoFocus
                    />
                  ) : (
                    <h2>{roomLabel}</h2>
                  )}
                  {!isEditingRoomName && (
                    <button
                      className="icon-button"
                      type="button"
                      onClick={() => {
                        setRoomNameDraft(roomInfo.displayName)
                        setIsEditingRoomName(true)
                      }}
                      aria-label="Sửa tên phòng"
                    >
                      ✎
                    </button>
                  )}
                  {isEditingRoomName && (
                    <button
                      className="icon-button"
                      type="button"
                      onMouseDown={(event) => {
                        event.preventDefault()
                        handleSaveRoomName()
                      }}
                      disabled={isSavingRoomName}
                      aria-label="Lưu tên phòng"
                    >
                      {isSavingRoomName ? '...' : '✓'}
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="chat-header-right">
              <span className="room-chip">{onlineCount} online</span>
            </div>
          </header>

              <div className="messages-area">
            {messages.map((msg, index) =>
              msg.type === 'system' ? (
                <div key={index} className="system-message">
                  {msg.content}
                </div>
              ) : (
                <div key={index} className={`message ${msg.isMine ? 'mine' : ''}`}>
                  <img className="message-avatar" src={defaultAvatarSrc} alt="Avatar mặc định" />
                  <div className="message-bubble">
                    <div className="message-meta">
                      <div className="message-nickname">{escapeHtml(msg.nickname)}</div>
                    </div>
                    <div className="message-content">{escapeHtml(msg.content)}</div>
                    <div className="message-timestamp">{formatTime(msg.timestamp)}</div>
                  </div>
                </div>
              ),
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className="input-area">
            <div className="composer-icon">✎</div>
            <input
              type="text"
              className="message-input"
              placeholder="Nhập tin nhắn..."
              value={messageInput}
              onChange={(event) => setMessageInput(event.target.value)}
              onKeyDown={handleKeyPress}
            />
            <button className="send-button" onClick={handleSendMessage} disabled={!messageInput.trim() || !isConnected}>
              Gửi
            </button>
          </div>
        </main>
      </div>
    </div>
  )
}

export default ChatApp
