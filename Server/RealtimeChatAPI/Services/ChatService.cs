using MongoDB.Bson;
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
        Task<List<ChatMember>> GetRoomMembersAsync(string roomId);
        Task UpsertRoomMemberAsync(string roomId, string nickname);
        Task UpdateMemberLastSeenAsync(string roomId, string nickname);
        Task UpdateMemberAvatarAsync(string roomId, string nickname, string avatar);
        Task<List<ChatReaction>> ToggleMessageReactionAsync(string roomId, string messageId, string nickname, string emoji);
        Task<ChatRoom> CreateRoomAsync(string displayName, string roomType, IEnumerable<string> members);
        Task<ChatRoom> CreateRoomAsync(string displayName, string roomType, IEnumerable<string> members, string passcode);
        Task<ChatRoom?> GetDirectRoomAsync(string firstNickname, string secondNickname);
        Task<List<ChatRoom>> GetRoomsForMemberAsync(string nickname);
        Task<ChatRoom?> JoinRoomByNameAsync(string displayName, string passcode, string nickname);
        Task AddRoomMemberAsync(string roomId, string nickname);
        Task RemoveRoomMemberAsync(string roomId, string nickname);
    }

    public class ChatService : IChatService
    {
        private readonly IMongoCollection<ChatMessage> _messagesCollection;
        private readonly IMongoCollection<ChatRoom> _roomsCollection;
        private readonly IMongoCollection<ChatMember> _membersCollection;

        public ChatService(IMongoClient mongoClient, string databaseName = "Websocket")
        {
            var database = mongoClient.GetDatabase(databaseName);
            _messagesCollection = database.GetCollection<ChatMessage>("message");
            _roomsCollection = database.GetCollection<ChatRoom>("rooms");
            _membersCollection = database.GetCollection<ChatMember>("members");

            // Create index for faster queries
            try
            {
                var indexKeysDefinition = Builders<ChatMessage>.IndexKeys.Ascending(m => m.RoomId);
                _messagesCollection.Indexes.CreateOne(new CreateIndexModel<ChatMessage>(indexKeysDefinition));

                var roomIndexKeys = Builders<ChatRoom>.IndexKeys.Ascending(r => r.RoomId);
                var roomIndexOptions = new CreateIndexOptions { Unique = true };
                _roomsCollection.Indexes.CreateOne(new CreateIndexModel<ChatRoom>(roomIndexKeys, roomIndexOptions));

                var memberIndexKeys = Builders<ChatMember>.IndexKeys
                    .Ascending(member => member.RoomId)
                    .Ascending(member => member.Nickname);
                _membersCollection.Indexes.CreateOne(new CreateIndexModel<ChatMember>(memberIndexKeys));
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
            message.MessageId = ObjectId.GenerateNewId().ToString();
            message.Id = ObjectId.Parse(message.MessageId);
            await _messagesCollection.InsertOneAsync(message);
        }

        public async Task<List<ChatReaction>> ToggleMessageReactionAsync(
            string roomId,
            string messageId,
            string nickname,
            string emoji)
        {
            var filter = Builders<ChatMessage>.Filter
                .Eq(message => message.RoomId, roomId)
                & Builders<ChatMessage>.Filter.Eq(message => message.MessageId, messageId);

            var message = await _messagesCollection.Find(filter).FirstOrDefaultAsync();
            if (message == null)
            {
                throw new ArgumentException("Tin nhắn không tồn tại.", nameof(messageId));
            }

            var existingReaction = message.Reactions.FirstOrDefault(reaction =>
                reaction.Nickname == nickname && reaction.Emoji == emoji);

            if (existingReaction != null)
            {
                message.Reactions.Remove(existingReaction);
            }
            else
            {
                message.Reactions.Add(new ChatReaction
                {
                    Nickname = nickname,
                    Emoji = emoji,
                    CreatedAt = DateTime.UtcNow
                });
            }

            await _messagesCollection.ReplaceOneAsync(filter, message);
            return message.Reactions;
        }

        public async Task<ChatRoom> GetOrCreateRoomAsync(string roomId)
        {
            var room = await _roomsCollection.Find(r => r.RoomId == roomId).FirstOrDefaultAsync();
            if (room != null)
            {
                return room.DisplayName == "Phòng chat"
                    ? await UpdateRoomNameAsync(roomId, "Hội ae rok")
                    : room;
            }

            room = new ChatRoom
            {
                RoomId = roomId,
                DisplayName = "Phòng chat",
                RoomType = "group",
                UpdatedAt = DateTime.UtcNow
            };

            await _roomsCollection.InsertOneAsync(room);
            return room;
        }

        private static string HashPasscode(string passcode)
        {
            return Convert.ToHexString(
                System.Security.Cryptography.SHA256.HashData(
                    System.Text.Encoding.UTF8.GetBytes(passcode.Trim()))).ToLowerInvariant();
        }

        public async Task<ChatRoom?> GetDirectRoomAsync(string firstNickname, string secondNickname)
        {
            var members = new[] { firstNickname, secondNickname }
                .Select(nickname => nickname.Trim())
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .OrderBy(nickname => nickname, StringComparer.OrdinalIgnoreCase)
                .ToArray();
            if (members.Length != 2)
            {
                return null;
            }

            var candidates = await _roomsCollection
                .Find(room => room.RoomType == "direct")
                .ToListAsync();

            return candidates.FirstOrDefault(room =>
                room.Members.Count == 2
                && room.Members.All(member => members.Contains(member, StringComparer.OrdinalIgnoreCase)));
        }

        public async Task<ChatRoom> CreateRoomAsync(string displayName, string roomType, IEnumerable<string> members)
        {
            return await CreateRoomAsync(displayName, roomType, members, string.Empty);
        }

        public async Task<ChatRoom> CreateRoomAsync(string displayName, string roomType, IEnumerable<string> members, string passcode)
        {
            var normalizedMembers = members
                .Where(nickname => !string.IsNullOrWhiteSpace(nickname))
                .Select(nickname => nickname.Trim())
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList();
            var normalizedType = roomType == "direct" ? "direct" : "group";

            var roomId = normalizedType == "direct" && normalizedMembers.Count == 2
                ? "direct-" + Convert.ToHexString(
                    System.Security.Cryptography.SHA256.HashData(
                        System.Text.Encoding.UTF8.GetBytes(
                            string.Join("|", normalizedMembers.OrderBy(n => n, StringComparer.OrdinalIgnoreCase)))))
                    .ToLowerInvariant()[..24]
                : "room-" + Guid.NewGuid().ToString("N");
            var normalizedName = displayName.Trim();
            if (string.IsNullOrWhiteSpace(normalizedName))
            {
                normalizedName = normalizedType == "direct" && normalizedMembers.Count == 2
                    ? string.Join(", ", normalizedMembers.OrderBy(n => n, StringComparer.OrdinalIgnoreCase))
                    : "Phòng chat mới";
            }

            var existing = await _roomsCollection.Find(room => room.RoomId == roomId).FirstOrDefaultAsync();
            if (existing != null)
            {
                return existing;
            }

            var room = new ChatRoom
            {
                RoomId = roomId,
                DisplayName = normalizedName,
                RoomType = normalizedType,
                Members = normalizedMembers,
                PasswordHash = normalizedType == "direct" ? string.Empty : HashPasscode(passcode),
                UpdatedAt = DateTime.UtcNow
            };
            await _roomsCollection.InsertOneAsync(room);
            return room;
        }

        public async Task<List<ChatRoom>> GetRoomsForMemberAsync(string nickname)
        {
            var rooms = await _roomsCollection
                .Find(room => room.Members.Contains(nickname))
                .SortByDescending(room => room.UpdatedAt)
                .ToListAsync();
            return rooms;
        }

        public async Task<ChatRoom?> JoinRoomByNameAsync(string displayName, string passcode, string nickname)
        {
            var normalizedName = displayName.Trim();
            if (string.IsNullOrWhiteSpace(normalizedName) || string.IsNullOrWhiteSpace(passcode))
            {
                return null;
            }

            var candidates = await _roomsCollection
                .Find(room => room.RoomType == "group")
                .ToListAsync();
            var room = candidates.FirstOrDefault(item =>
                item.DisplayName.Equals(normalizedName, StringComparison.OrdinalIgnoreCase));
            if (room == null
                || !string.Equals(room.PasswordHash, HashPasscode(passcode), StringComparison.OrdinalIgnoreCase))
            {
                return null;
            }

            await AddRoomMemberAsync(room.RoomId, nickname);
            return await _roomsCollection.Find(item => item.RoomId == room.RoomId).FirstOrDefaultAsync();
        }

        public async Task AddRoomMemberAsync(string roomId, string nickname)
        {
            var room = await _roomsCollection.Find(item => item.RoomId == roomId).FirstOrDefaultAsync();
            if (room == null) return;

            var members = room.Members ?? new List<string>();
            if (!members.Any(member => member.Equals(nickname, StringComparison.OrdinalIgnoreCase)))
            {
                members.Add(nickname);
                await _roomsCollection.UpdateOneAsync(
                    item => item.RoomId == roomId,
                    Builders<ChatRoom>.Update
                        .Set(item => item.Members, members)
                        .Set(item => item.UpdatedAt, DateTime.UtcNow));
            }
        }

        public async Task RemoveRoomMemberAsync(string roomId, string nickname)
        {
            var room = await _roomsCollection.Find(item => item.RoomId == roomId).FirstOrDefaultAsync();
            if (room == null) return;

            var members = (room.Members ?? new List<string>())
                .Where(member => !member.Equals(nickname, StringComparison.OrdinalIgnoreCase))
                .ToList();
            await _roomsCollection.UpdateOneAsync(
                item => item.RoomId == roomId,
                Builders<ChatRoom>.Update
                    .Set(item => item.Members, members)
                    .Set(item => item.UpdatedAt, DateTime.UtcNow));
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

        public async Task<List<ChatMember>> GetRoomMembersAsync(string roomId)
        {
            return await _membersCollection
                .Find(member => member.RoomId == roomId)
                .SortBy(member => member.Nickname)
                .ToListAsync();
        }

        public async Task UpsertRoomMemberAsync(string roomId, string nickname)
        {
            var filter = Builders<ChatMember>.Filter
                .Eq(member => member.RoomId, roomId)
                & Builders<ChatMember>.Filter.Eq(member => member.Nickname, nickname);
            var update = Builders<ChatMember>.Update
                .Set(member => member.LastSeen, DateTime.UtcNow)
                .SetOnInsert(member => member.RoomId, roomId)
                .SetOnInsert(member => member.Nickname, nickname);

            await _membersCollection.UpdateOneAsync(filter, update, new UpdateOptions { IsUpsert = true });
        }

        public async Task UpdateMemberLastSeenAsync(string roomId, string nickname)
        {
            var filter = Builders<ChatMember>.Filter
                .Eq(member => member.RoomId, roomId)
                & Builders<ChatMember>.Filter.Eq(member => member.Nickname, nickname);
            var update = Builders<ChatMember>.Update.Set(member => member.LastSeen, DateTime.UtcNow);

            await _membersCollection.UpdateOneAsync(filter, update);
        }

        public async Task UpdateMemberAvatarAsync(string roomId, string nickname, string avatar)
        {
            var filter = Builders<ChatMember>.Filter
                .Eq(member => member.RoomId, roomId)
                & Builders<ChatMember>.Filter.Eq(member => member.Nickname, nickname);
            var update = Builders<ChatMember>.Update.Set(member => member.Avatar, avatar);

            await _membersCollection.UpdateOneAsync(filter, update);
        }
    }
}
