using Microsoft.AspNetCore.SignalR;
using RealtimeChatAPI.Models;
using RealtimeChatAPI.Services;

namespace RealtimeChatAPI.Hubs
{
    public class ChatHub : Hub
    {
        private readonly IChatService _chatService;
        private static Dictionary<string, HashSet<string>> _onlineUsers = new();

        public ChatHub(IChatService chatService)
        {
            _chatService = chatService;
        }

        public override async Task OnConnectedAsync()
        {
            await base.OnConnectedAsync();
            Console.WriteLine($"Client connected: {Context.ConnectionId}");
        }

        public override async Task OnDisconnectedAsync(Exception exception)
        {
            // Remove user from online list
            foreach (var room in _onlineUsers.Keys.ToList())
            {
                if (_onlineUsers[room].Contains(Context.ConnectionId))
                {
                    _onlineUsers[room].Remove(Context.ConnectionId);
                    await Clients.Group(room).SendAsync("UpdateOnlineUsers", _onlineUsers[room].ToList());
                }
            }

            await base.OnDisconnectedAsync(exception);
            Console.WriteLine($"Client disconnected: {Context.ConnectionId}");
        }

        public async Task JoinRoom(string roomId, string nickname)
        {
            // Add user to the room group
            await Groups.AddToGroupAsync(Context.ConnectionId, roomId);

            // Track online users
            if (!_onlineUsers.ContainsKey(roomId))
            {
                _onlineUsers[roomId] = new HashSet<string>();
            }
            _onlineUsers[roomId].Add(Context.ConnectionId);

            // Load message history
            var history = await _chatService.GetMessageHistoryAsync(roomId);
            await Clients.Caller.SendAsync("LoadHistory", history);

            // Notify others about new user
            await Clients.Group(roomId).SendAsync("UpdateOnlineUsers", _onlineUsers[roomId].ToList());
            await Clients.Group(roomId).SendAsync("NotifyUserJoined", nickname);

            Console.WriteLine($"User {nickname} joined room {roomId}");
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

            if (_onlineUsers.ContainsKey(roomId))
            {
                _onlineUsers[roomId].Remove(Context.ConnectionId);
                await Clients.Group(roomId).SendAsync("UpdateOnlineUsers", _onlineUsers[roomId].ToList());
                await Clients.Group(roomId).SendAsync("NotifyUserLeft", nickname);
            }
        }
    }
}
