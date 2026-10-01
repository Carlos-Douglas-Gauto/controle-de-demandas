const path = require('node:path');
const express = require('express');
const cookieParser = require('cookie-parser');

const { Database } = require('./db');
const { createAuthMiddleware } = require('./middleware');
const { createAuthRoutes } = require('./routes/auth.routes');
const { createTaskRoutes } = require('./routes/tasks.routes');
const { createUserRoutes } = require('./routes/users.routes');
const { createMeetingRoutes } = require('./routes/meeting.routes');

function createApp(dbInstance) {
  const app = express();
  const db = dbInstance || new Database();
  const middleware = createAuthMiddleware(db);

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());
  app.use(middleware.attachUser);

  // Serve static assets
  app.use(express.static(path.join(__dirname, '..', 'public')));

  // API Routes
  app.use('/api/auth', createAuthRoutes(db));
  app.use('/api/tasks', createTaskRoutes(db, middleware));
  app.use('/api/users', createUserRoutes(db, middleware));
  app.use('/api/meeting', createMeetingRoutes(db, middleware));

  // SPA fallback
  app.use((req, res, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/api')) {
      return res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
    }
    next();
  });

  // Error handler
  app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).json({ error: 'Erro interno no servidor.' });
  });

  return { app, db };
}

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  const { app } = createApp();
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Mesa de Demandas rodando em http://localhost:${PORT}`);
  });
}

module.exports = {
  createApp
};
