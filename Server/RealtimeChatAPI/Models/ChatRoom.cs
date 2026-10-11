using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;

namespace RealtimeChatAPI.Models
{
    public class ChatRoom
    {
        [BsonId]
        public ObjectId Id { get; set; }

        [BsonElement("roomId")]
        public string RoomId { get; set; } = string.Empty;

        [BsonElement("displayName")]
        public string DisplayName { get; set; } = string.Empty;

        [BsonElement("updatedAt")]
        public DateTime UpdatedAt { get; set; }
    }
}
