using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;

namespace RealtimeChatAPI.Models
{
    public class ChatMessage
    {
        [BsonId]
        public ObjectId Id { get; set; }

        [BsonElement("nickname")]
        public string Nickname { get; set; } = string.Empty;

        [BsonElement("content")]
        public string Content { get; set; } = string.Empty;

        [BsonElement("timestamp")]
        public DateTime Timestamp { get; set; }

        [BsonElement("roomId")]
        public string RoomId { get; set; } = string.Empty;
    }
}
