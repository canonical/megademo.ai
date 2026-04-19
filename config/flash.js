/**
 * Flash message middleware — attaches req.flash() and res.locals.messages
 */
exports.flash = () => (req, res, next) => {
  if (!req.session) return next();

  if (!req.session.flash) req.session.flash = {};

  req.flash = (type, msg) => {
    if (!req.session.flash[type]) req.session.flash[type] = [];
    if (Array.isArray(msg)) {
      req.session.flash[type].push(
        ...msg.map((item) => (item !== null && typeof item === 'object' ? item : { msg: item })),
      );
    } else {
      req.session.flash[type].push(msg !== null && typeof msg === 'object' ? msg : { msg });
    }
  };

  res.locals.messages = req.session.flash;
  req.session.flash = {};
  next();
};
