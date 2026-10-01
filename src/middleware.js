function createAuthMiddleware(db) {
  function attachUser(req, res, next) {
    const token = req.cookies?.session_token || req.headers?.authorization?.replace(/^Bearer\s+/i, '');
    if (token) {
      const session = db.getSession(token);
      if (session) {
        req.user = {
          id: session.id,
          name: session.name,
          email: session.email,
          profile: session.profile,
          token: session.token
        };
      }
    }
    next();
  }

  function requireAuth(req, res, next) {
    if (!req.user) {
      return res.status(401).json({ error: 'Autenticação necessária.' });
    }
    next();
  }

  function requireAdmin(req, res, next) {
    if (!req.user) {
      return res.status(401).json({ error: 'Autenticação necessária.' });
    }
    if (req.user.profile !== 'Administrador') {
      return res.status(403).json({ error: 'Acesso restrito para administradores.' });
    }
    next();
  }

  return {
    attachUser,
    requireAuth,
    requireAdmin
  };
}

module.exports = {
  createAuthMiddleware
};
