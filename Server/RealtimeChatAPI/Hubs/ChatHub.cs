using MongoDB.Bson;
using Microsoft.AspNetCore.SignalR;
using RealtimeChatAPI.Models;
using RealtimeChatAPI.Services;
using System.Text.Json;

namespace RealtimeChatAPI.Hubs
{
    public class ChatHub : Hub
    {
        private readonly IChatService _chatService;
        private static readonly object _lock = new();
        private static readonly Dictionary<string, Dictionary<string, string>> _onlineUsers = new();
        private static readonly Dictionary<string, Dictionary<string, string>> _voiceParticipants = new();


        public ChatHub(IChatService chatService)
        {
            _chatService = chatService;
        }

        public override async Task OnConnectedAsync()
        {
            await base.OnConnectedAsync();
            Console.WriteLine($"Client connected: {Context.ConnectionId}");
        }

        public override async Task OnDisconnectedAsync(Exception? exception)
        {
            List<(string RoomId, string Nickname)> usersToUpdate = new();
            List<string> roomsToBroadcast = new();
            List<string> voiceRoomsToBroadcast = new();

            lock (_lock)
            {
                foreach (var room in _voiceParticipants.Keys.ToList())
                {
                    if (_voiceParticipants[room].Remove(Context.ConnectionId))
                    {
                        voiceRoomsToBroadcast.Add(room);
                    }

                    if (_voiceParticipants[room].Count == 0)
                    {
                        _voiceParticipants.Remove(room);
                    }
                }

                foreach (var room in _onlineUsers.Keys.ToList())
                {
                    if (_onlineUsers[room].Remove(Context.ConnectionId, out var nickname))
                    {
                        usersToUpdate.Add((room, nickname));
                    }
                    if (_onlineUsers[room].Remove(Context.ConnectionId))
                    {
                        roomsToBroadcast.Add(room);
                    }

                    if (_onlineUsers[room].Count == 0)
                    {
                        _onlineUsers.Remove(room);
                    }
                }
            }

            foreach (var (roomId, nickname) in usersToUpdate)
            {
                await _chatService.UpdateMemberLastSeenAsync(roomId, nickname);
                await Clients.Group(roomId).SendAsync("UpdateOnlineUsers", GetOnlineUsers(roomId));
                await Clients.Group(roomId).SendAsync("MemberLastSeenUpdated", new
                {
                    nickname,
                    lastSeen = DateTime.UtcNow
                });
            }

            foreach (var room in roomsToBroadcast)
            {
                await Clients.Group(room).SendAsync("UpdateOnlineUsers", GetOnlineUsers(room));
            }

            foreach (var room in voiceRoomsToBroadcast)
            {
                await Clients.Group(room).SendAsync("VoiceUserLeft", Context.ConnectionId);
            }

            await base.OnDisconnectedAsync(exception);
            Console.WriteLine($"Client disconnected: {Context.ConnectionId}");
        }

        public async Task JoinRoom(string roomId, string nickname)
        {
            await Groups.AddToGroupAsync(Context.ConnectionId, roomId);

            lock (_lock)
            {
                if (!_onlineUsers.ContainsKey(roomId))
                {
                    _onlineUsers[roomId] = new Dictionary<string, string>();
                }

                _onlineUsers[roomId][Context.ConnectionId] = nickname;
            }

            var room = await _chatService.GetOrCreateRoomAsync(roomId);
            await _chatService.UpsertRoomMemberAsync(roomId, nickname);
            await _chatService.AddRoomMemberAsync(roomId, nickname);
            var history = await _chatService.GetMessageHistoryAsync(roomId);
            var members = await _chatService.GetRoomMembersAsync(roomId);
            await Clients.Caller.SendAsync("RoomInfoLoaded", new
            {
                roomId = room.RoomId,
                displayName = room.DisplayName,
                updatedAt = room.UpdatedAt,
                roomType = room.RoomType,
                members = room.Members
            });
            await Clients.Caller.SendAsync("LoadHistory", history);
            await Clients.Caller.SendAsync("LoadMembers", members.Select(member => new
            {
                nickname = member.Nickname,
                lastSeen = member.LastSeen,
                avatar = member.Avatar
            }));
            var rooms = await _chatService.GetRoomsForMemberAsync(nickname);
            await Clients.Caller.SendAsync("RoomsLoaded", rooms.Select(chatRoom => new
            {
                roomId = chatRoom.RoomId,
                displayName = chatRoom.DisplayName,
                roomType = chatRoom.RoomType,
                members = chatRoom.Members,
                updatedAt = chatRoom.UpdatedAt
            }));

            await Clients.Group(roomId).SendAsync("UpdateOnlineUsers", GetOnlineUsers(roomId));
            await Clients.Group(roomId).SendAsync("NotifyUserJoined", nickname);

            Console.WriteLine($"User {nickname} joined room {roomId}");
        }

