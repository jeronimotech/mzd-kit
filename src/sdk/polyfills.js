// Minimal polyfills for the CMU's old WebKit (~2014). Kept tiny on purpose.
/* eslint-disable no-extend-native */

if (typeof Object.assign !== 'function') {
  Object.assign = function (target) {
    for (var i = 1; i < arguments.length; i++) {
      var src = arguments[i];
      if (src != null) for (var k in src) if (Object.prototype.hasOwnProperty.call(src, k)) target[k] = src[k];
    }
    return target;
  };
}

if (!Array.prototype.find) {
  Array.prototype.find = function (fn, thisArg) {
    for (var i = 0; i < this.length; i++) if (fn.call(thisArg, this[i], i, this)) return this[i];
    return undefined;
  };
}

if (!Array.prototype.findIndex) {
  Array.prototype.findIndex = function (fn, thisArg) {
    for (var i = 0; i < this.length; i++) if (fn.call(thisArg, this[i], i, this)) return i;
    return -1;
  };
}

if (!Array.prototype.includes) {
  Array.prototype.includes = function (v) { return this.indexOf(v) !== -1; };
}

if (!String.prototype.includes) {
  String.prototype.includes = function (s, pos) { return this.indexOf(s, pos || 0) !== -1; };
}

if (!String.prototype.startsWith) {
  String.prototype.startsWith = function (s, pos) { pos = pos || 0; return this.substr(pos, s.length) === s; };
}

if (!Array.from) {
  Array.from = function (obj, fn) {
    var out = [];
    for (var i = 0; i < obj.length; i++) out.push(fn ? fn(obj[i], i) : obj[i]);
    return out;
  };
}

if (!Date.now) Date.now = function () { return new Date().getTime(); };
