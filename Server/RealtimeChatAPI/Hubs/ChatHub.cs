using Microsoft.AspNetCore.SignalR;
using RealtimeChatAPI.Models;
using RealtimeChatAPI.Services;

namespace RealtimeChatAPI.Hubs
{
    public class ChatHub : Hub
    {
        private readonly IChatService _chatService;
        private static readonly object _lock = new();
        private static readonly Dictionary<string, Dictionary<string, string>> _onlineUsers = new();


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

            lock (_lock)
            {
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
            var history = await _chatService.GetMessageHistoryAsync(roomId);
            var members = await _chatService.GetRoomMembersAsync(roomId);
            await Clients.Caller.SendAsync("RoomInfoLoaded", new
            {
                roomId = room.RoomId,
                displayName = room.DisplayName,
                updatedAt = room.UpdatedAt
            });
            await Clients.Caller.SendAsync("LoadHistory", history);
            await Clients.Caller.SendAsync("LoadMembers", members.Select(member => new
            {
                nickname = member.Nickname,
                lastSeen = member.LastSeen,
                avatar = member.Avatar
            }));

            await Clients.Group(roomId).SendAsync("UpdateOnlineUsers", GetOnlineUsers(roomId));
            await Clients.Group(roomId).SendAsync("NotifyUserJoined", nickname);

            Console.WriteLine($"User {nickname} joined room {roomId}");
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
                nickname = message.Nickname,
                content = message.Content,
                timestamp = message.Timestamp
            });

            Console.WriteLine($"Message from {nickname} in {roomId}: {content}");
        }

        public async Task LeaveRoom(string roomId, string nickname)
        {
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
                await Clients.Group(roomId).SendAsync("UpdateOnlineUsers", GetOnlineUsers(roomId));
                await Clients.Group(roomId).SendAsync("MemberLastSeenUpdated", new
                {
                    nickname,
                    lastSeen = DateTime.UtcNow
                });
                await Clients.Group(roomId).SendAsync("NotifyUserLeft", nickname);
            }
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