        public async Task JoinRoomByName(string displayName, string passcode)
        {
            var nickname = string.Empty;
            lock (_lock)
            {
                foreach (var users in _onlineUsers.Values)
                {
                    if (users.TryGetValue(Context.ConnectionId, out var joinedNickname))
                    {
                        nickname = joinedNickname;
                        break;
                    }
                }
            }

            if (string.IsNullOrWhiteSpace(nickname))
            {
                throw new HubException("Bạn cần đăng nhập trước khi tham gia phòng.");
            }

            var room = await _chatService.JoinRoomByNameAsync(displayName, passcode, nickname);
            if (room == null)
            {
                throw new HubException("Tên phòng hoặc mã bảo mật không đúng.");
            }

            await Clients.Caller.SendAsync("RoomCreated", new
            {
                roomId = room.RoomId,
                displayName = room.DisplayName,
                roomType = room.RoomType,
                members = room.Members,
                updatedAt = room.UpdatedAt
            });
        }

        public async Task CreateRoom(string displayName, string roomType, string? targetNickname, string? passcode = null)
        {
            var creatorNickname = string.Empty;
            lock (_lock)
            {
                foreach (var users in _onlineUsers.Values)
                {
                    if (users.TryGetValue(Context.ConnectionId, out var nickname))
                    {
                        creatorNickname = nickname;
                        break;
                    }
                }
            }

            if (string.IsNullOrWhiteSpace(creatorNickname))
            {
                throw new HubException("Bạn cần tham gia chat trước khi tạo phòng.");
            }

            ChatRoom room;
            if (roomType == "direct")
            {
                if (string.IsNullOrWhiteSpace(targetNickname)
                    || targetNickname.Trim().Equals(creatorNickname, StringComparison.OrdinalIgnoreCase))
                {
                    throw new HubException("Vui lòng chọn một thành viên khác để chat 1-1.");
                }

                var existing = await _chatService.GetDirectRoomAsync(creatorNickname, targetNickname.Trim());
                room = existing ?? await _chatService.CreateRoomAsync(
                    targetNickname.Trim(),
                    "direct",
                    new[] { creatorNickname, targetNickname.Trim() });
            }
            else
            {
                if (string.IsNullOrWhiteSpace(passcode))
                {
                    throw new HubException("Phòng chat mới phải có mã bảo mật.");
                }
                room = await _chatService.CreateRoomAsync(
                    displayName,
                    "group",
                    new[] { creatorNickname },
                    passcode);
            }

            await Clients.Caller.SendAsync("RoomCreated", new
            {
                roomId = room.RoomId,
                displayName = room.DisplayName,
                roomType = room.RoomType,
                members = room.Members,
                updatedAt = room.UpdatedAt
            });

            var rooms = await _chatService.GetRoomsForMemberAsync(creatorNickname);
            await Clients.Caller.SendAsync("RoomsLoaded", rooms.Select(chatRoom => new
            {
                roomId = chatRoom.RoomId,
                displayName = chatRoom.DisplayName,
                roomType = chatRoom.RoomType,
                members = chatRoom.Members,
                updatedAt = chatRoom.UpdatedAt
            }));
        }

        public async Task UpdateRoomName(string roomId, string displayName)
        {
            if (string.IsNullOrWhiteSpace(displayName))
            {
                return;
            }

            var room = await _chatService.UpdateRoomNameAsync(roomId, displayName);

            await Clients.Group(roomId).SendAsync("RoomNameUpdated", new
            {
                roomId = room.RoomId,
                displayName = room.DisplayName,
                updatedAt = room.UpdatedAt
            });
        }

        public async Task UpdateMemberAvatar(string roomId, string nickname, string? avatar)
        {
            if (string.IsNullOrWhiteSpace(nickname)
                || nickname.Length > 20
                || string.IsNullOrWhiteSpace(avatar)
                || avatar.Length > 3_000_000
                || !System.Text.RegularExpressions.Regex.IsMatch(
                    avatar,
                    @"^data:image/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$",
                    System.Text.RegularExpressions.RegexOptions.IgnoreCase))
            {
                throw new HubException("Ảnh đại diện không hợp lệ hoặc vượt quá dung lượng cho phép.");
            }

            bool isRoomMember;
            lock (_lock)
            {
                isRoomMember = _onlineUsers.TryGetValue(roomId, out var users)
                    && users.TryGetValue(Context.ConnectionId, out var joinedNickname)
                    && joinedNickname == nickname;
            }

            if (!isRoomMember)
            {
                throw new HubException("Bạn cần tham gia phòng chat để cập nhật ảnh đại diện.");
            }

            await _chatService.UpsertRoomMemberAsync(roomId, nickname);
            await _chatService.UpdateMemberAvatarAsync(roomId, nickname, avatar);
            await Clients.Group(roomId).SendAsync("MemberAvatarUpdated", new
            {
                nickname,
                avatar
            });
        }

