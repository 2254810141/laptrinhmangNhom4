import { useEffect, useMemo, useRef, useState } from 'react'
import * as signalR from '@microsoft/signalr'
import './ChatApp.css'

const FORMATTED_MESSAGE_PREFIX = '[[chat-format-v1]]'
const REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🎉']
const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024
const MAX_AUDIO_SIZE_BYTES = 10 * 1024 * 1024
const MAX_AUDIO_DURATION_SECONDS = 120
const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']
const AUDIO_MIME_TYPES = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4']

async function readApiResponse(response) {
  const body = await response.text()
  if (!body.trim()) return null

  try {
    return JSON.parse(body)
  } catch {
    if (!response.ok) return null
    throw new Error('Máy chủ trả về dữ liệu không hợp lệ.')
  }
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
  const [memberFilter, setMemberFilter] = useState('all')
  const [roomInfo, setRoomInfo] = useState({ roomId: 'default-room', displayName: 'Hội ae rok', roomType: 'group', members: [] })
  const [roomNameDraft, setRoomNameDraft] = useState('Hội ae rok')
  const [chatRooms, setChatRooms] = useState([])
  const [showCreateRoom, setShowCreateRoom] = useState(false)
  const [showJoinRoom, setShowJoinRoom] = useState(false)
  const [newRoomName, setNewRoomName] = useState('')
  const [newRoomPassword, setNewRoomPassword] = useState('')
  const [joinRoomName, setJoinRoomName] = useState('')
  const [joinRoomPassword, setJoinRoomPassword] = useState('')
  const [onlineCount, setOnlineCount] = useState(0)
  const [isEditingRoomName, setIsEditingRoomName] = useState(false)
  const [isSavingRoomName, setIsSavingRoomName] = useState(false)
  const [isConnected, setIsConnected] = useState(false)
  const [showChat, setShowChat] = useState(Boolean(savedNickname))
  const [showQuickSettings, setShowQuickSettings] = useState(false)
  const [showRoomMenu, setShowRoomMenu] = useState(false)
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  const [isUploadingImage, setIsUploadingImage] = useState(false)
  const [imageUploadError, setImageUploadError] = useState('')
  const [isRecordingAudio, setIsRecordingAudio] = useState(false)
  const [isUploadingAudio, setIsUploadingAudio] = useState(false)
  const [audioUploadError, setAudioUploadError] = useState('')
  const [recordingSeconds, setRecordingSeconds] = useState(0)
  const [activeReactionPicker, setActiveReactionPicker] = useState(null)
  const [showFormatting, setShowFormatting] = useState(false)
  const [showMobileSidebar, setShowMobileSidebar] = useState(false)
  const [voiceState, setVoiceState] = useState('idle')
  const [isVoiceMuted, setIsVoiceMuted] = useState(false)
  const [voiceError, setVoiceError] = useState('')
  const [voiceParticipants, setVoiceParticipants] = useState([])
  const [textFormat, setTextFormat] = useState({
    color: '#e5e7eb',
    fontSize: 16,
    bold: false,
    italic: false,
    underline: false,
  })
  const [currentTime, setCurrentTime] = useState(() => Date.now())

  const avatarInputRef = useRef(null)
  const imageInputRef = useRef(null)
  const messagesEndRef = useRef(null)
  const recorderRef = useRef(null)
  const recordingStreamRef = useRef(null)
  const recordingChunksRef = useRef([])
  const recordingStartedAtRef = useRef(0)
  const recordingTimerRef = useRef(null)
  const localAudioStreamRef = useRef(null)
  const peerConnectionsRef = useRef(new Map())
  const pendingIceCandidatesRef = useRef(new Map())
  const voiceJoinedRef = useRef(false)

  const roomId = roomInfo.roomId
  const signalRUrl = import.meta.env.VITE_SIGNALR_URL || 'https://laptrinhmangnhom4backend.onrender.com/chathub'
  const apiBaseUrl = signalRUrl.replace('/chathub', '')

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

  const cleanupVoiceLocally = (updateState = true) => {
    peerConnectionsRef.current.forEach(({ peerConnection }) => peerConnection.close())
    peerConnectionsRef.current.clear()
    pendingIceCandidatesRef.current.clear()
    localAudioStreamRef.current?.getTracks().forEach((track) => track.stop())
    localAudioStreamRef.current = null
    voiceJoinedRef.current = false
    if (updateState) {
      setVoiceParticipants([])
      setIsVoiceMuted(false)
      setVoiceState('idle')
    }
  }

  const cleanupAudioRecording = () => {
    if (recordingTimerRef.current !== null) {
      window.clearInterval(recordingTimerRef.current)
      recordingTimerRef.current = null
    }

    if (recorderRef.current) {
      recorderRef.current.onstop = null
      recorderRef.current.onerror = null
      if (recorderRef.current.state !== 'inactive') recorderRef.current.stop()
      recorderRef.current = null
    }

    recordingStreamRef.current?.getTracks().forEach((track) => track.stop())
    recordingStreamRef.current = null
    recordingChunksRef.current = []
  }

  useEffect(() => () => {
    cleanupAudioRecording()
  }, [])

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

      try {
        const newConnection = new signalR.HubConnectionBuilder()
          .withUrl(signalRUrl, {
            skipNegotiation: true,
            transport: signalR.HttpTransportType.WebSockets,
          })
          .withAutomaticReconnect()
          .build()

        activeConnection = newConnection

        const sendVoiceSignal = async (targetConnectionId, signalType, payload) => {
          if (newConnection.state !== signalR.HubConnectionState.Connected) return
          await newConnection.invoke('SendVoiceSignal', roomId, targetConnectionId, signalType, payload)
        }

        const addPendingIceCandidates = async (peerConnection, peerId) => {
          const candidates = pendingIceCandidatesRef.current.get(peerId) || []
          pendingIceCandidatesRef.current.delete(peerId)
          for (const candidate of candidates) {
            await peerConnection.addIceCandidate(new RTCIceCandidate(candidate))
          }
        }

        const createPeerConnection = async (peerId, peerNickname, shouldOffer = false) => {
          const existingPeer = peerConnectionsRef.current.get(peerId)
          if (existingPeer) return existingPeer.peerConnection

          const peerConnection = new RTCPeerConnection({
            iceServers: [
              { urls: 'stun:stun.l.google.com:19302' },
              { urls: 'stun:stun1.l.google.com:19302' },
            ],
          })
          peerConnectionsRef.current.set(peerId, { peerConnection, nickname: peerNickname })

          localAudioStreamRef.current?.getTracks().forEach((track) => {
            peerConnection.addTrack(track, localAudioStreamRef.current)
          })

          peerConnection.ontrack = (event) => {
            const stream = event.streams[0]
            if (!stream) return
            setVoiceParticipants((participants) => {
              const existing = participants.find((participant) => participant.connectionId === peerId)
              if (existing) {
                return participants.map((participant) =>
                  participant.connectionId === peerId ? { ...participant, stream } : participant,
                )
              }
              return [...participants, { connectionId: peerId, nickname: peerNickname, stream }]
            })
          }

          peerConnection.onicecandidate = (event) => {
            if (!event.candidate) return
            sendVoiceSignal(peerId, 'candidate', event.candidate.toJSON()).catch((error) => {
              console.error('Failed to send voice ICE candidate:', error)
            })
          }

          peerConnection.onconnectionstatechange = () => {
            if (peerConnection.connectionState === 'failed' || peerConnection.connectionState === 'closed') {
              if (peerConnection.connectionState === 'failed') {
                setVoiceError('Không thể kết nối âm thanh trực tiếp. Mạng này có thể cần máy chủ TURN.')
              }
              peerConnection.close()
              peerConnectionsRef.current.delete(peerId)
              setVoiceParticipants((participants) =>
                participants.filter((participant) => participant.connectionId !== peerId),
              )
            }
          }

          if (shouldOffer) {
            const offer = await peerConnection.createOffer()
            await peerConnection.setLocalDescription(offer)
            await sendVoiceSignal(peerId, 'offer', peerConnection.localDescription.toJSON())
          }

          return peerConnection
        }

        const handleVoiceSignal = async ({ fromConnectionId, nickname, signalType, payload }) => {
          try {
            if (!voiceJoinedRef.current) return

            if (signalType === 'candidate') {
              const peer = peerConnectionsRef.current.get(fromConnectionId)
              if (!peer || !peer.peerConnection.remoteDescription) {
                const pending = pendingIceCandidatesRef.current.get(fromConnectionId) || []
                pending.push(payload)
                pendingIceCandidatesRef.current.set(fromConnectionId, pending)
                return
              }
              await peer.peerConnection.addIceCandidate(new RTCIceCandidate(payload))
              return
            }

            const peer = await createPeerConnection(fromConnectionId, nickname)
            if (signalType === 'offer') {
              await peer.setRemoteDescription(new RTCSessionDescription(payload))
              await addPendingIceCandidates(peer, fromConnectionId)
              const answer = await peer.createAnswer()
              await peer.setLocalDescription(answer)
              await sendVoiceSignal(fromConnectionId, 'answer', peer.localDescription.toJSON())
            } else if (signalType === 'answer') {
              await peer.setRemoteDescription(new RTCSessionDescription(payload))
              await addPendingIceCandidates(peer, fromConnectionId)
            }
          } catch (error) {
            console.error('Failed to handle voice signaling:', error)
            setVoiceError('Không thể thiết lập kết nối âm thanh với thành viên này.')
          }
        }

        newConnection.onreconnecting(() => {
          setIsConnected(false)
          cleanupVoiceLocally(false)
        })
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
          cleanupVoiceLocally()
          setConnection((current) => current === newConnection ? null : current)
          if (error) console.error('SignalR connection closed:', error)
          scheduleReconnect()
        })

        newConnection.on('VoiceParticipants', (participants) => {
          participants.forEach(({ connectionId, nickname }) => {
            createPeerConnection(connectionId, nickname, true).catch((error) => {
              console.error('Failed to create voice connection:', error)
              setVoiceError('Không thể kết nối voice chat với thành viên này.')
            })
          })
        })

        newConnection.on('VoiceUserLeft', (connectionId) => {
          const peer = peerConnectionsRef.current.get(connectionId)
          peer?.peerConnection.close()
          peerConnectionsRef.current.delete(connectionId)
          pendingIceCandidatesRef.current.delete(connectionId)
          setVoiceParticipants((participants) =>
            participants.filter((participant) => participant.connectionId !== connectionId),
          )
        })

        newConnection.on('ReceiveVoiceSignal', handleVoiceSignal)

        newConnection.on('RoomInfoLoaded', (room) => {
          setRoomInfo(room)
          setRoomNameDraft(room.displayName)
        })

        newConnection.on('RoomsLoaded', (rooms) => {
          setChatRooms(rooms)
        })

        newConnection.on('RoomLeft', ({ roomId: leftRoomId }) => {
          setChatRooms((rooms) => rooms.filter((room) => room.roomId !== leftRoomId))
        })

        newConnection.on('RoomCreated', (room) => {
          setChatRooms((rooms) => {
            const otherRooms = rooms.filter((item) => item.roomId !== room.roomId)
            return [room, ...otherRooms]
          })
          setMessages([])
          setKnownMembers([])
          setOnlineUsers([])
          setRoomInfo(room)
          setRoomNameDraft(room.displayName)
          setShowCreateRoom(false)
          setShowRoomMenu(false)
        })

        newConnection.on('RoomNameUpdated', (room) => {
          setRoomInfo(room)
          setRoomNameDraft(room.displayName)
          setIsEditingRoomName(false)
          setIsSavingRoomName(false)
        })

        newConnection.on('ReceiveMessage', (data) => {
          const parsedMessage = readFormattedMessage(data.content)
          setMessages((prev) => [
            ...prev,
            {
              messageId: data.messageId,
              nickname: data.nickname,
              content: parsedMessage.text,
              style: parsedMessage.style,
              timestamp: data.timestamp,
              messageType: data.messageType || 'text',
              imageId: data.imageId || null,
              audioId: data.audioId || null,
              durationSeconds: data.durationSeconds || null,
              type: 'message',
              isMine: data.nickname === currentNickname,
              reactions: data.reactions || [],
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
                messageId: msg.messageId || msg.MessageId,
                content: parsedMessage.text,
                style: parsedMessage.style,
                messageType: msg.messageType || msg.MessageType || 'text',
                imageId: msg.imageId || msg.ImageId || null,
                audioId: msg.audioId || msg.AudioId || null,
                durationSeconds: msg.durationSeconds || msg.DurationSeconds || null,
                type: 'message',
                isMine: msg.nickname === currentNickname,
                reactions: msg.reactions || msg.Reactions || [],
              }
            }),
          )
          setKnownMembers((prev) =>
            history.reduce((members, message) => rememberMember(members, message.nickname, message.timestamp), prev),
          )
        })

        newConnection.on('ReactionUpdated', ({ messageId, reactions }) => {
          setMessages((prev) =>
            prev.map((message) =>
              message.messageId === messageId ? { ...message, reactions: reactions || [] } : message,
            ),
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

        // Small delay to ensure connection is fully ready
        await new Promise(resolve => setTimeout(resolve, 100))

        console.log('Invoking JoinRoom with:', { roomId, currentNickname, state: newConnection.state })
        await newConnection.invoke('JoinRoom', roomId, currentNickname)
      } catch (error) {
        console.error('Connection failed:', error)
        setIsConnected(false)
        if (activeConnection) {
          const failedConnection = activeConnection
          activeConnection = null
          await failedConnection.stop().catch(console.error)
        }
        scheduleReconnect()
      }
    }

    initializeConnection()

    return () => {
      cancelled = true
      if (retryTimeout !== null) {
        window.clearTimeout(retryTimeout)
      }
      cleanupVoiceLocally()
      if (activeConnection && activeConnection.state !== signalR.HubConnectionState.Disconnected) {
        activeConnection.stop().catch(console.error)
      }
    }
  }, [showChat, currentNickname, roomId, signalRUrl])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    const interval = window.setInterval(() => setCurrentTime(Date.now()), 60000)
    return () => window.clearInterval(interval)
  }, [])

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

    const nextNickname = nickname.trim()
    setCurrentNickname(nextNickname)
    window.localStorage.setItem('chat.nickname', nextNickname)
    setShowChat(true)
  }

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

  const handleJoinVoice = async () => {
    if (!connection || !isConnected || voiceState !== 'idle') return

    setVoiceError('')
    setVoiceState('joining')
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Trình duyệt không hỗ trợ microphone hoặc cần mở trang bằng HTTPS.')
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      })
      localAudioStreamRef.current = stream
      voiceJoinedRef.current = true
      await connection.invoke('JoinVoiceRoom', roomId)
      setVoiceState('joined')
    } catch (error) {
      console.error('Error joining voice chat:', error)
      cleanupVoiceLocally()
      setVoiceError(error instanceof Error ? error.message : 'Không thể tham gia voice chat.')
    }
  }

  const handleLeaveVoice = async () => {
    try {
      if (connection && voiceJoinedRef.current) {
        await connection.invoke('LeaveVoiceRoom', roomId)
      }
    } catch (error) {
      console.error('Error leaving voice chat:', error)
    } finally {
      cleanupVoiceLocally()
      setVoiceError('')
    }
  }

  const handleToggleVoiceMute = () => {
    const nextMuted = !isVoiceMuted
    localAudioStreamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = !nextMuted
    })
    setIsVoiceMuted(nextMuted)
  }

  const handleStartAudioRecording = async () => {
    if (!connection || !isConnected || isRecordingAudio || isUploadingAudio) return

    setAudioUploadError('')
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setAudioUploadError('Trình duyệt không hỗ trợ ghi âm hoặc cần mở trang bằng HTTPS.')
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mimeType = AUDIO_MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type))
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)

      recordingStreamRef.current = stream
      recorderRef.current = recorder
      recordingChunksRef.current = []
      recordingStartedAtRef.current = Date.now()
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) recordingChunksRef.current.push(event.data)
      }
      recorder.onerror = (event) => {
        console.error('Audio recording failed:', event.error)
        setAudioUploadError('Không thể ghi âm. Vui lòng kiểm tra microphone và thử lại.')
        recorder.onstop = null
        stream.getTracks().forEach((track) => track.stop())
        recordingStreamRef.current = null
        recorderRef.current = null
        setIsRecordingAudio(false)
        if (recordingTimerRef.current !== null) {
          window.clearInterval(recordingTimerRef.current)
          recordingTimerRef.current = null
        }
      }
      recorder.onstop = async () => {
        const durationSeconds = Math.min(
          MAX_AUDIO_DURATION_SECONDS,
          Math.max(1, Math.round((Date.now() - recordingStartedAtRef.current) / 1000)),
        )
        const blob = new Blob(recordingChunksRef.current, { type: recorder.mimeType || 'audio/webm' })
        recordingChunksRef.current = []
        stream.getTracks().forEach((track) => track.stop())
        recordingStreamRef.current = null
        recorderRef.current = null
        setIsRecordingAudio(false)
        setRecordingSeconds(0)
        if (recordingTimerRef.current !== null) {
          window.clearInterval(recordingTimerRef.current)
          recordingTimerRef.current = null
        }

        if (blob.size === 0) {
          setAudioUploadError('Không ghi được âm thanh. Hãy thử ghi âm lâu hơn.')
          return
        }
        if (blob.size > MAX_AUDIO_SIZE_BYTES) {
          setAudioUploadError('Tin nhắn thoại phải nhỏ hơn hoặc bằng 10 MB.')
          return
        }
        if (!connection || connection.state !== signalR.HubConnectionState.Connected) {
          setAudioUploadError('Chat đã mất kết nối, không thể gửi tin nhắn thoại.')
          return
        }

        try {
          setIsUploadingAudio(true)
          const extension = blob.type.includes('ogg') ? 'ogg' : blob.type.includes('mp4') ? 'm4a' : 'webm'
          const formData = new FormData()
          formData.append('file', blob, `voice-message.${extension}`)
          const response = await fetch(`${apiBaseUrl}/api/audio`, { method: 'POST', body: formData })
          const result = await readApiResponse(response)

          if (!response.ok) {
            throw new Error(
              result?.error
              || result?.title
              || `API tin nhắn thoại không khả dụng (HTTP ${response.status}). Hãy khởi động lại backend.`,
            )
          }
          if (typeof result?.id !== 'string') {
            throw new Error('Backend chưa trả về mã tin nhắn thoại. Hãy khởi động lại backend.')
          }

          await connection.invoke('SendAudioMessage', roomId, currentNickname, result.id, durationSeconds)
        } catch (error) {
          console.error('Error uploading voice message:', error)
          setAudioUploadError(error instanceof Error ? error.message : 'Không thể gửi tin nhắn thoại.')
        } finally {
          setIsUploadingAudio(false)
        }
      }

      recorder.start(250)
      setIsRecordingAudio(true)
      recordingTimerRef.current = window.setInterval(() => {
        const elapsed = Math.floor((Date.now() - recordingStartedAtRef.current) / 1000)
        setRecordingSeconds(elapsed)
        if (elapsed >= MAX_AUDIO_DURATION_SECONDS && recorder.state === 'recording') {
          recorder.stop()
        }
      }, 250)
    } catch (error) {
      console.error('Unable to access microphone for voice message:', error)
      recordingStreamRef.current?.getTracks().forEach((track) => track.stop())
      recordingStreamRef.current = null
      recorderRef.current = null
      setAudioUploadError(error instanceof Error ? error.message : 'Không thể truy cập microphone.')
    }
  }

  const handleStopAudioRecording = () => {
    if (recorderRef.current?.state === 'recording') {
      recorderRef.current.stop()
    }
  }

  const handleImageChange = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    setImageUploadError('')

    if (!file) return
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      setImageUploadError('Chỉ hỗ trợ ảnh PNG, JPG, GIF hoặc WebP.')
      return
    }
    if (file.size > MAX_IMAGE_SIZE_BYTES) {
      setImageUploadError('Ảnh phải nhỏ hơn hoặc bằng 5 MB.')
      return
    }
    if (!connection || !isConnected) {
      setImageUploadError('Chat chưa kết nối. Vui lòng thử lại sau.')
      return
    }

    const formData = new FormData()
    formData.append('file', file)

    try {
      setIsUploadingImage(true)
      const response = await fetch(`${apiBaseUrl}/api/images`, {
        method: 'POST',
        body: formData,
      })
      const result = await readApiResponse(response)

      if (!response.ok) {
        throw new Error(
          result?.error
          || result?.title
          || `API tải ảnh không khả dụng (HTTP ${response.status}). Hãy khởi động lại backend.`,
        )
      }
      if (typeof result?.id !== 'string') {
        throw new Error('Backend chưa trả về mã ảnh. Hãy khởi động lại backend.')
      }

      await connection.invoke(
        'SendImageMessage',
        roomId,
        currentNickname,
        result.id,
        messageInput.trim(),
      )
      setMessageInput('')
      setShowEmojiPicker(false)
    } catch (error) {
      console.error('Error uploading image:', error)
      setImageUploadError(error instanceof Error ? error.message : 'Không thể tải ảnh lên.')
    } finally {
      setIsUploadingImage(false)
    }
  }

  const handleToggleReaction = async (messageId, emoji) => {
    if (!connection || !messageId) return

    try {
      await connection.invoke('ToggleReaction', roomId, messageId, currentNickname, emoji)
      setActiveReactionPicker(null)
    } catch (error) {
      console.error('Error toggling reaction:', error)
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

  const handleSwitchRoom = async (nextRoom) => {
    if (!nextRoom || nextRoom.roomId === roomId) {
      setShowCreateRoom(false)
      setShowRoomMenu(false)
      return
    }

    if (voiceJoinedRef.current) {
      try {
        await connection?.invoke('LeaveVoiceRoom', roomId)
      } catch (error) {
        console.error('Error leaving voice chat before switching room:', error)
      }
      cleanupVoiceLocally()
    }

    setMessages([])
    setKnownMembers([])
    setOnlineUsers([])
    setRoomInfo(nextRoom)
    setRoomNameDraft(nextRoom.displayName)
    setShowCreateRoom(false)
    setShowRoomMenu(false)
  }

  const handleCreateGroupRoom = async () => {
    if (!connection || !isConnected) return
    const name = newRoomName.trim()
    const passcode = newRoomPassword.trim()
    if (!name) {
      alert('Vui lòng nhập tên phòng.')
      return
    }
    if (!passcode) {
      alert('Vui lòng nhập mã bảo mật.')
      return
    }
    try {
      await connection.invoke('CreateRoom', name, 'group', null, passcode)
      setNewRoomName('')
      setNewRoomPassword('')
    } catch (error) {
      console.error('Error creating room:', error)
      alert(error instanceof Error ? error.message : 'Không thể tạo phòng chat mới.')
    }
  }

  const handleJoinRoomByName = async () => {
    if (!connection || !isConnected) return
    if (!joinRoomName.trim() || !joinRoomPassword.trim()) {
      alert('Vui lòng nhập tên phòng và mã bảo mật.')
      return
    }
    try {
      await connection.invoke('JoinRoomByName', joinRoomName.trim(), joinRoomPassword.trim())
      setJoinRoomName('')
      setJoinRoomPassword('')
      setShowJoinRoom(false)
    } catch (error) {
      console.error('Error joining room:', error)
      alert(error instanceof Error ? error.message : 'Tên phòng hoặc mã bảo mật không đúng.')
    }
  }

  const handleLeaveCurrentRoom = async () => {
    if (!connection || !isConnected) return
    try {
      if (voiceJoinedRef.current) {
        await connection.invoke('LeaveVoiceRoom', roomId)
      }
      await connection.invoke('LeaveRoom', roomId, currentNickname)
      cleanupVoiceLocally()
      setRoomInfo({ roomId: 'default-room', displayName: 'Hội ae rok', roomType: 'group', members: [] })
      setRoomNameDraft('Hội ae rok')
      setShowRoomMenu(false)
    } catch (error) {
      console.error('Error leaving room:', error)
      alert('Không thể rời phòng.')
    }
  }

  const handleCreateDirectRoom = async (targetNickname) => {
    if (!connection || !isConnected || !targetNickname) return
    try {
      await connection.invoke('CreateRoom', targetNickname, 'direct', targetNickname)
    } catch (error) {
      console.error('Error creating direct room:', error)
      alert(error instanceof Error ? error.message : 'Không thể tạo phòng chat 1-1.')
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
    cleanupAudioRecording()
    if (connection) {
      try {
        if (voiceJoinedRef.current) {
          await connection.invoke('LeaveVoiceRoom', roomId)
        }
        await connection.invoke('LeaveRoom', roomId, currentNickname)
        await connection.stop()
      } catch (error) {
        console.error('Error leaving chat room:', error)
      }
    }
    cleanupVoiceLocally()
    setIsRecordingAudio(false)
    setRecordingSeconds(0)

    window.localStorage.removeItem('chat.nickname')
    setConnection(null)
    setIsConnected(false)
    setOnlineUsers([])
    setMessages([])
    setNickname('')
    setCurrentNickname('')
    setShowQuickSettings(false)
    setShowMobileSidebar(false)
    setShowChat(false)
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

  const formatAudioDuration = (durationSeconds) => {
    const totalSeconds = Number(durationSeconds) || 0
    const minutes = Math.floor(totalSeconds / 60)
    const seconds = totalSeconds % 60
    return `${minutes}:${String(seconds).padStart(2, '0')}`
  }

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
        <div className="login-topbar">
          <ThemeToggle theme={theme} onToggle={toggleTheme} />
        </div>
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
          <button className="start-button" type="button" onClick={handleStartChat}>
            Vào Phòng Chat
          </button>
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

        <aside className={`chat-sidebar ${showMobileSidebar ? 'mobile-open' : ''}`}>
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

          <div className="room-list-block">
            <div className="sidebar-block-title">
              <span className="members-title-icon">◫</span>
              <span>Phòng chat</span>
              <span className="sidebar-pill">{chatRooms.length}</span>
            </div>
            <button
              className="create-room-button"
              type="button"
              onClick={() => setShowCreateRoom(true)}
            >
              + Tạo phòng mới
            </button>
            <button
              className="create-room-button"
              type="button"
              onClick={() => setShowJoinRoom(true)}
            >
              🔐 Tham gia bằng mã
            </button>
            <div className="room-list">
              {chatRooms.map((room) => (
                <button
                  key={room.roomId}
                  className={`room-list-item ${room.roomId === roomId ? 'active' : ''}`}
                  type="button"
                  onClick={() => handleSwitchRoom(room)}
                >
                  <span className="room-list-icon">{room.roomType === 'direct' ? '◎' : '#'}</span>
                  <span className="room-list-name">{room.displayName}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="sidebar-block">
            <div className="sidebar-block-title">
              <span className="members-title-icon">◉</span>
              <span>Danh sách thành viên</span>
              <span className="sidebar-pill">{knownMembers.length}</span>
            </div>

            <div className="member-tabs" role="tablist" aria-label="Lọc thành viên">
              <button
                className={memberFilter === 'all' ? 'active' : ''}
                type="button"
                role="tab"
                aria-selected={memberFilter === 'all'}
                onClick={() => setMemberFilter('all')}
              >
                Tất cả <span>{knownMembers.length}</span>
              </button>
              <button
                className={memberFilter === 'online' ? 'active' : ''}
                type="button"
                role="tab"
                aria-selected={memberFilter === 'online'}
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
                      {!isMine && (
                        <button
                          className="direct-chat-button"
                          type="button"
                          onClick={() => handleCreateDirectRoom(member.nickname)}
                          title={`Chat 1-1 với ${member.nickname}`}
                          aria-label={`Chat 1-1 với ${member.nickname}`}
                        >
                          💬
                        </button>
                      )}
                    </div>
                  )
                })
              )}
            </div>
          </div>

          <div className={`connection-status ${isConnected ? 'connected' : 'disconnected'}`}>
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
              >
                ☰
              </button>

              <div className="chat-room-icon">✦</div>

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
              <div className="voice-controls">
                <button
                  className={`voice-join-button ${voiceState === 'joined' ? 'active' : ''}`}
                  type="button"
                  onClick={voiceState === 'joined' ? handleLeaveVoice : handleJoinVoice}
                  disabled={!isConnected || voiceState === 'joining'}
                  aria-label={voiceState === 'joined' ? 'Rời voice chat' : 'Tham gia voice chat'}
                >
                  {voiceState === 'joining' ? 'Đang kết nối…' : voiceState === 'joined' ? '☎ Rời voice' : '🎙 Voice'}
                </button>
                {voiceState === 'joined' && (
                  <>
                    <button
                      className={`voice-mute-button ${isVoiceMuted ? 'muted' : ''}`}
                      type="button"
                      onClick={handleToggleVoiceMute}
                      aria-label={isVoiceMuted ? 'Bật microphone' : 'Tắt microphone'}
                      aria-pressed={isVoiceMuted}
                    >
                      {isVoiceMuted ? 'Mic tắt' : 'Mic bật'}
                    </button>
                    <span
                      className="voice-participant-count"
                      title={voiceParticipants.map((participant) => participant.nickname).join(', ') || 'Chưa có người khác'}
                    >
                      {voiceParticipants.length + 1} đang thoại
                    </span>
                  </>
                )}
              </div>
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
                  <button
                    type="button"
                    onClick={() => {
                      setShowCreateRoom(true)
                      setShowRoomMenu(false)
                    }}
                  >
                    + Tạo phòng mới
                  </button>
                  <button type="button" onClick={handleLeaveCurrentRoom}>
                    ↪ Rời phòng
                  </button>
                </div>
              )}
            </div>
          </header>

          {showCreateRoom && (
            <div className="create-room-modal-backdrop" role="presentation">
              <div className="create-room-modal" role="dialog" aria-modal="true" aria-labelledby="create-room-title">
                <div className="create-room-modal-header">
                  <div>
                    <span>Tạo phòng chat</span>
                    <h3 id="create-room-title">Phòng mới</h3>
                  </div>
                  <button
                    type="button"
                    className="icon-button"
                    onClick={() => setShowCreateRoom(false)}
                    aria-label="Đóng"
                  >
                    ×
                  </button>
                </div>
                <label htmlFor="new-room-name">Tên phòng</label>
                <input
                  id="new-room-name"
                  className="new-room-input"
                  value={newRoomName}
                  onChange={(event) => setNewRoomName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') handleCreateGroupRoom()
                  }}
                  placeholder="Ví dụ: Dự án, Bạn bè..."
                  maxLength="50"
                  autoFocus
                />
                <label htmlFor="new-room-password">Mã bảo mật</label>
                <input
                  id="new-room-password"
                  className="new-room-input"
                  type="password"
                  value={newRoomPassword}
                  onChange={(event) => setNewRoomPassword(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') handleCreateGroupRoom()
                  }}
                  placeholder="Nhập mã bảo mật..."
                  maxLength="64"
                />
                <div className="create-room-actions">
                  <button type="button" onClick={() => setShowCreateRoom(false)}>Hủy</button>
                  <button type="button" onClick={handleCreateGroupRoom}>Tạo phòng</button>
                </div>
              </div>
            </div>
          )}

          {showJoinRoom && (
            <div className="create-room-modal-backdrop" role="presentation">
              <div className="create-room-modal" role="dialog" aria-modal="true" aria-labelledby="join-room-title">
                <div className="create-room-modal-header">
                  <div>
                    <span>Tham gia phòng</span>
                    <h3 id="join-room-title">Nhập thông tin phòng</h3>
                  </div>
                  <button
                    type="button"
                    className="icon-button"
                    onClick={() => setShowJoinRoom(false)}
                    aria-label="Đóng"
                  >
                    ×
                  </button>
                </div>
                <label htmlFor="join-room-name">Tên phòng</label>
                <input
                  id="join-room-name"
                  className="new-room-input"
                  value={joinRoomName}
                  onChange={(event) => setJoinRoomName(event.target.value)}
                  placeholder="Nhập tên phòng..."
                  maxLength="50"
                  autoFocus
                />
                <label htmlFor="join-room-password">Mã bảo mật</label>
                <input
                  id="join-room-password"
                  className="new-room-input"
                  type="password"
                  value={joinRoomPassword}
                  onChange={(event) => setJoinRoomPassword(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') handleJoinRoomByName()
                  }}
                  placeholder="Nhập mã bảo mật..."
                  maxLength="64"
                />
                <div className="create-room-actions">
                  <button type="button" onClick={() => setShowJoinRoom(false)}>Hủy</button>
                  <button type="button" onClick={handleJoinRoomByName}>Tham gia</button>
                </div>
              </div>
            </div>
          )}

          {voiceError && <div className="voice-error" role="alert">{voiceError}</div>}
          {voiceParticipants.map((participant) => (
            <audio
              key={participant.connectionId}
              ref={(element) => {
                if (element && element.srcObject !== participant.stream) {
                  element.srcObject = participant.stream
                }
              }}
              autoPlay
              playsInline
              onCanPlay={(event) => {
                event.currentTarget.play().catch((error) => {
                  console.warn('Browser did not start remote voice audio:', error)
                })
              }}
              aria-label={`Âm thanh từ ${participant.nickname}`}
            />
          ))}

          <div className="messages-area">
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
                  <span className="system-message-icon">✦</span>
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
                      {msg.messageType === 'image' && msg.imageId ? (
                        <img
                          className="message-image"
                          src={`${apiBaseUrl}/api/images/${encodeURIComponent(msg.imageId)}`}
                          alt={`Ảnh được gửi bởi ${msg.nickname}`}
                          loading="lazy"
                        />
                      ) : null}
                      {msg.messageType === 'audio' && msg.audioId ? (
                        <div className="audio-message">
                          <audio
                            className="message-audio"
                            controls
                            preload="metadata"
                            src={`${apiBaseUrl}/api/audio/${encodeURIComponent(msg.audioId)}`}
                            aria-label={`Tin nhắn thoại của ${msg.nickname}`}
                          />
                          <span>{formatAudioDuration(msg.durationSeconds)}</span>
                        </div>
                      ) : null}
                      {msg.content && (
                        <div className={msg.messageType === 'image' ? 'image-caption' : undefined}>
                          {msg.content}
                        </div>
                      )}
                    </div>
                    <div className="message-timestamp">{formatTime(msg.timestamp)}</div>
                    <div className="message-reactions">
                      {REACTION_EMOJIS.map((emoji) => {
                        const matchingReactions = (msg.reactions || []).filter((reaction) =>
                          (reaction.emoji || reaction.Emoji) === emoji,
                        )
                        if (matchingReactions.length === 0) return null

                        const hasMine = matchingReactions.some((reaction) =>
                          (reaction.nickname || reaction.Nickname) === currentNickname,
                        )
                        return (
                          <button
                            key={emoji}
                            className={`reaction-summary ${hasMine ? 'mine' : ''}`}
                            type="button"
                            onClick={() => handleToggleReaction(msg.messageId, emoji)}
                            title={matchingReactions
                              .map((reaction) => reaction.nickname || reaction.Nickname)
                              .join(', ')}
                          >
                            <span>{emoji}</span>
                            <span>{matchingReactions.length}</span>
                          </button>
                        )
                      })}
                      <button
                        className="add-reaction-button"
                        type="button"
                        onClick={() =>
                          setActiveReactionPicker((current) => current === msg.messageId ? null : msg.messageId)
                        }
                        aria-label="Thả cảm xúc"
                        aria-expanded={activeReactionPicker === msg.messageId}
                      >
                        +
                      </button>
                      {activeReactionPicker === msg.messageId && (
                        <div className="reaction-picker" role="menu" aria-label="Chọn cảm xúc">
                          {REACTION_EMOJIS.map((emoji) => (
                            <button
                              key={emoji}
                              type="button"
                              role="menuitem"
                              onClick={() => handleToggleReaction(msg.messageId, emoji)}
                            >
                              {emoji}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ),
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className="composer-wrap">
            <input
              ref={imageInputRef}
              className="visually-hidden"
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              onChange={handleImageChange}
            />
            {isUploadingImage && <div className="image-upload-status" role="status">Đang tải ảnh lên...</div>}
            {imageUploadError && <div className="image-upload-error" role="alert">{imageUploadError}</div>}
            {isRecordingAudio && (
              <div className="audio-recording-status" role="status">
                Đang ghi âm {formatAudioDuration(recordingSeconds)} / 2:00 · Nhấn nút micro để gửi
              </div>
            )}
            {isUploadingAudio && <div className="image-upload-status" role="status">Đang gửi tin nhắn thoại...</div>}
            {audioUploadError && <div className="image-upload-error" role="alert">{audioUploadError}</div>}
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
                    <button key={sticker} type="button" onClick={() => appendToMessage(`${sticker} `)}>
                      {sticker}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="input-area">
              <button
                className="composer-tool-button"
                type="button"
                aria-label="Tải ảnh lên"
                title="Tải ảnh lên (tối đa 5 MB)"
                disabled={isUploadingImage || isUploadingAudio || isRecordingAudio || !isConnected}
                onClick={() => imageInputRef.current?.click()}
              >
                📎
              </button>
              <button
                className={`composer-tool-button audio-record-button ${isRecordingAudio ? 'recording' : ''}`}
                type="button"
                aria-label={isRecordingAudio ? 'Dừng ghi âm và gửi' : 'Ghi tin nhắn thoại'}
                title={isRecordingAudio ? 'Dừng và gửi tin nhắn thoại' : 'Ghi tin nhắn thoại (tối đa 2 phút)'}
                disabled={isUploadingImage || isUploadingAudio || (!isRecordingAudio && !isConnected)}
                onClick={isRecordingAudio ? handleStopAudioRecording : handleStartAudioRecording}
              >
                {isRecordingAudio ? '■' : '🎙'}
              </button>
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