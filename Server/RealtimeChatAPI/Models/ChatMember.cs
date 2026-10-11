using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;

namespace RealtimeChatAPI.Models
{
    public class ChatMember
    {
        [BsonId]
        public ObjectId Id { get; set; }

        [BsonElement("roomId")]
        public string RoomId { get; set; } = string.Empty;

        [BsonElement("nickname")]
        public string Nickname { get; set; } = string.Empty;

        [BsonElement("lastSeen")]
        public DateTime LastSeen { get; set; }

        [BsonElement("avatar")]
        public string Avatar { get; set; } = string.Empty;
    }
}
