using MongoDB.Driver;
using RealtimeChatAPI.Hubs;
using RealtimeChatAPI.Services;

var builder = WebApplication.CreateBuilder(args);

// Add services to the container
builder.Services.AddControllers();
builder.Services.AddSignalR();

// Configure MongoDB
var mongoConnectionString = builder.Configuration.GetConnectionString("MongoDB") 
    ?? "mongodb+srv://trinhhuyhoang255_db_user:<password>@websocket.zbsdb9k.mongodb.net/?appName=Websocket";

builder.Services.AddSingleton<IMongoClient>(new MongoClient(mongoConnectionString));
builder.Services.AddScoped<IChatService, ChatService>();

// Add CORS
builder.Services.AddCors(options =>
{
    options.AddPolicy("CorsPolicy", builder =>
    {
        builder
            .AllowAnyMethod()
            .AllowAnyHeader()
            .AllowCredentials()
            .WithOrigins("http://localhost:5173", "http://localhost:3000", "http://127.0.0.1:5173");
    });
});

var app = builder.Build();

// Configure the HTTP request pipeline
if (app.Environment.IsDevelopment())
{
    app.UseDeveloperExceptionPage();
}

app.UseRouting();
app.UseCors("CorsPolicy");

app.UseEndpoints(endpoints =>
{
    endpoints.MapControllers();
    endpoints.MapHub<ChatHub>("/chathub");
});

// Health check endpoint
app.MapGet("/api/health", () => new { status = "OK", timestamp = DateTime.UtcNow });

app.Run();
