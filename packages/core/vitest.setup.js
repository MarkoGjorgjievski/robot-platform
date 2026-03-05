const Module = require('module');
const path = require('path');
const fs = require('fs');

const originalResolveFilename = Module._resolveFilename;

Module._resolveFilename = function (request, parent, isMain, options) {
  // Try the original resolution first
  try {
    return originalResolveFilename.call(this, request, parent, isMain, options);
  } catch (err) {
    if (err.code !== 'MODULE_NOT_FOUND') throw err;

    // If the request ends with .js, try .ts
    if (request.endsWith('.js')) {
      const tsRequest = request.replace(/\.js$/, '.ts');
      try {
        return originalResolveFilename.call(this, tsRequest, parent, isMain, options);
      } catch {
        // fall through
      }
    }

    // If extensionless, try .ts
    if (request.startsWith('.') && !path.extname(request)) {
      const tsRequest = request + '.ts';
      try {
        return originalResolveFilename.call(this, tsRequest, parent, isMain, options);
      } catch {
        // fall through
      }
    }

    throw err;
  }
};
