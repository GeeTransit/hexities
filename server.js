const fs = require('node:fs');
const http = require('node:http');
const ws = require('ws');

const server = new http.Server();
const wsserver = new ws.WebSocketServer({ server, path: '/ws' });

// TODO: load and store events to file for persistence
const events = [];
const sessions = new Set();

// TODO: implement game logic
// TODO: write tests

function broadcast(event) {
  for (const session of sessions) {
    try {
      // TODO: personalize events
      session.ws.send(JSON.stringify(event));
    } catch (err) {
      console.error({ err, event, session });
    }
  }
}

wsserver.on('connection', ws => {
  const session = { ws };
  ws.on('message', data => {
    console.log({ data: data.toString(), session });
    if (!session.username) {
      session.username = 'cuh';
      sessions.add(session);
    }
    try {
      broadcast(JSON.parse(data));
    } catch (err) {
      ws.send(JSON.stringify({
        type: "debug",
        reason: "invalid event",
        _jserror: err.toString(),
      }));
    } finally {
      return;
    }
  });
  ws.on('error', err => {
    console.error({ err });
  });
  ws.on('close', () => {
    sessions.delete(session);
  });
});

server.on('request', (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/html",
  });
  fs.createReadStream('index.html').pipe(res);
});

server.listen(8080);
