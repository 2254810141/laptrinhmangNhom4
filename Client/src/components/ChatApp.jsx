import { useEffect, useMemo, useRef, useState } from 'react'
import * as signalR from '@microsoft/signalr'
import './ChatApp.css'

const FORMATTED_MESSAGE_PREFIX = '[[chat-format-v1]]'
const DEFAULT_ROOM = { roomId: 'default-room', displayName: 'Phòng chung' }

function readSavedRooms() {
  try {
    const savedRooms = JSON.parse(window.localStorage.getItem('chat.rooms') || '[]')
    if (!Array.isArray(savedRooms)) throw new Error('Danh sách phòng đã lưu không hợp lệ.')
    return savedRooms.filter((room) =>
      room
      && typeof room.roomId === 'string'
      && typeof room.displayName === 'string',
    )
  } catch (error) {
    console.error('Error reading saved rooms:', error)
    return []
  }
}

function saveRoom(room) {
  const savedRooms = readSavedRooms()
  const nextRooms = [room, ...savedRooms.filter((savedRoom) => savedRoom.roomId !== room.roomId)]
  window.localStorage.setItem('chat.rooms', JSON.stringify(nextRooms))
  return nextRooms
}

function readFormattedMessage(content) {
  if (!content || !content.startsWith(FORMATTED_MESSAGE_PREFIX)) {
    return { text: content || '', style: null }
  }

  try {
    const formatted = JSON.parse(content.slice(FORMATTED_MESSAGE_PREFIX.length))
    if (typeof formatted.text !== 'string') return { text: content, style: null }

    return {
      text: formatted.text,
      style: {
        color: typeof formatted.color === 'string' && /^#[\da-f]{6}$/i.test(formatted.color) ? formatted.color : undefined,
        fontSize: Number.isFinite(formatted.fontSize) && formatted.fontSize >= 12 && formatted.fontSize <= 24
          ? `${formatted.fontSize}px`
          : undefined,
        fontWeight: formatted.bold ? 700 : undefined,
        fontStyle: formatted.italic ? 'italic' : undefined,
        textDecoration: formatted.underline ? 'underline' : undefined,
      },
    }
  } catch {
    return { text: content, style: null }
  }
}

function rememberMember(members, nickname, timestamp = new Date().toISOString()) {
  if (!nickname || nickname === 'System') return members

  const existing = members.find((member) => member.nickname === nickname)
  if (existing) {
    return members.map((member) =>
      member.nickname === nickname ? { ...member, lastSeen: timestamp } : member,
    )
  }

  return [...members, { nickname, lastSeen: timestamp }]
}

function ThemeToggle({ theme, onToggle, className = '' }) {
  const isLight = theme === 'light'

  return (
    <button
      className={`theme-toggle ${className}`}
      type="button"
      onClick={onToggle}
      aria-label={`Chuyển sang giao diện ${isLight ? 'tối' : 'sáng'}`}
      aria-pressed={isLight}
      title={`Giao diện ${isLight ? 'sáng' : 'tối'}`}
    >
      <span className="theme-toggle-icon" aria-hidden="true">{isLight ? '☀' : '☾'}</span>
      <span>{isLight ? 'Giao diện sáng' : 'Giao diện tối'}</span>
      <span className={`theme-switch ${isLight ? 'is-light' : ''}`} aria-hidden="true"><span /></span>
    </button>
  )
}

