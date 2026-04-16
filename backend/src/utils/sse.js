// backend/src/utils/sse.js
// Server-Sent Events helper.
// Usage: const stream = createSSEStream(res); stream.send('progress', data); stream.done();

function createSSEStream(res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // disable Nginx buffering
  res.flushHeaders();

  // Heartbeat every 15s to keep connection alive through proxies
  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 15000);

  req?.on('close', () => clearInterval(heartbeat));

  return {
    // Send a named event with JSON data
    send(event, data) {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    },

    // Send a raw text chunk (for streaming Claude output token by token)
    chunk(text) {
      res.write(`event: chunk\ndata: ${JSON.stringify({ text })}\n\n`);
    },

    // Send progress update
    progress(step, message, pct = null) {
      this.send('progress', { step, message, pct });
    },

    // Send reasoning transparency (what Claude is thinking)
    reasoning(thought) {
      this.send('reasoning', { thought });
    },

    // Send error
    error(message, code = 'GENERATION_ERROR') {
      this.send('error', { message, code });
      clearInterval(heartbeat);
      res.end();
    },

    // Close the stream cleanly
    done(data = {}) {
      this.send('done', data);
      clearInterval(heartbeat);
      res.end();
    },
  };
}

module.exports = { createSSEStream };