        public async Task SendMessage(string roomId, string nickname, string content)
        {
            if (string.IsNullOrWhiteSpace(content))
                return;

            var message = new ChatMessage
            {
                Nickname = nickname,
                Content = content,
                RoomId = roomId,
                Timestamp = DateTime.UtcNow
            };

            // Save to MongoDB
            await _chatService.SaveMessageAsync(message);

            // Broadcast to all clients in room
            await Clients.Group(roomId).SendAsync("ReceiveMessage", new
            {
                messageId = message.MessageId,
                nickname = message.Nickname,
                content = message.Content,
                timestamp = message.Timestamp,
                reactions = message.Reactions
            });

            Console.WriteLine($"Message from {nickname} in {roomId}: {content}");
        }

        public async Task SendImageMessage(string roomId, string nickname, string imageId, string? caption)
        {
            bool isRoomMember;
            lock (_lock)
            {
                isRoomMember = _onlineUsers.TryGetValue(roomId, out var users)
                    && users.TryGetValue(Context.ConnectionId, out var joinedNickname)
                    && joinedNickname == nickname;
            }

            if (!isRoomMember)
            {
                throw new HubException("Bạn cần tham gia phòng chat để gửi ảnh.");
            }

            if (!ObjectId.TryParse(imageId, out _))
            {
                throw new HubException("Ảnh không hợp lệ.");
            }

            var message = new ChatMessage
            {
                Nickname = nickname,
                Content = caption?.Trim() ?? string.Empty,
                MessageType = "image",
                ImageId = imageId,
                RoomId = roomId
            };

            await _chatService.SaveMessageAsync(message);

            await Clients.Group(roomId).SendAsync("ReceiveMessage", new
            {
                messageId = message.MessageId,
                nickname = message.Nickname,
                content = message.Content,
                messageType = message.MessageType,
                imageId = message.ImageId,
                timestamp = message.Timestamp,
                reactions = message.Reactions
            });
        }

        public async Task SendAudioMessage(string roomId, string nickname, string audioId, int durationSeconds)
        {
            bool isRoomMember;
            lock (_lock)
            {
                isRoomMember = _onlineUsers.TryGetValue(roomId, out var users)
                    && users.TryGetValue(Context.ConnectionId, out var joinedNickname)
                    && joinedNickname == nickname;
            }

            if (!isRoomMember)
            {
                throw new HubException("Bạn cần tham gia phòng chat để gửi tin nhắn thoại.");
            }

            if (!ObjectId.TryParse(audioId, out _)
                || durationSeconds is < 1 or > 120)
            {
                throw new HubException("Tin nhắn thoại không hợp lệ hoặc vượt quá 2 phút.");
            }

            var message = new ChatMessage
            {
                Nickname = nickname,
                Content = string.Empty,
                MessageType = "audio",
                AudioId = audioId,
                DurationSeconds = durationSeconds,
                RoomId = roomId
            };

            await _chatService.SaveMessageAsync(message);

            await Clients.Group(roomId).SendAsync("ReceiveMessage", new
            {
                messageId = message.MessageId,
                nickname = message.Nickname,
                content = message.Content,
                messageType = message.MessageType,
                audioId = message.AudioId,
                durationSeconds = message.DurationSeconds,
                timestamp = message.Timestamp,
                reactions = message.Reactions
            });
        }

        public async Task ToggleReaction(string roomId, string messageId, string nickname, string emoji)
        {
            var allowedEmojis = new HashSet<string> { "👍", "❤️", "😂", "😮", "😢", "🎉" };
            if (string.IsNullOrWhiteSpace(roomId)
                || string.IsNullOrWhiteSpace(messageId)
                || string.IsNullOrWhiteSpace(nickname)
                || !allowedEmojis.Contains(emoji))
            {
                throw new HubException("Reaction không hợp lệ.");
            }

            bool isRoomMember;
            lock (_lock)
            {
                isRoomMember = _onlineUsers.TryGetValue(roomId, out var users)
                    && users.TryGetValue(Context.ConnectionId, out var joinedNickname)
                    && joinedNickname == nickname;
            }

            if (!isRoomMember)
            {
                throw new HubException("Bạn cần tham gia phòng chat để thả cảm xúc.");
            }

            var reactions = await _chatService.ToggleMessageReactionAsync(roomId, messageId, nickname, emoji);
            await Clients.Group(roomId).SendAsync("ReactionUpdated", new
            {
                messageId,
                reactions
            });
        }

