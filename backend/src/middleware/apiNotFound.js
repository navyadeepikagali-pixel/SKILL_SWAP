export function apiNotFound(req, res) {
  res.status(404).json({
    success: false,
    message: `API route not found: ${req.method} ${req.path}`
  });
}
