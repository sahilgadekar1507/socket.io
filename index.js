import express from 'express';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Server } from 'socket.io';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { availableParallelism } from 'node:os';
import cluster from 'node:cluster';
import { createAdapter, setupPrimary } from '@socket.io/cluster-adapter';

if (cluster.isPrimary) {
  const numCPUs = availableParallelism();
  // Create one worker per available core
  for (let i = 0; i < numCPUs; i++) {
    cluster.fork({
      PORT: 3000 + i
    });
  }

  // Set up the adapter on the primary thread to coordinate between workers
  setupPrimary();
} else {
  // --- WORKER THREAD LOGIC ---

  // 1. Open the database inside the worker
  const db = await open({
    filename: 'chat.db',
    driver: sqlite3.Database
  });

  // Enable WAL mode so workers don't lock each other out during writes
  await db.exec('PRAGMA journal_mode = WAL;');

  await db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        client_offset TEXT UNIQUE,
        content TEXT
    );
  `);

  const app = express();
  const server = createServer(app);
  
  // 2. Initialize Socket.IO with the Cluster Adapter
  const io = new Server(server, {
    connectionStateRecovery: {},
    adapter: createAdapter() 
  });

  const __dirname = dirname(fileURLToPath(import.meta.url));

  app.get('/', (req, res) => {
    res.sendFile(join(__dirname, 'index.html'));
  });

  // 3. Socket Logic
  io.on('connection', async (socket) => {
    socket.on('chat message', async (msg, clientOffset, callback) => {
      let result;
      try {
        result = await db.run('INSERT INTO messages (content, client_offset) VALUES (?, ?)', msg, clientOffset);
      } catch (e) {
        if (e.errno === 19 /* SQLITE_CONSTRAINT */ ) {
          callback();
        } 
        return;
      }
      // This broadcast will now reach clients connected to OTHER workers thanks to the adapter
      io.emit('chat message', msg, result.lastID);
      callback();
    });

    if (!socket.recovered) {
      try {
        await db.each('SELECT id, content FROM messages WHERE id > ?',
          [socket.handshake.auth.serverOffset || 0],
          (_err, row) => {
            socket.emit('chat message', row.content, row.id);
          }
        );
      } catch (e) {
        // Handle sync errors
      }
    }
  });

  // 4. Start the server on the assigned port
  const port = process.env.PORT || 3000;
  server.listen(port, () => {
    console.log(`Worker ${process.pid} running at http://localhost:${port}`);
  });
}