/**
 * Server-Sent Events (SSE) implementation using Cloudflare Workers and Durable Objects
 * 
 * This worker provides real-time server-sent events functionality with:
 * - Persistent connections managed by Durable Objects
 * - Periodic automatic updates
 * - Broadcast messaging to all connected clients
 * - Full CORS support for cross-origin requests
 */

const corsHeaders = (options = {}) => ({
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Cache-Control',
  'Vary': 'Origin',
  ...options,
});

const MAX_MESSAGES = 10;
const MAX_CLIENT_QUEUE = 100;

export class SseDurableObject {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.controllers = new Set();
    this.updateInterval = null;
    this.lastMessages = [];
    this.ready = this.state.storage.get('lastMessages').then(messages => {
      if (messages) {
        this.lastMessages = messages;
      }
    });
  }

  async fetch(request) {
    const url = new URL(request.url);

    // Handle CORS preflight requests
    if (request.method === 'OPTIONS') {
      return this.handleCorsPreflightRequest();
    }

    const room = url.searchParams.get('room') || 'global';

    switch (url.pathname) {
      case '/connect':
        return this.handleSseConnection(room);
      case '/broadcast':
        return this.handleBroadcast(request, room);
      default:
        return new Response('Not found', { status: 404 });
    }
  }

  /**
   * Handle CORS preflight requests
   */
  handleCorsPreflightRequest() {
    return new Response(null, {
      status: 204,
      headers: corsHeaders({
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Max-Age': '86400',
      }),
    });
  }

  /**
   * Handle new SSE connections
   */
  handleSseConnection(room) {
    const stream = new ReadableStream({
      start: async (controller) => {
        controller._queue = [];
        controller._max = MAX_CLIENT_QUEUE;
        this.controllers.add(controller);

        if (this.controllers.size === 1) {
          this.startPeriodicUpdate();
        }

        const encoder = new TextEncoder();
        this.enqueueToController(controller, encoder.encode('data: Connected to SSE stream\n\n'));

        // Wait for storage to be ready and then replay last messages
        await this.ready;
        for (const message of this.lastMessages) {
          this.enqueueToController(controller, encoder.encode(`event: broadcast\ndata: ${JSON.stringify(message)}\n\n`));
        }
      },
      cancel: (controller) => {
        this.controllers.delete(controller);
        if (this.controllers.size === 0) {
          this.stopPeriodicUpdate();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        ...corsHeaders(),
      },
    });
  }

  /**
   * Handle broadcast messages to all connected clients
   */
  async handleBroadcast(request, room) {
    try {
      let message;
      const contentType = request.headers.get('content-type') || '';

      if (contentType.includes('application/json')) {
        const bodyText = await request.text();
        message = bodyText.trim() === '' ? { message: 'Empty broadcast' } : JSON.parse(bodyText);
      } else {
        message = { message: 'Non-JSON broadcast' };
      }

      if (!message.timestamp) {
        message.timestamp = new Date().toISOString();
      }

      this.lastMessages.push(message);
      if (this.lastMessages.length > MAX_MESSAGES) {
        this.lastMessages.shift();
      }
      this.state.waitUntil(this.state.storage.put('lastMessages', this.lastMessages));

      const payload = `event: broadcast\ndata: ${JSON.stringify(message)}\n\n`;
      const encoder = new TextEncoder();
      const encodedPayload = encoder.encode(payload);

      for (const controller of this.controllers) {
        this.enqueueToController(controller, encodedPayload);
      }

      return new Response(
        JSON.stringify({ success: true, message: 'Broadcast sent successfully' }),
        {
          status: 200,
          headers: corsHeaders({ 'Content-Type': 'application/json' }),
        }
      );
    } catch (error) {
      return new Response(
        JSON.stringify({ success: false, error: error.message }),
        {
          status: 400,
          headers: corsHeaders({ 'Content-Type': 'application/json' }),
        }
      );
    }
  }

  enqueueToController(controller, chunk) {
    if (!this.controllers.has(controller)) {
      return;
    }
    controller._queue.push(chunk);
    if (controller._queue.length > controller._max) {
      controller._queue.shift();
    }
    this.tryDrainQueue(controller);
  }

  tryDrainQueue(controller) {
    try {
      while (controller._queue.length > 0) {
        controller.enqueue(controller._queue.shift());
      }
    } catch (error) {
      this.controllers.delete(controller);
    }
  }

  /**
   * Start periodic updates to all connected clients
   */
  startPeriodicUpdate() {
    this.updateInterval = setInterval(() => {
      try {
        const data = {
          timestamp: new Date().toISOString(),
          durableObjectId: this.state.id.toString(),
        };

        const eventData = `event: update\ndata: ${JSON.stringify(data)}\n\n`;
        const encoder = new TextEncoder();
        const encodedEventData = encoder.encode(eventData);

        for (const controller of this.controllers) {
          this.enqueueToController(controller, encodedEventData);
        }
      } catch (error) {
        // Interval will continue running even if an error occurs
      }
    }, 3000);
  }

  /**
   * Stop periodic updates
   */
  stopPeriodicUpdate() {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
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
        status: 204,
        headers: corsHeaders({
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Max-Age': '86400',
        }),
      });
    }
    
    // Route SSE and broadcast requests to Durable Object
    if (url.pathname === '/connect' || url.pathname === '/broadcast') {
      try {
        const room = url.searchParams.get('room') || 'global';
        const durableObjectId = env.SSE_DURABLE_OBJECT.idFromName(room);
        const durableObject = env.SSE_DURABLE_OBJECT.get(durableObjectId);
        return await durableObject.fetch(request);
      } catch (error) {
        return new Response(`Internal Server Error: ${error.message}`, { 
          status: 500,
          headers: corsHeaders(),
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
          ...corsHeaders()
        }
      });
    }
    
    return new Response('Not Found', { 
      status: 404,
      headers: corsHeaders(),
    });
  }
};