        public async Task LeaveRoom(string roomId, string nickname)
        {
            await LeaveVoiceRoom(roomId);
            await Groups.RemoveFromGroupAsync(Context.ConnectionId, roomId);

            bool removed = false;

            lock (_lock)
            {
                if (_onlineUsers.ContainsKey(roomId))
                {
                    removed = _onlineUsers[roomId].Remove(Context.ConnectionId);

                    if (_onlineUsers[roomId].Count == 0)
                    {
                        _onlineUsers.Remove(roomId);
                    }
                }
            }

            if (removed)
            {
                await _chatService.UpdateMemberLastSeenAsync(roomId, nickname);
                await _chatService.RemoveRoomMemberAsync(roomId, nickname);
                await Clients.Group(roomId).SendAsync("UpdateOnlineUsers", GetOnlineUsers(roomId));
                await Clients.Group(roomId).SendAsync("MemberLastSeenUpdated", new
                {
                    nickname,
                    lastSeen = DateTime.UtcNow
                });
                await Clients.Group(roomId).SendAsync("NotifyUserLeft", nickname);
                var rooms = await _chatService.GetRoomsForMemberAsync(nickname);
                await Clients.Caller.SendAsync("RoomsLoaded", rooms.Select(chatRoom => new
                {
                    roomId = chatRoom.RoomId,
                    displayName = chatRoom.DisplayName,
                    roomType = chatRoom.RoomType,
                    members = chatRoom.Members,
                    updatedAt = chatRoom.UpdatedAt
                }));
                await Clients.Caller.SendAsync("RoomLeft", new { roomId });
            }
        }

        public async Task JoinVoiceRoom(string roomId)
        {
            List<object> participants;
            string nickname;

            lock (_lock)
            {
                if (!_onlineUsers.TryGetValue(roomId, out var roomMembers)
                    || !roomMembers.TryGetValue(Context.ConnectionId, out nickname!))
                {
                    throw new HubException("Bạn cần tham gia phòng chat trước khi vào voice chat.");
                }

                if (!_voiceParticipants.TryGetValue(roomId, out var voiceMembers))
                {
                    voiceMembers = new Dictionary<string, string>();
                    _voiceParticipants[roomId] = voiceMembers;
                }

                participants = voiceMembers
                    .Where(participant => participant.Key != Context.ConnectionId)
                    .Select(participant => (object)new
                    {
                        connectionId = participant.Key,
                        nickname = participant.Value
                    })
                    .ToList();
                voiceMembers[Context.ConnectionId] = nickname;
            }

            await Clients.Caller.SendAsync("VoiceParticipants", participants);
        }

        public async Task LeaveVoiceRoom(string roomId)
        {
            bool removed = false;

            lock (_lock)
            {
                if (_voiceParticipants.TryGetValue(roomId, out var participants))
                {
                    removed = participants.Remove(Context.ConnectionId);
                    if (participants.Count == 0)
                    {
                        _voiceParticipants.Remove(roomId);
                    }
                }
            }

            if (removed)
            {
                await Clients.OthersInGroup(roomId).SendAsync("VoiceUserLeft", Context.ConnectionId);
            }
        }

        public async Task SendVoiceSignal(
            string roomId,
            string targetConnectionId,
            string signalType,
            JsonElement payload)
        {
            if (signalType is not ("offer" or "answer" or "candidate")
                || payload.ValueKind != JsonValueKind.Object
                || payload.GetRawText().Length > 65536)
            {
                throw new HubException("Tín hiệu voice chat không hợp lệ.");
            }

            string senderNickname;
            lock (_lock)
            {
                if (!_voiceParticipants.TryGetValue(roomId, out var participants)
                    || !participants.TryGetValue(Context.ConnectionId, out senderNickname!)
                    || !participants.ContainsKey(targetConnectionId))
                {
                    throw new HubException("Chỉ thành viên đang tham gia voice chat mới được gửi tín hiệu.");
                }
            }

            await Clients.Client(targetConnectionId).SendAsync("ReceiveVoiceSignal", new
            {
                fromConnectionId = Context.ConnectionId,
                nickname = senderNickname,
                signalType,
                payload
            });
        }

        private static List<object> GetOnlineUsers(string roomId)
        {
            lock (_lock)
            {
                if (!_onlineUsers.TryGetValue(roomId, out var users))
                {
                    return new List<object>();
                }

                return users.Select(user => new
                {
                    connectionId = user.Key,
                    nickname = user.Value
                }).Cast<object>().ToList();
            }
        }
    }
}
