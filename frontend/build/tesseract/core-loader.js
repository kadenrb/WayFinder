// Tesseract core loader shim to redirect WASM path
// Ensures the worker looks for '/tesseract/tesseract-core.wasm' (single .wasm)
// instead of the default 'tesseract-core.wasm.wasm'.
/* eslint-disable no-restricted-globals */
(function () {
  self.Module = self.Module || {};
  self.Module.locateFile = function (path) {
    if (typeof path === 'string' && path.toLowerCase().endsWith('.wasm')) {
      return '/tesseract/tesseract-core.wasm';
    }
    // fall back to same folder for any other auxiliary files
    return '/tesseract/' + path;
  };
  importScripts('/tesseract/tesseract-core.wasm.js');
})();

