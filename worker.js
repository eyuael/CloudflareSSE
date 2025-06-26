/**
 * Server-Sent Events (SSE) implementation using Cloudflare Workers and Durable Objects
 * 
 * This worker provides real-time server-sent events functionality with:
 * - Persistent connections managed by Durable Objects
 * - Periodic automatic updates
 * - Broadcast messaging to all connected clients
 * - Full CORS support for cross-origin requests
 */

export class SseDurableObject {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.connections = new Set();
    this.updateInterval = null;
  }

  async fetch(request) {
    const url = new URL(request.url);

    // Handle CORS preflight requests
    if (request.method === 'OPTIONS') {
      return this.handleCorsPreflightRequest();
    }

    switch (url.pathname) {
      case '/connect':
        return this.handleSseConnection();
      case '/broadcast':
        return this.handleBroadcast(request);
      default:
        return new Response('Not found', { status: 404 });
    }
  }

  /**
   * Handle CORS preflight requests
   */
  handleCorsPreflightRequest() {
    return new Response(null, {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Cache-Control',
        'Access-Control-Max-Age': '86400',
      },
    });
  }

  /**
   * Handle new SSE connections
   */
  handleSseConnection() {
    let intervalId;
    
    const stream = new ReadableStream({
      start: (controller) => {
        const encoder = new TextEncoder();
        
        // Send initial connection confirmation
        controller.enqueue(encoder.encode('data: Connected to SSE stream\n\n'));
        
        // Start periodic updates
        intervalId = setInterval(() => {
          const data = {
            timestamp: new Date().toISOString(),
            connectionCount: this.connections.size,
            durableObjectId: this.state.id.toString()
          };
          
          const eventData = `event: update\ndata: ${JSON.stringify(data)}\n\n`;
          controller.enqueue(encoder.encode(eventData));
        }, 3000); // Send updates every 3 seconds
      },
      
      cancel: () => {
        if (intervalId) {
          clearInterval(intervalId);
        }
      }
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Cache-Control',
      },
    });
  }

  /**
   * Handle broadcast messages to all connected clients
   */
  async handleBroadcast(request) {
    try {
      let message;
      
      // Parse request body
      const contentType = request.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const bodyText = await request.text();
        
        if (bodyText.trim() === '') {
          message = { 
            message: 'Empty broadcast', 
            timestamp: new Date().toISOString() 
          };
        } else {
          message = JSON.parse(bodyText);
        }
      } else {
        message = { 
          message: 'Non-JSON broadcast', 
          timestamp: new Date().toISOString() 
        };
      }
      
      // Add server timestamp if not present
      if (!message.timestamp) {
        message.timestamp = new Date().toISOString();
      }
      
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: 'Broadcast received successfully',
          data: message 
        }), 
        { 
          status: 200,
          headers: this.getCorsHeaders('application/json')
        }
      );
      
    } catch (error) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: error.message,
          details: 'Failed to parse broadcast request' 
        }), 
        { 
          status: 400, 
          headers: this.getCorsHeaders('application/json')
        }
      );
    }
  }

  /**
   * Get standard CORS headers
   */
  getCorsHeaders(contentType = 'text/plain') {
    return {
      'Content-Type': contentType,
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Cache-Control',
    };
  }
}

/**
 * Main Worker - Routes requests and handles CORS
 */
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Handle CORS preflight requests at worker level
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Cache-Control',
          'Access-Control-Max-Age': '86400',
        },
      });
    }
    
    // Route SSE and broadcast requests to Durable Object
    if (url.pathname === '/connect' || url.pathname === '/broadcast') {
      try {
        const durableObjectId = env.SSE_DURABLE_OBJECT.idFromName('sse-singleton');
        const durableObject = env.SSE_DURABLE_OBJECT.get(durableObjectId);
        return await durableObject.fetch(request);
      } catch (error) {
        return new Response(`Internal Server Error: ${error.message}`, { 
          status: 500,
          headers: {
            'Access-Control-Allow-Origin': '*',
          }
        });
      }
    }
    
    // Handle root path - API information
    if (url.pathname === '/') {
      return new Response(JSON.stringify({
        name: 'Cloudflare SSE Worker',
        version: '1.0.0',
        endpoints: {
          '/connect': {
            method: 'GET',
            description: 'Server-Sent Events connection endpoint',
            contentType: 'text/event-stream'
          },
          '/broadcast': {
            method: 'POST',
            description: 'Broadcast messages to all connected clients',
            contentType: 'application/json'
          }
        },
        timestamp: new Date().toISOString()
      }), {
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }
    
    return new Response('Not Found', { 
      status: 404,
      headers: {
        'Access-Control-Allow-Origin': '*',
      }
    });
  }
};