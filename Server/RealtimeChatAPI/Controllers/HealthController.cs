using Microsoft.AspNetCore.Mvc;
using RealtimeChatAPI.Services;

namespace RealtimeChatAPI.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class HealthController : ControllerBase
    {
        private readonly IChatService _chatService;

        public HealthController(IChatService chatService)
        {
            _chatService = chatService;
        }

        [HttpGet]
        public IActionResult GetHealth()
        {
            return Ok(new
            {
                status = "OK",
                timestamp = DateTime.UtcNow,
                version = "1.0.0",
                environment = Environment.GetEnvironmentVariable("ASPNETCORE_ENVIRONMENT") ?? "Production"
            });
        }

        [HttpPost("test-db")]
        public async Task<IActionResult> TestDatabaseConnection()
        {
            try
            {
                // Try to get message history (tests DB connection)
                var messages = await _chatService.GetMessageHistoryAsync("test-room", 1);
                return Ok(new
                {
                    status = "Connected",
                    messagesCount = messages.Count,
                    timestamp = DateTime.UtcNow
                });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new
                {
                    status = "Failed",
                    error = ex.Message
                });
            }
        }
    }
}
