# Cloudflare SSE Worker

A high-performance Server-Sent Events (SSE) implementation using Cloudflare Workers and Durable Objects. This worker provides real-time server-sent events functionality with persistent connections, automatic updates, and broadcast messaging capabilities.

## Features

- 🔄 **Real-time Updates**: Automatic periodic updates sent to all connected clients
- 📡 **Broadcast Messaging**: Send messages to all connected clients simultaneously
- 🌐 **CORS Support**: Full cross-origin resource sharing support
- ⚡ **High Performance**: Built on Cloudflare's edge network
- 🔐 **Durable Objects**: Persistent connection state management
- 📦 **Zero Dependencies**: Pure JavaScript implementation

## Architecture

This worker uses Cloudflare's Durable Objects to manage persistent SSE connections:

- **Main Worker**: Routes requests and handles CORS
- **Durable Object**: Manages SSE connections and broadcasts
- **Edge Network**: Global distribution via Cloudflare's infrastructure

## API Endpoints

### `GET /connect?room=<room_id>`

Establishes a Server-Sent Events connection to a specific room.

**Query Parameters:**
- `room` (optional): The ID of the room to connect to. Defaults to `global`.

**Response Headers:**
- `Content-Type: text/event-stream`
- `Cache-Control: no-cache`
- `Connection: keep-alive`

**Event Types:**
- `update`: Periodic updates with timestamp and connection info
- `broadcast`: Messages sent via the broadcast endpoint

**Example Response:**
```
data: Connected to SSE stream

event: update
data: {"timestamp":"2025-06-26T12:00:00.000Z","connectionCount":1,"durableObjectId":"abc123"}

event: broadcast
data: {"message":"Hello World","timestamp":"2025-06-26T12:01:00.000Z"}
```

### `POST /broadcast?room=<room_id>`

Sends a message to all connected SSE clients in a specific room.

**Query Parameters:**
- `room` (optional): The ID of the room to broadcast to. Defaults to `global`.

**Request Headers:**
- `Content-Type: application/json`

**Request Body:**
```json
{
  "message": "Your message here",
  "data": "Additional data (optional)"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Broadcast received successfully",
  "data": {
    "message": "Your message here",
    "timestamp": "2025-06-26T12:01:00.000Z"
  }
}
```

### `GET /`

Returns API information and available endpoints.

**Response:**
```json
{
  "name": "Cloudflare SSE Worker",
  "version": "1.0.0",
  "endpoints": {
    "/connect": {
      "method": "GET",
      "description": "Server-Sent Events connection endpoint",
      "contentType": "text/event-stream"
    },
    "/broadcast": {
      "method": "POST",
      "description": "Broadcast messages to all connected clients",
      "contentType": "application/json"
    }
  },
  "timestamp": "2025-06-26T12:00:00.000Z"
}
```

## Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) (v16 or later)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/)
- Cloudflare account

### Installation

1. Clone this repository:
```bash
git clone https://github.com/eyuael/cloudflare-sse.git
cd cloudflare-sse
```

2. Install Wrangler CLI (if not already installed):
```bash
npm install -g wrangler
```

3. Login to Cloudflare:
```bash
wrangler login
```

### Deployment

1. Deploy the worker:
```bash
wrangler deploy
```

2. Your worker will be available at:
```
https://sse-worker.your-subdomain.workers.dev
```

## Configuration

### Environment Variables

The worker automatically configures the following:

- **SSE_DURABLE_OBJECT**: Durable Object binding for connection management
- **Update Interval**: 3 seconds (configurable in code)

### Customization

To modify the update interval or message format, edit the `handleSseConnection()` method in `worker.js`:

```javascript
// Change update interval (currently 3000ms = 3 seconds)
intervalId = setInterval(() => {
  // Your custom update logic here
}, 3000);
```

## Usage Examples

### JavaScript Client

```javascript
// Connect to SSE endpoint for a specific room
const eventSource = new EventSource('https://your-worker.workers.dev/connect?room=my-room');

// Handle connection open
eventSource.onopen = function(event) {
  console.log('SSE connection opened');
};

// Handle regular updates
eventSource.addEventListener('update', function(event) {
  const data = JSON.parse(event.data);
  console.log('Update received:', data);
});

// Handle broadcast messages
eventSource.addEventListener('broadcast', function(event) {
  const data = JSON.parse(event.data);
  console.log('Broadcast received:', data);
});

// Handle errors
eventSource.onerror = function(event) {
  console.error('SSE error:', event);
};
```

### Send Broadcast Message

```javascript
// Send broadcast to all connected clients in a specific room
fetch('https://your-worker.workers.dev/broadcast?room=my-room', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    message: 'Hello from broadcast!',
    timestamp: new Date().toISOString()
  })
})
.then(response => response.json())
.then(data => console.log('Broadcast sent:', data));
```

### cURL Examples

**Connect to SSE:**
```bash
curl -N https://your-worker.workers.dev/connect?room=my-room
```

**Send broadcast:**
```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -d '{"message":"Hello World","data":"Additional info"}' \
  https://your-worker.workers.dev/broadcast?room=my-room
```

## Development

### Local Development

```bash
# Start local development server
wrangler dev

# The worker will be available at http://localhost:8787
```

### Testing

```bash
# Test SSE connection
curl -N http://localhost:8787/connect?room=my-room

# Test broadcast
curl -X POST \
  -H "Content-Type: application/json" \
  -d '{"message":"Test message"}' \
  http://localhost:8787/broadcast?room=my-room
```

## Performance Considerations

- **Scalability**: The worker now shards connections by room, allowing for greater scalability.
- **Connection Limits**: Durable Objects can handle thousands of concurrent connections per room.
- **Back-pressure**: The worker implements a per-client queue depth limit to prevent memory leaks from slow clients.
- **Message Persistence**: The last 10 messages are persisted in Durable Object storage to survive evictions.
- **Geographic Distribution**: Connections are automatically routed to the nearest Cloudflare edge location.
- **Auto-scaling**: Cloudflare automatically scales based on demand.
- **Memory Usage**: Each connection uses minimal memory for connection state.

## Security

- **CORS**: Configured to allow all origins (`*`) - modify for production use
- **Rate Limiting**: Consider implementing rate limiting for broadcast endpoints
- **Authentication**: Add authentication as needed for your use case

## Troubleshooting

### Common Issues

**Connection Timeouts:**
- Check CORS configuration
- Verify worker is deployed correctly
- Ensure client supports EventSource

**Broadcast Not Working:**
- Verify Content-Type header is set correctly
- Check JSON payload format
- Ensure CORS preflight requests are handled

**High Memory Usage:**
- Monitor connection count
- Implement connection cleanup logic
- Consider connection limits per Durable Object

### Debugging

Enable debugging by adding console logs:

```javascript
// Add to worker.js for detailed logging
console.log('Connection established');
console.log('Broadcast received:', message);
```

View logs with:
```bash
wrangler tail
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Support

- [Cloudflare Workers Documentation](https://developers.cloudflare.com/workers/)
- [Durable Objects Documentation](https://developers.cloudflare.com/workers/durable-objects/)
- [Server-Sent Events Specification](https://html.spec.whatwg.org/multipage/server-sent-events.html)

---

Built with ❤️ using Cloudflare Workers and Durable Objects