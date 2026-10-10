using MongoDB.Driver;
using RealtimeChatAPI.Models;

namespace RealtimeChatAPI.Services
{
    public interface IChatService
    {
        Task<List<ChatMessage>> GetMessageHistoryAsync(string roomId, int limit = 50);
        Task SaveMessageAsync(ChatMessage message);
        Task<ChatRoom> GetOrCreateRoomAsync(string roomId);
        Task<ChatRoom> UpdateRoomNameAsync(string roomId, string displayName);
    }

    public class ChatService : IChatService
    {
        private readonly IMongoCollection<ChatMessage> _messagesCollection;
        private readonly IMongoCollection<ChatRoom> _roomsCollection;

        public ChatService(IMongoClient mongoClient, string databaseName = "Websocket")
        {
            var database = mongoClient.GetDatabase(databaseName);
            _messagesCollection = database.GetCollection<ChatMessage>("message");
            _roomsCollection = database.GetCollection<ChatRoom>("rooms");

            // Create index for faster queries
            try
            {
                var indexKeysDefinition = Builders<ChatMessage>.IndexKeys.Ascending(m => m.RoomId);
                _messagesCollection.Indexes.CreateOne(new CreateIndexModel<ChatMessage>(indexKeysDefinition));

                var roomIndexKeys = Builders<ChatRoom>.IndexKeys.Ascending(r => r.RoomId);
                var roomIndexOptions = new CreateIndexOptions { Unique = true };
                _roomsCollection.Indexes.CreateOne(new CreateIndexModel<ChatRoom>(roomIndexKeys, roomIndexOptions));
            }
            catch (MongoCommandException ex) when (ex.Code == 48)
            {
                // Index already exists
            }
        }

        public async Task<List<ChatMessage>> GetMessageHistoryAsync(string roomId, int limit = 50)
        {
            var messages = await _messagesCollection
                .Find(m => m.RoomId == roomId)
                .SortByDescending(m => m.Timestamp)
                .Limit(limit)
                .ToListAsync();

            messages.Reverse(); // Return oldest first
            return messages;
        }

        public async Task SaveMessageAsync(ChatMessage message)
        {
            message.Timestamp = DateTime.UtcNow;
            await _messagesCollection.InsertOneAsync(message);
        }

        public async Task<ChatRoom> GetOrCreateRoomAsync(string roomId)
        {
            var room = await _roomsCollection.Find(r => r.RoomId == roomId).FirstOrDefaultAsync();
            if (room != null)
            {
                return room;
            }

            room = new ChatRoom
            {
                RoomId = roomId,
                DisplayName = "Phòng chat",
                UpdatedAt = DateTime.UtcNow
            };

            await _roomsCollection.InsertOneAsync(room);
            return room;
        }

        public async Task<ChatRoom> UpdateRoomNameAsync(string roomId, string displayName)
        {
            var normalizedName = displayName.Trim();
            if (string.IsNullOrWhiteSpace(normalizedName))
            {
                throw new ArgumentException("Room display name cannot be empty.", nameof(displayName));
            }

            var update = Builders<ChatRoom>.Update
                .Set(r => r.DisplayName, normalizedName)
                .Set(r => r.UpdatedAt, DateTime.UtcNow);

            var options = new UpdateOptions { IsUpsert = true };
            await _roomsCollection.UpdateOneAsync(
                r => r.RoomId == roomId,
                update,
                options);

            return await _roomsCollection.Find(r => r.RoomId == roomId).FirstOrDefaultAsync();
        }
    }
}
