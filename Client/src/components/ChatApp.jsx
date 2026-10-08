import { useState, useEffect, useRef } from 'react'
import * as signalR from '@microsoft/signalr'
import './ChatApp.css'

function ChatApp() {
  const [connection, setConnection] = useState(null)
  const [currentNickname, setCurrentNickname] = useState('')
  const [nickname, setNickname] = useState('')
  const [messages, setMessages] = useState([])
  const [messageInput, setMessageInput] = useState('')
  const [onlineCount, setOnlineCount] = useState(0)
  const [isConnected, setIsConnected] = useState(false)
  const [showChat, setShowChat] = useState(false)
  const messagesEndRef = useRef(null)
  const roomId = 'default-room'

  // Initialize connection
  useEffect(() => {
    if (!showChat || !currentNickname) return

    const initializeConnection = async () => {
      try {
        const newConnection = new signalR.HubConnectionBuilder()
          .withUrl('http://localhost:5000/chathub', {
            skipNegotiation: true,
            transport: signalR.HttpTransportType.WebSockets,
          })
          .withAutomaticReconnect()
          .build()

        // Connection events
        newConnection.onreconnecting((error) => {
          console.log(`Reconnecting: ${error.message}`)
          setIsConnected(false)
        })

        newConnection.onreconnected((connectionId) => {
          console.log(`Reconnected with connection id: ${connectionId}`)
          setIsConnected(true)
          newConnection.invoke('JoinRoom', roomId, currentNickname).catch(err => console.error(err))
        })

        // SignalR event handlers
        newConnection.on('ReceiveMessage', (data) => {
          setMessages(prev => [...prev, {
            nickname: data.nickname,
            content: data.content,
            timestamp: data.timestamp,
            type: 'message'
          }])
        })

        newConnection.on('LoadHistory', (history) => {
          setMessages(history.map(msg => ({
            ...msg,
            type: 'message'
          })))
        })

        newConnection.on('UpdateOnlineUsers', (users) => {
          setOnlineCount(users.length)
        })

        newConnection.on('NotifyUserJoined', (joinedNickname) => {
          setMessages(prev => [...prev, {
            nickname: 'System',
            content: `✅ ${joinedNickname} đã vào phòng`,
            timestamp: new Date().toISOString(),
            type: 'system'
          }])
        })

        newConnection.on('NotifyUserLeft', (leftNickname) => {
          setMessages(prev => [...prev, {
            nickname: 'System',
            content: `❌ ${leftNickname} đã rời phòng`,
            timestamp: new Date().toISOString(),
            type: 'system'
          }])
        })

        await newConnection.start()
        setConnection(newConnection)
        setIsConnected(true)
        console.log('Connected to SignalR hub')

        // Join room after slight delay
        setTimeout(async () => {
          try {
            await newConnection.invoke('JoinRoom', roomId, currentNickname)
          } catch (err) {
            console.error('Error joining room:', err)
          }
        }, 500)
      } catch (err) {
        console.error('Connection failed:', err)
        setIsConnected(false)
        setTimeout(() => initializeConnection(), 5000)
      }
    }

    initializeConnection()

    return () => {
      if (connection) {
        connection.stop()
      }
    }
  }, [showChat, currentNickname])

  // Auto scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleStartChat = () => {
    if (!nickname.trim()) {
      alert('Vui lòng nhập nickname!')
      return
    }
    setCurrentNickname(nickname)
    setShowChat(true)
  }

  const handleSendMessage = async () => {
    const content = messageInput.trim()
    if (!content || !connection) return

    try {
      await connection.invoke('SendMessage', roomId, currentNickname, content)
      setMessageInput('')
    } catch (err) {
      console.error('Error sending message:', err)
    }
  }

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSendMessage()
    }
  }

  const handleNicknameKeyPress = (e) => {
    if (e.key === 'Enter') {
      handleStartChat()
    }
  }

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

  const formatTime = (timestamp) => {
    return new Date(timestamp).toLocaleTimeString('vi-VN')
  }

  if (!showChat) {
    return (
      <div className="nickname-container">
        <div className="nickname-modal">
          <h1>💬 Realtime Chat</h1>
          <p>Nhập nickname của bạn để bắt đầu</p>
          <input
            type="text"
            className="nickname-input"
            placeholder="Nhập nickname..."
            maxLength="20"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            onKeyPress={handleNicknameKeyPress}
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
      {/* Chat Main Area */}
      <div className="chat-main">
        <div className="chat-header">
          <h2>🗨️ Phòng Chat Realtime</h2>
        </div>

        <div className="messages-area">
          {messages.map((msg, index) => (
            msg.type === 'system' ? (
              <div key={index} className="system-message">
                {msg.content}
              </div>
            ) : (
              <div key={index} className="message">
                <div className="message-bubble">
                  <div className="message-nickname">{escapeHtml(msg.nickname)}</div>
                  <div className="message-content">{escapeHtml(msg.content)}</div>
                  <div className="message-timestamp">{formatTime(msg.timestamp)}</div>
                </div>
              </div>
            )
          ))}
          <div ref={messagesEndRef} />
        </div>

        <div className="input-area">
          <input
            type="text"
            className="message-input"
            placeholder="Gõ tin nhắn..."
            value={messageInput}
            onChange={(e) => setMessageInput(e.target.value)}
            onKeyPress={handleKeyPress}
          />
          <button
            className="send-button"
            onClick={handleSendMessage}
            disabled={!messageInput.trim() || !isConnected}
          >
            Gửi
          </button>
        </div>
      </div>

      {/* Sidebar - Online Users */}
      <div className="sidebar">
        <div className="sidebar-header">👥 Đang Online ({onlineCount})</div>
        <div className="online-users-list">
          <div className="online-user">
            <div className="online-indicator"></div>
            <span>{currentNickname} (Bạn)</span>
          </div>
        </div>
        <div className={`connection-status ${isConnected ? 'connected' : 'disconnected'}`}>
          {isConnected ? '🟢 Kết nối' : '🔴 Mất kết nối'}
        </div>
      </div>
    </div>
  )
}

export default ChatApp
