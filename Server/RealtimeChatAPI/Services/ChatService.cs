using MongoDB.Driver;
using RealtimeChatAPI.Models;

namespace RealtimeChatAPI.Services
{
    public interface IChatService
    {
        Task<List<ChatMessage>> GetMessageHistoryAsync(string roomId, int limit = 50);
        Task SaveMessageAsync(ChatMessage message);
    }

    public class ChatService : IChatService
    {
        private readonly IMongoCollection<ChatMessage> _messagesCollection;

        public ChatService(IMongoClient mongoClient, string databaseName = "Websocket")
        {
            var database = mongoClient.GetDatabase(databaseName);
            _messagesCollection = database.GetCollection<ChatMessage>("message");

            // Create index for faster queries
            try
            {
                var indexKeysDefinition = Builders<ChatMessage>.IndexKeys.Ascending(m => m.RoomId);
                _messagesCollection.Indexes.CreateOne(new CreateIndexModel<ChatMessage>(indexKeysDefinition));
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
    }
}