function ChatApp() {
  const savedNickname = typeof window !== 'undefined' ? window.localStorage.getItem('chat.nickname') || '' : ''
  const defaultAvatarSrc = '/default-avatar.svg'

  const [avatarSrc, setAvatarSrc] = useState(() => {
    if (typeof window === 'undefined') return defaultAvatarSrc
    return window.localStorage.getItem('chat.avatar') || defaultAvatarSrc
  })

  const [theme, setTheme] = useState(() => {
    if (typeof window === 'undefined') return 'dark'
    return window.localStorage.getItem('chat.theme') === 'light' ? 'light' : 'dark'
  })

  const [nickname, setNickname] = useState(savedNickname)
  const [currentNickname, setCurrentNickname] = useState(savedNickname)
  const [connection, setConnection] = useState(null)
  const [messages, setMessages] = useState([])
  const [messageInput, setMessageInput] = useState('')
  const [onlineUsers, setOnlineUsers] = useState([])
  const [knownMembers, setKnownMembers] = useState([])
  const [rooms, setRooms] = useState([])
  const [roomForm, setRoomForm] = useState(null)
  const [roomCodeInput, setRoomCodeInput] = useState('')
  const [roomActionError, setRoomActionError] = useState('')
  const [memberFilter, setMemberFilter] = useState('all')
  const [roomInfo, setRoomInfo] = useState(DEFAULT_ROOM)
  const [roomNameDraft, setRoomNameDraft] = useState('')
  const [onlineCount, setOnlineCount] = useState(0)
  const [isEditingRoomName, setIsEditingRoomName] = useState(false)
  const [isSavingRoomName, setIsSavingRoomName] = useState(false)
  const [isConnected, setIsConnected] = useState(false)
  const [showChat, setShowChat] = useState(false)
  const [showQuickSettings, setShowQuickSettings] = useState(false)
  const [showRoomMenu, setShowRoomMenu] = useState(false)
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  const [showFormatting, setShowFormatting] = useState(false)
  const [showMobileSidebar, setShowMobileSidebar] = useState(false)
  const [textFormat, setTextFormat] = useState({
    color: '#e5e7eb',
    fontSize: 16,
    bold: false,
    italic: false,
    underline: false,
  })
  const [currentTime, setCurrentTime] = useState(() => Date.now())
  const avatarInputRef = useRef(null)
  const messagesEndRef = useRef(null)
  const loginInputRef = useRef(null)
  const particleCanvasRef = useRef(null)
  const inputContainerRef = useRef(null)
  const parallaxRef = useRef(null)
  const shouldStickToBottomRef = useRef(true)

  const roomId = roomInfo.roomId
  const signalRUrl = import.meta.env.VITE_SIGNALR_URL || 'https://laptrinhmangnhom4backend.onrender.com/chathub'

  const roomLabel = useMemo(() => roomInfo.displayName || 'Phòng chat', [roomInfo.displayName])
  const onlineMemberNames = useMemo(() => new Set(onlineUsers.map((user) => user.nickname)), [onlineUsers])
  const onlineMemberCount = onlineMemberNames.size

  const visibleMembers = useMemo(
    () =>
      knownMembers
        .filter((member) => memberFilter === 'all' || onlineMemberNames.has(member.nickname))
        .sort((left, right) => {
          const leftOnline = onlineMemberNames.has(left.nickname)
          const rightOnline = onlineMemberNames.has(right.nickname)
          return Number(rightOnline) - Number(leftOnline) || left.nickname.localeCompare(right.nickname)
        }),
    [knownMembers, memberFilter, onlineMemberNames],
  )

  useEffect(() => {
    if (!showChat || !currentNickname) return undefined

    let activeConnection = null
    let cancelled = false
    let retryTimeout = null

    const scheduleReconnect = () => {
      if (cancelled || retryTimeout !== null) return

      retryTimeout = window.setTimeout(() => {
        retryTimeout = null
        initializeConnection()
      }, 5000)
    }

    const initializeConnection = async () => {
      if (cancelled) return

      let roomJoinAttempted = false
      try {
        const newConnection = new signalR.HubConnectionBuilder()
          .withUrl(signalRUrl, {
            skipNegotiation: true,
            transport: signalR.HttpTransportType.WebSockets,
          })
          .withAutomaticReconnect()
          .build()

        activeConnection = newConnection

        newConnection.onreconnecting(() => setIsConnected(false))
        newConnection.onreconnected(async () => {
          try {
            await newConnection.invoke('JoinRoom', roomId, currentNickname)
            setIsConnected(true)
          } catch (error) {
            console.error('Failed to rejoin chat room:', error)
            setIsConnected(false)
          }
        })
        newConnection.onclose((error) => {
          setIsConnected(false)
          setConnection((current) => current === newConnection ? null : current)
          if (error) console.error('SignalR connection closed:', error)
          scheduleReconnect()
        })

        newConnection.on('RoomInfoLoaded', (room) => {
          const savedRoom = readSavedRooms().find((item) => item.roomId === room.roomId)
          const roomInfoToShow = savedRoom ? { ...room, displayName: savedRoom.displayName } : room
          setRoomInfo(roomInfoToShow)
          setRoomNameDraft(roomInfoToShow.displayName)
          try {
            saveRoom(roomInfoToShow)
            setRooms((current) => [
              roomInfoToShow,
              ...current.filter((item) => item.roomId !== roomInfoToShow.roomId),
            ])
          } catch (error) {
            console.error('Error saving joined room:', error)
            setRoomActionError('Đã vào phòng nhưng không thể lưu phòng trên thiết bị này.')
          }

          if (savedRoom && savedRoom.displayName !== room.displayName) {
            newConnection.invoke('UpdateRoomName', room.roomId, savedRoom.displayName).catch((error) => {
              console.error('Error syncing saved room name:', error)
              setRoomActionError('Không thể đồng bộ tên phòng với máy chủ.')
            })
          }
        })

        newConnection.on('RoomNameUpdated', (room) => {
          setRoomInfo(room)
          setRoomNameDraft(room.displayName)
          setIsEditingRoomName(false)
          setIsSavingRoomName(false)
          try {
            saveRoom(room)
            setRooms((current) => [room, ...current.filter((item) => item.roomId !== room.roomId)])
          } catch (error) {
            console.error('Error saving room name:', error)
            setRoomActionError('Không thể lưu tên phòng trên thiết bị này.')
          }
        })

        newConnection.on('ReceiveMessage', (data) => {
          const parsedMessage = readFormattedMessage(data.content)
          setMessages((prev) => [
            ...prev,
            {
              nickname: data.nickname,
              content: parsedMessage.text,
              style: parsedMessage.style,
              timestamp: data.timestamp,
              type: 'message',
              isMine: data.nickname === currentNickname,
            },
          ])
          setKnownMembers((prev) => rememberMember(prev, data.nickname, data.timestamp))
        })

        newConnection.on('LoadHistory', (history) => {
          setMessages(
            history.map((msg) => {
              const parsedMessage = readFormattedMessage(msg.content)
              return {
                ...msg,
                content: parsedMessage.text,
                style: parsedMessage.style,
                type: 'message',
                isMine: msg.nickname === currentNickname,
              }
            }),
          )
          setKnownMembers((prev) =>
            history.reduce((members, message) => rememberMember(members, message.nickname, message.timestamp), prev),
          )
        })

        newConnection.on('LoadMembers', (members) => {
          setKnownMembers((prev) =>
            members.reduce(
              (known, member) => rememberMember(known, member.nickname, member.lastSeen),
              prev,
            ),
          )
        })

        newConnection.on('MemberAvatarUpdated', ({ nickname, avatar }) => {
          setKnownMembers((prev) => {
            const member = prev.find((item) => item.nickname === nickname)
            const updated = member
              ? prev.map((item) => (item.nickname === nickname ? { ...item, avatar } : item))
              : [...prev, { nickname, avatar, lastSeen: new Date().toISOString() }]
            return updated
          })

          if (nickname === currentNickname) {
            setAvatarSrc(avatar || defaultAvatarSrc)
            if (avatar) window.localStorage.setItem('chat.avatar', avatar)
          }
        })

        newConnection.on('MemberLastSeenUpdated', ({ nickname, lastSeen }) => {
          setKnownMembers((prev) => prev.map((member) => (member.nickname === nickname ? { ...member, lastSeen } : member)))
        })

        newConnection.on('UpdateOnlineUsers', (users) => {
          setOnlineUsers(users)
          setOnlineCount(users.length)
          setKnownMembers((prev) => users.reduce((members, user) => rememberMember(members, user.nickname), prev))
        })

        newConnection.on('NotifyUserJoined', (joinedNickname) => {
          setKnownMembers((prev) => rememberMember(prev, joinedNickname))
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
          setKnownMembers((prev) => rememberMember(prev, leftNickname))
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
        roomJoinAttempted = true
        await newConnection.invoke('JoinRoom', roomId, currentNickname)
      } catch (error) {
        console.error('Connection failed:', error)
        setIsConnected(false)
        if (activeConnection) {
          const failedConnection = activeConnection
          activeConnection = null
          await failedConnection.stop().catch(console.error)
        }
        if (roomJoinAttempted) {
          setConnection(null)
          setShowChat(false)
          setRoomActionError('Không thể vào hoặc tạo phòng. Hãy kiểm tra kết nối và thử lại.')
        } else {
          scheduleReconnect()
        }
      }
    }

    initializeConnection()

    return () => {
      cancelled = true
      if (retryTimeout !== null) {
        window.clearTimeout(retryTimeout)
      }
      if (activeConnection) {
        activeConnection.stop()
      }
    }
  }, [showChat, currentNickname, roomId, signalRUrl])

  useEffect(() => {
    if (!shouldStickToBottomRef.current) return

    const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
    messagesEndRef.current?.scrollIntoView({ behavior, block: 'end' })
  }, [messages])

  const handleMessagesScroll = (event) => {
    const { scrollHeight, scrollTop, clientHeight } = event.currentTarget
    shouldStickToBottomRef.current = scrollHeight - scrollTop - clientHeight <= 96
  }

  useEffect(() => {
    const interval = window.setInterval(() => setCurrentTime(Date.now()), 60000)
    return () => window.clearInterval(interval)
  }, [])

  useEffect(() => {
    if (!isEditingRoomName) {
      setRoomNameDraft(roomInfo.displayName)
    }
  }, [roomInfo.displayName, isEditingRoomName])

  useEffect(() => {
    if (!showChat) {
      const canvas = particleCanvasRef.current
      if (!canvas) return

      const ctx = canvas.getContext('2d')
      const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      const hasFinePointer = window.matchMedia('(pointer: fine)').matches
      if (!ctx || prefersReducedMotion || !hasFinePointer) return undefined

      let particles = []
      let animationFrameId
      let fallingIntervalId
      let pointerFrameId = null
      let lastParticleAt = 0
      let pointerPosition = { x: 0, y: 0 }

      const resizeCanvas = () => {
        canvas.width = window.innerWidth
        canvas.height = window.innerHeight
      }

      resizeCanvas()
      window.addEventListener('resize', resizeCanvas)

      class Particle {
        constructor(x, y, isFalling = false) {
          this.x = x
          this.y = y
          this.size = isFalling ? Math.random() * 4 + 2 : Math.random() * 3 + 1
          this.speedX = isFalling ? -(Math.random() * 1.5 + 0.5) : Math.random() * 2 - 1
          this.speedY = isFalling ? Math.random() * 0.5 + 0.3 : Math.random() * 2 - 1
          this.life = 1
          this.decay = isFalling ? Math.random() * 0.003 + 0.001 : Math.random() * 0.02 + 0.01
          this.color = isFalling ? 'rgba(255, 255, 255, 0.9)' : `hsl(${Math.random() * 60 + 200}, 80%, 80%)`
          this.isFalling = isFalling
        }

        update() {
          this.x += this.speedX
          this.y += this.speedY
          this.life -= this.decay
          this.size *= 0.996

          if (this.isFalling) {
            if (this.y > canvas.height || this.x < 0) {
              this.y = 0
              this.x = canvas.width + Math.random() * 200
              this.life = 1
              this.size = Math.random() * 4 + 2
            }
          }
        }

        draw() {
          ctx.beginPath()
          ctx.fillStyle = this.color
          ctx.globalAlpha = this.life

          if (this.isFalling) {
            // Draw meteor/star shape with tail
            const tailLength = this.size * 4
            ctx.moveTo(this.x, this.y - this.size)
            ctx.lineTo(this.x + this.size * 0.3, this.y + this.size)
            ctx.lineTo(this.x, this.y + tailLength)
            ctx.lineTo(this.x - this.size * 0.3, this.y + this.size)
            ctx.closePath()
          } else {
            // Sharp diamond shape for mouse particles
            ctx.moveTo(this.x, this.y - this.size)
            ctx.lineTo(this.x + this.size, this.y)
            ctx.lineTo(this.x, this.y + this.size)
            ctx.lineTo(this.x - this.size, this.y)
            ctx.closePath()
          }

          ctx.fill()
          ctx.globalAlpha = 1
        }
      }

      const animate = () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height)

        particles = particles.filter(p => p.life > 0)

        particles.forEach(particle => {
          particle.update()
          particle.draw()
        })

        animationFrameId = requestAnimationFrame(animate)
      }

      animate()

      const handleMouseMove = (e) => {
        pointerPosition = { x: e.clientX, y: e.clientY }
        if (pointerFrameId === null) {
          pointerFrameId = requestAnimationFrame(() => {
            pointerFrameId = null
            const centerX = window.innerWidth / 2
            const centerY = window.innerHeight / 2
            const rotateX = (pointerPosition.y - centerY) / 30
            const rotateY = -(pointerPosition.x - centerX) / 30
            const translateX = (pointerPosition.x - centerX) / 20
            const translateY = (pointerPosition.y - centerY) / 20

            if (parallaxRef.current) {
              parallaxRef.current.style.transform =
                `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateX(${translateX}px) translateY(${translateY}px)`
            }
          })
        }

        const inputContainer = inputContainerRef.current
        if (!inputContainer) return

        const rect = inputContainer.getBoundingClientRect()
        const isInsideInput =
          e.clientX >= rect.left &&
          e.clientX <= rect.right &&
          e.clientY >= rect.top &&
          e.clientY <= rect.bottom

        if (!isInsideInput && Date.now() - lastParticleAt >= 32 && particles.length < 120) {
          particles.push(new Particle(e.clientX, e.clientY, false))
          lastParticleAt = Date.now()
        }
      }

      window.addEventListener('mousemove', handleMouseMove)

      fallingIntervalId = setInterval(() => {
        if (particles.length < 120) {
          particles.push(new Particle(Math.random() * canvas.width, 0, true))
        }
      }, 250)

      return () => {
        window.removeEventListener('resize', resizeCanvas)
        window.removeEventListener('mousemove', handleMouseMove)
        cancelAnimationFrame(animationFrameId)
        if (pointerFrameId !== null) cancelAnimationFrame(pointerFrameId)
        clearInterval(fallingIntervalId)
      }
    }
  }, [showChat])

  const handleSendMessage = async () => {
    const text = messageInput.trim()
    if (!text || !connection) return

    const hasFormatting =
      textFormat.color !== '#e5e7eb' ||
      textFormat.fontSize !== 16 ||
      textFormat.bold ||
      textFormat.italic ||
      textFormat.underline

    const content = hasFormatting
      ? `${FORMATTED_MESSAGE_PREFIX}${JSON.stringify({ text, ...textFormat })}`
      : text

    try {
      await connection.invoke('SendMessage', roomId, currentNickname, content)
      setMessageInput('')
      setShowEmojiPicker(false)
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

  const switchRoom = (room) => {
    if (room.roomId === roomId) return

    setMessages([])
    setOnlineUsers([])
    setKnownMembers([])
    setIsEditingRoomName(false)
    setRoomInfo(room)
    setConnection(null)
    setIsConnected(false)
    setShowMobileSidebar(false)
    setRoomActionError('')
  }

  const handleJoinRoom = (event) => {
    event.preventDefault()
    const nextNickname = nickname.trim()
    if (!nextNickname) {
      setRoomActionError('Vui lòng nhập nickname.')
      return
    }

    const roomId = roomCodeInput.trim()
    if (!/^[a-z\d-]{1,100}$/i.test(roomId)) {
      setRoomActionError('Mã phòng không hợp lệ.')
      return
    }

    const room = rooms.find((item) => item.roomId === roomId)
      || { roomId, displayName: `Phòng ${roomId.slice(0, 12)}` }

    try {
      window.localStorage.setItem('chat.nickname', nextNickname)
    } catch (error) {
      console.error('Error saving nickname:', error)
      setRoomActionError('Không thể lưu nickname trên thiết bị này.')
      return
    }

    setCurrentNickname(nextNickname)
    setRoomCodeInput('')
    setRoomForm(null)
    setRoomActionError('')
    switchRoom(room)
    setShowChat(true)
  }

  const handleCopyRoomCode = async (room) => {
    try {
      await window.navigator.clipboard.writeText(room.roomId)
      setRoomActionError('')
    } catch (error) {
      console.error('Error copying room code:', error)
      setRoomActionError('Không thể sao chép mã. Hãy chọn và sao chép mã hiển thị bên cạnh tên phòng.')
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
      handleNextStep()
    }
  }

  const handleNextStep = () => {
    const nextNickname = nickname.trim()
    if (!nextNickname) {
      setRoomActionError('Vui lòng nhập nickname.')
      return
    }

    try {
      window.localStorage.setItem('chat.nickname', nextNickname)
    } catch (error) {
      console.error('Error saving nickname:', error)
      setRoomActionError('Không thể lưu nickname trên thiết bị này.')
      return
    }

    setCurrentNickname(nextNickname)
    setRoomInfo(DEFAULT_ROOM)
    setRoomActionError('')
    setShowChat(true)
  }

  const handleAvatarChange = (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) {
      alert('Vui lòng chọn ảnh PNG, JPG, WebP hoặc GIF.')
      return
    }
    if (file.size > 2 * 1024 * 1024) {
      alert('Ảnh đại diện phải nhỏ hơn 2 MB.')
      return
    }

    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result !== 'string') return
      try {
        window.localStorage.setItem('chat.avatar', reader.result)
        setAvatarSrc(reader.result)
        if (connection) {
          connection.invoke('UpdateMemberAvatar', roomId, currentNickname, reader.result).catch((error) => {
            console.error('Error syncing avatar:', error)
            alert('Ảnh đã được lưu trên thiết bị này nhưng chưa đồng bộ được với phòng chat.')
          })
        }
      } catch (error) {
        console.error('Error saving avatar:', error)
        alert('Không thể lưu ảnh đại diện. Vui lòng chọn ảnh có dung lượng nhỏ hơn.')
      }
    }
    reader.onerror = () => {
      console.error('Error reading avatar file:', reader.error)
      alert('Không thể đọc ảnh đại diện. Vui lòng thử lại.')
    }
    reader.readAsDataURL(file)
  }

  const handleUpdateNickname = () => {
    const nextNickname = nickname.trim()
    if (!nextNickname) {
      alert('Tên hiển thị không được để trống.')
      return
    }

    window.localStorage.setItem('chat.nickname', nextNickname)
    setKnownMembers((prev) => rememberMember(prev, nextNickname))
    setCurrentNickname(nextNickname)
    setShowQuickSettings(false)
  }

  const toggleTheme = () => {
    setTheme((currentTheme) => {
      const nextTheme = currentTheme === 'dark' ? 'light' : 'dark'
      window.localStorage.setItem('chat.theme', nextTheme)
      return nextTheme
    })
  }

  const handleLogout = async () => {
    if (connection) {
      try {
        await connection.invoke('LeaveRoom', roomId, currentNickname)
        await connection.stop()
      } catch (error) {
        console.error('Error leaving chat room:', error)
      }
    }

    window.localStorage.removeItem('chat.nickname')
    setConnection(null)
    setIsConnected(false)
    setOnlineUsers([])
    setMessages([])
    setNickname('')
    setCurrentNickname('')
    setRooms([])
    setShowQuickSettings(false)
    setShowMobileSidebar(false)
    setShowChat(false)
    setRoomCodeInput('')
    setRoomActionError('')
    setRoomInfo(DEFAULT_ROOM)
  }

  const appendToMessage = (value) => {
    setMessageInput((current) => `${current}${value}`)
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

  const formatTime = (timestamp) =>
    new Date(timestamp).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })

  const formatLastSeen = (timestamp) => {
    const lastSeenTime = new Date(timestamp).getTime()
    if (!Number.isFinite(lastSeenTime)) return 'Ngoại tuyến'
    const elapsedMinutes = Math.max(0, Math.floor((currentTime - lastSeenTime) / 60000))
    if (elapsedMinutes < 1) return 'Vừa hoạt động'
    if (elapsedMinutes < 60) return `Hoạt động ${elapsedMinutes} phút trước`
    const elapsedHours = Math.floor(elapsedMinutes / 60)
    if (elapsedHours < 24) return `Hoạt động ${elapsedHours} giờ trước`
    return `Hoạt động ${Math.floor(elapsedHours / 24)} ngày trước`
  }

  if (!showChat) {
    return (
      <div className="nickname-container" data-theme={theme}>
        <canvas ref={particleCanvasRef} className="particle-canvas" />
        <div className="login-topbar">
          <ThemeToggle theme={theme} onToggle={toggleTheme} />
        </div>
        <div ref={parallaxRef} className="minimal-input-wrapper">
          <div className="login-content">
            <div className="login-heading">
              <span className="login-heading-icon" aria-hidden="true">
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
                  <path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5H7l-4 2v-5.5A7.5 7.5 0 1 1 20 11.5Z" />
                  <path d="M8 11h8M8 14h5" />
                </svg>
              </span>
              <div className="login-heading-title">Phòng chat</div>
              <div className="login-heading-caption">Bắt đầu trò chuyện cùng mọi người</div>
            </div>
            <div ref={inputContainerRef} className="minimal-input-container">
              <div className="input-icon-wrapper">
                <svg className="input-icon" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
              </div>
              <input
                ref={loginInputRef}
                type="text"
                className="minimal-input"
                placeholder="Name"
                aria-label="Tên hiển thị"
                maxLength="20"
                value={nickname}
                onChange={(event) => setNickname(event.target.value)}
                onKeyDown={handleNicknameKeyPress}
                autoFocus
              />
              <button
                className="input-arrow-button"
                type="button"
                onClick={handleNextStep}
                aria-label="Vào phòng chung"
                title="Vào phòng chung"
              />
            </div>
          </div>
          {roomActionError && <div className="room-action-error" role="alert">{roomActionError}</div>}
        </div>
      </div>
    )
  }

  return (
    <div className="chat-container active" data-theme={theme}>
      <div className="chat-shell">
        {showMobileSidebar && (
          <button
            className="sidebar-backdrop"
            type="button"
            onClick={() => setShowMobileSidebar(false)}
            aria-label="Đóng danh sách thành viên"
          />
        )}

        <aside
          id="chat-members-sidebar"
          className={`chat-sidebar ${showMobileSidebar ? 'mobile-open' : ''}`}
          aria-label="Thành viên phòng chat"
        >
          <div className="sidebar-profile">
            <div className="profile-avatar-wrap">
              <button
                className="avatar-upload-button"
                type="button"
                onClick={() => avatarInputRef.current?.click()}
                aria-label="Đổi ảnh đại diện"
              >
                <img className="profile-avatar" src={avatarSrc} alt={`Avatar của ${currentNickname}`} />
                <span className="avatar-edit-hint" aria-hidden="true">✎</span>
              </button>
              <span className="profile-online-dot" />
            </div>
            <div className="profile-details">
              <div className="profile-label">Tài khoản của bạn</div>
              <div className="profile-name">{currentNickname}</div>
              <div className="profile-presence">Đang hoạt động</div>
            </div>
            <button
              className="icon-button quick-settings-button"
              type="button"
              onClick={() => setShowQuickSettings((value) => !value)}
              aria-label="Cài đặt tài khoản"
              aria-expanded={showQuickSettings}
            >
              ⚙
            </button>
            {showQuickSettings && (
              <div className="quick-settings-panel">
                <strong>Cài đặt nhanh</strong>
                <label htmlFor="nickname-setting">Tên hiển thị</label>
                <div className="quick-settings-row">
                  <input
                    id="nickname-setting"
                    value={nickname}
                    maxLength="20"
                    onChange={(event) => setNickname(event.target.value)}
                  />
                  <button type="button" onClick={handleUpdateNickname}>Lưu</button>
                </div>
                <ThemeToggle theme={theme} onToggle={toggleTheme} className="settings-theme-toggle" />
                <button className="text-action" type="button" onClick={() => avatarInputRef.current?.click()}>
                  Đổi ảnh đại diện
                </button>
                <button className="logout-action" type="button" onClick={handleLogout}>
                  ↪ <span>Đăng xuất</span>
                </button>
              </div>
            )}
          </div>

          <input
            ref={avatarInputRef}
            className="visually-hidden"
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            onChange={handleAvatarChange}
          />

          <div className="sidebar-block room-list-block">
            <div className="sidebar-block-title">
              <span className="members-title-icon">▣</span>
              <span>Phòng chat</span>
              <span className="sidebar-pill">{rooms.length}</span>
            </div>
            <div className="room-actions">
              <button
                type="button"
                onClick={() => {
                  setRoomForm((form) => form === 'join' ? null : 'join')
                  setRoomActionError('')
                }}
              >
                Vào hoặc tạo bằng mã
              </button>
            </div>

            {roomForm === 'join' && (
              <form className="room-create-form" onSubmit={handleJoinRoom}>
                <input
                  aria-label="Mã phòng"
                  placeholder="Nhập mã để vào hoặc tạo phòng"
                  maxLength={100}
                  value={roomCodeInput}
                  onChange={(event) => setRoomCodeInput(event.target.value)}
                />
                <button type="submit" disabled={!roomCodeInput.trim()}>Vào hoặc tạo phòng</button>
              </form>
            )}

            {roomActionError && <div className="room-action-error" role="alert">{roomActionError}</div>}

            <div className="room-entry-list" aria-label="Các phòng đã tham gia trên thiết bị">
              {rooms.map((room) => (
                <div className={`room-entry ${room.roomId === roomId ? 'active' : ''}`} key={room.roomId}>
                  <button
                    className="room-entry-select"
                    type="button"
                    onClick={() => switchRoom(room)}
                    aria-current={room.roomId === roomId ? 'page' : undefined}
                  >
                    <span aria-hidden="true">#</span>
                    <span className="room-entry-name">
                      <strong>{room.displayName}</strong>
                      <small>{room.roomId}</small>
                    </span>
                  </button>
                  <button
                    className="room-copy-button"
                    type="button"
                    onClick={() => handleCopyRoomCode(room)}
                    title="Sao chép mã mời"
                    aria-label={`Sao chép mã phòng ${room.displayName}`}
                  >
                    ⧉
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="sidebar-block">
            <div className="sidebar-block-title">
              <span className="members-title-icon">◉</span>
              <span>Danh sách thành viên</span>
              <span className="sidebar-pill">{knownMembers.length}</span>
            </div>

            <div className="member-tabs" role="group" aria-label="Lọc thành viên">
              <button
                className={memberFilter === 'all' ? 'active' : ''}
                type="button"
                aria-pressed={memberFilter === 'all'}
                onClick={() => setMemberFilter('all')}
              >
                Tất cả <span>{knownMembers.length}</span>
              </button>
              <button
                className={memberFilter === 'online' ? 'active' : ''}
                type="button"
                aria-pressed={memberFilter === 'online'}
                onClick={() => setMemberFilter('online')}
              >
                Đang online <span>{onlineMemberCount}</span>
              </button>
            </div>

            <div className="online-users-list">
              {visibleMembers.length === 0 ? (
                <div className="empty-state">
                  {memberFilter === 'online' ? 'Chưa có ai đang online' : 'Chưa có thành viên nào'}
                </div>
              ) : (
                visibleMembers.map((member) => {
                  const isOnline = onlineMemberNames.has(member.nickname)
                  const isMine = member.nickname === currentNickname

                  return (
                    <div key={member.nickname} className={`online-user ${isMine ? 'self' : ''}`}>
                      <div className="member-avatar-wrap">
                        {isMine ? (
                          <button
                            className="member-avatar-button"
                            type="button"
                            onClick={() => avatarInputRef.current?.click()}
                            aria-label="Đổi ảnh đại diện"
                          >
                            <img className="member-avatar" src={avatarSrc} alt={`Avatar của ${member.nickname}`} />
                          </button>
                        ) : (
                          <img
                            className="member-avatar"
                            src={member.avatar || defaultAvatarSrc}
                            alt={`Avatar của ${member.nickname}`}
                          />
                        )}
                        <span className={`member-presence-dot ${isOnline ? 'online' : ''}`} />
                      </div>

                      <div className="member-meta">
                        <div className="member-name">
                          {member.nickname}
                          {isMine && <span className="member-badge">Bạn</span>}
                        </div>
                        <div className={`member-status ${isOnline ? 'is-online' : ''}`}>
                          {isOnline ? 'Đang hoạt động' : formatLastSeen(member.lastSeen)}
                        </div>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </div>

          <div
            className={`connection-status ${isConnected ? 'connected' : 'disconnected'}`}
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            <span className="connection-dot" />
            <span>{isConnected ? 'Đã kết nối' : 'Mất kết nối'}</span>
            <span className="connection-label">SignalR</span>
          </div>
        </aside>

        <main className="chat-main">
          <header className="chat-header">
            <div className="chat-header-left">
              <button
                className="mobile-members-button"
                type="button"
                onClick={() => setShowMobileSidebar(true)}
                aria-label="Mở danh sách thành viên"
                aria-controls="chat-members-sidebar"
                aria-expanded={showMobileSidebar}
              >
                ☰
              </button>

              <div className="chat-room-icon" aria-hidden="true">✦</div>
              <div className="chat-room-icon" aria-hidden="true">💬</div>

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
                <p className="room-subtitle">
                  <span className="room-online-dot" />
                  {onlineMemberCount}/{knownMembers.length} online
                  <span className="subtitle-divider">·</span>
                  Phòng chat
                </p>
              </div>
            </div>

            <div className="chat-header-right">
              <span className="room-chip">
                <span className="room-online-dot" />
                {onlineMemberCount} online
              </span>
              <button
                className="icon-button room-menu-button"
                type="button"
                aria-label="Cài đặt phòng chat"
                aria-expanded={showRoomMenu}
                onClick={() => setShowRoomMenu((value) => !value)}
              >
                •••
              </button>

              {showRoomMenu && (
                <div className="room-menu-panel">
                  <strong>Cài đặt phòng</strong>
                  <span>{roomLabel}</span>
                  <span>{knownMembers.length} thành viên đã tham gia</span>
                  <button
                    type="button"
                    onClick={() => {
                      setRoomNameDraft(roomInfo.displayName)
                      setIsEditingRoomName(true)
                      setShowRoomMenu(false)
                    }}
                  >
                    ✎ Đổi tên phòng
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowMobileSidebar(true)
                      setShowRoomMenu(false)
                    }}
                  >
                    ♙ Xem thành viên
                  </button>
                </div>
              )}
            </div>
          </header>

          <div
            className="messages-area"
            role="log"
            aria-label="Tin nhắn phòng chat"
            aria-live="polite"
            aria-relevant="additions text"
            tabIndex={0}
            onScroll={handleMessagesScroll}
          >
            {messages.length === 0 && (
              <div className="chat-welcome">
                <div className="welcome-sparkle">✦</div>
                <strong>Bắt đầu cuộc trò chuyện</strong>
                <span>Gửi lời chào đầu tiên đến mọi người trong phòng nhé.</span>
              </div>
            )}

            {messages.map((msg, index) =>
              msg.type === 'system' ? (
                <div key={`${msg.nickname}-${index}`} className="system-message">
                  <span className="system-message-icon" aria-hidden="true">✦</span>
                  {msg.content}
                </div>
              ) : (
                <div key={`${msg.nickname}-${msg.timestamp}-${index}`} className={`message ${msg.isMine ? 'mine' : ''}`}>
                  <img
                    className="message-avatar"
                    src={
                      msg.isMine
                        ? avatarSrc
                        : knownMembers.find((member) => member.nickname === msg.nickname)?.avatar || defaultAvatarSrc
                    }
                    alt={`Avatar của ${msg.nickname}`}
                  />
                  <div className="message-bubble">
                    <div className="message-meta">
                      <div className="message-nickname">{msg.nickname}</div>
                    </div>
                    <div className="message-content" style={msg.style || undefined}>
                      {msg.content}
                    </div>
                    <div className="message-timestamp">{formatTime(msg.timestamp)}</div>
                  </div>
                </div>
              ),
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className="composer-wrap">
            {(showFormatting || messageInput.length > 0) && (
              <div className="formatting-toolbar" aria-label="Định dạng tin nhắn">
                <label className="color-picker-control" title="Màu chữ">
                  <span className="formatting-label">Màu chữ</span>
                  <input
                    aria-label="Chọn màu chữ"
                    type="color"
                    value={textFormat.color}
                    onChange={(event) => setTextFormat((format) => ({ ...format, color: event.target.value }))}
                  />
                </label>

                <span className="toolbar-divider" />
                <span className="formatting-label">Cỡ chữ</span>
                <div className="font-size-presets" role="group" aria-label="Cỡ chữ">
                  {[{ label: 'Nhỏ', size: 13 }, { label: 'Vừa', size: 16 }, { label: 'Lớn', size: 20 }].map(
                    ({ label, size }) => (
                      <button
                        className={textFormat.fontSize === size ? 'active' : ''}
                        key={label}
                        type="button"
                        aria-pressed={textFormat.fontSize === size}
                        onClick={() => setTextFormat((format) => ({ ...format, fontSize: size }))}
                      >
                        {label}
                      </button>
                    ),
                  )}
                </div>

                <span className="toolbar-divider" />
                <button
                  className={`format-button ${textFormat.bold ? 'active' : ''}`}
                  type="button"
                  aria-label="In đậm"
                  aria-pressed={textFormat.bold}
                  onClick={() => setTextFormat((format) => ({ ...format, bold: !format.bold }))}
                >
                  <strong>B</strong>
                </button>
                <button
                  className={`format-button ${textFormat.italic ? 'active' : ''}`}
                  type="button"
                  aria-label="In nghiêng"
                  aria-pressed={textFormat.italic}
                  onClick={() => setTextFormat((format) => ({ ...format, italic: !format.italic }))}
                >
                  <em>I</em>
                </button>
                <button
                  className={`format-button ${textFormat.underline ? 'active' : ''}`}
                  type="button"
                  aria-label="Gạch chân"
                  aria-pressed={textFormat.underline}
                  onClick={() => setTextFormat((format) => ({ ...format, underline: !format.underline }))}
                >
                  <u>U</u>
                </button>
              </div>
            )}

            {showEmojiPicker && (
              <div className="emoji-picker-panel">
                <div className="emoji-picker-heading">
                  <strong>Emoji & sticker</strong>
                  <button type="button" aria-label="Đóng bảng emoji" onClick={() => setShowEmojiPicker(false)}>
                    ×
                  </button>
                </div>
                <div className="emoji-grid">
                  {['😀', '😂', '🥰', '😎', '🤔', '😭', '🔥', '❤️', '👍', '🎉', '✨', '🙌', '👋', '💜', '🚀', '🥳'].map(
                    (emoji) => (
                      <button key={emoji} type="button" onClick={() => appendToMessage(emoji)} aria-label={`Thêm ${emoji}`}>
                        {emoji}
                      </button>
                    ),
                  )}
                </div>
                <div className="sticker-row">
                  <span>Sticker nhanh</span>
                  {['🫶', '🤝', '🌟', '💌'].map((sticker) => (
                    <button
                      key={sticker}
                      type="button"
                      aria-label={`Thêm sticker ${sticker}`}
                      onClick={() => appendToMessage(`${sticker} `)}
                    >
                      {sticker}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="input-area">
              <button
                className={`composer-tool-button ${showEmojiPicker ? 'active' : ''}`}
                type="button"
                aria-label="Mở emoji và sticker"
                aria-expanded={showEmojiPicker}
                onClick={() => setShowEmojiPicker((value) => !value)}
              >
                ☺
              </button>
              <button
                className={`composer-tool-button format-toggle ${showFormatting ? 'active' : ''}`}
                type="button"
                aria-label="Định dạng tin nhắn"
                aria-expanded={showFormatting}
                onClick={() => setShowFormatting((value) => !value)}
              >
                Aa
              </button>
              <input
                type="text"
                className="message-input"
                placeholder="Nhập tin nhắn..."
                value={messageInput}
                onChange={(event) => setMessageInput(event.target.value)}
                onFocus={() => setShowEmojiPicker(false)}
                onKeyDown={handleKeyPress}
                aria-label="Nội dung tin nhắn"
              />
              <button className="send-button" type="button" onClick={handleSendMessage} disabled={!messageInput.trim() || !isConnected}>
                <span>Gửi</span>
                <span className="send-arrow">↗</span>
              </button>
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}

export default ChatApp