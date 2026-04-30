// backend/src/middleware/auth.js
const { supabase } = require('../utils/supabase');

module.exports = async function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization
  // Also accept token as query param — needed for browser redirects (YouTube OAuth)
  const queryToken = req.query?.token

  const raw = authHeader?.startsWith('Bearer ') ? authHeader.replace('Bearer ', '') : queryToken
  if (!raw) {
    return res.status(401).json({ error: 'Missing or invalid authorization header' })
  }
  const token = raw

  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  // Fetch profile for tier + limits
  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single();

  req.user    = user;
  req.profile = profile;
  req.token   = token;
  next();
};