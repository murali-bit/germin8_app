// Plain JavaScript with no React, so it can be tested with node (frontend/test/apiUrl.test.js).
// '/migrations/1/x' and '/api/migrations/1/x' (a route the server sends whole, e.g. in the Import Wizard) both become
// '/api/migrations/1/x', so a route is never sent as '/api/api/...'.
export const apiUrl = url => `/api${String(url).replace(/^\/api(?=\/)/, '')}`;
