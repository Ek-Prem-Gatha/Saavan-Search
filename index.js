// JioSaavn Search Plugin

(function () {
  "use strict";

  const SOURCE_TYPE     = "jiosaavn";
  const DEBUG           = true;
  const DEFAULT_QUALITY = "320kbps";

  // ── API endpoints ────────────────────────────────────────────────────────────
  const PAX_BASE    = "https://api.paxsenix.org/jiosaavn";
  const VERCEL_BASE = "https://jiosaavn-api-privatecvc2.vercel.app";

  // ── Paxsenix API key helpers — stored in localStorage ───────────────────────
  function getPaxKey() {
    return (localStorage.getItem("jiosaavn_pax_api_key") || "").trim();
  }
  function getPaxAuth() {
    const key = getPaxKey();
    if (!key) return null;
    return key.startsWith("Bearer ") ? key : `Bearer ${key}`;
  }

  // ── Provider preference — stored in localStorage ─────────────────────────────
  // Values: "paxsenix_first" | "direct_first" | "direct_only"
  // Default: "direct_first" (richest data, Paxsenix as reliability fallback)
  const PROVIDER_PREF_KEY = "jiosaavn_provider_pref";
  function getProviderPref() {
    return localStorage.getItem(PROVIDER_PREF_KEY) || "direct_first";
  }
  function setProviderPref(pref) {
    localStorage.setItem(PROVIDER_PREF_KEY, pref);
  }

  // Returns the ordered list of provider tokens to try for any fetch operation.
  // Each call site iterates this and tries providers in order, stopping on success.
  //   "pax"    — Paxsenix API (requires key; skipped silently if no key set)
  //   "direct" — Direct JioSaavn API (always available; DES decryption inlined)
  //   "vercel" — Vercel fallback (last resort; no key needed)
  function getProviderOrder() {
    const pref = getProviderPref();
    if (pref === "paxsenix_first") return ["pax", "direct", "vercel"];
    if (pref === "direct_only")    return ["direct", "vercel"];
    return ["direct", "pax", "vercel"]; // default: direct_first
  }

  // Quality index map for Paxsenix downloadUrl[] array
  // index 0=12kbps 1=48kbps 2=96kbps 3=160kbps 4=320kbps
  const QUALITY_INDEX = { "12kbps": 0, "48kbps": 1, "96kbps": 2, "160kbps": 3, "320kbps": 4 };

  // ── Icons ────────────────────────────────────────────────────────────────────
  const ICONS = {
    search:      `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>`,
    play:        `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>`,
    heart:       `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>`,
    heartOutline:`<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>`,
    download:    `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>`
  };

  // DIRECT JIOSAAVN API MODULE (browser-native, DES decryption via crypto-js)
  
  // ── Direct API endpoint map ──────────────────────────────────────────────────
  const ENDPOINTS = {
    search: {
      all:       'autocomplete.get',
      songs:     'search.getResults',
      albums:    'search.getAlbumResults',
      artists:   'search.getArtistResults',
      playlists: 'search.getPlaylistResults',
    },
    songs: {
      id:          'song.getDetails',
      link:        'webapi.get',
      lyrics:      'lyrics.getLyrics',
      suggestions: 'webradio.getSong',
      station:     'webradio.createEntityStation',
    },
    albums: {
      id:   'content.getAlbumDetails',
      link: 'webapi.get',
    },
    artists: {
      id:     'artist.getArtistPageDetails',
      link:   'webapi.get',
      songs:  'artist.getArtistMoreSong',
      albums: 'artist.getArtistMoreAlbum',
    },
    playlists: {
      id:   'playlist.getDetails',
      link: 'webapi.get',
    },
  };

  const CTX = { WEB: 'web6dot0', ANDROID: 'android' };

  // Rotating user agents
  const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:136.0) Gecko/20100101 Firefox/136.0',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_3_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3.1 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Mobile Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3.1 Safari/605.1.15',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Linux; Android 13; SM-G981B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Mobile Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64; rv:136.0) Gecko/20100101 Firefox/136.0',
  ];


  // ── crypto-js (inlined) ─────────────────────────────────────────────────────
  // Inlined directly to comply with Tauri CSP which blocks external script loads
  // Source: crypto-js 4.2.0, minified with terser
  // Wrapped in a fake global so crypto-js UMD can attach to it
  // (plugin sandboxes may not have window or a real global this)
  // _fetch — set to api.fetch in init() for CORS-free requests via Tauri's native HTTP client
  // falls back to native fetch if api.fetch is not available
  let _fetch = (...args) => fetch(...args);

  const _cryptoJsGlobal = {};
  (function(){const self=_cryptoJsGlobal;const window=_cryptoJsGlobal;const global=_cryptoJsGlobal;const globalThis=_cryptoJsGlobal;
!function(t,e){t.CryptoJS=e()}(_cryptoJsGlobal,function(){var t,e,r,i,n,o,s,a,c=c||function(t){var e;if("undefined"!=typeof window&&window.crypto&&(e=window.crypto),"undefined"!=typeof self&&self.crypto&&(e=self.crypto),"undefined"!=typeof globalThis&&globalThis.crypto&&(e=globalThis.crypto),!e&&"undefined"!=typeof window&&window.msCrypto&&(e=window.msCrypto),!e&&"undefined"!=typeof global&&global.crypto&&(e=global.crypto),!e&&"function"==typeof require)try{e=require("crypto")}catch(t){}var r=function(){if(e){if("function"==typeof e.getRandomValues)try{return e.getRandomValues(new Uint32Array(1))[0]}catch(t){}if("function"==typeof e.randomBytes)try{return e.randomBytes(4).readInt32LE()}catch(t){}}throw new Error("Native crypto module could not be used to get secure random number.")},i=Object.create||function(){function t(){}return function(e){var r;return t.prototype=e,r=new t,t.prototype=null,r}}(),n={},o=n.lib={},s=o.Base={extend:function(t){var e=i(this);return t&&e.mixIn(t),e.hasOwnProperty("init")&&this.init!==e.init||(e.init=function(){e.$super.init.apply(this,arguments)}),e.init.prototype=e,e.$super=this,e},create:function(){var t=this.extend();return t.init.apply(t,arguments),t},init:function(){},mixIn:function(t){for(var e in t)t.hasOwnProperty(e)&&(this[e]=t[e]);t.hasOwnProperty("toString")&&(this.toString=t.toString)},clone:function(){return this.init.prototype.extend(this)}},a=o.WordArray=s.extend({init:function(t,e){t=this.words=t||[],this.sigBytes=null!=e?e:4*t.length},toString:function(t){return(t||h).stringify(this)},concat:function(t){var e=this.words,r=t.words,i=this.sigBytes,n=t.sigBytes;if(this.clamp(),i%4)for(var o=0;o<n;o++){var s=r[o>>>2]>>>24-o%4*8&255;e[i+o>>>2]|=s<<24-(i+o)%4*8}else for(var a=0;a<n;a+=4)e[i+a>>>2]=r[a>>>2];return this.sigBytes+=n,this},clamp:function(){var e=this.words,r=this.sigBytes;e[r>>>2]&=4294967295<<32-r%4*8,e.length=t.ceil(r/4)},clone:function(){var t=s.clone.call(this);return t.words=this.words.slice(0),t},random:function(t){for(var e=[],i=0;i<t;i+=4)e.push(r());return new a.init(e,t)}}),c=n.enc={},h=c.Hex={stringify:function(t){for(var e=t.words,r=t.sigBytes,i=[],n=0;n<r;n++){var o=e[n>>>2]>>>24-n%4*8&255;i.push((o>>>4).toString(16)),i.push((15&o).toString(16))}return i.join("")},parse:function(t){for(var e=t.length,r=[],i=0;i<e;i+=2)r[i>>>3]|=parseInt(t.substr(i,2),16)<<24-i%8*4;return new a.init(r,e/2)}},l=c.Latin1={stringify:function(t){for(var e=t.words,r=t.sigBytes,i=[],n=0;n<r;n++){var o=e[n>>>2]>>>24-n%4*8&255;i.push(String.fromCharCode(o))}return i.join("")},parse:function(t){for(var e=t.length,r=[],i=0;i<e;i++)r[i>>>2]|=(255&t.charCodeAt(i))<<24-i%4*8;return new a.init(r,e)}},f=c.Utf8={stringify:function(t){try{return decodeURIComponent(escape(l.stringify(t)))}catch(t){throw new Error("Malformed UTF-8 data")}},parse:function(t){return l.parse(unescape(encodeURIComponent(t)))}},u=o.BufferedBlockAlgorithm=s.extend({reset:function(){this._data=new a.init,this._nDataBytes=0},_append:function(t){"string"==typeof t&&(t=f.parse(t)),this._data.concat(t),this._nDataBytes+=t.sigBytes},_process:function(e){var r,i=this._data,n=i.words,o=i.sigBytes,s=this.blockSize,c=o/(4*s),h=(c=e?t.ceil(c):t.max((0|c)-this._minBufferSize,0))*s,l=t.min(4*h,o);if(h){for(var f=0;f<h;f+=s)this._doProcessBlock(n,f);r=n.splice(0,h),i.sigBytes-=l}return new a.init(r,l)},clone:function(){var t=s.clone.call(this);return t._data=this._data.clone(),t},_minBufferSize:0}),d=(o.Hasher=u.extend({cfg:s.extend(),init:function(t){this.cfg=this.cfg.extend(t),this.reset()},reset:function(){u.reset.call(this),this._doReset()},update:function(t){return this._append(t),this._process(),this},finalize:function(t){return t&&this._append(t),this._doFinalize()},blockSize:16,_createHelper:function(t){return function(e,r){return new t.init(r).finalize(e)}},_createHmacHelper:function(t){return function(e,r){return new d.HMAC.init(t,r).finalize(e)}}}),n.algo={});return n}(Math);return e=(t=c).lib,r=e.Base,i=e.WordArray,(n=t.x64={}).Word=r.extend({init:function(t,e){this.high=t,this.low=e}}),n.WordArray=r.extend({init:function(t,e){t=this.words=t||[],this.sigBytes=null!=e?e:8*t.length},toX32:function(){for(var t=this.words,e=t.length,r=[],n=0;n<e;n++){var o=t[n];r.push(o.high),r.push(o.low)}return i.create(r,this.sigBytes)},clone:function(){for(var t=r.clone.call(this),e=t.words=this.words.slice(0),i=e.length,n=0;n<i;n++)e[n]=e[n].clone();return t}}),function(){if("function"==typeof ArrayBuffer){var t=c.lib.WordArray,e=t.init,r=t.init=function(t){if(t instanceof ArrayBuffer&&(t=new Uint8Array(t)),(t instanceof Int8Array||"undefined"!=typeof Uint8ClampedArray&&t instanceof Uint8ClampedArray||t instanceof Int16Array||t instanceof Uint16Array||t instanceof Int32Array||t instanceof Uint32Array||t instanceof Float32Array||t instanceof Float64Array)&&(t=new Uint8Array(t.buffer,t.byteOffset,t.byteLength)),t instanceof Uint8Array){for(var r=t.byteLength,i=[],n=0;n<r;n++)i[n>>>2]|=t[n]<<24-n%4*8;e.call(this,i,r)}else e.apply(this,arguments)};r.prototype=t}}(),function(){var t=c,e=t.lib.WordArray,r=t.enc;r.Utf16=r.Utf16BE={stringify:function(t){for(var e=t.words,r=t.sigBytes,i=[],n=0;n<r;n+=2){var o=e[n>>>2]>>>16-n%4*8&65535;i.push(String.fromCharCode(o))}return i.join("")},parse:function(t){for(var r=t.length,i=[],n=0;n<r;n++)i[n>>>1]|=t.charCodeAt(n)<<16-n%2*16;return e.create(i,2*r)}};function i(t){return t<<8&4278255360|t>>>8&16711935}r.Utf16LE={stringify:function(t){for(var e=t.words,r=t.sigBytes,n=[],o=0;o<r;o+=2){var s=i(e[o>>>2]>>>16-o%4*8&65535);n.push(String.fromCharCode(s))}return n.join("")},parse:function(t){for(var r=t.length,n=[],o=0;o<r;o++)n[o>>>1]|=i(t.charCodeAt(o)<<16-o%2*16);return e.create(n,2*r)}}}(),function(){var t=c,e=t.lib.WordArray;t.enc.Base64={stringify:function(t){var e=t.words,r=t.sigBytes,i=this._map;t.clamp();for(var n=[],o=0;o<r;o+=3)for(var s=(e[o>>>2]>>>24-o%4*8&255)<<16|(e[o+1>>>2]>>>24-(o+1)%4*8&255)<<8|e[o+2>>>2]>>>24-(o+2)%4*8&255,a=0;a<4&&o+.75*a<r;a++)n.push(i.charAt(s>>>6*(3-a)&63));var c=i.charAt(64);if(c)for(;n.length%4;)n.push(c);return n.join("")},parse:function(t){var r=t.length,i=this._map,n=this._reverseMap;if(!n){n=this._reverseMap=[];for(var o=0;o<i.length;o++)n[i.charCodeAt(o)]=o}var s=i.charAt(64);if(s){var a=t.indexOf(s);-1!==a&&(r=a)}return function(t,r,i){for(var n=[],o=0,s=0;s<r;s++)if(s%4){var a=i[t.charCodeAt(s-1)]<<s%4*2|i[t.charCodeAt(s)]>>>6-s%4*2;n[o>>>2]|=a<<24-o%4*8,o++}return e.create(n,o)}(t,r,n)},_map:"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/="}}(),function(){var t=c,e=t.lib.WordArray;t.enc.Base64url={stringify:function(t,e){void 0===e&&(e=!0);var r=t.words,i=t.sigBytes,n=e?this._safe_map:this._map;t.clamp();for(var o=[],s=0;s<i;s+=3)for(var a=(r[s>>>2]>>>24-s%4*8&255)<<16|(r[s+1>>>2]>>>24-(s+1)%4*8&255)<<8|r[s+2>>>2]>>>24-(s+2)%4*8&255,c=0;c<4&&s+.75*c<i;c++)o.push(n.charAt(a>>>6*(3-c)&63));var h=n.charAt(64);if(h)for(;o.length%4;)o.push(h);return o.join("")},parse:function(t,r){void 0===r&&(r=!0);var i=t.length,n=r?this._safe_map:this._map,o=this._reverseMap;if(!o){o=this._reverseMap=[];for(var s=0;s<n.length;s++)o[n.charCodeAt(s)]=s}var a=n.charAt(64);if(a){var c=t.indexOf(a);-1!==c&&(i=c)}return function(t,r,i){for(var n=[],o=0,s=0;s<r;s++)if(s%4){var a=i[t.charCodeAt(s-1)]<<s%4*2|i[t.charCodeAt(s)]>>>6-s%4*2;n[o>>>2]|=a<<24-o%4*8,o++}return e.create(n,o)}(t,i,o)},_map:"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=",_safe_map:"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"}}(),function(t){var e=c,r=e.lib,i=r.WordArray,n=r.Hasher,o=e.algo,s=[];!function(){for(var e=0;e<64;e++)s[e]=4294967296*t.abs(t.sin(e+1))|0}();var a=o.MD5=n.extend({_doReset:function(){this._hash=new i.init([1732584193,4023233417,2562383102,271733878])},_doProcessBlock:function(t,e){for(var r=0;r<16;r++){var i=e+r,n=t[i];t[i]=16711935&(n<<8|n>>>24)|4278255360&(n<<24|n>>>8)}var o=this._hash.words,a=t[e+0],c=t[e+1],d=t[e+2],p=t[e+3],_=t[e+4],v=t[e+5],y=t[e+6],g=t[e+7],B=t[e+8],w=t[e+9],k=t[e+10],x=t[e+11],b=t[e+12],m=t[e+13],S=t[e+14],A=t[e+15],z=o[0],H=o[1],C=o[2],R=o[3];z=h(z,H,C,R,a,7,s[0]),R=h(R,z,H,C,c,12,s[1]),C=h(C,R,z,H,d,17,s[2]),H=h(H,C,R,z,p,22,s[3]),z=h(z,H,C,R,_,7,s[4]),R=h(R,z,H,C,v,12,s[5]),C=h(C,R,z,H,y,17,s[6]),H=h(H,C,R,z,g,22,s[7]),z=h(z,H,C,R,B,7,s[8]),R=h(R,z,H,C,w,12,s[9]),C=h(C,R,z,H,k,17,s[10]),H=h(H,C,R,z,x,22,s[11]),z=h(z,H,C,R,b,7,s[12]),R=h(R,z,H,C,m,12,s[13]),C=h(C,R,z,H,S,17,s[14]),z=l(z,H=h(H,C,R,z,A,22,s[15]),C,R,c,5,s[16]),R=l(R,z,H,C,y,9,s[17]),C=l(C,R,z,H,x,14,s[18]),H=l(H,C,R,z,a,20,s[19]),z=l(z,H,C,R,v,5,s[20]),R=l(R,z,H,C,k,9,s[21]),C=l(C,R,z,H,A,14,s[22]),H=l(H,C,R,z,_,20,s[23]),z=l(z,H,C,R,w,5,s[24]),R=l(R,z,H,C,S,9,s[25]),C=l(C,R,z,H,p,14,s[26]),H=l(H,C,R,z,B,20,s[27]),z=l(z,H,C,R,m,5,s[28]),R=l(R,z,H,C,d,9,s[29]),C=l(C,R,z,H,g,14,s[30]),z=f(z,H=l(H,C,R,z,b,20,s[31]),C,R,v,4,s[32]),R=f(R,z,H,C,B,11,s[33]),C=f(C,R,z,H,x,16,s[34]),H=f(H,C,R,z,S,23,s[35]),z=f(z,H,C,R,c,4,s[36]),R=f(R,z,H,C,_,11,s[37]),C=f(C,R,z,H,g,16,s[38]),H=f(H,C,R,z,k,23,s[39]),z=f(z,H,C,R,m,4,s[40]),R=f(R,z,H,C,a,11,s[41]),C=f(C,R,z,H,p,16,s[42]),H=f(H,C,R,z,y,23,s[43]),z=f(z,H,C,R,w,4,s[44]),R=f(R,z,H,C,b,11,s[45]),C=f(C,R,z,H,A,16,s[46]),z=u(z,H=f(H,C,R,z,d,23,s[47]),C,R,a,6,s[48]),R=u(R,z,H,C,g,10,s[49]),C=u(C,R,z,H,S,15,s[50]),H=u(H,C,R,z,v,21,s[51]),z=u(z,H,C,R,b,6,s[52]),R=u(R,z,H,C,p,10,s[53]),C=u(C,R,z,H,k,15,s[54]),H=u(H,C,R,z,c,21,s[55]),z=u(z,H,C,R,B,6,s[56]),R=u(R,z,H,C,A,10,s[57]),C=u(C,R,z,H,y,15,s[58]),H=u(H,C,R,z,m,21,s[59]),z=u(z,H,C,R,_,6,s[60]),R=u(R,z,H,C,x,10,s[61]),C=u(C,R,z,H,d,15,s[62]),H=u(H,C,R,z,w,21,s[63]),o[0]=o[0]+z|0,o[1]=o[1]+H|0,o[2]=o[2]+C|0,o[3]=o[3]+R|0},_doFinalize:function(){var e=this._data,r=e.words,i=8*this._nDataBytes,n=8*e.sigBytes;r[n>>>5]|=128<<24-n%32;var o=t.floor(i/4294967296),s=i;r[15+(n+64>>>9<<4)]=16711935&(o<<8|o>>>24)|4278255360&(o<<24|o>>>8),r[14+(n+64>>>9<<4)]=16711935&(s<<8|s>>>24)|4278255360&(s<<24|s>>>8),e.sigBytes=4*(r.length+1),this._process();for(var a=this._hash,c=a.words,h=0;h<4;h++){var l=c[h];c[h]=16711935&(l<<8|l>>>24)|4278255360&(l<<24|l>>>8)}return a},clone:function(){var t=n.clone.call(this);return t._hash=this._hash.clone(),t}});function h(t,e,r,i,n,o,s){var a=t+(e&r|~e&i)+n+s;return(a<<o|a>>>32-o)+e}function l(t,e,r,i,n,o,s){var a=t+(e&i|r&~i)+n+s;return(a<<o|a>>>32-o)+e}function f(t,e,r,i,n,o,s){var a=t+(e^r^i)+n+s;return(a<<o|a>>>32-o)+e}function u(t,e,r,i,n,o,s){var a=t+(r^(e|~i))+n+s;return(a<<o|a>>>32-o)+e}e.MD5=n._createHelper(a),e.HmacMD5=n._createHmacHelper(a)}(Math),function(){var t=c,e=t.lib,r=e.WordArray,i=e.Hasher,n=t.algo,o=[],s=n.SHA1=i.extend({_doReset:function(){this._hash=new r.init([1732584193,4023233417,2562383102,271733878,3285377520])},_doProcessBlock:function(t,e){for(var r=this._hash.words,i=r[0],n=r[1],s=r[2],a=r[3],c=r[4],h=0;h<80;h++){if(h<16)o[h]=0|t[e+h];else{var l=o[h-3]^o[h-8]^o[h-14]^o[h-16];o[h]=l<<1|l>>>31}var f=(i<<5|i>>>27)+c+o[h];f+=h<20?1518500249+(n&s|~n&a):h<40?1859775393+(n^s^a):h<60?(n&s|n&a|s&a)-1894007588:(n^s^a)-899497514,c=a,a=s,s=n<<30|n>>>2,n=i,i=f}r[0]=r[0]+i|0,r[1]=r[1]+n|0,r[2]=r[2]+s|0,r[3]=r[3]+a|0,r[4]=r[4]+c|0},_doFinalize:function(){var t=this._data,e=t.words,r=8*this._nDataBytes,i=8*t.sigBytes;return e[i>>>5]|=128<<24-i%32,e[14+(i+64>>>9<<4)]=Math.floor(r/4294967296),e[15+(i+64>>>9<<4)]=r,t.sigBytes=4*e.length,this._process(),this._hash},clone:function(){var t=i.clone.call(this);return t._hash=this._hash.clone(),t}});t.SHA1=i._createHelper(s),t.HmacSHA1=i._createHmacHelper(s)}(),function(t){var e=c,r=e.lib,i=r.WordArray,n=r.Hasher,o=e.algo,s=[],a=[];!function(){function e(e){for(var r=t.sqrt(e),i=2;i<=r;i++)if(!(e%i))return!1;return!0}function r(t){return 4294967296*(t-(0|t))|0}for(var i=2,n=0;n<64;)e(i)&&(n<8&&(s[n]=r(t.pow(i,.5))),a[n]=r(t.pow(i,1/3)),n++),i++}();var h=[],l=o.SHA256=n.extend({_doReset:function(){this._hash=new i.init(s.slice(0))},_doProcessBlock:function(t,e){for(var r=this._hash.words,i=r[0],n=r[1],o=r[2],s=r[3],c=r[4],l=r[5],f=r[6],u=r[7],d=0;d<64;d++){if(d<16)h[d]=0|t[e+d];else{var p=h[d-15],_=(p<<25|p>>>7)^(p<<14|p>>>18)^p>>>3,v=h[d-2],y=(v<<15|v>>>17)^(v<<13|v>>>19)^v>>>10;h[d]=_+h[d-7]+y+h[d-16]}var g=i&n^i&o^n&o,B=(i<<30|i>>>2)^(i<<19|i>>>13)^(i<<10|i>>>22),w=u+((c<<26|c>>>6)^(c<<21|c>>>11)^(c<<7|c>>>25))+(c&l^~c&f)+a[d]+h[d];u=f,f=l,l=c,c=s+w|0,s=o,o=n,n=i,i=w+(B+g)|0}r[0]=r[0]+i|0,r[1]=r[1]+n|0,r[2]=r[2]+o|0,r[3]=r[3]+s|0,r[4]=r[4]+c|0,r[5]=r[5]+l|0,r[6]=r[6]+f|0,r[7]=r[7]+u|0},_doFinalize:function(){var e=this._data,r=e.words,i=8*this._nDataBytes,n=8*e.sigBytes;return r[n>>>5]|=128<<24-n%32,r[14+(n+64>>>9<<4)]=t.floor(i/4294967296),r[15+(n+64>>>9<<4)]=i,e.sigBytes=4*r.length,this._process(),this._hash},clone:function(){var t=n.clone.call(this);return t._hash=this._hash.clone(),t}});e.SHA256=n._createHelper(l),e.HmacSHA256=n._createHmacHelper(l)}(Math),function(){var t=c,e=t.lib.WordArray,r=t.algo,i=r.SHA256,n=r.SHA224=i.extend({_doReset:function(){this._hash=new e.init([3238371032,914150663,812702999,4144912697,4290775857,1750603025,1694076839,3204075428])},_doFinalize:function(){var t=i._doFinalize.call(this);return t.sigBytes-=4,t}});t.SHA224=i._createHelper(n),t.HmacSHA224=i._createHmacHelper(n)}(),function(){var t=c,e=t.lib.Hasher,r=t.x64,i=r.Word,n=r.WordArray,o=t.algo;function s(){return i.create.apply(i,arguments)}var a=[s(1116352408,3609767458),s(1899447441,602891725),s(3049323471,3964484399),s(3921009573,2173295548),s(961987163,4081628472),s(1508970993,3053834265),s(2453635748,2937671579),s(2870763221,3664609560),s(3624381080,2734883394),s(310598401,1164996542),s(607225278,1323610764),s(1426881987,3590304994),s(1925078388,4068182383),s(2162078206,991336113),s(2614888103,633803317),s(3248222580,3479774868),s(3835390401,2666613458),s(4022224774,944711139),s(264347078,2341262773),s(604807628,2007800933),s(770255983,1495990901),s(1249150122,1856431235),s(1555081692,3175218132),s(1996064986,2198950837),s(2554220882,3999719339),s(2821834349,766784016),s(2952996808,2566594879),s(3210313671,3203337956),s(3336571891,1034457026),s(3584528711,2466948901),s(113926993,3758326383),s(338241895,168717936),s(666307205,1188179964),s(773529912,1546045734),s(1294757372,1522805485),s(1396182291,2643833823),s(1695183700,2343527390),s(1986661051,1014477480),s(2177026350,1206759142),s(2456956037,344077627),s(2730485921,1290863460),s(2820302411,3158454273),s(3259730800,3505952657),s(3345764771,106217008),s(3516065817,3606008344),s(3600352804,1432725776),s(4094571909,1467031594),s(275423344,851169720),s(430227734,3100823752),s(506948616,1363258195),s(659060556,3750685593),s(883997877,3785050280),s(958139571,3318307427),s(1322822218,3812723403),s(1537002063,2003034995),s(1747873779,3602036899),s(1955562222,1575990012),s(2024104815,1125592928),s(2227730452,2716904306),s(2361852424,442776044),s(2428436474,593698344),s(2756734187,3733110249),s(3204031479,2999351573),s(3329325298,3815920427),s(3391569614,3928383900),s(3515267271,566280711),s(3940187606,3454069534),s(4118630271,4000239992),s(116418474,1914138554),s(174292421,2731055270),s(289380356,3203993006),s(460393269,320620315),s(685471733,587496836),s(852142971,1086792851),s(1017036298,365543100),s(1126000580,2618297676),s(1288033470,3409855158),s(1501505948,4234509866),s(1607167915,987167468),s(1816402316,1246189591)],h=[];!function(){for(var t=0;t<80;t++)h[t]=s()}();var l=o.SHA512=e.extend({_doReset:function(){this._hash=new n.init([new i.init(1779033703,4089235720),new i.init(3144134277,2227873595),new i.init(1013904242,4271175723),new i.init(2773480762,1595750129),new i.init(1359893119,2917565137),new i.init(2600822924,725511199),new i.init(528734635,4215389547),new i.init(1541459225,327033209)])},_doProcessBlock:function(t,e){for(var r=this._hash.words,i=r[0],n=r[1],o=r[2],s=r[3],c=r[4],l=r[5],f=r[6],u=r[7],d=i.high,p=i.low,_=n.high,v=n.low,y=o.high,g=o.low,B=s.high,w=s.low,k=c.high,x=c.low,b=l.high,m=l.low,S=f.high,A=f.low,z=u.high,H=u.low,C=d,R=p,D=_,E=v,M=y,P=g,F=B,W=w,O=k,I=x,U=b,K=m,X=S,L=A,j=z,T=H,N=0;N<80;N++){var q,Z,V=h[N];if(N<16)Z=V.high=0|t[e+2*N],q=V.low=0|t[e+2*N+1];else{var G=h[N-15],J=G.high,Q=G.low,Y=(J>>>1|Q<<31)^(J>>>8|Q<<24)^J>>>7,$=(Q>>>1|J<<31)^(Q>>>8|J<<24)^(Q>>>7|J<<25),tt=h[N-2],et=tt.high,rt=tt.low,it=(et>>>19|rt<<13)^(et<<3|rt>>>29)^et>>>6,nt=(rt>>>19|et<<13)^(rt<<3|et>>>29)^(rt>>>6|et<<26),ot=h[N-7],st=ot.high,at=ot.low,ct=h[N-16],ht=ct.high,lt=ct.low;Z=(Z=(Z=Y+st+((q=$+at)>>>0<$>>>0?1:0))+it+((q+=nt)>>>0<nt>>>0?1:0))+ht+((q+=lt)>>>0<lt>>>0?1:0),V.high=Z,V.low=q}var ft,ut=O&U^~O&X,dt=I&K^~I&L,pt=C&D^C&M^D&M,_t=R&E^R&P^E&P,vt=(C>>>28|R<<4)^(C<<30|R>>>2)^(C<<25|R>>>7),yt=(R>>>28|C<<4)^(R<<30|C>>>2)^(R<<25|C>>>7),gt=(O>>>14|I<<18)^(O>>>18|I<<14)^(O<<23|I>>>9),Bt=(I>>>14|O<<18)^(I>>>18|O<<14)^(I<<23|O>>>9),wt=a[N],kt=wt.high,xt=wt.low,bt=j+gt+((ft=T+Bt)>>>0<T>>>0?1:0),mt=yt+_t;j=X,T=L,X=U,L=K,U=O,K=I,O=F+(bt=(bt=(bt=bt+ut+((ft=ft+dt)>>>0<dt>>>0?1:0))+kt+((ft=ft+xt)>>>0<xt>>>0?1:0))+Z+((ft=ft+q)>>>0<q>>>0?1:0))+((I=W+ft|0)>>>0<W>>>0?1:0)|0,F=M,W=P,M=D,P=E,D=C,E=R,C=bt+(vt+pt+(mt>>>0<yt>>>0?1:0))+((R=ft+mt|0)>>>0<ft>>>0?1:0)|0}p=i.low=p+R,i.high=d+C+(p>>>0<R>>>0?1:0),v=n.low=v+E,n.high=_+D+(v>>>0<E>>>0?1:0),g=o.low=g+P,o.high=y+M+(g>>>0<P>>>0?1:0),w=s.low=w+W,s.high=B+F+(w>>>0<W>>>0?1:0),x=c.low=x+I,c.high=k+O+(x>>>0<I>>>0?1:0),m=l.low=m+K,l.high=b+U+(m>>>0<K>>>0?1:0),A=f.low=A+L,f.high=S+X+(A>>>0<L>>>0?1:0),H=u.low=H+T,u.high=z+j+(H>>>0<T>>>0?1:0)},_doFinalize:function(){var t=this._data,e=t.words,r=8*this._nDataBytes,i=8*t.sigBytes;return e[i>>>5]|=128<<24-i%32,e[30+(i+128>>>10<<5)]=Math.floor(r/4294967296),e[31+(i+128>>>10<<5)]=r,t.sigBytes=4*e.length,this._process(),this._hash.toX32()},clone:function(){var t=e.clone.call(this);return t._hash=this._hash.clone(),t},blockSize:32});t.SHA512=e._createHelper(l),t.HmacSHA512=e._createHmacHelper(l)}(),function(){var t=c,e=t.x64,r=e.Word,i=e.WordArray,n=t.algo,o=n.SHA512,s=n.SHA384=o.extend({_doReset:function(){this._hash=new i.init([new r.init(3418070365,3238371032),new r.init(1654270250,914150663),new r.init(2438529370,812702999),new r.init(355462360,4144912697),new r.init(1731405415,4290775857),new r.init(2394180231,1750603025),new r.init(3675008525,1694076839),new r.init(1203062813,3204075428)])},_doFinalize:function(){var t=o._doFinalize.call(this);return t.sigBytes-=16,t}});t.SHA384=o._createHelper(s),t.HmacSHA384=o._createHmacHelper(s)}(),function(t){var e=c,r=e.lib,i=r.WordArray,n=r.Hasher,o=e.x64.Word,s=e.algo,a=[],h=[],l=[];!function(){for(var t=1,e=0,r=0;r<24;r++){a[t+5*e]=(r+1)*(r+2)/2%64;var i=(2*t+3*e)%5;t=e%5,e=i}for(t=0;t<5;t++)for(e=0;e<5;e++)h[t+5*e]=e+(2*t+3*e)%5*5;for(var n=1,s=0;s<24;s++){for(var c=0,f=0,u=0;u<7;u++){if(1&n){var d=(1<<u)-1;d<32?f^=1<<d:c^=1<<d-32}128&n?n=n<<1^113:n<<=1}l[s]=o.create(c,f)}}();var f=[];!function(){for(var t=0;t<25;t++)f[t]=o.create()}();var u=s.SHA3=n.extend({cfg:n.cfg.extend({outputLength:512}),_doReset:function(){for(var t=this._state=[],e=0;e<25;e++)t[e]=new o.init;this.blockSize=(1600-2*this.cfg.outputLength)/32},_doProcessBlock:function(t,e){for(var r=this._state,i=this.blockSize/2,n=0;n<i;n++){var o=t[e+2*n],s=t[e+2*n+1];o=16711935&(o<<8|o>>>24)|4278255360&(o<<24|o>>>8),s=16711935&(s<<8|s>>>24)|4278255360&(s<<24|s>>>8),(H=r[n]).high^=s,H.low^=o}for(var c=0;c<24;c++){for(var u=0;u<5;u++){for(var d=0,p=0,_=0;_<5;_++){d^=(H=r[u+5*_]).high,p^=H.low}var v=f[u];v.high=d,v.low=p}for(u=0;u<5;u++){var y=f[(u+4)%5],g=f[(u+1)%5],B=g.high,w=g.low;for(d=y.high^(B<<1|w>>>31),p=y.low^(w<<1|B>>>31),_=0;_<5;_++){(H=r[u+5*_]).high^=d,H.low^=p}}for(var k=1;k<25;k++){var x=(H=r[k]).high,b=H.low,m=a[k];m<32?(d=x<<m|b>>>32-m,p=b<<m|x>>>32-m):(d=b<<m-32|x>>>64-m,p=x<<m-32|b>>>64-m);var S=f[h[k]];S.high=d,S.low=p}var A=f[0],z=r[0];A.high=z.high,A.low=z.low;for(u=0;u<5;u++)for(_=0;_<5;_++){var H=r[k=u+5*_],C=f[k],R=f[(u+1)%5+5*_],D=f[(u+2)%5+5*_];H.high=C.high^~R.high&D.high,H.low=C.low^~R.low&D.low}H=r[0];var E=l[c];H.high^=E.high,H.low^=E.low}},_doFinalize:function(){var e=this._data,r=e.words,n=(this._nDataBytes,8*e.sigBytes),o=32*this.blockSize;r[n>>>5]|=1<<24-n%32,r[(t.ceil((n+1)/o)*o>>>5)-1]|=128,e.sigBytes=4*r.length,this._process();for(var s=this._state,a=this.cfg.outputLength/8,c=a/8,h=[],l=0;l<c;l++){var f=s[l],u=f.high,d=f.low;u=16711935&(u<<8|u>>>24)|4278255360&(u<<24|u>>>8),d=16711935&(d<<8|d>>>24)|4278255360&(d<<24|d>>>8),h.push(d),h.push(u)}return new i.init(h,a)},clone:function(){for(var t=n.clone.call(this),e=t._state=this._state.slice(0),r=0;r<25;r++)e[r]=e[r].clone();return t}});e.SHA3=n._createHelper(u),e.HmacSHA3=n._createHmacHelper(u)}(Math),
/** @preserve
	(c) 2012 by Cédric Mesnil. All rights reserved.

	Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:

	    - Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.
	    - Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.

	THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
	*/
function(){var t=c,e=t.lib,r=e.WordArray,i=e.Hasher,n=t.algo,o=r.create([0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,7,4,13,1,10,6,15,3,12,0,9,5,2,14,11,8,3,10,14,4,9,15,8,1,2,7,0,6,13,11,5,12,1,9,11,10,0,8,12,4,13,3,7,15,14,5,6,2,4,0,5,9,7,12,2,10,14,1,3,8,11,6,15,13]),s=r.create([5,14,7,0,9,2,11,4,13,6,15,8,1,10,3,12,6,11,3,7,0,13,5,10,14,15,8,12,4,9,1,2,15,5,1,3,7,14,6,9,11,8,12,2,10,0,4,13,8,6,4,1,3,11,15,0,5,12,2,13,9,7,10,14,12,15,10,4,1,5,8,7,6,2,13,14,0,3,9,11]),a=r.create([11,14,15,12,5,8,7,9,11,13,14,15,6,7,9,8,7,6,8,13,11,9,7,15,7,12,15,9,11,7,13,12,11,13,6,7,14,9,13,15,14,8,13,6,5,12,7,5,11,12,14,15,14,15,9,8,9,14,5,6,8,6,5,12,9,15,5,11,6,8,13,12,5,12,13,14,11,8,5,6]),h=r.create([8,9,9,11,13,15,15,5,7,7,8,11,14,14,12,6,9,13,15,7,12,8,9,11,7,7,12,7,6,15,13,11,9,7,15,11,8,6,6,14,12,13,5,14,13,13,7,5,15,5,8,11,14,14,6,14,6,9,12,9,12,5,15,8,8,5,12,9,12,5,14,6,8,13,6,5,15,13,11,11]),l=r.create([0,1518500249,1859775393,2400959708,2840853838]),f=r.create([1352829926,1548603684,1836072691,2053994217,0]),u=n.RIPEMD160=i.extend({_doReset:function(){this._hash=r.create([1732584193,4023233417,2562383102,271733878,3285377520])},_doProcessBlock:function(t,e){for(var r=0;r<16;r++){var i=e+r,n=t[i];t[i]=16711935&(n<<8|n>>>24)|4278255360&(n<<24|n>>>8)}var c,u,B,w,k,x,b,m,S,A,z,H=this._hash.words,C=l.words,R=f.words,D=o.words,E=s.words,M=a.words,P=h.words;x=c=H[0],b=u=H[1],m=B=H[2],S=w=H[3],A=k=H[4];for(r=0;r<80;r+=1)z=c+t[e+D[r]]|0,z+=r<16?d(u,B,w)+C[0]:r<32?p(u,B,w)+C[1]:r<48?_(u,B,w)+C[2]:r<64?v(u,B,w)+C[3]:y(u,B,w)+C[4],z=(z=g(z|=0,M[r]))+k|0,c=k,k=w,w=g(B,10),B=u,u=z,z=x+t[e+E[r]]|0,z+=r<16?y(b,m,S)+R[0]:r<32?v(b,m,S)+R[1]:r<48?_(b,m,S)+R[2]:r<64?p(b,m,S)+R[3]:d(b,m,S)+R[4],z=(z=g(z|=0,P[r]))+A|0,x=A,A=S,S=g(m,10),m=b,b=z;z=H[1]+B+S|0,H[1]=H[2]+w+A|0,H[2]=H[3]+k+x|0,H[3]=H[4]+c+b|0,H[4]=H[0]+u+m|0,H[0]=z},_doFinalize:function(){var t=this._data,e=t.words,r=8*this._nDataBytes,i=8*t.sigBytes;e[i>>>5]|=128<<24-i%32,e[14+(i+64>>>9<<4)]=16711935&(r<<8|r>>>24)|4278255360&(r<<24|r>>>8),t.sigBytes=4*(e.length+1),this._process();for(var n=this._hash,o=n.words,s=0;s<5;s++){var a=o[s];o[s]=16711935&(a<<8|a>>>24)|4278255360&(a<<24|a>>>8)}return n},clone:function(){var t=i.clone.call(this);return t._hash=this._hash.clone(),t}});function d(t,e,r){return t^e^r}function p(t,e,r){return t&e|~t&r}function _(t,e,r){return(t|~e)^r}function v(t,e,r){return t&r|e&~r}function y(t,e,r){return t^(e|~r)}function g(t,e){return t<<e|t>>>32-e}t.RIPEMD160=i._createHelper(u),t.HmacRIPEMD160=i._createHmacHelper(u)}(Math),function(){var t=c,e=t.lib.Base,r=t.enc.Utf8;t.algo.HMAC=e.extend({init:function(t,e){t=this._hasher=new t.init,"string"==typeof e&&(e=r.parse(e));var i=t.blockSize,n=4*i;e.sigBytes>n&&(e=t.finalize(e)),e.clamp();for(var o=this._oKey=e.clone(),s=this._iKey=e.clone(),a=o.words,c=s.words,h=0;h<i;h++)a[h]^=1549556828,c[h]^=909522486;o.sigBytes=s.sigBytes=n,this.reset()},reset:function(){var t=this._hasher;t.reset(),t.update(this._iKey)},update:function(t){return this._hasher.update(t),this},finalize:function(t){var e=this._hasher,r=e.finalize(t);return e.reset(),e.finalize(this._oKey.clone().concat(r))}})}(),function(){var t=c,e=t.lib,r=e.Base,i=e.WordArray,n=t.algo,o=n.SHA256,s=n.HMAC,a=n.PBKDF2=r.extend({cfg:r.extend({keySize:4,hasher:o,iterations:25e4}),init:function(t){this.cfg=this.cfg.extend(t)},compute:function(t,e){for(var r=this.cfg,n=s.create(r.hasher,t),o=i.create(),a=i.create([1]),c=o.words,h=a.words,l=r.keySize,f=r.iterations;c.length<l;){var u=n.update(e).finalize(a);n.reset();for(var d=u.words,p=d.length,_=u,v=1;v<f;v++){_=n.finalize(_),n.reset();for(var y=_.words,g=0;g<p;g++)d[g]^=y[g]}o.concat(u),h[0]++}return o.sigBytes=4*l,o}});t.PBKDF2=function(t,e,r){return a.create(r).compute(t,e)}}(),function(){var t=c,e=t.lib,r=e.Base,i=e.WordArray,n=t.algo,o=n.MD5,s=n.EvpKDF=r.extend({cfg:r.extend({keySize:4,hasher:o,iterations:1}),init:function(t){this.cfg=this.cfg.extend(t)},compute:function(t,e){for(var r,n=this.cfg,o=n.hasher.create(),s=i.create(),a=s.words,c=n.keySize,h=n.iterations;a.length<c;){r&&o.update(r),r=o.update(t).finalize(e),o.reset();for(var l=1;l<h;l++)r=o.finalize(r),o.reset();s.concat(r)}return s.sigBytes=4*c,s}});t.EvpKDF=function(t,e,r){return s.create(r).compute(t,e)}}(),c.lib.Cipher||function(){var t=c,e=t.lib,r=e.Base,i=e.WordArray,n=e.BufferedBlockAlgorithm,o=t.enc,s=(o.Utf8,o.Base64),a=t.algo.EvpKDF,h=e.Cipher=n.extend({cfg:r.extend(),createEncryptor:function(t,e){return this.create(this._ENC_XFORM_MODE,t,e)},createDecryptor:function(t,e){return this.create(this._DEC_XFORM_MODE,t,e)},init:function(t,e,r){this.cfg=this.cfg.extend(r),this._xformMode=t,this._key=e,this.reset()},reset:function(){n.reset.call(this),this._doReset()},process:function(t){return this._append(t),this._process()},finalize:function(t){return t&&this._append(t),this._doFinalize()},keySize:4,ivSize:4,_ENC_XFORM_MODE:1,_DEC_XFORM_MODE:2,_createHelper:function(){function t(t){return"string"==typeof t?g:v}return function(e){return{encrypt:function(r,i,n){return t(i).encrypt(e,r,i,n)},decrypt:function(r,i,n){return t(i).decrypt(e,r,i,n)}}}}()}),l=(e.StreamCipher=h.extend({_doFinalize:function(){return this._process(!0)},blockSize:1}),t.mode={}),f=e.BlockCipherMode=r.extend({createEncryptor:function(t,e){return this.Encryptor.create(t,e)},createDecryptor:function(t,e){return this.Decryptor.create(t,e)},init:function(t,e){this._cipher=t,this._iv=e}}),u=l.CBC=function(){var t=f.extend();function e(t,e,r){var i,n=this._iv;n?(i=n,this._iv=void 0):i=this._prevBlock;for(var o=0;o<r;o++)t[e+o]^=i[o]}return t.Encryptor=t.extend({processBlock:function(t,r){var i=this._cipher,n=i.blockSize;e.call(this,t,r,n),i.encryptBlock(t,r),this._prevBlock=t.slice(r,r+n)}}),t.Decryptor=t.extend({processBlock:function(t,r){var i=this._cipher,n=i.blockSize,o=t.slice(r,r+n);i.decryptBlock(t,r),e.call(this,t,r,n),this._prevBlock=o}}),t}(),d=(t.pad={}).Pkcs7={pad:function(t,e){for(var r=4*e,n=r-t.sigBytes%r,o=n<<24|n<<16|n<<8|n,s=[],a=0;a<n;a+=4)s.push(o);var c=i.create(s,n);t.concat(c)},unpad:function(t){var e=255&t.words[t.sigBytes-1>>>2];t.sigBytes-=e}},p=(e.BlockCipher=h.extend({cfg:h.cfg.extend({mode:u,padding:d}),reset:function(){var t;h.reset.call(this);var e=this.cfg,r=e.iv,i=e.mode;this._xformMode==this._ENC_XFORM_MODE?t=i.createEncryptor:(t=i.createDecryptor,this._minBufferSize=1),this._mode&&this._mode.__creator==t?this._mode.init(this,r&&r.words):(this._mode=t.call(i,this,r&&r.words),this._mode.__creator=t)},_doProcessBlock:function(t,e){this._mode.processBlock(t,e)},_doFinalize:function(){var t,e=this.cfg.padding;return this._xformMode==this._ENC_XFORM_MODE?(e.pad(this._data,this.blockSize),t=this._process(!0)):(t=this._process(!0),e.unpad(t)),t},blockSize:4}),e.CipherParams=r.extend({init:function(t){this.mixIn(t)},toString:function(t){return(t||this.formatter).stringify(this)}})),_=(t.format={}).OpenSSL={stringify:function(t){var e=t.ciphertext,r=t.salt;return(r?i.create([1398893684,1701076831]).concat(r).concat(e):e).toString(s)},parse:function(t){var e,r=s.parse(t),n=r.words;return 1398893684==n[0]&&1701076831==n[1]&&(e=i.create(n.slice(2,4)),n.splice(0,4),r.sigBytes-=16),p.create({ciphertext:r,salt:e})}},v=e.SerializableCipher=r.extend({cfg:r.extend({format:_}),encrypt:function(t,e,r,i){i=this.cfg.extend(i);var n=t.createEncryptor(r,i),o=n.finalize(e),s=n.cfg;return p.create({ciphertext:o,key:r,iv:s.iv,algorithm:t,mode:s.mode,padding:s.padding,blockSize:t.blockSize,formatter:i.format})},decrypt:function(t,e,r,i){return i=this.cfg.extend(i),e=this._parse(e,i.format),t.createDecryptor(r,i).finalize(e.ciphertext)},_parse:function(t,e){return"string"==typeof t?e.parse(t,this):t}}),y=(t.kdf={}).OpenSSL={execute:function(t,e,r,n,o){if(n||(n=i.random(8)),o)s=a.create({keySize:e+r,hasher:o}).compute(t,n);else var s=a.create({keySize:e+r}).compute(t,n);var c=i.create(s.words.slice(e),4*r);return s.sigBytes=4*e,p.create({key:s,iv:c,salt:n})}},g=e.PasswordBasedCipher=v.extend({cfg:v.cfg.extend({kdf:y}),encrypt:function(t,e,r,i){var n=(i=this.cfg.extend(i)).kdf.execute(r,t.keySize,t.ivSize,i.salt,i.hasher);i.iv=n.iv;var o=v.encrypt.call(this,t,e,n.key,i);return o.mixIn(n),o},decrypt:function(t,e,r,i){i=this.cfg.extend(i),e=this._parse(e,i.format);var n=i.kdf.execute(r,t.keySize,t.ivSize,e.salt,i.hasher);return i.iv=n.iv,v.decrypt.call(this,t,e,n.key,i)}})}(),c.mode.CFB=function(){var t=c.lib.BlockCipherMode.extend();function e(t,e,r,i){var n,o=this._iv;o?(n=o.slice(0),this._iv=void 0):n=this._prevBlock,i.encryptBlock(n,0);for(var s=0;s<r;s++)t[e+s]^=n[s]}return t.Encryptor=t.extend({processBlock:function(t,r){var i=this._cipher,n=i.blockSize;e.call(this,t,r,n,i),this._prevBlock=t.slice(r,r+n)}}),t.Decryptor=t.extend({processBlock:function(t,r){var i=this._cipher,n=i.blockSize,o=t.slice(r,r+n);e.call(this,t,r,n,i),this._prevBlock=o}}),t}(),c.mode.CTR=(o=c.lib.BlockCipherMode.extend(),s=o.Encryptor=o.extend({processBlock:function(t,e){var r=this._cipher,i=r.blockSize,n=this._iv,o=this._counter;n&&(o=this._counter=n.slice(0),this._iv=void 0);var s=o.slice(0);r.encryptBlock(s,0),o[i-1]=o[i-1]+1|0;for(var a=0;a<i;a++)t[e+a]^=s[a]}}),o.Decryptor=s,o),
/** @preserve
	 * Counter block mode compatible with  Dr Brian Gladman fileenc.c
	 * derived from CryptoJS.mode.CTR
	 * Jan Hruby jhruby.web@gmail.com
	 */
c.mode.CTRGladman=function(){var t=c.lib.BlockCipherMode.extend();function e(t){if(255&~(t>>24))t+=1<<24;else{var e=t>>16&255,r=t>>8&255,i=255&t;255===e?(e=0,255===r?(r=0,255===i?i=0:++i):++r):++e,t=0,t+=e<<16,t+=r<<8,t+=i}return t}var r=t.Encryptor=t.extend({processBlock:function(t,r){var i=this._cipher,n=i.blockSize,o=this._iv,s=this._counter;o&&(s=this._counter=o.slice(0),this._iv=void 0),function(t){0===(t[0]=e(t[0]))&&(t[1]=e(t[1]))}(s);var a=s.slice(0);i.encryptBlock(a,0);for(var c=0;c<n;c++)t[r+c]^=a[c]}});return t.Decryptor=r,t}(),c.mode.OFB=function(){var t=c.lib.BlockCipherMode.extend(),e=t.Encryptor=t.extend({processBlock:function(t,e){var r=this._cipher,i=r.blockSize,n=this._iv,o=this._keystream;n&&(o=this._keystream=n.slice(0),this._iv=void 0),r.encryptBlock(o,0);for(var s=0;s<i;s++)t[e+s]^=o[s]}});return t.Decryptor=e,t}(),c.mode.ECB=((a=c.lib.BlockCipherMode.extend()).Encryptor=a.extend({processBlock:function(t,e){this._cipher.encryptBlock(t,e)}}),a.Decryptor=a.extend({processBlock:function(t,e){this._cipher.decryptBlock(t,e)}}),a),c.pad.AnsiX923={pad:function(t,e){var r=t.sigBytes,i=4*e,n=i-r%i,o=r+n-1;t.clamp(),t.words[o>>>2]|=n<<24-o%4*8,t.sigBytes+=n},unpad:function(t){var e=255&t.words[t.sigBytes-1>>>2];t.sigBytes-=e}},c.pad.Iso10126={pad:function(t,e){var r=4*e,i=r-t.sigBytes%r;t.concat(c.lib.WordArray.random(i-1)).concat(c.lib.WordArray.create([i<<24],1))},unpad:function(t){var e=255&t.words[t.sigBytes-1>>>2];t.sigBytes-=e}},c.pad.Iso97971={pad:function(t,e){t.concat(c.lib.WordArray.create([2147483648],1)),c.pad.ZeroPadding.pad(t,e)},unpad:function(t){c.pad.ZeroPadding.unpad(t),t.sigBytes--}},c.pad.ZeroPadding={pad:function(t,e){var r=4*e;t.clamp(),t.sigBytes+=r-(t.sigBytes%r||r)},unpad:function(t){var e=t.words,r=t.sigBytes-1;for(r=t.sigBytes-1;r>=0;r--)if(e[r>>>2]>>>24-r%4*8&255){t.sigBytes=r+1;break}}},c.pad.NoPadding={pad:function(){},unpad:function(){}},function(){var t=c,e=t.lib.CipherParams,r=t.enc.Hex;t.format.Hex={stringify:function(t){return t.ciphertext.toString(r)},parse:function(t){var i=r.parse(t);return e.create({ciphertext:i})}}}(),function(){var t=c,e=t.lib.BlockCipher,r=t.algo,i=[],n=[],o=[],s=[],a=[],h=[],l=[],f=[],u=[],d=[];!function(){for(var t=[],e=0;e<256;e++)t[e]=e<128?e<<1:e<<1^283;var r=0,c=0;for(e=0;e<256;e++){var p=c^c<<1^c<<2^c<<3^c<<4;p=p>>>8^255&p^99,i[r]=p,n[p]=r;var _=t[r],v=t[_],y=t[v],g=257*t[p]^16843008*p;o[r]=g<<24|g>>>8,s[r]=g<<16|g>>>16,a[r]=g<<8|g>>>24,h[r]=g;g=16843009*y^65537*v^257*_^16843008*r;l[p]=g<<24|g>>>8,f[p]=g<<16|g>>>16,u[p]=g<<8|g>>>24,d[p]=g,r?(r=_^t[t[t[y^_]]],c^=t[t[c]]):r=c=1}}();var p=[0,1,2,4,8,16,32,64,128,27,54],_=r.AES=e.extend({_doReset:function(){if(!this._nRounds||this._keyPriorReset!==this._key){for(var t=this._keyPriorReset=this._key,e=t.words,r=t.sigBytes/4,n=4*((this._nRounds=r+6)+1),o=this._keySchedule=[],s=0;s<n;s++)s<r?o[s]=e[s]:(h=o[s-1],s%r?r>6&&s%r==4&&(h=i[h>>>24]<<24|i[h>>>16&255]<<16|i[h>>>8&255]<<8|i[255&h]):(h=i[(h=h<<8|h>>>24)>>>24]<<24|i[h>>>16&255]<<16|i[h>>>8&255]<<8|i[255&h],h^=p[s/r|0]<<24),o[s]=o[s-r]^h);for(var a=this._invKeySchedule=[],c=0;c<n;c++){s=n-c;if(c%4)var h=o[s];else h=o[s-4];a[c]=c<4||s<=4?h:l[i[h>>>24]]^f[i[h>>>16&255]]^u[i[h>>>8&255]]^d[i[255&h]]}}},encryptBlock:function(t,e){this._doCryptBlock(t,e,this._keySchedule,o,s,a,h,i)},decryptBlock:function(t,e){var r=t[e+1];t[e+1]=t[e+3],t[e+3]=r,this._doCryptBlock(t,e,this._invKeySchedule,l,f,u,d,n);r=t[e+1];t[e+1]=t[e+3],t[e+3]=r},_doCryptBlock:function(t,e,r,i,n,o,s,a){for(var c=this._nRounds,h=t[e]^r[0],l=t[e+1]^r[1],f=t[e+2]^r[2],u=t[e+3]^r[3],d=4,p=1;p<c;p++){var _=i[h>>>24]^n[l>>>16&255]^o[f>>>8&255]^s[255&u]^r[d++],v=i[l>>>24]^n[f>>>16&255]^o[u>>>8&255]^s[255&h]^r[d++],y=i[f>>>24]^n[u>>>16&255]^o[h>>>8&255]^s[255&l]^r[d++],g=i[u>>>24]^n[h>>>16&255]^o[l>>>8&255]^s[255&f]^r[d++];h=_,l=v,f=y,u=g}_=(a[h>>>24]<<24|a[l>>>16&255]<<16|a[f>>>8&255]<<8|a[255&u])^r[d++],v=(a[l>>>24]<<24|a[f>>>16&255]<<16|a[u>>>8&255]<<8|a[255&h])^r[d++],y=(a[f>>>24]<<24|a[u>>>16&255]<<16|a[h>>>8&255]<<8|a[255&l])^r[d++],g=(a[u>>>24]<<24|a[h>>>16&255]<<16|a[l>>>8&255]<<8|a[255&f])^r[d++];t[e]=_,t[e+1]=v,t[e+2]=y,t[e+3]=g},keySize:8});t.AES=e._createHelper(_)}(),function(){var t=c,e=t.lib,r=e.WordArray,i=e.BlockCipher,n=t.algo,o=[57,49,41,33,25,17,9,1,58,50,42,34,26,18,10,2,59,51,43,35,27,19,11,3,60,52,44,36,63,55,47,39,31,23,15,7,62,54,46,38,30,22,14,6,61,53,45,37,29,21,13,5,28,20,12,4],s=[14,17,11,24,1,5,3,28,15,6,21,10,23,19,12,4,26,8,16,7,27,20,13,2,41,52,31,37,47,55,30,40,51,45,33,48,44,49,39,56,34,53,46,42,50,36,29,32],a=[1,2,4,6,8,10,12,14,15,17,19,21,23,25,27,28],h=[{0:8421888,268435456:32768,536870912:8421378,805306368:2,1073741824:512,1342177280:8421890,1610612736:8389122,1879048192:8388608,2147483648:514,2415919104:8389120,2684354560:33280,2952790016:8421376,3221225472:32770,3489660928:8388610,3758096384:0,4026531840:33282,134217728:0,402653184:8421890,671088640:33282,939524096:32768,1207959552:8421888,1476395008:512,1744830464:8421378,2013265920:2,2281701376:8389120,2550136832:33280,2818572288:8421376,3087007744:8389122,3355443200:8388610,3623878656:32770,3892314112:514,4160749568:8388608,1:32768,268435457:2,536870913:8421888,805306369:8388608,1073741825:8421378,1342177281:33280,1610612737:512,1879048193:8389122,2147483649:8421890,2415919105:8421376,2684354561:8388610,2952790017:33282,3221225473:514,3489660929:8389120,3758096385:32770,4026531841:0,134217729:8421890,402653185:8421376,671088641:8388608,939524097:512,1207959553:32768,1476395009:8388610,1744830465:2,2013265921:33282,2281701377:32770,2550136833:8389122,2818572289:514,3087007745:8421888,3355443201:8389120,3623878657:0,3892314113:33280,4160749569:8421378},{0:1074282512,16777216:16384,33554432:524288,50331648:1074266128,67108864:1073741840,83886080:1074282496,100663296:1073758208,117440512:16,134217728:540672,150994944:1073758224,167772160:1073741824,184549376:540688,201326592:524304,218103808:0,234881024:16400,251658240:1074266112,8388608:1073758208,25165824:540688,41943040:16,58720256:1073758224,75497472:1074282512,92274688:1073741824,109051904:524288,125829120:1074266128,142606336:524304,159383552:0,176160768:16384,192937984:1074266112,209715200:1073741840,226492416:540672,243269632:1074282496,260046848:16400,268435456:0,285212672:1074266128,301989888:1073758224,318767104:1074282496,335544320:1074266112,352321536:16,369098752:540688,385875968:16384,402653184:16400,419430400:524288,436207616:524304,452984832:1073741840,469762048:540672,486539264:1073758208,503316480:1073741824,520093696:1074282512,276824064:540688,293601280:524288,310378496:1074266112,327155712:16384,343932928:1073758208,360710144:1074282512,377487360:16,394264576:1073741824,411041792:1074282496,427819008:1073741840,444596224:1073758224,461373440:524304,478150656:0,494927872:16400,511705088:1074266128,528482304:540672},{0:260,1048576:0,2097152:67109120,3145728:65796,4194304:65540,5242880:67108868,6291456:67174660,7340032:67174400,8388608:67108864,9437184:67174656,10485760:65792,11534336:67174404,12582912:67109124,13631488:65536,14680064:4,15728640:256,524288:67174656,1572864:67174404,2621440:0,3670016:67109120,4718592:67108868,5767168:65536,6815744:65540,7864320:260,8912896:4,9961472:256,11010048:67174400,12058624:65796,13107200:65792,14155776:67109124,15204352:67174660,16252928:67108864,16777216:67174656,17825792:65540,18874368:65536,19922944:67109120,20971520:256,22020096:67174660,23068672:67108868,24117248:0,25165824:67109124,26214400:67108864,27262976:4,28311552:65792,29360128:67174400,30408704:260,31457280:65796,32505856:67174404,17301504:67108864,18350080:260,19398656:67174656,20447232:0,21495808:65540,22544384:67109120,23592960:256,24641536:67174404,25690112:65536,26738688:67174660,27787264:65796,28835840:67108868,29884416:67109124,30932992:67174400,31981568:4,33030144:65792},{0:2151682048,65536:2147487808,131072:4198464,196608:2151677952,262144:0,327680:4198400,393216:2147483712,458752:4194368,524288:2147483648,589824:4194304,655360:64,720896:2147487744,786432:2151678016,851968:4160,917504:4096,983040:2151682112,32768:2147487808,98304:64,163840:2151678016,229376:2147487744,294912:4198400,360448:2151682112,425984:0,491520:2151677952,557056:4096,622592:2151682048,688128:4194304,753664:4160,819200:2147483648,884736:4194368,950272:4198464,1015808:2147483712,1048576:4194368,1114112:4198400,1179648:2147483712,1245184:0,1310720:4160,1376256:2151678016,1441792:2151682048,1507328:2147487808,1572864:2151682112,1638400:2147483648,1703936:2151677952,1769472:4198464,1835008:2147487744,1900544:4194304,1966080:64,2031616:4096,1081344:2151677952,1146880:2151682112,1212416:0,1277952:4198400,1343488:4194368,1409024:2147483648,1474560:2147487808,1540096:64,1605632:2147483712,1671168:4096,1736704:2147487744,1802240:2151678016,1867776:4160,1933312:2151682048,1998848:4194304,2064384:4198464},{0:128,4096:17039360,8192:262144,12288:536870912,16384:537133184,20480:16777344,24576:553648256,28672:262272,32768:16777216,36864:537133056,40960:536871040,45056:553910400,49152:553910272,53248:0,57344:17039488,61440:553648128,2048:17039488,6144:553648256,10240:128,14336:17039360,18432:262144,22528:537133184,26624:553910272,30720:536870912,34816:537133056,38912:0,43008:553910400,47104:16777344,51200:536871040,55296:553648128,59392:16777216,63488:262272,65536:262144,69632:128,73728:536870912,77824:553648256,81920:16777344,86016:553910272,90112:537133184,94208:16777216,98304:553910400,102400:553648128,106496:17039360,110592:537133056,114688:262272,118784:536871040,122880:0,126976:17039488,67584:553648256,71680:16777216,75776:17039360,79872:537133184,83968:536870912,88064:17039488,92160:128,96256:553910272,100352:262272,104448:553910400,108544:0,112640:553648128,116736:16777344,120832:262144,124928:537133056,129024:536871040},{0:268435464,256:8192,512:270532608,768:270540808,1024:268443648,1280:2097152,1536:2097160,1792:268435456,2048:0,2304:268443656,2560:2105344,2816:8,3072:270532616,3328:2105352,3584:8200,3840:270540800,128:270532608,384:270540808,640:8,896:2097152,1152:2105352,1408:268435464,1664:268443648,1920:8200,2176:2097160,2432:8192,2688:268443656,2944:270532616,3200:0,3456:270540800,3712:2105344,3968:268435456,4096:268443648,4352:270532616,4608:270540808,4864:8200,5120:2097152,5376:268435456,5632:268435464,5888:2105344,6144:2105352,6400:0,6656:8,6912:270532608,7168:8192,7424:268443656,7680:270540800,7936:2097160,4224:8,4480:2105344,4736:2097152,4992:268435464,5248:268443648,5504:8200,5760:270540808,6016:270532608,6272:270540800,6528:270532616,6784:8192,7040:2105352,7296:2097160,7552:0,7808:268435456,8064:268443656},{0:1048576,16:33555457,32:1024,48:1049601,64:34604033,80:0,96:1,112:34603009,128:33555456,144:1048577,160:33554433,176:34604032,192:34603008,208:1025,224:1049600,240:33554432,8:34603009,24:0,40:33555457,56:34604032,72:1048576,88:33554433,104:33554432,120:1025,136:1049601,152:33555456,168:34603008,184:1048577,200:1024,216:34604033,232:1,248:1049600,256:33554432,272:1048576,288:33555457,304:34603009,320:1048577,336:33555456,352:34604032,368:1049601,384:1025,400:34604033,416:1049600,432:1,448:0,464:34603008,480:33554433,496:1024,264:1049600,280:33555457,296:34603009,312:1,328:33554432,344:1048576,360:1025,376:34604032,392:33554433,408:34603008,424:0,440:34604033,456:1049601,472:1024,488:33555456,504:1048577},{0:134219808,1:131072,2:134217728,3:32,4:131104,5:134350880,6:134350848,7:2048,8:134348800,9:134219776,10:133120,11:134348832,12:2080,13:0,14:134217760,15:133152,2147483648:2048,2147483649:134350880,2147483650:134219808,2147483651:134217728,2147483652:134348800,2147483653:133120,2147483654:133152,2147483655:32,2147483656:134217760,2147483657:2080,2147483658:131104,2147483659:134350848,2147483660:0,2147483661:134348832,2147483662:134219776,2147483663:131072,16:133152,17:134350848,18:32,19:2048,20:134219776,21:134217760,22:134348832,23:131072,24:0,25:131104,26:134348800,27:134219808,28:134350880,29:133120,30:2080,31:134217728,2147483664:131072,2147483665:2048,2147483666:134348832,2147483667:133152,2147483668:32,2147483669:134348800,2147483670:134217728,2147483671:134219808,2147483672:134350880,2147483673:134217760,2147483674:134219776,2147483675:0,2147483676:133120,2147483677:2080,2147483678:131104,2147483679:134350848}],l=[4160749569,528482304,33030144,2064384,129024,8064,504,2147483679],f=n.DES=i.extend({_doReset:function(){for(var t=this._key.words,e=[],r=0;r<56;r++){var i=o[r]-1;e[r]=t[i>>>5]>>>31-i%32&1}for(var n=this._subKeys=[],c=0;c<16;c++){var h=n[c]=[],l=a[c];for(r=0;r<24;r++)h[r/6|0]|=e[(s[r]-1+l)%28]<<31-r%6,h[4+(r/6|0)]|=e[28+(s[r+24]-1+l)%28]<<31-r%6;h[0]=h[0]<<1|h[0]>>>31;for(r=1;r<7;r++)h[r]=h[r]>>>4*(r-1)+3;h[7]=h[7]<<5|h[7]>>>27}var f=this._invSubKeys=[];for(r=0;r<16;r++)f[r]=n[15-r]},encryptBlock:function(t,e){this._doCryptBlock(t,e,this._subKeys)},decryptBlock:function(t,e){this._doCryptBlock(t,e,this._invSubKeys)},_doCryptBlock:function(t,e,r){this._lBlock=t[e],this._rBlock=t[e+1],u.call(this,4,252645135),u.call(this,16,65535),d.call(this,2,858993459),d.call(this,8,16711935),u.call(this,1,1431655765);for(var i=0;i<16;i++){for(var n=r[i],o=this._lBlock,s=this._rBlock,a=0,c=0;c<8;c++)a|=h[c][((s^n[c])&l[c])>>>0];this._lBlock=s,this._rBlock=o^a}var f=this._lBlock;this._lBlock=this._rBlock,this._rBlock=f,u.call(this,1,1431655765),d.call(this,8,16711935),d.call(this,2,858993459),u.call(this,16,65535),u.call(this,4,252645135),t[e]=this._lBlock,t[e+1]=this._rBlock},keySize:2,ivSize:2,blockSize:2});function u(t,e){var r=(this._lBlock>>>t^this._rBlock)&e;this._rBlock^=r,this._lBlock^=r<<t}function d(t,e){var r=(this._rBlock>>>t^this._lBlock)&e;this._lBlock^=r,this._rBlock^=r<<t}t.DES=i._createHelper(f);var p=n.TripleDES=i.extend({_doReset:function(){var t=this._key.words;if(2!==t.length&&4!==t.length&&t.length<6)throw new Error("Invalid key length - 3DES requires the key length to be 64, 128, 192 or >192.");var e=t.slice(0,2),i=t.length<4?t.slice(0,2):t.slice(2,4),n=t.length<6?t.slice(0,2):t.slice(4,6);this._des1=f.createEncryptor(r.create(e)),this._des2=f.createEncryptor(r.create(i)),this._des3=f.createEncryptor(r.create(n))},encryptBlock:function(t,e){this._des1.encryptBlock(t,e),this._des2.decryptBlock(t,e),this._des3.encryptBlock(t,e)},decryptBlock:function(t,e){this._des3.decryptBlock(t,e),this._des2.encryptBlock(t,e),this._des1.decryptBlock(t,e)},keySize:6,ivSize:2,blockSize:2});t.TripleDES=i._createHelper(p)}(),function(){var t=c,e=t.lib.StreamCipher,r=t.algo,i=r.RC4=e.extend({_doReset:function(){for(var t=this._key,e=t.words,r=t.sigBytes,i=this._S=[],n=0;n<256;n++)i[n]=n;n=0;for(var o=0;n<256;n++){var s=n%r,a=e[s>>>2]>>>24-s%4*8&255;o=(o+i[n]+a)%256;var c=i[n];i[n]=i[o],i[o]=c}this._i=this._j=0},_doProcessBlock:function(t,e){t[e]^=n.call(this)},keySize:8,ivSize:0});function n(){for(var t=this._S,e=this._i,r=this._j,i=0,n=0;n<4;n++){r=(r+t[e=(e+1)%256])%256;var o=t[e];t[e]=t[r],t[r]=o,i|=t[(t[e]+t[r])%256]<<24-8*n}return this._i=e,this._j=r,i}t.RC4=e._createHelper(i);var o=r.RC4Drop=i.extend({cfg:i.cfg.extend({drop:192}),_doReset:function(){i._doReset.call(this);for(var t=this.cfg.drop;t>0;t--)n.call(this)}});t.RC4Drop=e._createHelper(o)}(),function(){var t=c,e=t.lib.StreamCipher,r=t.algo,i=[],n=[],o=[],s=r.Rabbit=e.extend({_doReset:function(){for(var t=this._key.words,e=this.cfg.iv,r=0;r<4;r++)t[r]=16711935&(t[r]<<8|t[r]>>>24)|4278255360&(t[r]<<24|t[r]>>>8);var i=this._X=[t[0],t[3]<<16|t[2]>>>16,t[1],t[0]<<16|t[3]>>>16,t[2],t[1]<<16|t[0]>>>16,t[3],t[2]<<16|t[1]>>>16],n=this._C=[t[2]<<16|t[2]>>>16,4294901760&t[0]|65535&t[1],t[3]<<16|t[3]>>>16,4294901760&t[1]|65535&t[2],t[0]<<16|t[0]>>>16,4294901760&t[2]|65535&t[3],t[1]<<16|t[1]>>>16,4294901760&t[3]|65535&t[0]];this._b=0;for(r=0;r<4;r++)a.call(this);for(r=0;r<8;r++)n[r]^=i[r+4&7];if(e){var o=e.words,s=o[0],c=o[1],h=16711935&(s<<8|s>>>24)|4278255360&(s<<24|s>>>8),l=16711935&(c<<8|c>>>24)|4278255360&(c<<24|c>>>8),f=h>>>16|4294901760&l,u=l<<16|65535&h;n[0]^=h,n[1]^=f,n[2]^=l,n[3]^=u,n[4]^=h,n[5]^=f,n[6]^=l,n[7]^=u;for(r=0;r<4;r++)a.call(this)}},_doProcessBlock:function(t,e){var r=this._X;a.call(this),i[0]=r[0]^r[5]>>>16^r[3]<<16,i[1]=r[2]^r[7]>>>16^r[5]<<16,i[2]=r[4]^r[1]>>>16^r[7]<<16,i[3]=r[6]^r[3]>>>16^r[1]<<16;for(var n=0;n<4;n++)i[n]=16711935&(i[n]<<8|i[n]>>>24)|4278255360&(i[n]<<24|i[n]>>>8),t[e+n]^=i[n]},blockSize:4,ivSize:2});function a(){for(var t=this._X,e=this._C,r=0;r<8;r++)n[r]=e[r];e[0]=e[0]+1295307597+this._b|0,e[1]=e[1]+3545052371+(e[0]>>>0<n[0]>>>0?1:0)|0,e[2]=e[2]+886263092+(e[1]>>>0<n[1]>>>0?1:0)|0,e[3]=e[3]+1295307597+(e[2]>>>0<n[2]>>>0?1:0)|0,e[4]=e[4]+3545052371+(e[3]>>>0<n[3]>>>0?1:0)|0,e[5]=e[5]+886263092+(e[4]>>>0<n[4]>>>0?1:0)|0,e[6]=e[6]+1295307597+(e[5]>>>0<n[5]>>>0?1:0)|0,e[7]=e[7]+3545052371+(e[6]>>>0<n[6]>>>0?1:0)|0,this._b=e[7]>>>0<n[7]>>>0?1:0;for(r=0;r<8;r++){var i=t[r]+e[r],s=65535&i,a=i>>>16,c=((s*s>>>17)+s*a>>>15)+a*a,h=((4294901760&i)*i|0)+((65535&i)*i|0);o[r]=c^h}t[0]=o[0]+(o[7]<<16|o[7]>>>16)+(o[6]<<16|o[6]>>>16)|0,t[1]=o[1]+(o[0]<<8|o[0]>>>24)+o[7]|0,t[2]=o[2]+(o[1]<<16|o[1]>>>16)+(o[0]<<16|o[0]>>>16)|0,t[3]=o[3]+(o[2]<<8|o[2]>>>24)+o[1]|0,t[4]=o[4]+(o[3]<<16|o[3]>>>16)+(o[2]<<16|o[2]>>>16)|0,t[5]=o[5]+(o[4]<<8|o[4]>>>24)+o[3]|0,t[6]=o[6]+(o[5]<<16|o[5]>>>16)+(o[4]<<16|o[4]>>>16)|0,t[7]=o[7]+(o[6]<<8|o[6]>>>24)+o[5]|0}t.Rabbit=e._createHelper(s)}(),function(){var t=c,e=t.lib.StreamCipher,r=t.algo,i=[],n=[],o=[],s=r.RabbitLegacy=e.extend({_doReset:function(){var t=this._key.words,e=this.cfg.iv,r=this._X=[t[0],t[3]<<16|t[2]>>>16,t[1],t[0]<<16|t[3]>>>16,t[2],t[1]<<16|t[0]>>>16,t[3],t[2]<<16|t[1]>>>16],i=this._C=[t[2]<<16|t[2]>>>16,4294901760&t[0]|65535&t[1],t[3]<<16|t[3]>>>16,4294901760&t[1]|65535&t[2],t[0]<<16|t[0]>>>16,4294901760&t[2]|65535&t[3],t[1]<<16|t[1]>>>16,4294901760&t[3]|65535&t[0]];this._b=0;for(var n=0;n<4;n++)a.call(this);for(n=0;n<8;n++)i[n]^=r[n+4&7];if(e){var o=e.words,s=o[0],c=o[1],h=16711935&(s<<8|s>>>24)|4278255360&(s<<24|s>>>8),l=16711935&(c<<8|c>>>24)|4278255360&(c<<24|c>>>8),f=h>>>16|4294901760&l,u=l<<16|65535&h;i[0]^=h,i[1]^=f,i[2]^=l,i[3]^=u,i[4]^=h,i[5]^=f,i[6]^=l,i[7]^=u;for(n=0;n<4;n++)a.call(this)}},_doProcessBlock:function(t,e){var r=this._X;a.call(this),i[0]=r[0]^r[5]>>>16^r[3]<<16,i[1]=r[2]^r[7]>>>16^r[5]<<16,i[2]=r[4]^r[1]>>>16^r[7]<<16,i[3]=r[6]^r[3]>>>16^r[1]<<16;for(var n=0;n<4;n++)i[n]=16711935&(i[n]<<8|i[n]>>>24)|4278255360&(i[n]<<24|i[n]>>>8),t[e+n]^=i[n]},blockSize:4,ivSize:2});function a(){for(var t=this._X,e=this._C,r=0;r<8;r++)n[r]=e[r];e[0]=e[0]+1295307597+this._b|0,e[1]=e[1]+3545052371+(e[0]>>>0<n[0]>>>0?1:0)|0,e[2]=e[2]+886263092+(e[1]>>>0<n[1]>>>0?1:0)|0,e[3]=e[3]+1295307597+(e[2]>>>0<n[2]>>>0?1:0)|0,e[4]=e[4]+3545052371+(e[3]>>>0<n[3]>>>0?1:0)|0,e[5]=e[5]+886263092+(e[4]>>>0<n[4]>>>0?1:0)|0,e[6]=e[6]+1295307597+(e[5]>>>0<n[5]>>>0?1:0)|0,e[7]=e[7]+3545052371+(e[6]>>>0<n[6]>>>0?1:0)|0,this._b=e[7]>>>0<n[7]>>>0?1:0;for(r=0;r<8;r++){var i=t[r]+e[r],s=65535&i,a=i>>>16,c=((s*s>>>17)+s*a>>>15)+a*a,h=((4294901760&i)*i|0)+((65535&i)*i|0);o[r]=c^h}t[0]=o[0]+(o[7]<<16|o[7]>>>16)+(o[6]<<16|o[6]>>>16)|0,t[1]=o[1]+(o[0]<<8|o[0]>>>24)+o[7]|0,t[2]=o[2]+(o[1]<<16|o[1]>>>16)+(o[0]<<16|o[0]>>>16)|0,t[3]=o[3]+(o[2]<<8|o[2]>>>24)+o[1]|0,t[4]=o[4]+(o[3]<<16|o[3]>>>16)+(o[2]<<16|o[2]>>>16)|0,t[5]=o[5]+(o[4]<<8|o[4]>>>24)+o[3]|0,t[6]=o[6]+(o[5]<<16|o[5]>>>16)+(o[4]<<16|o[4]>>>16)|0,t[7]=o[7]+(o[6]<<8|o[6]>>>24)+o[5]|0}t.RabbitLegacy=e._createHelper(s)}(),function(){var t=c,e=t.lib.BlockCipher,r=t.algo;const i=16,n=[608135816,2242054355,320440878,57701188,2752067618,698298832,137296536,3964562569,1160258022,953160567,3193202383,887688300,3232508343,3380367581,1065670069,3041331479,2450970073,2306472731],o=[[3509652390,2564797868,805139163,3491422135,3101798381,1780907670,3128725573,4046225305,614570311,3012652279,134345442,2240740374,1667834072,1901547113,2757295779,4103290238,227898511,1921955416,1904987480,2182433518,2069144605,3260701109,2620446009,720527379,3318853667,677414384,3393288472,3101374703,2390351024,1614419982,1822297739,2954791486,3608508353,3174124327,2024746970,1432378464,3864339955,2857741204,1464375394,1676153920,1439316330,715854006,3033291828,289532110,2706671279,2087905683,3018724369,1668267050,732546397,1947742710,3462151702,2609353502,2950085171,1814351708,2050118529,680887927,999245976,1800124847,3300911131,1713906067,1641548236,4213287313,1216130144,1575780402,4018429277,3917837745,3693486850,3949271944,596196993,3549867205,258830323,2213823033,772490370,2760122372,1774776394,2652871518,566650946,4142492826,1728879713,2882767088,1783734482,3629395816,2517608232,2874225571,1861159788,326777828,3124490320,2130389656,2716951837,967770486,1724537150,2185432712,2364442137,1164943284,2105845187,998989502,3765401048,2244026483,1075463327,1455516326,1322494562,910128902,469688178,1117454909,936433444,3490320968,3675253459,1240580251,122909385,2157517691,634681816,4142456567,3825094682,3061402683,2540495037,79693498,3249098678,1084186820,1583128258,426386531,1761308591,1047286709,322548459,995290223,1845252383,2603652396,3431023940,2942221577,3202600964,3727903485,1712269319,422464435,3234572375,1170764815,3523960633,3117677531,1434042557,442511882,3600875718,1076654713,1738483198,4213154764,2393238008,3677496056,1014306527,4251020053,793779912,2902807211,842905082,4246964064,1395751752,1040244610,2656851899,3396308128,445077038,3742853595,3577915638,679411651,2892444358,2354009459,1767581616,3150600392,3791627101,3102740896,284835224,4246832056,1258075500,768725851,2589189241,3069724005,3532540348,1274779536,3789419226,2764799539,1660621633,3471099624,4011903706,913787905,3497959166,737222580,2514213453,2928710040,3937242737,1804850592,3499020752,2949064160,2386320175,2390070455,2415321851,4061277028,2290661394,2416832540,1336762016,1754252060,3520065937,3014181293,791618072,3188594551,3933548030,2332172193,3852520463,3043980520,413987798,3465142937,3030929376,4245938359,2093235073,3534596313,375366246,2157278981,2479649556,555357303,3870105701,2008414854,3344188149,4221384143,3956125452,2067696032,3594591187,2921233993,2428461,544322398,577241275,1471733935,610547355,4027169054,1432588573,1507829418,2025931657,3646575487,545086370,48609733,2200306550,1653985193,298326376,1316178497,3007786442,2064951626,458293330,2589141269,3591329599,3164325604,727753846,2179363840,146436021,1461446943,4069977195,705550613,3059967265,3887724982,4281599278,3313849956,1404054877,2845806497,146425753,1854211946],[1266315497,3048417604,3681880366,3289982499,290971e4,1235738493,2632868024,2414719590,3970600049,1771706367,1449415276,3266420449,422970021,1963543593,2690192192,3826793022,1062508698,1531092325,1804592342,2583117782,2714934279,4024971509,1294809318,4028980673,1289560198,2221992742,1669523910,35572830,157838143,1052438473,1016535060,1802137761,1753167236,1386275462,3080475397,2857371447,1040679964,2145300060,2390574316,1461121720,2956646967,4031777805,4028374788,33600511,2920084762,1018524850,629373528,3691585981,3515945977,2091462646,2486323059,586499841,988145025,935516892,3367335476,2599673255,2839830854,265290510,3972581182,2759138881,3795373465,1005194799,847297441,406762289,1314163512,1332590856,1866599683,4127851711,750260880,613907577,1450815602,3165620655,3734664991,3650291728,3012275730,3704569646,1427272223,778793252,1343938022,2676280711,2052605720,1946737175,3164576444,3914038668,3967478842,3682934266,1661551462,3294938066,4011595847,840292616,3712170807,616741398,312560963,711312465,1351876610,322626781,1910503582,271666773,2175563734,1594956187,70604529,3617834859,1007753275,1495573769,4069517037,2549218298,2663038764,504708206,2263041392,3941167025,2249088522,1514023603,1998579484,1312622330,694541497,2582060303,2151582166,1382467621,776784248,2618340202,3323268794,2497899128,2784771155,503983604,4076293799,907881277,423175695,432175456,1378068232,4145222326,3954048622,3938656102,3820766613,2793130115,2977904593,26017576,3274890735,3194772133,1700274565,1756076034,4006520079,3677328699,720338349,1533947780,354530856,688349552,3973924725,1637815568,332179504,3949051286,53804574,2852348879,3044236432,1282449977,3583942155,3416972820,4006381244,1617046695,2628476075,3002303598,1686838959,431878346,2686675385,1700445008,1080580658,1009431731,832498133,3223435511,2605976345,2271191193,2516031870,1648197032,4164389018,2548247927,300782431,375919233,238389289,3353747414,2531188641,2019080857,1475708069,455242339,2609103871,448939670,3451063019,1395535956,2413381860,1841049896,1491858159,885456874,4264095073,4001119347,1565136089,3898914787,1108368660,540939232,1173283510,2745871338,3681308437,4207628240,3343053890,4016749493,1699691293,1103962373,3625875870,2256883143,3830138730,1031889488,3479347698,1535977030,4236805024,3251091107,2132092099,1774941330,1199868427,1452454533,157007616,2904115357,342012276,595725824,1480756522,206960106,497939518,591360097,863170706,2375253569,3596610801,1814182875,2094937945,3421402208,1082520231,3463918190,2785509508,435703966,3908032597,1641649973,2842273706,3305899714,1510255612,2148256476,2655287854,3276092548,4258621189,236887753,3681803219,274041037,1734335097,3815195456,3317970021,1899903192,1026095262,4050517792,356393447,2410691914,3873677099,3682840055],[3913112168,2491498743,4132185628,2489919796,1091903735,1979897079,3170134830,3567386728,3557303409,857797738,1136121015,1342202287,507115054,2535736646,337727348,3213592640,1301675037,2528481711,1895095763,1721773893,3216771564,62756741,2142006736,835421444,2531993523,1442658625,3659876326,2882144922,676362277,1392781812,170690266,3921047035,1759253602,3611846912,1745797284,664899054,1329594018,3901205900,3045908486,2062866102,2865634940,3543621612,3464012697,1080764994,553557557,3656615353,3996768171,991055499,499776247,1265440854,648242737,3940784050,980351604,3713745714,1749149687,3396870395,4211799374,3640570775,1161844396,3125318951,1431517754,545492359,4268468663,3499529547,1437099964,2702547544,3433638243,2581715763,2787789398,1060185593,1593081372,2418618748,4260947970,69676912,2159744348,86519011,2512459080,3838209314,1220612927,3339683548,133810670,1090789135,1078426020,1569222167,845107691,3583754449,4072456591,1091646820,628848692,1613405280,3757631651,526609435,236106946,48312990,2942717905,3402727701,1797494240,859738849,992217954,4005476642,2243076622,3870952857,3732016268,765654824,3490871365,2511836413,1685915746,3888969200,1414112111,2273134842,3281911079,4080962846,172450625,2569994100,980381355,4109958455,2819808352,2716589560,2568741196,3681446669,3329971472,1835478071,660984891,3704678404,4045999559,3422617507,3040415634,1762651403,1719377915,3470491036,2693910283,3642056355,3138596744,1364962596,2073328063,1983633131,926494387,3423689081,2150032023,4096667949,1749200295,3328846651,309677260,2016342300,1779581495,3079819751,111262694,1274766160,443224088,298511866,1025883608,3806446537,1145181785,168956806,3641502830,3584813610,1689216846,3666258015,3200248200,1692713982,2646376535,4042768518,1618508792,1610833997,3523052358,4130873264,2001055236,3610705100,2202168115,4028541809,2961195399,1006657119,2006996926,3186142756,1430667929,3210227297,1314452623,4074634658,4101304120,2273951170,1399257539,3367210612,3027628629,1190975929,2062231137,2333990788,2221543033,2438960610,1181637006,548689776,2362791313,3372408396,3104550113,3145860560,296247880,1970579870,3078560182,3769228297,1714227617,3291629107,3898220290,166772364,1251581989,493813264,448347421,195405023,2709975567,677966185,3703036547,1463355134,2715995803,1338867538,1343315457,2802222074,2684532164,233230375,2599980071,2000651841,3277868038,1638401717,4028070440,3237316320,6314154,819756386,300326615,590932579,1405279636,3267499572,3150704214,2428286686,3959192993,3461946742,1862657033,1266418056,963775037,2089974820,2263052895,1917689273,448879540,3550394620,3981727096,150775221,3627908307,1303187396,508620638,2975983352,2726630617,1817252668,1876281319,1457606340,908771278,3720792119,3617206836,2455994898,1729034894,1080033504],[976866871,3556439503,2881648439,1522871579,1555064734,1336096578,3548522304,2579274686,3574697629,3205460757,3593280638,3338716283,3079412587,564236357,2993598910,1781952180,1464380207,3163844217,3332601554,1699332808,1393555694,1183702653,3581086237,1288719814,691649499,2847557200,2895455976,3193889540,2717570544,1781354906,1676643554,2592534050,3230253752,1126444790,2770207658,2633158820,2210423226,2615765581,2414155088,3127139286,673620729,2805611233,1269405062,4015350505,3341807571,4149409754,1057255273,2012875353,2162469141,2276492801,2601117357,993977747,3918593370,2654263191,753973209,36408145,2530585658,25011837,3520020182,2088578344,530523599,2918365339,1524020338,1518925132,3760827505,3759777254,1202760957,3985898139,3906192525,674977740,4174734889,2031300136,2019492241,3983892565,4153806404,3822280332,352677332,2297720250,60907813,90501309,3286998549,1016092578,2535922412,2839152426,457141659,509813237,4120667899,652014361,1966332200,2975202805,55981186,2327461051,676427537,3255491064,2882294119,3433927263,1307055953,942726286,933058658,2468411793,3933900994,4215176142,1361170020,2001714738,2830558078,3274259782,1222529897,1679025792,2729314320,3714953764,1770335741,151462246,3013232138,1682292957,1483529935,471910574,1539241949,458788160,3436315007,1807016891,3718408830,978976581,1043663428,3165965781,1927990952,4200891579,2372276910,3208408903,3533431907,1412390302,2931980059,4132332400,1947078029,3881505623,4168226417,2941484381,1077988104,1320477388,886195818,18198404,3786409e3,2509781533,112762804,3463356488,1866414978,891333506,18488651,661792760,1628790961,3885187036,3141171499,876946877,2693282273,1372485963,791857591,2686433993,3759982718,3167212022,3472953795,2716379847,445679433,3561995674,3504004811,3574258232,54117162,3331405415,2381918588,3769707343,4154350007,1140177722,4074052095,668550556,3214352940,367459370,261225585,2610173221,4209349473,3468074219,3265815641,314222801,3066103646,3808782860,282218597,3406013506,3773591054,379116347,1285071038,846784868,2669647154,3771962079,3550491691,2305946142,453669953,1268987020,3317592352,3279303384,3744833421,2610507566,3859509063,266596637,3847019092,517658769,3462560207,3443424879,370717030,4247526661,2224018117,4143653529,4112773975,2788324899,2477274417,1456262402,2901442914,1517677493,1846949527,2295493580,3734397586,2176403920,1280348187,1908823572,3871786941,846861322,1172426758,3287448474,3383383037,1655181056,3139813346,901632758,1897031941,2986607138,3066810236,3447102507,1393639104,373351379,950779232,625454576,3124240540,4148612726,2007998917,544563296,2244738638,2330496472,2058025392,1291430526,424198748,50039436,29584100,3605783033,2429876329,2791104160,1057563949,3255363231,3075367218,3463963227,1469046755,985887462]];var s={pbox:[],sbox:[]};function a(t,e){let r=e>>24&255,i=e>>16&255,n=e>>8&255,o=255&e,s=t.sbox[0][r]+t.sbox[1][i];return s^=t.sbox[2][n],s+=t.sbox[3][o],s}function h(t,e,r){let n,o=e,s=r;for(let e=0;e<i;++e)o^=t.pbox[e],s=a(t,o)^s,n=o,o=s,s=n;return n=o,o=s,s=n,s^=t.pbox[i],o^=t.pbox[17],{left:o,right:s}}var l=r.Blowfish=e.extend({_doReset:function(){if(this._keyPriorReset!==this._key){var t=this._keyPriorReset=this._key,e=t.words,r=t.sigBytes/4;!function(t,e,r){for(let e=0;e<4;e++){t.sbox[e]=[];for(let r=0;r<256;r++)t.sbox[e][r]=o[e][r]}let i=0;for(let o=0;o<18;o++)t.pbox[o]=n[o]^e[i],i++,i>=r&&(i=0);let s=0,a=0,c=0;for(let e=0;e<18;e+=2)c=h(t,s,a),s=c.left,a=c.right,t.pbox[e]=s,t.pbox[e+1]=a;for(let e=0;e<4;e++)for(let r=0;r<256;r+=2)c=h(t,s,a),s=c.left,a=c.right,t.sbox[e][r]=s,t.sbox[e][r+1]=a}(s,e,r)}},encryptBlock:function(t,e){var r=h(s,t[e],t[e+1]);t[e]=r.left,t[e+1]=r.right},decryptBlock:function(t,e){var r=function(t,e,r){let i,n=e,o=r;for(let e=17;e>1;--e)n^=t.pbox[e],o=a(t,n)^o,i=n,n=o,o=i;return i=n,n=o,o=i,o^=t.pbox[1],n^=t.pbox[0],{left:n,right:o}}(s,t[e],t[e+1]);t[e]=r.left,t[e+1]=r.right},blockSize:2,keySize:4,ivSize:2});t.Blowfish=e._createHelper(l)}(),c});
  })();
  function loadCryptoJs() {
    // already inlined above — just return resolved promise
    return Promise.resolve(_cryptoJsGlobal.CryptoJS);
  }


  // ── fetch helper ────────────────────────────────────────────────────────────
  // Builds the jiosaavn.com/api.php URL and calls it
  // Uses a random UA per request
  async function jiosaavn_fetch(endpoint, params = {}, context = CTX.WEB) {
    const url = new URL('https://www.jiosaavn.com/api.php');
    url.searchParams.append('__call',      endpoint);
    url.searchParams.append('_format',     'json');
    url.searchParams.append('_marker',     '0');
    url.searchParams.append('api_version', '4');
    url.searchParams.append('ctx',         context);
    Object.entries(params).forEach(([k, v]) => url.searchParams.append(k, String(v)));

    const ua  = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
    const res = await _fetch(url.toString(), {
      headers: {
        'User-Agent':      ua,
        'Content-Type':    'application/json',
        'Accept':          'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer':         'https://www.jiosaavn.com/',
      }
    });
    return res.json();
  }

  // ── DES decryption ──────────────────────────────────────────────────────────
  // Algorithm: DES-ECB, PKCS7 padding
  // Returns all 5 quality variants at once: 12/48/96/160/320kbps
  async function create_download_links(encrypted_media_url) {
    if (!encrypted_media_url) return [];
    const CryptoJS = await loadCryptoJs();

    const qualities = [
      { id: '_12',  bitrate: '12kbps'  },
      { id: '_48',  bitrate: '48kbps'  },
      { id: '_96',  bitrate: '96kbps'  },
      { id: '_160', bitrate: '160kbps' },
      { id: '_320', bitrate: '320kbps' },
    ];

    const key       = CryptoJS.enc.Utf8.parse('38346591');
    const encrypted = CryptoJS.enc.Base64.parse(encrypted_media_url.trim());
    const decrypted = CryptoJS.DES.decrypt(
      { ciphertext: encrypted },
      key,
      { mode: CryptoJS.mode.ECB, padding: CryptoJS.pad.Pkcs7 }
    );
    const decryptedUrl = decrypted.toString(CryptoJS.enc.Utf8);

    // base decrypted url always ends in _96.mp4 — replace for each quality
    // also fix http:// → https://
    return qualities.map(q => ({
      quality: q.bitrate,
      url: decryptedUrl
        .replace('_96', q.id)
        .replace(/^http:\/\//, 'https://')
    }));
  }

  // ── image links ─────────────────────────────────────────────────────────────
  // Returns 3 size variants from the base 150x150 url
  function create_image_links(image_url) {
    if (!image_url) return [];
    const sizes = ['50x50', '150x150', '500x500'];
    return sizes.map(size => ({
      quality: size,
      url: image_url
        .replace(/150x150|50x50/, size)
        .replace(/^http:\/\//, 'https://')
    }));
  }

  // ── html entity cleaner ─────────────────────────────────────────────────────
  function clean_html(str) {
    if (!str) return str;
    return str
      .replace(/&quot;/g, "'")
      .replace(/&amp;/g, '&')
      .replace(/&#039;/g, "'");
  }

  // ── format helpers ──────────────────────────────────────────────────────────
  function format_artist_map(a) {
    return {
      id:    a.id,
      name:  clean_html(a.name),
      url:   a.perma_url,
      image: create_image_links(a.image),
      type:  a.type,
      role:  a.role,
    };
  }

  // format_song is async because create_download_links is async (loads crypto-js)
  async function format_song(song) {
    if (!song) return null;
    return {
      id:           song.id,
      name:         clean_html(song.title || song.song),
      type:         song.type,
      year:         song.year          || null,
      release_date: song.more_info?.release_date || null,
      duration:     song.more_info?.duration ? Number(song.more_info.duration) : null,
      label:        song.more_info?.label    || null,
      explicit:     song.explicit_content === '1',
      play_count:   song.play_count ? Number(song.play_count) : null,
      language:     song.language,
      has_lyrics:   song.more_info?.has_lyrics === 'true',
      lyrics_id:    song.more_info?.lyrics_id || null,
      url:          song.perma_url,
      copyright:    clean_html(song.more_info?.copyright_text) || null,
      album: {
        id:   song.more_info?.album_id  || null,
        name: clean_html(song.more_info?.album) || null,
        url:  song.more_info?.album_url || null,
      },
      artists: {
        primary:  (song.more_info?.artistMap?.primary_artists  || []).map(format_artist_map),
        featured: (song.more_info?.artistMap?.featured_artists || []).map(format_artist_map),
        all:      (song.more_info?.artistMap?.artists          || []).map(format_artist_map),
      },
      image:        create_image_links(song.image),
      download_url: await create_download_links(song.more_info?.encrypted_media_url),
      // highest quality actually available — JioSaavn sets more_info['320kbps'] = 'true'/'false'
      highest_quality: song.more_info?.['320kbps'] === 'true' ? '320kbps' : '160kbps',
    };
  }

  async function format_album(album) {
    if (!album) return null;
    const songs = await Promise.all((album.list || album.songs || []).map(format_song));
    return {
      id:          album.id,
      name:        clean_html(album.title),
      description: album.header_desc || null,
      type:        album.type,
      year:        album.year ? Number(album.year) : null,
      play_count:  album.play_count ? Number(album.play_count) : null,
      language:    album.language,
      explicit:    album.explicit_content === '1',
      url:         album.perma_url,
      song_count:  album.more_info?.song_count ? Number(album.more_info.song_count) : null,
      artists: {
        primary:  (album.more_info?.artistMap?.primary_artists  || []).map(format_artist_map),
        featured: (album.more_info?.artistMap?.featured_artists || []).map(format_artist_map),
        all:      (album.more_info?.artistMap?.artists          || []).map(format_artist_map),
      },
      image: create_image_links(album.image),
      songs,
    };
  }

  async function format_artist(artist) {
    if (!artist) return null;
    const top_songs  = await Promise.all((artist.topSongs  || []).map(format_song));
    const top_albums = await Promise.all((artist.topAlbums || []).map(s => format_album(s)));
    const singles    = await Promise.all((artist.singles   || []).map(a => format_album(a)));

    // Normalize a raw playlist card (dedicated or featured).
    // image is a flat 150x150 string — run through create_image_links for consistency.
    const fmt_playlist = p => ({
      id:        String(p.id),
      title:     clean_html(p.title)    || 'Unknown Playlist',
      subtitle:  clean_html(p.subtitle) || '',
      songCount: p.more_info?.song_count ? Number(p.more_info.song_count) : null,
      language:  p.more_info?.language  || null,
      image:     create_image_links(p.image),
      type:      'playlist',
    });

    // latest_release items are raw album cards (same shape as getArtistMoreAlbums).
    // Normalize inline — no tracks present, just the card metadata.
    const fmt_latest = a => {
      const primary = (a.more_info?.artistMap?.primary_artists || []);
      return {
        id:        String(a.id),
        name:      clean_html(a.title) || 'Unknown',
        year:      a.year  || null,
        language:  a.language || null,
        song_count: a.more_info?.song_count ? Number(a.more_info.song_count) : null,
        artists:   { primary: primary.map(format_artist_map) },
        image:     create_image_links(a.image),
        type:      'album',
      };
    };

    return {
      id:                  artist.artistId || artist.id,
      name:                clean_html(artist.name),
      url:                 artist.urls?.overview || artist.perma_url,
      type:                artist.type,
      follower_count:      artist.follower_count ? Number(artist.follower_count) : null,
      fan_count:           artist.fan_count      || null,
      is_verified:         artist.isVerified     || null,
      dominant_language:   artist.dominantLanguage || null,
      dominant_type:       artist.dominantType   || null,
      bio:                 artist.bio ? JSON.parse(artist.bio) : null,
      dob:                 artist.dob    || null,
      fb:                  artist.fb     || null,
      twitter:             artist.twitter || null,
      wiki:                artist.wiki   || null,
      available_languages: artist.availableLanguages || null,
      is_radio_present:    artist.isRadioPresent || null,
      image:               create_image_links(artist.image),
      top_songs,
      top_albums,
      singles,
      dedicated_playlists: (artist.dedicated_artist_playlist || []).map(fmt_playlist),
      featured_playlists:  (artist.featured_artist_playlist  || []).map(fmt_playlist),
      latest_release:      (artist.latest_release            || []).map(fmt_latest),
      similar_artists: (artist.similarArtists || []).map(s => ({
        id:               s.id,
        name:             clean_html(s.name),
        url:              s.perma_url,
        image:            create_image_links(s.image_url), // note: image_url not image
        languages:        s.languages ? JSON.parse(s.languages) : null,
        similar_artists:  s.similar   ? JSON.parse(s.similar)   : null,
        wiki:             s.wiki,
        dob:              s.dob,
        fb:               s.fb,
        twitter:          s.twitter,
        is_radio_present: s.isRadioPresent,
        type:             s.type,
        dominant_type:    s.dominantType,
        aka:              s.aka,
        bio:              s.bio ? JSON.parse(s.bio) : null,
      })),
    };
  }

  // ── public API functions ─────────────────────────────────────────────────────

  const JioSaavnAPI = {

    async search_songs(query, page = 0, limit = 10) {
      const data = await jiosaavn_fetch(ENDPOINTS.search.songs, { q: query, p: page, n: limit });
      const results = await Promise.all((data.results || []).map(format_song));
      return { total: data.total, start: data.start, results: results.filter(Boolean).slice(0, limit) };
    },

    async search_albums(query, page = 0, limit = 10) {
      const data = await jiosaavn_fetch(ENDPOINTS.search.albums, { q: query, p: page, n: limit });
      return {
        total:   Number(data.total),
        start:   Number(data.start),
        results: (data.results || []).map(item => {
          const primaryArtists = (item.more_info?.artistMap?.primary_artists || []).map(format_artist_map);
          return {
            id:       item.id,
            name:     clean_html(item.title),
            type:     item.type,
            url:      item.perma_url,
            year:     item.year ? Number(item.year) : null,
            language: item.language,
            explicit: item.explicit_content === '1',
            image:    create_image_links(item.image),
            // fall back to more_info.music string when primary_artists array is empty
            music:    primaryArtists.length ? null : clean_html(item.more_info?.music) || null,
            artists: {
              primary:  primaryArtists,
              featured: (item.more_info?.artistMap?.featured_artists || []).map(format_artist_map),
              all:      (item.more_info?.artistMap?.artists          || []).map(format_artist_map),
            },
          };
        }),
      };
    },

    async search_playlists(query, page = 0, limit = 10) {
      const data = await jiosaavn_fetch(ENDPOINTS.search.playlists, { q: query, p: page, n: limit });
      return {
        total:   Number(data.total),
        start:   Number(data.start),
        results: (data.results || []).map(item => ({
          id:        item.id,
          title:     clean_html(item.title),
          type:      'playlist',
          image:     create_image_links(item.image),
          songCount: item.more_info?.song_count ? Number(item.more_info.song_count) : null,
          language:  item.more_info?.language   || null,
          subtitle:  clean_html(item.subtitle)  || null,
        })),
      };
    },

    async search_artists(query, page = 0, limit = 10) {
      const data = await jiosaavn_fetch(ENDPOINTS.search.artists, { q: query, p: page, n: limit });
      return {
        total:   Number(data.total),
        start:   Number(data.start),
        // entity=0 entries are auto-generated collaboration combos (e.g. "Pritam & Arijit Singh")
        // entity=1 are real individual/group artists — only show those
        results: (data.results || [])
          .filter(item => item.entity === 1)
          .map(item => ({
            id:    item.id,
            name:  clean_html(item.name),
            type:  item.type,
            image: create_image_links(item.image),
            url:   item.perma_url,
          })),
      };
    },

    async get_song(id) {
      const data = await jiosaavn_fetch(ENDPOINTS.songs.id, { pids: id });
      // response is { songs: Array[1], modules: object }
      const song = data.songs?.[0] || data[id];
      return format_song(song);
    },

    async get_album(album_id) {
      const data = await jiosaavn_fetch(ENDPOINTS.albums.id, { albumid: album_id });
      return format_album(data);
    },

    // Playlist response: top-level has id, title, image (flat string), list_count,
    // list[] (raw songs — same shape as artist topSongs, needs format_song),
    // more_info.firstname/lastname (curator), more_info.follower_count.
    async get_playlist(playlist_id) {
      const data = await jiosaavn_fetch(ENDPOINTS.playlists.id, { listid: playlist_id });
      const songs = await Promise.all((data.list || []).map(format_song));
      return {
        id:            String(data.id),
        title:         clean_html(data.title)       || 'Unknown Playlist',
        description:   data.header_desc             || null,
        image:         create_image_links(data.image),
        song_count:    data.list_count ? Number(data.list_count) : songs.length,
        language:      data.language               || null,
        curator:       data.more_info?.firstname
                         ? `${data.more_info.firstname} ${data.more_info.lastname || ''}`.trim()
                         : null,
        follower_count: data.more_info?.follower_count
                         ? Number(data.more_info.follower_count) : null,
        songs:         songs.filter(Boolean),
      };
    },

    async get_artist(artist_id, options = {}) {
      const { page = 0, song_count = 10, album_count = 10, sort_by = 'popularity', sort_order = 'desc' } = options;
      const data = await jiosaavn_fetch(ENDPOINTS.artists.id, {
        artistId: artist_id, n_song: song_count, n_album: album_count,
        page, sort_order, category: sort_by,
      });
      return format_artist(data);
    },

    // Paginated songs for an artist — response: { topSongs: { songs[], total, last_page } }
    // songs[] are raw JioSaavn song objects (same shape as topSongs in get_artist)
    async get_artist_more_songs(artist_id, page = 0, n_song = 10, sort_by = 'popularity', sort_order = 'desc') {
      const data = await jiosaavn_fetch(ENDPOINTS.artists.songs, {
        artistId: artist_id, page, n_song, category: sort_by, sort_order,
      });
      const songs = await Promise.all((data.topSongs?.songs || []).map(format_song));
      return {
        songs:     songs.filter(Boolean),
        total:     data.topSongs?.total     || 0,
        last_page: data.topSongs?.last_page ?? true,
      };
    },

    // Paginated albums for an artist — response: { topAlbums: { albums[], total, last_page } }
    // albums[] are raw JioSaavn album objects — note: artist info lives in more_info.artistMap,
    // and more_info.song_count holds the track count. format_album expects a list/songs array
    // which is absent here (we only get the album card, not its tracks), so we normalize manually.
    async get_artist_more_albums(artist_id, page = 0, n_album = 10, sort_by = 'popularity', sort_order = 'desc') {
      const data = await jiosaavn_fetch(ENDPOINTS.artists.albums, {
        artistId: artist_id, page, n_album, category: sort_by, sort_order,
      });
      const raw_albums = data.topAlbums?.albums || [];
      // Normalize each raw album card into our shared album shape
      const albums = raw_albums.map(a => {
        const primaryArtists = (a.more_info?.artistMap?.primary_artists || []);
        const artist   = primaryArtists.map(x => x.name).join(', ') || a.more_info?.music || 'Unknown Artist';
        const artistId = primaryArtists[0]?.id || null;
        const image    = create_image_links(a.image);
        return {
          id:        String(a.id),
          name:      a.title || 'Unknown Album',
          year:      a.year  || null,
          language:  a.language || null,
          song_count: a.more_info?.song_count ? Number(a.more_info.song_count) : null,
          artists:   { primary: primaryArtists },
          image,
          _raw_more_info: a.more_info,
        };
      });
      return {
        albums:    albums,
        total:     data.topAlbums?.total     || 0,
        last_page: data.topAlbums?.last_page ?? true,
      };
    },

    async get_lyrics(song_id) {
      const data = await jiosaavn_fetch(ENDPOINTS.songs.lyrics, { lyrics_id: song_id });
      return data.lyrics || null;
    },

    async get_song_suggestions(song_id, limit = 10) {
      // Step 1: create radio station (requires android context)
      const entity_id = JSON.stringify([encodeURIComponent(song_id)]);
      const stationData = await jiosaavn_fetch(
        ENDPOINTS.songs.station,
        { entity_id, entity_type: 'queue' },
        CTX.ANDROID
      );
      if (!stationData?.stationid) return [];

      // Step 2: get suggestions from station (also requires android context)
      const data = await jiosaavn_fetch(
        ENDPOINTS.songs.suggestions,
        { stationid: stationData.stationid, k: limit },
        CTX.ANDROID
      );
      // response is flat object: { stationid, '0': { song: {...} }, '1': {...} }
      const { stationid, ...entries } = data;
      const songs = await Promise.all(
        Object.values(entries)
          .filter(e => e?.song)
          .map(e => format_song(e.song))
      );
      return songs.filter(Boolean).slice(0, limit);
    },
  };


  // ═══════════════════════════════════════════════════════════════════════════
  // UNIFIED RESPONSE NORMALIZERS
  // Handles all three source shapes:
  //   Paxsenix:  t.downloadUrl[].{quality,link|url}, t.artists.primary[]
  //   Direct:    t.download_url[].{quality,url}, t.artists.primary[], t.highest_quality
  //   Vercel:    t.downloadUrl[].{quality,link|url}, t.primaryArtists (string)
  // ═══════════════════════════════════════════════════════════════════════════

  function normalizeTrack(t, albumFallback = {}) {
    // ── Artists ──────────────────────────────────────────────────────────────
    const primaryArtists  = t.artists?.primary || [];
    const featuredArtists = (t.artists?.featured || []).filter(a => a.id);
    const artist = primaryArtists.length
      ? [...primaryArtists, ...featuredArtists].map(a => a.name).join(", ")
      : (t.primaryArtists || "Unknown Artist");
    const artistId = primaryArtists.length
      ? (primaryArtists[0]?.id || null)
      : (t.primaryArtistsId ? String(t.primaryArtistsId).split(",")[0].trim() : null);
    // Artist image — available on Paxsenix and Direct structures
    const artistImage = (primaryArtists[0]?.image || [])[2]?.url
                     || (primaryArtists[0]?.image || [])[1]?.url || "";

    // ── Cover image ──────────────────────────────────────────────────────────
    // Paxsenix / Vercel use .link or .url; Direct uses .url only
    const imageArr = t.image || [];
    const image    = imageArr[2]?.link || imageArr[2]?.url
                  || imageArr[1]?.link || imageArr[1]?.url
                  || imageArr[0]?.link || imageArr[0]?.url || "";
    if (DEBUG && !image) console.warn("[JioSaavn] normalizeTrack: no image for", t.id, t.name, "image field:", imageArr);

    // ── Stream URLs ──────────────────────────────────────────────────────────
    // Paxsenix/Vercel: downloadUrl[].{quality, link|url}
    // Direct:          download_url[].{quality, url}
    const streamUrls = {};
    for (const d of (t.downloadUrl || t.download_url || [])) {
      streamUrls[d.quality] = d.link || d.url;
    }

    // ── Highest quality ──────────────────────────────────────────────────────
    // Direct API: t.highest_quality set from more_info['320kbps'] flag
    // Paxsenix / Vercel: attempt same-named fields, else infer from streamUrls
    const highestQuality = t.highestQuality
                        || t.highest_quality
                        || (streamUrls["320kbps"] ? "320kbps"
                          : streamUrls["160kbps"] ? "160kbps" : null);

    // ── Metadata ─────────────────────────────────────────────────────────────
    // has_lyrics: Direct returns boolean, Paxsenix returns boolean (hasLyrics),
    //             Vercel raw may return string "true"
    const hasLyrics = t.hasLyrics || t.has_lyrics === true || t.has_lyrics === "true" || false;
    // explicitContent: Direct uses t.explicit (boolean), Paxsenix uses t.explicitContent
    //                  or t.explicit_content === "1"
    const explicitContent = t.explicitContent || t.explicit
                         || t.explicit_content === "1" || false;

    return {
      id:             String(t.id),
      title:          t.name || t.title || "Unknown",
      artist,
      artistId,
      artistImage,
      albumTitle:     t.album?.name  || albumFallback.title || "",
      albumId:        t.album?.id    ? String(t.album.id) : (albumFallback.id || null),
      duration:       Number(t.duration) || 0,
      cover:          image,
      year:           t.year         || null,
      language:       t.language     || null,
      hasLyrics,
      playCount:      t.playCount    || t.play_count || null,
      explicitContent,
      streamUrls,                            // { "12kbps": url, … "320kbps": url }
      highestQuality,                        // best quality actually available
      vlink:          t.vlink        || null, // unencrypted preview MP3 (30s), Paxsenix only
      lyricsId:       t.lyrics_id    || t.lyricsId || null,
      _source:        t._source      || "unknown",
    };
  }

  function normalizePlaylist(p) {
    // Works for both format_artist output (image already array) and
    // any raw playlist card where image is a flat string.
    const imageArr = Array.isArray(p.image) ? p.image : (p.image ? [{ quality: "150x150", url: p.image }] : []);
    const image    = imageArr[2]?.url || imageArr[1]?.url || imageArr[0]?.url || "";
    return {
      id:        String(p.id),
      title:     p.title    || "Unknown Playlist",
      subtitle:  p.subtitle || "",
      songCount: p.songCount || p.song_count || (p.more_info?.song_count ? Number(p.more_info.song_count) : null),
      language:  p.language || p.more_info?.language || null,
      cover:     image,
      type:      "playlist",
      _source:   p._source  || "direct",
    };
  }

  function normalizeAlbum(a) {
    const primaryArtists = a.artists?.primary || [];
    // Direct normalizeAlbum also checks a.music as artist fallback (search_albums quirk)
    const artist   = primaryArtists.map(x => x.name).join(", ")
                  || a.music               // Direct: search_albums may populate this
                  || a.primaryArtists      // Vercel flat string
                  || "Unknown Artist";
    const artistId = primaryArtists.length
      ? (primaryArtists[0]?.id || null)
      : (a.primaryArtistsId ? String(a.primaryArtistsId).split(",")[0].trim() : null);
    const image    = (a.image || [])[2]?.link || (a.image || [])[2]?.url
                  || (a.image || [])[1]?.link || (a.image || [])[1]?.url || "";
    return {
      id:          String(a.id),
      title:       a.name || a.title || "Unknown Album",
      artist,
      artistId,
      cover:       image,
      year:        a.year         || null,
      language:    a.language     || null,
      // Direct uses song_count, Paxsenix uses songCount
      songCount:   a.songCount    || a.song_count || null,
      description: a.description  || null,
      _source:     a._source      || "unknown",
    };
  }

  function normalizeArtist(a) {
    const image = (a.image || [])[2]?.link || (a.image || [])[2]?.url
               || (a.image || [])[1]?.link || (a.image || [])[1]?.url || "";
    // bio: Direct returns parsed array of {text} objects, Paxsenix returns JSON string or array
    let bio = null;
    if (typeof a.bio === "string") {
      try { bio = JSON.parse(a.bio); } catch { bio = null; }
    } else {
      bio = a.bio;
    }
    if (Array.isArray(bio)) bio = bio.map(x => (x.text || x)).join("\n\n");
    else if (typeof bio !== "string") bio = null;

    return {
      id:               String(a.id),
      name:             a.name              || "Unknown Artist",
      cover:            image,
      // Direct uses follower_count, Paxsenix uses followerCount
      followerCount:    a.followerCount      || a.follower_count || null,
      fanCount:         a.fanCount          || a.fan_count      || null,
      dominantLanguage: a.dominantLanguage  || a.dominant_language || null,
      // Direct uses is_verified, Paxsenix uses isVerified
      isVerified:       a.isVerified        || a.is_verified    || false,
      bio,
      _source:          a._source           || "unknown",
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PLUGIN OBJECT
  // ═══════════════════════════════════════════════════════════════════════════

  const JioSaavnSearch = {
    name: "JioSaavn Search",
    api:  null,
    isOpen: false,
    searchTimeout: null,
    libraryTracks: new Set(),

    searchCache:   {},
    _currentQuery: "",
    _scrollCache:  {},
    hasNewChanges: false,

    state: {
      view:         "search",
      searchType:   "track",
      currentData:  null,
      history:      [],
      currentTitle: ""
    },

    isPlaying: null,

    // ── Init ──────────────────────────────────────────────────────────────────

    init(api) {
      this.api = api;
      // Wire api.fetch into the direct JioSaavn module for CORS-free Tauri requests
      if (api?.fetch) _fetch = api.fetch.bind(api);
      // Pre-load crypto-js so the first direct-API search isn't slow
      loadCryptoJs().catch(e => console.warn("[JioSaavn] crypto-js preload failed:", e));
      this.fetchLibraryTracks();
      this.injectStyles();
      this.createSearchPanel();
      this.createPlayerBarButton();
      setTimeout(() => this.createPlayerBarButton(), 500);

      if (api.stream?.registerResolver) {
        api.stream.registerResolver(SOURCE_TYPE, async (externalId) => {
          try {
            const streamData = await this.fetchStream(externalId);
            return streamData.url;
          } catch (err) {
            console.error("[JioSaavn] Stream resolve error:", err);
            return null;
          }
        });
      }

      // register as a search source
      // must call onResult exactly once.
      if (api.search?.registerSource) {
        api.search.registerSource(SOURCE_TYPE, (query, onResult) => {
          this.handleSearchQuery(query, onResult);
        });
      }

      if (api.handleRequest) {
        api.handleRequest("searchCover", async (data) => {
          const { title, artist, trackId } = data;
          return await this.searchCoverForRPC(title, artist, trackId);
        });
      }
    },

    async fetchLibraryTracks() {
      if (this.api?.library?.getTracks) {
        try {
          const tracks = (await this.api.library.getTracks()) || [];
          if (!Array.isArray(tracks)) { this.libraryTracks = new Set(); return; }
          this.libraryTracks = new Set(
            tracks.filter(t => t?.source_type === SOURCE_TYPE).map(t => t.external_id)
          );
        } catch (err) {
          console.error("[JioSaavn] Failed to fetch library tracks:", err);
        }
      }
    },

    saveAllLabel(count) {
      if (count === 1) return "Save Track";
      if (count === 2) return "Save Both Tracks";
      return `Save All ${count} Tracks`;
    },

    formatDuration(sec) {
      if (!sec) return "--:--";
      const m = Math.floor(sec / 60);
      const s = sec % 60;
      return `${m}:${s.toString().padStart(2, "0")}`;
    },

    escapeHtml(str) {
      if (!str) return "";
      return String(str).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
    },

    injectStyles() {
      if (document.getElementById("jiosaavn-search-styles-v1")) return;
      const style = document.createElement("style");
      style.id = "jiosaavn-search-styles-v1";
      style.textContent = `
        /* Core Panels */
        #jiosaavn-search-panel {
          position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%) scale(0.95);
          background: var(--bg-elevated, #181818);
          border: 1px solid var(--border-color, #333);
          border-radius: 12px; padding: 0; width: 700px; height: 95vh; max-height: 95vh; z-index: 10001;
          box-shadow: 0 20px 50px rgba(0,0,0,0.5);
          opacity: 0; visibility: hidden;
          transition: all 0.2s cubic-bezier(0, 0, 0.2, 1);
          display: flex; flex-direction: column; overflow: hidden; position: fixed;
        }
        #jiosaavn-search-panel.open { opacity: 1; visibility: visible; transform: translate(-50%, -50%) scale(1); }
        #jiosaavn-search-overlay { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.7); backdrop-filter: blur(4px); z-index: 10000; opacity: 0; visibility: hidden; transition: opacity 0.2s; }
        #jiosaavn-search-overlay.open { opacity: 1; visibility: visible; }

        /* Header */
        .jss-header { padding: 16px 24px; border-bottom: 1px solid var(--border-color, #333); display: flex; align-items: center; gap: 16px; background: var(--bg-elevated, #181818); flex-shrink: 0; }
        .jss-back-btn { background: none; border: none; color: var(--text-secondary, #aaa); cursor: pointer; padding: 8px; border-radius: 50%; transition: 0.2s; display: flex; align-items: center; justify-content: center; }
        .jss-back-btn:hover { background: var(--bg-highlight, #333); color: var(--text-primary, #fff); }
        .jss-title { font-size: 18px; font-weight: 700; color: var(--text-primary, #fff); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .jss-close-btn { margin-left: auto; background: none; border: none; color: var(--text-secondary, #aaa); cursor: pointer; font-size: 20px; transition: 0.2s; }
        .jss-close-btn:hover { color: var(--text-primary, #fff); }

        /* Controls */
        .jss-controls { padding: 16px 24px; border-bottom: 1px solid var(--border-color, #333); background: var(--bg-elevated, #181818); }
        .jss-search-row { display: flex; flex-direction: column; gap: 12px; }
        .jss-input-wrapper { position: relative; }
        .jss-input { width: 100%; padding: 10px 16px 10px 40px; border-radius: 8px; border: 1px solid var(--border-color, #404040); background: #1a1a1a !important; color: #fff !important; font-size: 14px; outline: none; transition: border-color 0.2s; box-sizing: border-box; -webkit-text-fill-color: #fff !important; color-scheme: dark; }
        .jss-input::placeholder { color: #555 !important; -webkit-text-fill-color: #555 !important; }
        .jss-input:focus { border-color: var(--accent-primary, #ff6b35); background: #1a1a1a !important; }
        .jss-input-icon { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: var(--text-subdued, #666); display: flex; align-items: center; }

        .jss-tabs { display: flex; background: var(--bg-surface, #202020); padding: 3px; border-radius: 999px; gap: 2px; }
        .jss-tab { flex: 1; border: none; background: transparent; color: var(--text-secondary, #888); padding: 5px 12px; font-size: 12px; font-weight: 600; cursor: pointer; border-radius: 999px; transition: 0.2s; }
        .jss-tab:hover { color: var(--text-primary, #fff); background: rgba(255,255,255,0.05); }
        .jss-tab.active { background: var(--bg-highlight, #2a2a2a); color: var(--text-primary, #fff); box-shadow: 0 2px 8px rgba(0,0,0,0.2); }

        /* Content */
        .jss-content { flex: 1; overflow-y: auto; overflow-x: hidden; padding: 0 0 24px; position: relative; background: var(--bg-base, #121212); width: 100%; box-sizing: border-box; }
        .jss-content::-webkit-scrollbar { width: 8px; }
        .jss-content::-webkit-scrollbar-thumb { background: var(--bg-highlight, #333); border-radius: 4px; }

        /* Hero */
        .jss-hero { padding: 24px; display: flex; gap: 24px; background: linear-gradient(to bottom, rgba(255, 107, 53, 0.1), transparent); }
        .jss-hero-cover { width: 160px; height: 160px; border-radius: 8px; box-shadow: 0 8px 24px rgba(0,0,0,0.3); object-fit: cover; background: var(--bg-surface, #202020); flex-shrink: 0; }
        .jss-hero-info { flex: 1; display: flex; flex-direction: column; justify-content: flex-end; padding-bottom: 4px; }
        .jss-hero-type { font-size: 11px; text-transform: uppercase; letter-spacing: 1px; font-weight: 700; color: var(--text-secondary, #aaa); margin-bottom: 6px; }
        .jss-hero-title { font-size: 28px; font-weight: 800; color: var(--text-primary, #fff); line-height: 1.2; margin-bottom: 12px; }
        .jss-hero-meta { font-size: 13px; color: var(--text-secondary, #ccc); display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
        .jss-badge { background: var(--accent-primary, #ff6b35); color: white; padding: 2px 8px; border-radius: 4px; font-size: 10px; font-weight: 800; display: inline-block; vertical-align: middle; line-height: 1.4; }
        .jss-explicit-badge { background: var(--text-subdued, #555); color: var(--bg-base, #121212); padding: 1px 4px; border-radius: 2px; font-size: 9px; font-weight: 700; display: inline-block; vertical-align: middle; line-height: 1.4; flex-shrink: 0; }

        /* Save All Button */
        .jss-save-all-btn { background: transparent; border: 1px solid var(--border-color, #444); color: var(--text-primary, #fff); padding: 6px 12px; border-radius: 20px; font-size: 12px; font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; margin-top: 12px; transition: 0.2s; }
        .jss-save-all-btn:hover { border-color: var(--accent-primary, #ff6b35); color: var(--accent-primary, #ff6b35); }

        /* Track List */
        .jss-track-list { padding: 8px 16px 24px; }
        .jss-track-item { display: grid; grid-template-columns: 48px 1fr auto auto; align-items: center; gap: 12px; padding: 8px; border-radius: 6px; cursor: pointer; transition: 0.2s; border-bottom: 1px solid rgba(255,255,255,0.03); }
        .jss-track-item:hover { background: var(--bg-surface, #202020); }
        .jss-track-item.playing { background: rgba(255,107,53,0.08); }
        .jss-track-item.playing .jss-track-title { color: var(--accent-primary, #ff6b35); }

        .jss-track-cover-wrapper { position: relative; width: 48px; height: 48px; border-radius: 4px; overflow: hidden; background: #2a2a2a; flex-shrink: 0; }
        .jss-track-cover { width: 100%; height: 100%; object-fit: cover; }
        .jss-track-cover-wrapper img { min-height: 1px; }
        .jss-play-overlay { position: absolute; inset: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; opacity: 0; transition: 0.2s; color: white; }
        .jss-track-item:hover .jss-play-overlay { opacity: 1; }
        .jss-track-item.playing .jss-play-overlay { opacity: 1; }

        .jss-track-title { font-size: 14px; color: var(--text-primary, #fff); font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: flex; align-items: center; gap: 6px; line-height: 1.2; }
        .jss-track-artist { font-size: 12px; color: var(--text-secondary, #888); margin-top: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 1.2; display: flex; align-items: center; }
        .jss-track-time { color: var(--text-subdued, #666); font-size: 12px; font-variant-numeric: tabular-nums; }

        .jss-clickable-artist { cursor: pointer; transition: color 0.2s; }
        .jss-clickable-artist:hover { color: var(--accent-primary, #ff6b35); text-decoration: underline; }
        .jss-clickable-album { color: var(--text-secondary,#888); font-size: 12px; cursor: pointer; transition: color 0.2s; }
        .jss-clickable-album:hover { color: var(--accent-primary, #ff6b35); }

        .jss-track-actions { display: flex; align-items: center; gap: 8px; opacity: 0; transition: 0.2s; }
        .jss-track-item:hover .jss-track-actions { opacity: 1; }
        .jss-save-btn-mini { background: none; border: none; color: var(--text-secondary); cursor: pointer; padding: 4px; display: flex; align-items: center; justify-content: center; transition: 0.2s; }
        .jss-save-btn-mini:hover { color: var(--text-primary); transform: scale(1.1); }
        .jss-save-btn-mini.saved { color: var(--accent-primary, #ff6b35); opacity: 1 !important; }
        .jss-track-item .jss-save-btn-mini.saved { opacity: 1; }

        /* Grid Cards */
        .jss-grid-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 20px; padding: 20px; width: 100%; box-sizing: border-box; }
        .jss-card { background: var(--bg-elevated, #181818); padding: 12px; border-radius: 8px; cursor: pointer; transition: all 0.2s; border: 1px solid transparent; }
        .jss-card:hover { background: var(--bg-surface, #202020); transform: translateY(-4px); border-color: var(--bg-highlight, #333); }
        .jss-card-img { width: 100%; aspect-ratio: 1; border-radius: 6px; object-fit: cover; background: var(--bg-surface, #202020); margin-bottom: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.2); }
        .jss-card-title { font-size: 14px; font-weight: 600; color: var(--text-primary, #fff); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-bottom: 2px; line-height: 1.2; }
        .jss-card-sub { font-size: 12px; color: var(--text-secondary, #888); display: flex; align-items: center; gap: 4px; overflow: hidden; line-height: 1.2; }
        .jss-card-sub-text { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; flex: 1; }
        .jss-card-sub-count { white-space: nowrap; flex-shrink: 0; color: var(--text-subdued, #666); }

        .jss-unavailable { text-align: center; padding: 40px 24px; color: var(--text-subdued, #666); font-size: 13px; }
        .jss-unavailable-icon { font-size: 32px; margin-bottom: 12px; }

        /* Skeleton */
        .jss-skeleton { background: #222; border-radius: 4px; animation: jss-pulse 1.5s infinite ease-in-out; display: block; }
        @keyframes jss-pulse { 0% { opacity: 0.4; } 50% { opacity: 0.7; } 100% { opacity: 0.4; } }

        /* Player Bar Button */
        .jss-playerbar-btn { display: inline-flex; align-items: center; gap: 8px; padding: 6px 16px; border-radius: 20px; border: 1px solid var(--border-color, #404040); background: transparent; color: #fff; cursor: pointer; font-size: 13px; font-weight: 700; transition: 0.2s; }
        .jss-playerbar-btn:hover { background: var(--bg-highlight, #2a2a2a); border-color: var(--accent-primary, #ff6b35); transform: scale(1.05); }
        .jss-playerbar-btn svg { fill: var(--accent-primary, #ff6b35); width: 16px; height: 16px; }

        .hidden { display: none !important; }

        .jss-description { font-size:13px; color:var(--text-secondary,#ccc); line-height:1.6; }
        .jss-description.collapsed { display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; overflow:hidden; }
        .jss-show-more-btn { background:none; border:none; color:var(--accent-primary,#ff6b35); font-size:12px; cursor:pointer; padding:4px 0 0; display:block; }
        .jss-show-more-btn:hover { text-decoration:underline; }
        .text-center { text-align: center; color: var(--text-subdued, #666); margin-top: 60px; font-size: 14px; }

        /* Settings */
        .jss-settings-btn { background: none; border: none; color: var(--text-secondary, #aaa); cursor: pointer; padding: 8px; border-radius: 50%; transition: 0.2s; display: flex; align-items: center; justify-content: center; margin-left: 6px; }
        .jss-settings-btn:hover { background: var(--bg-highlight, #333); color: var(--text-primary, #fff); }

        #jiosaavn-settings-panel {
          position: absolute; top: 0; left: 0; right: 0; bottom: 0;
          background: var(--bg-elevated, #181818); border-radius: 12px; z-index: 20;
          display: flex; flex-direction: column;
          opacity: 0; visibility: hidden; transform: translateY(8px);
          transition: all 0.2s cubic-bezier(0, 0, 0.2, 1);
        }
        #jiosaavn-settings-panel.open { opacity: 1; visibility: visible; transform: translateY(0); }

        .jss-settings-header { padding: 16px 24px; border-bottom: 1px solid var(--border-color, #333); display: flex; align-items: center; gap: 12px; flex-shrink: 0; }
        .jss-settings-close { margin-left: auto; background: none; border: none; color: var(--text-secondary, #aaa); cursor: pointer; font-size: 20px; transition: 0.2s; }
        .jss-settings-close:hover { color: var(--text-primary, #fff); }
        .jss-settings-body { flex: 1; overflow-y: auto; padding: 20px 24px; display: flex; flex-direction: column; }
        .jss-settings-body::-webkit-scrollbar { width: 8px; }
        .jss-settings-body::-webkit-scrollbar-thumb { background: var(--bg-highlight, #333); border-radius: 4px; }
        .jss-api-key-input { width: 100%; padding: 10px 14px; border-radius: 8px; border: 1px solid var(--border-color, #404040); background: var(--bg-surface, #202020); color: var(--text-primary, #fff); font-size: 13px; font-family: monospace; outline: none; transition: border-color 0.2s; box-sizing: border-box; }
        .jss-api-key-input:focus { border-color: var(--accent-primary, #ff6b35); }
        .jss-api-key-save { padding: 10px 20px; background: var(--accent-primary, #ff6b35); border: none; border-radius: 8px; color: #fff; font-size: 13px; font-weight: 700; cursor: pointer; transition: 0.2s; }
        .jss-api-key-save:hover { filter: brightness(1.15); }
        .jss-api-key-status { font-size: 12px; }
        .jss-api-key-status.ok { color: #4caf50; }
        .jss-api-key-status.missing { color: #f55; }
        .jss-apikey-toggle-btn { display:flex; align-items:center; justify-content:space-between; width:100%; background:var(--bg-surface,#202020); border:none; border-radius:8px; color:var(--text-secondary,#aaa); font-size:13px; font-weight:600; cursor:pointer; padding:12px 16px; text-transform:uppercase; letter-spacing:0.5px; transition:background 0.2s; }
        .jss-apikey-toggle-btn:hover { background:var(--bg-highlight,#2a2a2a); }

        /* Progress bar */
        #jiosaavn-save-progress {
          position: fixed; bottom: 100px; left: 50%; transform: translateX(-50%);
          background: var(--bg-elevated, #282828); color: var(--text-primary, #fff);
          padding: 16px 32px; border-radius: 10px; box-shadow: 0 4px 20px rgba(0,0,0,0.4);
          z-index: 10002; display: flex; flex-direction: column; align-items: center;
          min-width: 320px; max-width: 400px; text-align: center;
        }
        #jiosaavn-save-progress.hidden { display: none; }
        .jss-progress-bar { width: 100%; height: 8px; background: var(--bg-highlight, #3e3e3e); border-radius: 4px; margin-bottom: 12px; overflow: hidden; position: relative; }
        .jss-progress-bar-inner { height: 100%; background: var(--accent-primary, #ff6b35); border-radius: 4px; width: 0%; transition: width 0.2s; position: absolute; left: 0; top: 0; }
        .jss-progress-text { font-size: 14px; color: var(--text-primary, #fff); }

        .jss-artist-avatar {
          width: 160px; height: 160px; border-radius: 50%; flex-shrink: 0;
          background: linear-gradient(135deg, var(--accent-primary, #ff6b35), #c0392b);
          display: flex; align-items: center; justify-content: center;
          font-size: 52px; font-weight: 800; color: rgba(255,255,255,0.9);
          box-shadow: 0 8px 24px rgba(0,0,0,0.4); letter-spacing: -2px; user-select: none;
        }
        .jss-artist-card-avatar {
          width: 100%; aspect-ratio: 1; border-radius: 50%; margin-bottom: 12px;
          background: linear-gradient(135deg, var(--accent-primary, #ff6b35), #c0392b);
          display: flex; align-items: center; justify-content: center;
          font-size: 36px; font-weight: 800; color: rgba(255,255,255,0.9);
          box-shadow: 0 4px 12px rgba(0,0,0,0.2); letter-spacing: -1px; user-select: none;
        }

        .jss-section-header { padding: 16px 24px 8px; font-size: 16px; font-weight: 700; color: var(--text-primary, #fff); margin-top: 8px; }

        .jss-quality-select { background: var(--bg-surface, #202020); border: 1px solid var(--border-color, #404040); border-radius: 6px; color: var(--text-primary, #fff); padding: 6px 10px; font-size: 12px; cursor: pointer; }

        @media (max-width: 768px) {
          #jiosaavn-search-panel { position: fixed; top: 0; left: 0; width: 100vw; height: 100dvh; max-height: 100dvh; transform: none !important; border-radius: 0; border: none; box-sizing: border-box; overflow-x: hidden; }
          #jiosaavn-search-panel.open { transform: none !important; }
          #jiosaavn-settings-panel { border-radius: 0; }
          .jss-header { padding: calc(8px + env(safe-area-inset-top)) 16px 8px 16px; gap: 12px; }
          .jss-back-btn, .jss-close-btn, .jss-settings-btn { min-width: 44px; min-height: 44px; -webkit-tap-highlight-color: transparent; }
          .jss-title { font-size: 16px; }
          .jss-controls { position: sticky; top: 0; background: var(--bg-elevated, #181818); z-index: 10; padding: 12px 16px; border-bottom: 1px solid var(--border-color, #2a2a2a); }
          .jss-input { font-size: 16px; padding: 12px 16px 12px 40px; }
          .jss-tabs { width: 100%; }
          .jss-content { max-height: none; flex: 1; width: 100%; max-width: 100%; box-sizing: border-box; overflow-x: hidden; padding-bottom: calc(16px + env(safe-area-inset-bottom)); }
          .jss-hero { flex-direction: column; align-items: center; text-align: center; padding: 16px; gap: 16px; }
          .jss-hero-cover { width: 140px; height: 140px; }
          .jss-hero-title { font-size: 20px; }
          .jss-hero-meta { justify-content: center; }
          .jss-track-item { grid-template-columns: 44px 1fr auto auto; padding: 6px 8px; -webkit-tap-highlight-color: transparent; }
          .jss-track-actions { opacity: 1; }
          .jss-play-overlay { display: none; }
          .jss-track-list { padding: 4px 12px 8px; }
          .jss-section-header { padding: 8px 16px 4px; margin-top: 0; }
          .jss-grid-list { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; padding: 8px 12px 12px; max-width: 100%; box-sizing: border-box; }
          .jss-card { -webkit-tap-highlight-color: transparent; min-width: 0; max-width: 100%; box-sizing: border-box; overflow: hidden; padding: 8px; }
          .jss-artist-avatar { width: 120px; height: 120px; font-size: 40px; }
          .jss-artist-card-avatar { font-size: 28px; }
          #jiosaavn-save-progress { bottom: calc(20px + env(safe-area-inset-bottom)); max-width: 90vw; min-width: auto; padding: 12px 20px; }
        }
      `;

      document.head.appendChild(style);
    },

    // ── UI Setup ──────────────────────────────────────────────────────────────

    createSearchPanel() {
      const overlay = document.createElement("div");
      overlay.id = "jiosaavn-search-overlay";
      overlay.onclick = () => this.close();
      document.body.appendChild(overlay);

      const progressEl = document.createElement("div");
      progressEl.id = "jiosaavn-save-progress";
      progressEl.className = "hidden";
      progressEl.innerHTML = `<div class="jss-progress-bar"><div class="jss-progress-bar-inner"></div></div><div class="jss-progress-text"></div>`;
      document.body.appendChild(progressEl);

      const panel = document.createElement("div");
      panel.id = "jiosaavn-search-panel";
      panel.innerHTML = `
        <div class="jss-header">
          <button id="jss-back-btn" class="jss-back-btn hidden" title="Back">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
          </button>
          <div class="jss-title" id="jss-panel-title">JioSaavn Search</div>
          <button id="jss-settings-btn" class="jss-settings-btn" title="Settings">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="3"></circle>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
            </svg>
          </button>
          <button class="jss-close-btn" title="Close">✕</button>
        </div>

        <div id="jiosaavn-settings-panel">
          <div class="jss-settings-header">
            <div class="jss-title">Settings</div>
            <button class="jss-settings-close" title="Close settings">✕</button>
          </div>
          <div class="jss-settings-body">
            <p style="font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.8px; color:var(--text-secondary,#aaa); margin:0 0 8px;">Paxsenix API Key</p>
            <div style="display:flex; gap:8px; margin-bottom:8px;">
              <input type="text" id="jss-pax-key-input" class="jss-api-key-input" placeholder="sk-paxsenix-…" autocomplete="off" autocorrect="off" autocapitalize="none" spellcheck="false" style="flex:1; min-width:0;">
              <button id="jss-pax-key-save" class="jss-api-key-save">Save</button>
            </div>
            <p id="jss-pax-key-status" class="jss-api-key-status" style="margin:0 0 16px;"></p>

            <p style="font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.8px; color:var(--text-secondary,#aaa); margin:0 0 8px;">Streaming Quality</p>
            <div style="display:flex; align-items:center; gap:8px; margin-bottom:20px;">
              <span style="font-size:11px; color:var(--text-subdued,#666); white-space:nowrap;">Quality</span>
              <select id="jss-quality-select" class="jss-quality-select" style="flex:1;">
                <option value="12kbps">12 kbps</option>
                <option value="48kbps">48 kbps</option>
                <option value="96kbps">96 kbps</option>
                <option value="160kbps">160 kbps</option>
                <option value="320kbps" selected>320 kbps (Best)</option>
              </select>
            </div>

            <p style="font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.8px; color:var(--text-secondary,#aaa); margin:0 0 8px;">Data Provider</p>
            <select id="jss-provider-select" class="jss-quality-select" style="width:100%; margin-bottom:6px;">
              <option value="direct_first">Direct → Paxsenix → Vercel (richest data)</option>
              <option value="paxsenix_first">Paxsenix → Direct → Vercel (most reliable)</option>
              <option value="direct_only">Direct → Vercel only (no Paxsenix)</option>
            </select>
            <p id="jss-provider-hint" style="font-size:11px; color:var(--text-subdued,#666); margin:0 0 20px; line-height:1.5;"></p>

            <button id="jss-apikey-toggle" class="jss-apikey-toggle-btn">
              <span>How to get your Paxsenix API key</span>
              <svg id="jss-apikey-arrow" width="20" height="20" viewBox="0 0 24 24" fill="currentColor" style="transition:transform 0.2s; flex-shrink:0;"><path d="M7 10l5 5 5-5z"/></svg>
            </button>
            <div id="jss-apikey-steps" style="display:none; padding:8px 0 4px;">
              <p style="font-size:12px; color:var(--text-secondary,#ccc); line-height:1.5; margin:0 0 6px;"><span style="font-weight:700;">1.</span> Visit <a href="https://api.paxsenix.org/dashboard#api-keys" target="_blank" rel="noopener" style="color:var(--accent-primary,#ff6b35);">api.paxsenix.org/dashboard</a></p>
              <p style="font-size:12px; color:var(--text-secondary,#ccc); line-height:1.5; margin:0 0 6px;"><span style="font-weight:700;">2.</span> Sign in with GitHub</p>
              <p style="font-size:12px; color:var(--text-secondary,#ccc); line-height:1.5; margin:0 0 6px;"><span style="font-weight:700;">3.</span> Click <strong>API Keys</strong> in the sidebar</p>
              <p style="font-size:12px; color:var(--text-secondary,#ccc); line-height:1.5; margin:0;"><span style="font-weight:700;">4.</span> Copy your key and paste it above</p>
            </div>

            <p style="margin-top:auto; padding-top:16px; font-size:11px; color:var(--text-subdued,#555); line-height:1.6; text-align:center;">
              Direct API &nbsp;·&nbsp; Paxsenix JioSaavn API &nbsp;·&nbsp; Vercel fallback<br>Praise The Fool !
            </p>
          </div>
        </div>

        <div id="jss-controls-area" class="jss-controls">
          <div class="jss-search-row">
            <div class="jss-input-wrapper">
              <div class="jss-input-icon">${ICONS.search}</div>
              <input type="text" id="jss-search-input" class="jss-input" placeholder="Search tracks, albums, artists...">
            </div>
            <div class="jss-tabs" id="jss-search-tabs">
              <button class="jss-tab active" data-type="track">Tracks</button>
              <button class="jss-tab" data-type="album">Albums</button>
              <button class="jss-tab" data-type="artist">Artists</button>
              <button class="jss-tab" data-type="playlist">Playlists</button>
            </div>
          </div>
        </div>

        <div id="jss-content-area" class="jss-content"></div>
      `;
      document.body.appendChild(panel);

      panel.querySelector(".jss-close-btn").onclick  = () => this.close();
      panel.querySelector("#jss-back-btn").onclick   = () => this.goBack();

      // Settings wiring
      const settingsPanel = panel.querySelector("#jiosaavn-settings-panel");
      const keyInput      = panel.querySelector("#jss-pax-key-input");
      const keyStatus     = panel.querySelector("#jss-pax-key-status");

      const refreshKeyStatus = () => {
        const key  = getPaxKey();
        const pref = getProviderPref();
        if (key) {
          keyStatus.className = "jss-api-key-status ok";
          keyStatus.textContent = "✓ API key saved";
          keyInput.value = key;
        } else {
          keyStatus.className = "jss-api-key-status missing";
          keyStatus.textContent = pref === "paxsenix_first"
            ? "No API key — Paxsenix will be skipped, falling back to Direct."
            : "No API key — Paxsenix not used.";
          keyInput.value = "";
        }
      };

      panel.querySelector(".jss-settings-close").onclick = () => settingsPanel.classList.remove("open");

      // ── Provider preference select ─────────────────────────────────────────
      const providerSelect = panel.querySelector("#jss-provider-select");
      const providerHint   = panel.querySelector("#jss-provider-hint");
      const PROVIDER_HINTS = {
        direct_first:   "Best data quality. Falls back to Paxsenix if JioSaavn changes their API.",
        paxsenix_first: "Most reliable. Requires API key. Falls back to Direct if Paxsenix fails.",
        direct_only:    "Uses JioSaavn directly with no Paxsenix involvement.",
      };
      const refreshProviderSelect = () => {
        const pref = getProviderPref();
        providerSelect.value       = pref;
        providerHint.textContent   = PROVIDER_HINTS[pref] || "";
        // Grey out the Paxsenix API key section if provider is direct_only
        const paxSection = panel.querySelector("#jss-pax-key-input")?.closest("div")?.parentElement;
        if (paxSection) paxSection.style.opacity = pref === "direct_only" ? "0.4" : "1";
      };
      refreshProviderSelect();
      providerSelect.onchange = () => {
        setProviderPref(providerSelect.value);
        refreshProviderSelect();
        refreshKeyStatus();
        // Clear search cache so next search uses the new provider order
        this.searchCache = {};
        this._currentQuery = "";
      };
      // Refresh both status displays whenever settings opens
      panel.querySelector("#jss-settings-btn").onclick = () => {
        refreshKeyStatus();
        refreshProviderSelect();
        settingsPanel.classList.add("open");
      };

      const apiKeyToggle = panel.querySelector("#jss-apikey-toggle");
      const apiKeySteps  = panel.querySelector("#jss-apikey-steps");
      const apiKeyArrow  = panel.querySelector("#jss-apikey-arrow");
      if (apiKeyToggle) {
        apiKeyToggle.onclick = () => {
          const open = apiKeySteps.style.display === "none";
          apiKeySteps.style.display = open ? "block" : "none";
          if (apiKeyArrow) apiKeyArrow.style.transform = open ? "rotate(180deg)" : "";
        };
      }

      panel.querySelector("#jss-pax-key-save").onclick = () => {
        const val = keyInput.value.trim();
        if (!val) {
          localStorage.removeItem("jiosaavn_pax_api_key");
          keyStatus.className = "jss-api-key-status missing";
          keyStatus.textContent = "API key cleared.";
          return;
        }
        localStorage.setItem("jiosaavn_pax_api_key", val);
        keyStatus.className = "jss-api-key-status ok";
        keyStatus.textContent = "✓ API key saved!";
        setTimeout(() => settingsPanel.classList.remove("open"), 800);
      };

      const input = panel.querySelector("#jss-search-input");
      input.addEventListener("input", (e) => {
        this._currentQuery = e.target.value.trim();
        this.handleSearch(e.target.value);
      });

      panel.querySelectorAll(".jss-tab").forEach(btn => {
        btn.onclick = () => {
          const container = document.getElementById("jss-content-area");
          const currentKey = `${this.state.searchType}:${this._currentQuery}`;
          if (container) this._scrollCache[currentKey] = container.scrollTop;

          this.state.searchType = btn.dataset.type;
          panel.querySelectorAll(".jss-tab").forEach(b => b.classList.remove("active"));
          btn.classList.add("active");
          if (input.value) this.handleSearch(input.value);

          const newKey = `${this.state.searchType}:${this._currentQuery}`;
          const savedScroll = this._scrollCache[newKey];
          if (savedScroll !== undefined) {
            setTimeout(() => { if (container) container.scrollTop = savedScroll; }, 0);
          }
        };
      });
    },

    createPlayerBarButton() {
      if (document.getElementById("jss-search-btn")) return;
      const btn = document.createElement("button");
      btn.id = "jss-search-btn";
      btn.className = "jss-playerbar-btn";
      btn.innerHTML = `
        <svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14.5v-9l6 4.5-6 4.5z"/></svg>
        <span>JioSaavn</span>
      `;
      btn.onclick = () => this.open();
      if (this.api?.ui?.registerSlot) {
        this.api.ui.registerSlot("playerbar:menu", btn);
      }
    },

    // ── Navigation ────────────────────────────────────────────────────────────

    open() {
      this.isOpen = true;
      document.getElementById("jiosaavn-search-overlay")?.classList.add("open");
      document.getElementById("jiosaavn-search-panel")?.classList.add("open");
      this.fetchLibraryTracks();
      setTimeout(() => document.querySelector("#jss-search-input")?.focus(), 100);
    },

    close() {
      this.isOpen = false;
      document.getElementById("jiosaavn-search-overlay")?.classList.remove("open");
      document.getElementById("jiosaavn-search-panel")?.classList.remove("open");
      if (this.hasNewChanges) { this.api?.library?.refresh?.(); this.hasNewChanges = false; }
      this.searchCache   = {};
      this._currentQuery = "";
    },

    navigateTo(view, data, title) {
      const container = document.getElementById("jss-content-area");
      const scrollKey = `${this.state.view}:${this.state.currentTitle}`;
      if (container) this._scrollCache[scrollKey] = container.scrollTop;

      const currentQuery = this.state.view === "search"
        ? (document.getElementById("jss-search-input")?.value ?? "")
        : null;

      this.state.history.push({
        view:       this.state.view,
        data:       this.state.currentData,
        title:      this.state.currentTitle,
        query:      currentQuery,
        searchType: this.state.view === "search" ? this.state.searchType : null,
      });
      this.state.view         = view;
      this.state.currentData  = data;
      this.state.currentTitle = title;
      this.updateHeader();
      this.render();
    },

    goBack() {
      if (this.state.history.length > 0) {
        const prev = this.state.history.pop();
        this.state.view         = prev.view;
        this.state.currentData  = prev.data;
        this.state.currentTitle = prev.title;
        this.updateHeader();
        if (prev.view === "search") {
          const input = document.getElementById("jss-search-input");
          if (input) input.value = prev.query ?? "";
          if (prev.searchType) {
            this.state.searchType = prev.searchType;
            document.querySelectorAll(".jss-tab").forEach(b => {
              b.classList.toggle("active", b.dataset.type === prev.searchType);
            });
          }
        }
        this.render();
        const savedScroll = this._scrollCache[`${prev.view}:${prev.title}`];
        if (savedScroll !== undefined) {
          const container = document.getElementById("jss-content-area");
          if (container) setTimeout(() => { container.scrollTop = savedScroll; }, 0);
        }
      } else {
        this.close();
      }
    },

    updateHeader() {
      const backBtn  = document.getElementById("jss-back-btn");
      const title    = document.getElementById("jss-panel-title");
      const controls = document.getElementById("jss-controls-area");
      title.textContent = this.state.currentTitle;
      if (this.state.view === "search") {
        backBtn.classList.add("hidden");
        controls.classList.remove("hidden");
      } else {
        backBtn.classList.remove("hidden");
        controls.classList.add("hidden");
      }
    },



    // ── Data Fetching ─────────────────────────────────────────────────────────

    handleSearch(query) {
      clearTimeout(this.searchTimeout);
      const container = document.getElementById("jss-content-area");
      if (!query.trim()) {
        this.searchCache   = {};
        this._scrollCache  = {};
        this._currentQuery = "";
        container.innerHTML = `<div class="text-center">Start typing to search</div>`;
        return;
      }
      const cacheKey = `${this.state.searchType}:${query.trim()}`;
      if (this.searchCache[cacheKey]) {
        this.state.currentData = this.searchCache[cacheKey];
        this.renderSearchResults(this.searchCache[cacheKey]);
        return;
      }
      this.renderSkeleton("search");
      this.searchTimeout = setTimeout(() => this.performSearch(query.trim()), 400);
    },

    async performSearch(query) {
      const container = document.getElementById("jss-content-area");
      const cacheKey  = `${this.state.searchType}:${query}`;

      if (this.searchCache[cacheKey]) {
        this.state.currentData = this.searchCache[cacheKey];
        this.renderSearchResults(this.searchCache[cacheKey]);
        return;
      }

      let results = null;

      for (const provider of getProviderOrder()) {
        if (results) break;

        // ── Paxsenix ──────────────────────────────────────────────────────────
        if (provider === "pax") {
          const paxAuth = getPaxAuth();
          if (!paxAuth) continue; // no key — skip silently
          try {
            const url = `${PAX_BASE}/search?q=${encodeURIComponent(query)}`;
            const res = await (this.api.fetch
              ? this.api.fetch(url, { headers: { "Authorization": paxAuth } })
              : fetch(url,          { headers: { "Authorization": paxAuth } }));
            if (!res.ok) throw new Error("HTTP " + res.status);
            const data = await res.json();
            if (!data.ok) throw new Error(data.message || "Paxsenix error");
            if (DEBUG) console.log("[JioSaavn] Paxsenix search results:", (data.results||[]).length);
            this._populateCacheFromPaxsenix(data.results || [], query);
            results = this.searchCache[cacheKey] || null;
            if (!results?.length) results = null;
          } catch (e) {
            console.warn("[JioSaavn] Paxsenix search failed:", e.message);
          }
        }

        // ── Direct JioSaavn API ───────────────────────────────────────────────
        else if (provider === "direct") {
          try {
            if (DEBUG) console.log("[JioSaavn] Direct search for searchType:", this.state.searchType);
            if (this.state.searchType === "track") {
              const data = await JioSaavnAPI.search_songs(query, 0, 40);
              const tracks = (data.results || []).map(t => normalizeTrack({ ...t, _source: "direct" }));
              this._extractSideEffects(data.results || [], query, "direct");
              this.searchCache[`track:${query}`] = tracks;
            } else if (this.state.searchType === "album") {
              const data = await JioSaavnAPI.search_albums(query, 0, 40);
              const albums = (data.results || []).map(a => normalizeAlbum({ ...a, _source: "direct" }));
              this.searchCache[`album:${query}`] = albums;
            } else if (this.state.searchType === "artist") {
              const data = await JioSaavnAPI.search_artists(query, 0, 40);
              const artists = (data.results || []).map(a => ({
                id:            String(a.id),
                name:          a.name || a.title || "",
                cover:         (a.image || [])[2]?.url || (a.image || [])[1]?.url || "",
                followerCount: null,
                _source:       "direct",
              }));
              this.searchCache[`artist:${query}`] = artists;
            } else if (this.state.searchType === "playlist") {
              const data = await JioSaavnAPI.search_playlists(query, 0, 40);
              const playlists = (data.results || []).map(p => normalizePlaylist({ ...p, _source: "direct" }));
              this.searchCache[`playlist:${query}`] = playlists;
            }
            results = this.searchCache[cacheKey] || null;
            if (!results?.length) results = null;
          } catch (e) {
            console.warn("[JioSaavn] Direct search failed:", e.message);
          }
        }

        // ── Vercel fallback ───────────────────────────────────────────────────
        else if (provider === "vercel") {
          try {
            const url = `${VERCEL_BASE}/search/songs?query=${encodeURIComponent(query)}&limit=40`;
            const res = await (this.api.fetch ? this.api.fetch(url) : fetch(url));
            if (!res.ok) throw new Error("HTTP " + res.status);
            const data = await res.json();
            const items = data?.data?.results || [];
            if (!items.length) throw new Error("No results");
            const tracks = items.map(t => normalizeTrack({ ...t, _source: "vercel" }));
            this.searchCache[`track:${query}`] = tracks;
            this._extractSideEffects(items, query, "vercel");
            results = this.searchCache[cacheKey] || tracks;
          } catch (e) {
            console.warn("[JioSaavn] Vercel search failed:", e.message);
          }
        }
      }

      if (!results?.length) {
        container.innerHTML = `<div class="text-center">No results found</div>`;
        return;
      }

      if (!this.searchCache[cacheKey]) this.searchCache[cacheKey] = results;
      this.state.currentData = results;
      this.renderSearchResults(results);
    },

    // Populate all type caches from a Paxsenix search result array.
    // Paxsenix /jiosaavn/search returns mixed types with a `type` field.
    _populateCacheFromPaxsenix(results, query) {
      const tracks    = results.filter(r => !r.type || r.type === "song");
      const albums    = results.filter(r => r.type === "album");
      const artists   = results.filter(r => r.type === "artist");
      const playlists = results.filter(r => r.type === "playlist");

      if (tracks.length)    this.searchCache[`track:${query}`]    = tracks.map(t => normalizeTrack({ ...t, _source: "paxsenix" }));
      if (albums.length)    this.searchCache[`album:${query}`]    = albums.map(a => normalizeAlbum({ ...a, _source: "paxsenix" }));
      if (artists.length)   this.searchCache[`artist:${query}`]   = artists.map(a => normalizeArtist({ ...a, _source: "paxsenix" }));
      if (playlists.length) this.searchCache[`playlist:${query}`] = playlists.map(p => normalizePlaylist({ ...p, _source: "paxsenix" }));

      // Fallback: if nothing matched by type, treat all as tracks
      if (!tracks.length && !albums.length && !artists.length && results.length) {
        this.searchCache[`track:${query}`] = results.map(t => normalizeTrack({ ...t, _source: "paxsenix" }));
      }

      // Pre-populate artist detail stubs from search results
      const cachedArtists = this.searchCache[`artist:${query}`] || [];
      for (const a of cachedArtists) {
        const key = `artist-detail:${a.id}`;
        if (!this.searchCache[key]) {
          this.searchCache[key] = {
            artistId: a.id, artistName: a.name, artistPicture: a.cover || null,
            followerCount: a.followerCount || null, isVerified: false,
            dominantLanguage: null, bio: null,
            tracks: [], albums: [], singles: [],
            dedicatedPlaylists: [], featuredPlaylists: [], latestRelease: [],
          };
        }
      }
    },

    // Extract artist and album side-effect caches from track-search results.
    // Works for both Direct (t.artists.primary[]) and Vercel (t.primaryArtistsId string) shapes.
    _extractSideEffects(tracks, query, source) {
      const seenArtists = new Map();
      const seenAlbums  = new Map();

      for (const t of tracks) {
        // Paxsenix / Direct structure: t.artists.primary = [{id, name, image}]
        for (const a of (t.artists?.primary || [])) {
          if (a.id && !seenArtists.has(String(a.id))) {
            const aImg = (a.image || [])[2]?.url || (a.image || [])[1]?.url || (a.image || [])[0]?.url || "";
            seenArtists.set(String(a.id), { id: String(a.id), name: a.name || "", cover: aImg, followerCount: null, _source: source });
          }
        }
        // Vercel flat structure: t.primaryArtistsId = "id1, id2"
        if (t.primaryArtistsId) {
          const names = String(t.primaryArtists || "").split(",").map(s => s.trim()).filter(Boolean);
          const ids   = String(t.primaryArtistsId).split(",").map(s => s.trim()).filter(Boolean);
          ids.forEach((id, idx) => {
            if (id && !seenArtists.has(id)) {
              seenArtists.set(id, { id, name: names[idx] || id, cover: "", followerCount: null, _source: source });
            }
          });
        }
        // Albums
        if (t.album?.id && !seenAlbums.has(String(t.album.id))) {
          const img = (t.image || [])[2]?.link || (t.image || [])[2]?.url || (t.image || [])[1]?.link || (t.image || [])[1]?.url || "";
          const albumArtist   = (t.artists?.primary || []).map(a => a.name).join(", ") || t.primaryArtists || "";
          const albumArtistId = (t.artists?.primary || [])[0]?.id
                             || (t.primaryArtistsId ? String(t.primaryArtistsId).split(",")[0].trim() : null);
          seenAlbums.set(String(t.album.id), {
            id: String(t.album.id), title: t.album.name || t.album.title || "",
            artist: albumArtist, artistId: albumArtistId, cover: img, _source: source,
          });
        }
      }

      const artistList = [...seenArtists.values()];
      const albumList  = [...seenAlbums.values()];
      // Only write if not already set — an explicit artist/album search for this
      // query should never be overwritten by artists/albums encountered while
      // browsing track results (which accumulate from many different pages).
      if (artistList.length && !this.searchCache[`artist:${query}`]) this.searchCache[`artist:${query}`] = artistList;
      if (albumList.length  && !this.searchCache[`album:${query}`])  this.searchCache[`album:${query}`]  = albumList;

      // Pre-populate artist detail stubs so loadArtistPage has something to show immediately
      for (const a of artistList) {
        const key = `artist-detail:${a.id}`;
        if (!this.searchCache[key]) {
          this.searchCache[key] = {
            artistId: a.id, artistName: a.name, artistPicture: a.cover,
            followerCount: null, isVerified: false, dominantLanguage: null, bio: null,
            tracks: [], albums: [], singles: [],
            dedicatedPlaylists: [], featuredPlaylists: [], latestRelease: [],
          };
        }
      }

      if (DEBUG) console.log("[JioSaavn] _extractSideEffects artists:", artistList.length, "albums:", albumList.length);
    },

    async fetchAlbumDetails(albumId) {
      this.renderSkeleton("album");
      const cacheKey = `album-detail:${albumId}`;
      if (this.searchCache[cacheKey]) return this.searchCache[cacheKey];

      for (const provider of getProviderOrder()) {
        // ── Paxsenix ────────────────────────────────────────────────────────
        if (provider === "pax") {
          const paxAuth = getPaxAuth();
          if (!paxAuth) continue;
          try {
            const url = `${PAX_BASE}/album?id=${encodeURIComponent(albumId)}`;
            const res = await (this.api.fetch
              ? this.api.fetch(url, { headers: { "Authorization": paxAuth } })
              : fetch(url,          { headers: { "Authorization": paxAuth } }));
            if (!res.ok) throw new Error("HTTP " + res.status);
            const data = await res.json();
            if (!data.ok) throw new Error(data.message || "Paxsenix error");
            const result = this._normalizeAlbumDetail(data, "paxsenix");
            this.searchCache[cacheKey] = result;
            return result;
          } catch (e) {
            console.warn("[JioSaavn] Paxsenix album failed:", e.message);
          }
        }

        // ── Direct JioSaavn API ──────────────────────────────────────────────
        else if (provider === "direct") {
          try {
            const data   = await JioSaavnAPI.get_album(albumId);
            const result = this._normalizeAlbumDetail(data, "direct");
            this.searchCache[cacheKey] = result;
            return result;
          } catch (e) {
            console.warn("[JioSaavn] Direct album failed:", e.message);
          }
        }

        // ── Vercel fallback ──────────────────────────────────────────────────
        else if (provider === "vercel") {
          try {
            const url = `${VERCEL_BASE}/albums?id=${encodeURIComponent(albumId)}`;
            const res = await (this.api.fetch ? this.api.fetch(url) : fetch(url));
            if (!res.ok) throw new Error("HTTP " + res.status);
            const data = (await res.json())?.data || {};
            const result = this._normalizeAlbumDetail(data, "vercel");
            this.searchCache[cacheKey] = result;
            return result;
          } catch (e) {
            console.warn("[JioSaavn] Vercel album failed:", e.message);
          }
        }
      }

      this.showToast("Could not load album", true);
      return null;
    },

    // Normalize an album detail response from any source into a unified shape.
    // Handles Paxsenix (camelCase + .link|.url), Direct (snake_case + .url),
    // and Vercel (mixed camelCase + .link) field names.
    _normalizeAlbumDetail(data, source) {
      const image = (data.image || [])[2]?.link || (data.image || [])[2]?.url
                 || (data.image || [])[1]?.link || (data.image || [])[1]?.url || "";

      const primaryArtists = data.artists?.primary || [];
      let artist, artistId;
      if (primaryArtists.length) {
        artist   = primaryArtists.map(a => a.name).join(", ");
        artistId = String(primaryArtists[0]?.id || "");
      } else {
        // Vercel flat strings / Direct from search_albums
        artist   = data.primaryArtists || data.music || "Unknown Artist";
        artistId = data.primaryArtistsId
          ? String(data.primaryArtistsId).split(",")[0].trim()
          : "";
      }

      // songs array: Paxsenix uses data.songs, Direct uses data.songs (mapped from data.list),
      // Vercel uses data.songs or data.song
      const songList = data.songs || data.song || [];
      const songs    = songList.map(t => normalizeTrack(
        { ...t, _source: source },
        { id: String(data.id), title: data.name || data.title }
      ));

      if (DEBUG) console.log("[JioSaavn] _normalizeAlbumDetail source:", source, "artist:", artist, "songs:", songs.length);
      return {
        id:          String(data.id),
        title:       data.name || data.title || "Unknown Album",
        artist,
        artistId,
        cover:       image,
        year:        data.year        || null,
        language:    data.language    || null,
        songCount:   data.songCount   || data.song_count || songs.length,
        description: data.description || null,
        tracks:      songs,
      };
    },

    async fetchPlaylistDetails(playlistId) {
      this.renderSkeleton("album"); // reuse album skeleton — same hero+tracklist shape
      const cacheKey = `playlist-detail:${playlistId}`;
      if (this.searchCache[cacheKey]) return this.searchCache[cacheKey];

      // Paxsenix has no playlist endpoint — only direct and vercel apply here.
      // We still iterate providerOrder so if pref is "paxsenix_first" we simply
      // skip past "pax" and hit direct/vercel in the correct relative order.
      for (const provider of getProviderOrder()) {
        if (provider === "pax") continue; // no playlist endpoint

        else if (provider === "direct") {
          try {
            const data   = await JioSaavnAPI.get_playlist(playlistId);
            const result = {
              id:            data.id,
              title:         data.title,
              description:   data.description,
              cover:         (data.image || [])[2]?.url || (data.image || [])[1]?.url || "",
              songCount:     data.song_count,
              language:      data.language,
              curator:       data.curator,
              followerCount: data.follower_count,
              tracks:        data.songs.map(t => normalizeTrack({ ...t, _source: "direct" })),
              _source:       "direct",
            };
            this.searchCache[cacheKey] = result;
            return result;
          } catch (e) {
            console.warn("[JioSaavn] Direct playlist failed:", e.message);
          }
        }

        else if (provider === "vercel") {
          try {
            const url = `${VERCEL_BASE}/playlists?id=${encodeURIComponent(playlistId)}`;
            const res = await (this.api.fetch ? this.api.fetch(url) : fetch(url));
            if (!res.ok) throw new Error("HTTP " + res.status);
            const d    = (await res.json())?.data || {};
            const image = (d.image || [])[2]?.link || (d.image || [])[2]?.url
                       || (d.image || [])[1]?.link || (d.image || [])[1]?.url || "";
            const result = {
              id:            String(d.id),
              title:         d.name || d.title || "Unknown Playlist",
              description:   d.description || null,
              cover:         image,
              songCount:     d.songCount || d.song_count || null,
              language:      d.language  || null,
              curator:       null,
              followerCount: null,
              tracks:        (d.songs || []).map(t => normalizeTrack({ ...t, _source: "vercel" })),
              _source:       "vercel",
            };
            this.searchCache[cacheKey] = result;
            return result;
          } catch (e) {
            console.warn("[JioSaavn] Vercel playlist failed:", e.message);
          }
        }
      }

      this.showToast("Could not load playlist", true);
      return null;
    },

    async fetchArtistDetails(artistId, artistName) {
      const cacheKey = `artist-detail:${artistId}`;
      // Only use cache if it already has tracks (stub entries have empty tracks[])
      if (this.searchCache[cacheKey]?.tracks?.length) return this.searchCache[cacheKey];

      for (const provider of getProviderOrder()) {
        // ── Paxsenix ──────────────────────────────────────────────────────────
        if (provider === "pax") {
          const paxAuth = getPaxAuth();
          if (!paxAuth) continue;
          try {
            const url = `${PAX_BASE}/artist?id=${encodeURIComponent(artistId)}`;
            const res = await (this.api.fetch
              ? this.api.fetch(url, { headers: { "Authorization": paxAuth } })
              : fetch(url,          { headers: { "Authorization": paxAuth } }));
            if (!res.ok) throw new Error("HTTP " + res.status);
            const data = await res.json();
            if (!data.ok) throw new Error(data.message || "Paxsenix error");

            const image = (data.image || [])[2]?.link || (data.image || [])[2]?.url
                       || (data.image || [])[1]?.link || (data.image || [])[1]?.url || "";
            const topSongs  = (data.topSongs  || []).map(t => normalizeTrack({ ...t, _source: "paxsenix" }));
            const topAlbums = (data.topAlbums || []).map(a => normalizeAlbum({ ...a, _source: "paxsenix" }));
            const singles   = (data.singles   || []).map(a => normalizeAlbum({ ...a, _source: "paxsenix" }));

            let bio = null;
            if (typeof data.bio === "string") { try { bio = JSON.parse(data.bio); } catch { bio = null; } } else { bio = data.bio; }
            if (Array.isArray(bio)) bio = bio.map(x => (x.text || x)).join("\n\n");
            else if (typeof bio !== "string") bio = null;

            const result = {
              artistId,
              artistName:       data.name              || artistName,
              artistPicture:    image,
              followerCount:    data.followerCount      || data.follower_count || null,
              fanCount:         data.fanCount           || data.fan_count      || null,
              isVerified:       data.isVerified         || data.is_verified    || false,
              dominantLanguage: data.dominantLanguage   || data.dominant_language || null,
              bio,
              fb:               data.fb       || null,
              twitter:          data.twitter  || null,
              wiki:             data.wiki     || null,
              dob:              data.dob      || null,
              aka:              data.aka      || null,
              availableLanguages: data.availableLanguages || data.available_languages || null,
              similarArtists:   (data.similarArtists || []).map(s => ({
                id:    String(s.id),
                name:  s.name  || "Unknown Artist",
                cover: (s.image || [])[2]?.link || (s.image || [])[2]?.url
                    || (s.image || [])[1]?.link || (s.image || [])[1]?.url || "",
                followerCount: null,
                _source: "paxsenix",
              })),
              tracks:           topSongs,
              albums:           topAlbums,
              singles,
              dedicatedPlaylists: (data.dedicated_artist_playlist || []).map(p => normalizePlaylist({ ...p, _source: "paxsenix" })),
              featuredPlaylists:  (data.featured_artist_playlist  || []).map(p => normalizePlaylist({ ...p, _source: "paxsenix" })),
              latestRelease:      (data.latest_release            || []).map(a => normalizeAlbum({ ...a, _source: "paxsenix" })),
            };
            this.searchCache[cacheKey] = result;
            return result;
          } catch (e) {
            console.warn("[JioSaavn] Paxsenix artist failed:", e.message);
          }
        }

        // ── Direct JioSaavn API ────────────────────────────────────────────────
        else if (provider === "direct") {
          try {
            const data    = await JioSaavnAPI.get_artist(artistId);
            const bioText = Array.isArray(data.bio)
              ? data.bio.map(b => b.text || String(b)).join("\n\n")
              : (typeof data.bio === "string" ? data.bio : null);
            const result = {
              artistId,
              artistName:       data.name              || artistName,
              artistPicture:    (data.image || [])[2]?.url || (data.image || [])[1]?.url || null,
              followerCount:    data.follower_count    || null,
              fanCount:         data.fan_count         || null,
              isVerified:       data.is_verified       || false,
              dominantLanguage: data.dominant_language || null,
              bio:              bioText,
              fb:               data.fb      || null,
              twitter:          data.twitter || null,
              wiki:             data.wiki    || null,
              dob:              data.dob     || null,
              aka:              data.aka     || null,
              availableLanguages: data.available_languages || null,
              similarArtists:   (data.similar_artists || []).map(s => ({
                id:    String(s.id),
                name:  s.name  || "Unknown Artist",
                cover: (s.image || [])[2]?.url || (s.image || [])[1]?.url || (s.image || [])[0]?.url || "",
                followerCount: null,
                _source: "direct",
              })),
              tracks:  [...new Map((data.top_songs  || []).map(t => normalizeTrack({ ...t, _source: "direct" })).map(t => [t.id, t])).values()],
              albums:  [...new Map((data.top_albums || []).map(a => normalizeAlbum({ ...a, _source: "direct" })).map(a => [a.id, a])).values()],
              singles: [...new Map((data.singles    || []).map(a => normalizeAlbum({ ...a, _source: "direct" })).map(a => [a.id, a])).values()],
              dedicatedPlaylists: (data.dedicated_playlists || []).map(p => normalizePlaylist({ ...p, _source: "direct" })),
              featuredPlaylists:  (data.featured_playlists  || []).map(p => normalizePlaylist({ ...p, _source: "direct" })),
              latestRelease:      (data.latest_release      || []).map(a => normalizeAlbum({ ...a, _source: "direct" })),
            };
            this.searchCache[cacheKey] = result;
            return result;
          } catch (e) {
            console.warn("[JioSaavn] Direct artist failed:", e.message);
          }
        }

        // ── Vercel artist endpoint ─────────────────────────────────────────────
        else if (provider === "vercel") {
          try {
            const url = `${VERCEL_BASE}/artists?id=${encodeURIComponent(artistId)}`;
            const res = await (this.api.fetch ? this.api.fetch(url) : fetch(url));
            if (!res.ok) throw new Error("HTTP " + res.status);
            const data = (await res.json())?.data || {};
            const fromCache = this._buildArtistFromCache(artistId, artistName);
            const image = (data.image || [])[2]?.link || (data.image || [])[2]?.url
                       || (data.image || [])[1]?.link || (data.image || [])[1]?.url || "";
            let bio = null;
            if (typeof data.bio === "string") { try { bio = JSON.parse(data.bio); } catch { bio = null; } } else { bio = data.bio; }
            if (Array.isArray(bio)) bio = bio.map(x => (x.text || x)).join("\n\n");
            else if (typeof bio !== "string") bio = null;

            const result = {
              ...fromCache,
              artistName:       data.name              || artistName,
              artistPicture:    image || fromCache.artistPicture,
              followerCount:    data.followerCount      || data.follower_count || null,
              fanCount:         data.fanCount           || data.fan_count      || null,
              isVerified:       data.isVerified         || data.is_verified    || false,
              dominantLanguage: data.dominantLanguage   || data.dominant_language || null,
              bio,
              fb: null, twitter: null, wiki: null, dob: null, aka: null,
              availableLanguages: null, similarArtists: [],
              dedicatedPlaylists: [], featuredPlaylists: [], latestRelease: [],
            };
            this.searchCache[cacheKey] = result;
            return result;
          } catch (e) {
            console.warn("[JioSaavn] Vercel artist failed:", e.message);
          }
        }
      }

      // Pure cache fallback — no provider succeeded
      return this._buildArtistFromCache(artistId, artistName);
    },

    // Build a minimal artist detail object from whatever track/album data
    // is already in the search cache (populated during search).
    _buildArtistFromCache(artistId, artistName) {
      let artistPicture = null;
      for (const [, items] of Object.entries(this.searchCache)) {
        if (!Array.isArray(items)) continue;
        const foundArtist = items.find(a => a && String(a.id) === String(artistId) && a.cover);
        if (foundArtist?.cover) { artistPicture = foundArtist.cover; break; }
        const foundTrack = items.find(t => t && String(t.artistId) === String(artistId) && t.artistImage);
        if (foundTrack?.artistImage) { artistPicture = foundTrack.artistImage; break; }
      }

      const seenTrackIds = new Set();
      const seenAlbumIds = new Set();
      const tracks = [];
      const albums = [];

      for (const [key, items] of Object.entries(this.searchCache)) {
        if (!Array.isArray(items)) continue;
        if (key.startsWith("track:")) {
          for (const t of items) {
            if (t && String(t.artistId) === String(artistId) && !seenTrackIds.has(t.id)) {
              seenTrackIds.add(t.id); tracks.push(t);
            }
          }
        }
        if (key.startsWith("album:")) {
          for (const a of items) {
            if (a && String(a.artistId) === String(artistId) && !seenAlbumIds.has(a.id)) {
              seenAlbumIds.add(a.id); albums.push(a);
            }
          }
        }
      }

      const result = {
        artistId, artistName, artistPicture,
        followerCount: null, fanCount: null, isVerified: false,
        dominantLanguage: null, bio: null,
        fb: null, twitter: null, wiki: null, dob: null, aka: null,
        availableLanguages: null, similarArtists: [],
        tracks, albums, singles: [],
        dedicatedPlaylists: [], featuredPlaylists: [], latestRelease: [],
      };
      this.searchCache[`artist-detail:${artistId}`] = result;
      return result;
    },

    // Load the next page of songs for an artist (direct API only).
    // Returns { songs: normalizedTrack[], total, last_page } or null on failure.
    async fetchMoreArtistSongs(artistId, page) {
      try {
        const result = await JioSaavnAPI.get_artist_more_songs(artistId, page, 10);
        return {
          songs:     result.songs.map(t => normalizeTrack({ ...t, _source: "direct" })),
          total:     result.total,
          last_page: result.last_page,
        };
      } catch (e) {
        console.error("[JioSaavn] fetchMoreArtistSongs failed:", e.message);
        return null;
      }
    },

    // Load the next page of albums for an artist (direct API only).
    // Returns { albums: normalizedAlbum[], total, last_page } or null on failure.
    async fetchMoreArtistAlbums(artistId, page) {
      try {
        const result = await JioSaavnAPI.get_artist_more_albums(artistId, page, 10);
        return {
          albums:    result.albums.map(a => normalizeAlbum({ ...a, _source: "direct" })),
          total:     result.total,
          last_page: result.last_page,
        };
      } catch (e) {
        console.error("[JioSaavn] fetchMoreArtistAlbums failed:", e.message);
        return null;
      }
    },

    async fetchStream(trackId) {
      const quality = document.getElementById("jss-quality-select")?.value || DEFAULT_QUALITY;
      const qualityFallbacks = {
        "320kbps": ["160kbps","96kbps"],
        "160kbps": ["320kbps","96kbps"],
        "96kbps":  ["160kbps","48kbps"],
        "48kbps":  ["96kbps","12kbps"],
        "12kbps":  ["48kbps"],
      };
      const qualitiesToTry = [quality, ...(qualityFallbacks[quality] || [])];

      // heck cache first — search results may already have decrypted URLs ──
      for (const [, items] of Object.entries(this.searchCache)) {
        if (!Array.isArray(items)) continue;
        const track = items.find(t => t && String(t.id) === String(trackId));
        if (track?.streamUrls && Object.keys(track.streamUrls).length > 0) {
          if (DEBUG) console.log("[JioSaavn] Found cached streamUrls for", trackId, track.streamUrls);
          for (const q of qualitiesToTry) {
            if (track.streamUrls[q]) return { url: track.streamUrls[q], quality: q };
          }
        }
      }
      if (DEBUG) console.log("[JioSaavn] No cached stream for", trackId, "— hitting APIs");

      for (const provider of getProviderOrder()) {
        // ── Paxsenix ──────────────────────────────────────────────────────────
        if (provider === "pax") {
          const paxAuth = getPaxAuth();
          if (!paxAuth) continue;
          try {
            const url = `${PAX_BASE}/track?id=${encodeURIComponent(trackId)}`;
            const res = await (this.api.fetch
              ? this.api.fetch(url, { headers: { "Authorization": paxAuth } })
              : fetch(url,          { headers: { "Authorization": paxAuth } }));
            if (!res.ok) throw new Error("HTTP " + res.status);
            const data = await res.json();
            if (!data.ok) throw new Error(data.message || "Paxsenix error");
            const dlUrls = data.downloadUrl || [];
            for (const q of qualitiesToTry) {
              const found = dlUrls.find(d => d.quality === q);
              const streamUrl = found?.link || found?.url;
              if (streamUrl) return { url: streamUrl, quality: q };
            }
            throw new Error("No matching quality URL in Paxsenix response");
          } catch (e) {
            console.warn("[JioSaavn] Paxsenix stream failed:", e.message);
          }
        }

        // ── Direct JioSaavn API ───────────────────────────────────────────────
        else if (provider === "direct") {
          try {
            const song = await JioSaavnAPI.get_song(trackId);
            const normalized = normalizeTrack({ ...song, _source: "direct" });
            for (const q of qualitiesToTry) {
              if (normalized.streamUrls[q]) return { url: normalized.streamUrls[q], quality: q };
            }
            throw new Error("No matching quality URL in direct response");
          } catch (e) {
            console.warn("[JioSaavn] Direct stream failed:", e.message);
          }
        }

        // ── Vercel fallback ───────────────────────────────────────────────────
        else if (provider === "vercel") {
          try {
            const url = `${VERCEL_BASE}/songs?id=${encodeURIComponent(trackId)}`;
            const res = await (this.api.fetch ? this.api.fetch(url) : fetch(url));
            if (!res.ok) throw new Error("HTTP " + res.status);
            const data = await res.json();
            const trackData = data?.data?.songs?.[0] || data?.data?.[0] || null;
            const dlUrls    = trackData?.downloadUrl || [];
            if (DEBUG) console.log("[JioSaavn] Vercel stream dlUrls:", dlUrls);
            for (const q of qualitiesToTry) {
              const found = dlUrls.find(d => d.quality === q);
              const streamUrl = found?.link || found?.url;
              if (streamUrl) return { url: streamUrl, quality: q };
            }
            throw new Error(`No URL in Vercel response (got ${dlUrls.length} entries)`);
          } catch (e) {
            console.warn("[JioSaavn] Vercel stream failed:", e.message);
          }
        }
      }

      throw new Error("[JioSaavn] All providers exhausted for track " + trackId);
    },

    renderSkeleton(type) {
      const container = document.getElementById("jss-content-area");
      const s = (w, h, r="4px") => `<div class="jss-skeleton" style="width:${w};height:${h};border-radius:${r};flex-shrink:0;"></div>`;

      if (type === "search" && this.state.searchType === "track") {
        const row = `<div style="display:grid; grid-template-columns:48px 1fr auto auto; align-items:center; gap:12px; padding:6px 8px;">${s("48px","48px")} <div style="display:flex;flex-direction:column;gap:5px;min-width:0;">${s("60%","13px")}${s("40%","11px")}</div>${s("32px","11px")}${s("16px","16px","50%")}</div>`;
        container.innerHTML = `<div class="jss-track-list">${Array(8).fill(row).join("")}</div>`;
      } else if (type === "search") {
        const card = `<div style="padding:8px;"><div style="aspect-ratio:1;background:#222;border-radius:6px;margin-bottom:6px;animation:jss-pulse 1.5s infinite;"></div>${s("80%","13px")}<div style="margin-top:5px;">${s("55%","11px")}</div></div>`;
        container.innerHTML = `<div class="jss-grid-list">${Array(8).fill(card).join("")}</div>`;
      } else if (type === "album" || type === "artist-detail") {
        const row = `<div style="display:grid;grid-template-columns:48px 1fr auto auto;align-items:center;gap:12px;padding:6px 8px;">${s("48px","48px")}<div style="display:flex;flex-direction:column;gap:5px;min-width:0;">${s("55%","13px")}${s("35%","11px")}</div>${s("32px","11px")}${s("16px","16px","50%")}</div>`;
        container.innerHTML = `<div class="jss-hero">${s("160px","160px","8px")}<div style="flex:1;display:flex;flex-direction:column;justify-content:center;gap:10px;">${s("30%","11px")}${s("70%","26px")}${s("50%","13px")}${s("90px","28px","20px")}</div></div><div class="jss-track-list">${Array(6).fill(row).join("")}</div>`;
      }
    },

    render() {
      if (this.state.view === "search") {
        if (this.state.currentData) this.renderSearchResults(this.state.currentData);
      } else if (this.state.view === "album") {
        this.renderAlbumView(this.state.currentData);
      } else if (this.state.view === "artist") {
        this.renderArtistView(this.state.currentData);
      } else if (this.state.view === "playlist") {
        this.renderPlaylistView(this.state.currentData);
      }
    },

    renderSearchResults(results) {
      const container = document.getElementById("jss-content-area");
      if (!results?.length) { container.innerHTML = `<div class="text-center">No results found</div>`; return; }

      if (this.state.searchType === "track") {
        container.innerHTML = `<div class="jss-track-list">${results.map(t => this.renderTrackItem(t, false)).join("")}</div>`;
        this.attachTrackListeners(container, results);
      } else if (this.state.searchType === "artist") {
        container.innerHTML = `<div class="jss-grid-list">${results.map(a => this.renderArtistCard(a)).join("")}</div>`;
        this.attachArtistCardListeners(container, results);
      } else if (this.state.searchType === "playlist") {
        container.innerHTML = `<div class="jss-grid-list">${results.map(p => this.renderPlaylistCard(p)).join("")}</div>`;
        this.attachPlaylistCardListeners(container, results);
      } else {
        container.innerHTML = `<div class="jss-grid-list">${results.map(item => this.renderCard(item, true)).join("")}</div>`;
        this.attachCardListeners(container, results, true);
      }
    },

    renderAlbumView(album) {
      const container = document.getElementById("jss-content-area");
      if (!album) { container.innerHTML = `<div class="jss-unavailable"><div class="jss-unavailable-icon">⚠️</div>Album details unavailable</div>`; return; }

      container.innerHTML = `
        <div class="jss-hero">
          <img src="${this.escapeHtml(album.cover)}" class="jss-hero-cover">
          <div class="jss-hero-info">
            <div class="jss-hero-type">Album</div>
            <div class="jss-hero-title">${this.escapeHtml(album.title)}</div>
            <div class="jss-hero-meta">
              <span class="jss-clickable-artist" data-artist-id="${album.artistId || ""}">${this.escapeHtml(album.artist)}</span>
              ${album.year     ? `• <span>${album.year}</span>` : ""}
              • <span>${album.tracks.length} songs</span>
              ${album.language ? `• <span>${this.escapeHtml(album.language)}</span>` : ""}
            </div>
            <button id="jss-save-all-btn" class="jss-save-all-btn">${ICONS.download} ${this.saveAllLabel(album.tracks.length)}</button>
          </div>
        </div>
        ${album.description ? `<div style="padding:16px 24px 8px;"><p id="jss-album-desc" class="jss-description collapsed">${this.escapeHtml(album.description)}</p><button class="jss-show-more-btn" id="jss-album-desc-toggle">Show more</button></div>` : ""}
        <div class="jss-track-list">${album.tracks.map(t => this.renderTrackItem(t, true)).join("")}</div>
      `;

      container.querySelector(".jss-hero .jss-clickable-artist")?.addEventListener("click", () => {
        if (album.artistId) this.loadArtistPage(album.artistId, album.artist);
      });
      container.querySelector("#jss-save-all-btn").onclick = () => this.saveAllTracks(album.tracks, album);
      this.attachTrackListeners(container, album.tracks);

      const descToggle = container.querySelector("#jss-album-desc-toggle");
      const descEl     = container.querySelector("#jss-album-desc");
      if (descToggle && descEl) {
        descToggle.onclick = () => {
          const collapsed = descEl.classList.toggle("collapsed");
          descToggle.textContent = collapsed ? "Show more" : "Show less";
        };
      }
    },

    renderPlaylistView(playlist) {
      const container = document.getElementById("jss-content-area");
      if (!playlist) {
        container.innerHTML = `<div class="jss-unavailable"><div class="jss-unavailable-icon">⚠️</div>Playlist details unavailable</div>`;
        return;
      }

      const metaParts = [];
      if (playlist.curator)       metaParts.push(`<span>${this.escapeHtml(playlist.curator)}</span>`);
      if (playlist.tracks.length) metaParts.push(`<span>${playlist.tracks.length} songs</span>`);
      if (playlist.language)      metaParts.push(`<span>${this.escapeHtml(playlist.language)}</span>`);
      if (playlist.followerCount) metaParts.push(`<span>${Number(playlist.followerCount).toLocaleString()} followers</span>`);

      container.innerHTML = `
        <div class="jss-hero">
          <img src="${this.escapeHtml(playlist.cover)}" class="jss-hero-cover">
          <div class="jss-hero-info">
            <div class="jss-hero-type">Playlist</div>
            <div class="jss-hero-title">${this.escapeHtml(playlist.title)}</div>
            <div class="jss-hero-meta">${metaParts.join(' • ')}</div>
            ${playlist.tracks.length ? `<button id="jss-save-all-btn" class="jss-save-all-btn">${ICONS.download} ${this.saveAllLabel(playlist.tracks.length)}</button>` : ""}
          </div>
        </div>
        ${playlist.description ? `<div style="padding:16px 24px 8px;"><p id="jss-playlist-desc" class="jss-description collapsed">${this.escapeHtml(playlist.description)}</p><button class="jss-show-more-btn" id="jss-playlist-desc-toggle">Show more</button></div>` : ""}
        <div class="jss-track-list">${playlist.tracks.map(t => this.renderTrackItem(t, false)).join("")}</div>
      `;

      container.querySelector("#jss-save-all-btn")?.addEventListener("click", () => this.saveAllTracks(playlist.tracks, playlist));
      this.attachTrackListeners(container, playlist.tracks);

      const descToggle = container.querySelector("#jss-playlist-desc-toggle");
      const descEl     = container.querySelector("#jss-playlist-desc");
      if (descToggle && descEl) {
        descToggle.onclick = () => {
          const collapsed = descEl.classList.toggle("collapsed");
          descToggle.textContent = collapsed ? "Show more" : "Show less";
        };
      }
    },

    renderArtistView(data) {
      const container = document.getElementById("jss-content-area");
      const {
        artistId, artistName,
        tracks = [], albums = [], singles = [],
        dedicatedPlaylists = [], featuredPlaylists = [], latestRelease = [],
        similarArtists = [],
        artistPicture = null, bio = null, followerCount = null,
        isVerified = false, dominantLanguage = null,
      } = data || {};

      const initials    = (artistName || "?").split(" ").slice(0, 2).map(w => w[0]?.toUpperCase() || "").join("");
      const avatarHtml  = artistPicture
        ? `<div class="jss-artist-avatar" style="padding:0;overflow:hidden;"><img src="${this.escapeHtml(artistPicture)}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;display:block;"></div>`
        : `<div class="jss-artist-avatar">${this.escapeHtml(initials)}</div>`;

      const cleanBio = bio ? bio.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim() : null;

      container.innerHTML = `
        <div class="jss-hero">
          ${avatarHtml}
          <div class="jss-hero-info">
            <div class="jss-hero-type">Artist ${isVerified ? "✓" : ""}</div>
            <div class="jss-hero-title">${this.escapeHtml(artistName || "Unknown Artist")}</div>
            <div class="jss-hero-meta">
              ${followerCount ? `<span>${Number(followerCount).toLocaleString()} followers</span>` : ""}
              ${dominantLanguage ? `<span>· ${this.escapeHtml(dominantLanguage)}</span>` : ""}
            </div>
            ${tracks.length ? `<button id="jss-artist-save-all-btn" class="jss-save-all-btn">${ICONS.download} ${this.saveAllLabel(tracks.length)}</button>` : ""}
          </div>
        </div>

        ${cleanBio ? `<div style="padding:0 24px 16px;"><p id="jss-artist-bio" class="jss-description collapsed">${this.escapeHtml(cleanBio)}</p><button class="jss-show-more-btn" id="jss-bio-toggle">Show more</button></div>` : ""}

        ${tracks.length ? `<div class="jss-section-header">Top Tracks</div><div class="jss-track-list" id="jss-artist-tracks"></div><div id="jss-artist-tracks-loadmore"></div>` : ""}
        ${albums.length ? `<div class="jss-section-header">Albums</div><div class="jss-grid-list" id="jss-artist-albums"></div><div id="jss-artist-albums-loadmore"></div>` : ""}
        ${singles.length ? `<div class="jss-section-header">Singles</div><div class="jss-grid-list" id="jss-artist-singles"></div>` : ""}
        ${latestRelease.length ? `<div class="jss-section-header">Latest Release</div><div class="jss-grid-list" id="jss-artist-latest"></div>` : ""}
        ${dedicatedPlaylists.length ? `<div class="jss-section-header">Artist Playlists</div><div class="jss-grid-list" id="jss-artist-dedicated"></div>` : ""}
        ${featuredPlaylists.length ? `<div class="jss-section-header">Featured In</div><div class="jss-grid-list" id="jss-artist-featured"></div>` : ""}
        ${similarArtists.length ? `<div class="jss-section-header">Similar Artists</div><div class="jss-grid-list" id="jss-artist-similar"></div>` : ""}

        ${!tracks.length && !albums.length && !singles.length && !dedicatedPlaylists.length && !featuredPlaylists.length ? `<div class="jss-unavailable"><div class="jss-unavailable-icon">🎤</div><div>No data found for this artist.</div></div>` : ""}
      `;

      // ── Render initial tracks with server-side load more ────────────────────
      if (tracks.length) {
        const tracksContainer = document.getElementById("jss-artist-tracks");
        tracksContainer.innerHTML = tracks.map(t => this.renderTrackItem(t, false)).join("");
        this.attachTrackListeners(tracksContainer, tracks);
        this._attachArtistLoadMore({
          wrapperId:    "jss-artist-tracks-loadmore",
          type:         "songs",
          artistId,
          loadedItems:  tracks,
          totalKnown:   null, // will be discovered on first fetch
          nextPage:     1,    // page 0 already loaded via get_artist
          renderFn:     newTracks => {
            newTracks.forEach(t => { tracksContainer.innerHTML += this.renderTrackItem(t, false); });
            this.attachTrackListeners(tracksContainer, newTracks);
          },
        });
      }

      // ── Render initial albums with server-side load more ────────────────────
      if (albums.length) {
        const albumsContainer = document.getElementById("jss-artist-albums");
        albumsContainer.innerHTML = albums.map(a => this.renderCard(a, true)).join("");
        this.attachCardListeners(albumsContainer, albums, true);
        this._attachArtistLoadMore({
          wrapperId:    "jss-artist-albums-loadmore",
          type:         "albums",
          artistId,
          loadedItems:  albums,
          totalKnown:   null,
          nextPage:     1,
          renderFn:     newAlbums => {
            newAlbums.forEach(a => { albumsContainer.innerHTML += this.renderCard(a, true); });
            this.attachCardListeners(albumsContainer, newAlbums, true);
          },
        });
      }

      // ── Singles use client-side pagination only (no dedicated endpoint) ─────
      if (singles.length) {
        this._renderPaginatedSection("jss-artist-singles", singles, a => this.renderCard(a, true), (c, v) => this.attachCardListeners(c, v, true));
      }

      // ── Latest release — album cards, client-side paginated ─────────────────
      if (latestRelease.length) {
        this._renderPaginatedSection("jss-artist-latest", latestRelease, a => this.renderCard(a, true), (c, v) => this.attachCardListeners(c, v, true));
      }

      // ── Dedicated artist playlists — playlist cards ─────────────────────────
      if (dedicatedPlaylists.length) {
        this._renderPaginatedSection("jss-artist-dedicated", dedicatedPlaylists, p => this.renderPlaylistCard(p), (c, v) => this.attachPlaylistCardListeners(c, v));
      }

      // ── Featured playlists — playlist cards ─────────────────────────────────
      if (featuredPlaylists.length) {
        this._renderPaginatedSection("jss-artist-featured", featuredPlaylists, p => this.renderPlaylistCard(p), (c, v) => this.attachPlaylistCardListeners(c, v));
      }

      // ── Similar Artists — circular artist cards, click navigates to their page ─
      if (similarArtists.length) {
        this._renderPaginatedSection("jss-artist-similar", similarArtists, a => this.renderArtistCard(a), (c, v) => this.attachArtistCardListeners(c, v));
      }

      const artistSaveAllBtn = container.querySelector("#jss-artist-save-all-btn");
      if (artistSaveAllBtn) artistSaveAllBtn.onclick = () => this.saveAllTracks(tracks);

      const bioToggle = container.querySelector("#jss-bio-toggle");
      const bioEl     = container.querySelector("#jss-artist-bio");
      if (bioToggle && bioEl) {
        bioToggle.onclick = () => {
          const collapsed = bioEl.classList.toggle("collapsed");
          bioToggle.textContent = collapsed ? "Show more" : "Show less";
        };
      }
    },

    // Attaches a "Load More" button for artist songs or albums.
    // Fetches the next page from the direct API when clicked, appends results,
    // and updates itself (re-renders or hides) based on last_page / total.
    // Falls back silently if the direct API is unavailable (e.g. Paxsenix-only session).
    _attachArtistLoadMore({ wrapperId, type, artistId, loadedItems, totalKnown, nextPage, renderFn }) {
      const wrapper = document.getElementById(wrapperId);
      if (!wrapper) return;

      // State captured in closure
      let page       = nextPage;
      let loaded     = loadedItems.length;
      let total      = totalKnown; // null until first fetch resolves
      let isLoading  = false;
      let exhausted  = false;

      const BTN_STYLE = `background:transparent;border:1px solid var(--border-color,#444);color:var(--text-secondary,#aaa);padding:8px 24px;border-radius:20px;font-size:13px;cursor:pointer;transition:0.2s;`;
      const WRAP_STYLE = `text-align:center;padding:16px 0;`;

      const render = () => {
        if (exhausted) { wrapper.innerHTML = ""; return; }
        const remaining = total !== null ? Math.max(0, total - loaded) : null;
        const label = remaining !== null
          ? `Load more (${remaining.toLocaleString()} remaining)`
          : `Load more ${type}`;
        wrapper.innerHTML = `<div style="${WRAP_STYLE}"><button style="${BTN_STYLE}" id="${wrapperId}-btn">${label}</button></div>`;
        document.getElementById(`${wrapperId}-btn`).onclick = async () => {
          if (isLoading) return;
          isLoading = true;
          const btn = document.getElementById(`${wrapperId}-btn`);
          if (btn) { btn.disabled = true; btn.textContent = "Loading…"; }

          try {
            const result = type === "songs"
              ? await this.fetchMoreArtistSongs(artistId, page)
              : await this.fetchMoreArtistAlbums(artistId, page);

            if (!result) { exhausted = true; render(); return; }

            const items = type === "songs" ? result.songs : result.albums;
            total   = result.total;
            loaded += items.length;
            page++;

            if (items.length) renderFn(items);

            exhausted = result.last_page || loaded >= total;
            render();
          } catch (e) {
            console.error("[JioSaavn] _attachArtistLoadMore failed:", e);
            exhausted = true; render();
          } finally {
            isLoading = false;
          }
        };
      };

      // Only show the button if the direct API is available.
      // Paxsenix already returns all it has upfront — no pagination endpoint exists for it.
      // We detect this by checking if the source is "direct" on any loaded item,
      // or if we have no source info, we show the button and let it fail gracefully.
      const source = loadedItems[0]?._source;
      if (source === "paxsenix" || source === "vercel") {
        // These sources don't have a more-songs/more-albums endpoint — hide button
        wrapper.innerHTML = "";
        return;
      }

      render();
    },

    _renderPaginatedSection(containerId, items, renderFn, attachFn, pageSize = 20) {
      const container = document.getElementById(containerId);
      if (!container) return;
      let shown = pageSize;
      const render = () => {
        const visible   = items.slice(0, shown);
        const remaining = items.length - shown;
        container.innerHTML = visible.map(renderFn).join("") + (remaining > 0
          ? `<div id="${containerId}-show-more" style="grid-column:1/-1;text-align:center;padding:16px 0;"><button style="background:transparent;border:1px solid var(--border-color,#444);color:var(--text-secondary,#aaa);padding:8px 24px;border-radius:20px;font-size:13px;cursor:pointer;">Show ${Math.min(remaining, pageSize)} more <span style="color:var(--text-subdued,#666);">(${remaining} left)</span></button></div>`
          : "");
        attachFn(container, visible);
        const btn = document.getElementById(`${containerId}-show-more`);
        if (btn) {
          btn.querySelector("button").onclick = () => { shown += pageSize; render(); };
        }
      };
      render();
    },

    renderTrackItem(track, isCompact = false) {
      const isPlaying = this.isPlaying === String(track.id);
      const isSaved   = this.libraryTracks.has(String(track.id));
      const coverUrl  = track.cover || "";

      const explicitBadge = track.explicitContent ? `<span class="jss-explicit-badge">E</span>` : "";

      return `
        <div class="jss-track-item ${isPlaying ? "playing" : ""}" data-id="${track.id}">
          <div class="jss-track-cover-wrapper">
            ${isCompact && track.trackNumber
              ? `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:13px;color:var(--text-subdued,#666);">${track.trackNumber}</div>`
              : `<img src="${this.escapeHtml(coverUrl)}" class="jss-track-cover" loading="lazy">`
            }
            <div class="jss-play-overlay">${isPlaying ? ICONS.play : ""}</div>
          </div>
          <div style="min-width:0;">
            <div class="jss-track-title">
              <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;">${this.escapeHtml(track.title)}</span>
              ${explicitBadge}
            </div>
            ${!isCompact
              ? `<div class="jss-track-artist">
                  <span class="jss-clickable-artist" data-artist-id="${track.artistId || ""}">${this.escapeHtml(track.artist)}</span>
                  ${track.albumTitle ? `<span style="color:var(--text-subdued,#666);font-size:11px;margin:0 3px;">·</span><span class="jss-clickable-album" data-album-id="${track.albumId || ""}">${this.escapeHtml(track.albumTitle)}</span>` : ""}
                  ${track.language ? `<span style="color:var(--text-subdued,#555);font-size:11px;margin-left:4px;">· ${this.escapeHtml(track.language)}</span>` : ""}
                </div>`
              : ""}
          </div>
          ${!isCompact ? `<div class="jss-track-time">${this.formatDuration(track.duration)}</div>` : ""}
          <div class="jss-track-actions">
            <button class="jss-save-btn-mini ${isSaved ? "saved" : ""}" title="${isSaved ? "Saved to Library" : "Add to Library"}">
              ${isSaved ? ICONS.heart : ICONS.heartOutline}
            </button>
          </div>
        </div>
      `;
    },

    renderCard(item, isAlbum) {
      const imgUrl  = item.cover || "";
      const title   = isAlbum ? item.title : item.name;
      const subText = isAlbum ? item.artist : (item.followerCount ? `${Number(item.followerCount).toLocaleString()} followers` : "Artist");
      const count   = isAlbum && item.songCount ? `${item.songCount} songs` : null;
      const imgHtml = imgUrl
        ? `<img src="${this.escapeHtml(imgUrl)}" class="jss-card-img" loading="lazy">`
        : `<div class="jss-card-img" style="background:var(--bg-highlight,#2a2a2a);"></div>`;

      return `
        <div class="jss-card" data-id="${item.id}">
          ${imgHtml}
          <div class="jss-card-title">${this.escapeHtml(title)}</div>
          <div class="jss-card-sub">
            ${isAlbum && item.artistId
              ? `<span class="jss-card-sub-text jss-clickable-artist" data-artist-id="${item.artistId}">${this.escapeHtml(subText)}</span>`
              : `<span class="jss-card-sub-text">${this.escapeHtml(subText)}</span>`
            }
            ${count ? `<span class="jss-card-sub-count">· ${count}</span>` : ""}
          </div>
        </div>
      `;
    },

    renderArtistCard(artist) {
      const initials   = (artist.name || "?").split(" ").slice(0, 2).map(w => w[0]?.toUpperCase() || "").join("");
      const avatarHtml = artist.cover
        ? `<div class="jss-artist-card-avatar" style="padding:0;overflow:hidden;"><img src="${this.escapeHtml(artist.cover)}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;display:block;"></div>`
        : `<div class="jss-artist-card-avatar">${this.escapeHtml(initials)}</div>`;
      return `
        <div class="jss-card jss-artist-card" data-id="${artist.id}">
          ${avatarHtml}
          <div class="jss-card-title">${this.escapeHtml(artist.name)}</div>
          <div class="jss-card-sub"><span class="jss-card-sub-text">${artist.followerCount ? `${Number(artist.followerCount).toLocaleString()} followers` : "Artist"}</span></div>
        </div>
      `;
    },

    renderPlaylistCard(playlist) {
      const imgUrl   = playlist.cover || "";
      const subText  = playlist.songCount ? `${playlist.songCount} songs` : (playlist.subtitle || "Playlist");
      const imgHtml  = imgUrl
        ? `<img src="${this.escapeHtml(imgUrl)}" class="jss-card-img" loading="lazy">`
        : `<div class="jss-card-img" style="background:linear-gradient(135deg,var(--bg-highlight,#2a2a2a),var(--bg-surface,#202020));display:flex;align-items:center;justify-content:center;"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.3"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg></div>`;
      return `
        <div class="jss-card jss-playlist-card" data-id="${playlist.id}">
          <div style="position:relative;">
            ${imgHtml}
            <div style="position:absolute;bottom:6px;right:6px;background:rgba(0,0,0,0.65);border-radius:4px;padding:2px 6px;font-size:10px;font-weight:700;color:#fff;letter-spacing:0.3px;">PLAYLIST</div>
          </div>
          <div class="jss-card-title">${this.escapeHtml(playlist.title)}</div>
          <div class="jss-card-sub"><span class="jss-card-sub-text">${this.escapeHtml(subText)}</span></div>
        </div>
      `;
    },

    // Playlist cards navigate to the playlist detail page.
    attachPlaylistCardListeners(container, playlists) {
      container.querySelectorAll(".jss-playlist-card").forEach(el => {
        el.style.cursor = "pointer";
        el.onclick = () => {
          const playlist = playlists.find(p => String(p.id) === String(el.dataset.id));
          if (playlist) this.loadPlaylistPage(playlist.id, playlist.title);
        };
      });
    },



    attachArtistCardListeners(container, artists) {
      container.querySelectorAll(".jss-artist-card").forEach(el => {
        el.onclick = () => {
          const artist = artists.find(a => String(a.id) === String(el.dataset.id));
          if (artist) this.loadArtistPage(artist.id, artist.name);
        };
      });
    },

    attachTrackListeners(container, tracks) {
      container.querySelectorAll(".jss-track-item").forEach(el => {
        el.onclick = (e) => {
          const artistClick = e.target.closest(".jss-clickable-artist");
          if (artistClick) {
            const id = artistClick.dataset.artistId;
            const name = artistClick.textContent;
            if (id) this.loadArtistPage(id, name);
            return;
          }
          const albumClick = e.target.closest(".jss-clickable-album");
          if (albumClick) {
            const id    = albumClick.dataset.albumId;
            const title = albumClick.textContent.trim();
            if (id) this.loadAlbumPage(id, title);
            return;
          }
          const track = tracks.find(t => String(t.id) === String(el.dataset.id));
          if (!track) return;
          const saveBtn = e.target.closest(".jss-save-btn-mini");
          if (saveBtn) { this.saveTrack(track, saveBtn); return; }
          this.playTrack(track);
        };
      });
    },

    attachCardListeners(container, items, isAlbum) {
      container.querySelectorAll(".jss-card").forEach(el => {
        el.onclick = (e) => {
          const artistClick = e.target.closest(".jss-clickable-artist");
          if (artistClick) {
            e.stopPropagation();
            const id   = artistClick.dataset.artistId;
            const name = artistClick.textContent.trim();
            if (id) this.loadArtistPage(id, name);
            return;
          }
          const item = items.find(i => String(i.id) === String(el.dataset.id));
          if (!item) return;
          if (isAlbum) this.loadAlbumPage(item.id, item.title);
          else this.loadArtistPage(item.id, item.name);
        };
      });
    },

    async loadAlbumPage(id, title) {
      document.getElementById("jss-controls-area")?.classList.add("hidden");
      this.showToast("Loading album...");
      const albumData = await this.fetchAlbumDetails(id);
      this.navigateTo("album", albumData, albumData?.title || title);
    },

    async loadArtistPage(id, name) {
      document.getElementById("jss-controls-area")?.classList.add("hidden");
      this.renderSkeleton("artist-detail");
      const artistData = await this.fetchArtistDetails(id, name);
      this.navigateTo("artist", artistData, name);
    },

    async loadPlaylistPage(id, title) {
      document.getElementById("jss-controls-area")?.classList.add("hidden");
      this.showToast("Loading playlist...");
      const playlistData = await this.fetchPlaylistDetails(id);
      this.navigateTo("playlist", playlistData, playlistData?.title || title);
    },

    // search registry
    // Called by the runtime when another plugin queries api.search.query
    // must call onResult exactly once with status success, not_found,error

    async handleSearchQuery(query, onResult) {
      try {
        const searchQuery = `${query.title} ${query.artist || ""}`.trim();

        for (const provider of getProviderOrder()) {

          //direct
          if (provider === "direct") {
            try {
              const data = await JioSaavnAPI.search_songs(searchQuery, 0, 10);
              const items = (data.results || []).map(t => normalizeTrack({ ...t, _source: "direct" }));
              const best  = this._pickBestMatch(items, query);
              if (best) { onResult(this.saavnTrackToSearchResult(best.track, best.score)); return; }
            } catch (e) {
              console.warn("[JioSaavn] handleSearchQuery — direct failed:", e.message);
            }
          }

          // pax
          else if (provider === "pax") {
            const paxAuth = getPaxAuth();
            if (!paxAuth) continue;
            try {
              const url = `${PAX_BASE}/search?q=${encodeURIComponent(searchQuery)}`;
              const res = await (this.api.fetch
                ? this.api.fetch(url, { headers: { "Authorization": paxAuth } })
                : fetch(url,          { headers: { "Authorization": paxAuth } }));
              if (res.ok) {
                const data  = await res.json();
                const items = (data.results || []).map(t => normalizeTrack({ ...t, _source: "paxsenix" }));
                const best  = this._pickBestMatch(items, query);
                if (best) { onResult(this.saavnTrackToSearchResult(best.track, best.score)); return; }
              }
            } catch (e) {
              console.warn("[JioSaavn] handleSearchQuery — Paxsenix failed:", e.message);
            }
          }

          // vercel
          else if (provider === "vercel") {
            try {
              const url = `${VERCEL_BASE}/search/songs?query=${encodeURIComponent(searchQuery)}&limit=10`;
              const res = await (this.api.fetch ? this.api.fetch(url) : fetch(url));
              if (res.ok) {
                const data  = await res.json();
                const items = (data?.data?.results || []).map(t => normalizeTrack({ ...t, _source: "vercel" }));
                const best  = this._pickBestMatch(items, query);
                if (best) { onResult(this.saavnTrackToSearchResult(best.track, best.score)); return; }
              }
            } catch (e) {
              console.warn("[JioSaavn] handleSearchQuery — Vercel failed:", e.message);
            }
          }
        }

        // all providers exhausted
        onResult({ sourceId: SOURCE_TYPE, status: "not_found" });
      } catch (err) {
        console.error("[JioSaavn] handleSearchQuery error:", err);
        onResult({ sourceId: SOURCE_TYPE, status: "error", error: err });
      }
    },

    // score all and return the best above threshold, or null.
    _pickBestMatch(items, query) {
      if (!items.length) return null;
      const scored = items
        .map(t => ({ track: t, score: this.calculateMatchScore(t, query) }))
        .sort((a, b) => b.score - a.score);
      return scored[0].score >= 60 ? scored[0] : null;
    },

    calculateMatchScore(track, query) {
      let score = 0;
      const n = (s) => (s || "").toLowerCase().replace(/[^\w\s]/g, "").replace(/\s+/g, " ").trim();

      const tTitle = n(track.title);
      const qTitle = n(query.title);
      if (tTitle === qTitle) score += 50;
      else if (tTitle.includes(qTitle) || qTitle.includes(tTitle)) score += 30;

      const tArtist = n(track.artist);
      const qArtist = n(query.artist || "");
      if (tArtist === qArtist) score += 30;
      else if (tArtist.includes(qArtist) || qArtist.includes(tArtist)) score += 15;

      if (query.duration_ms && track.duration) {
        const diff = Math.abs(track.duration - query.duration_ms / 1000);
        if (diff < 5) score += 20;
        else if (diff < 10) score += 10;
      }

      return score;
    },

    // normalize  Saavn track
    saavnTrackToSearchResult(track, score = 0) {
      return {
        sourceId:    SOURCE_TYPE,
        status:      "success",
        source_type: SOURCE_TYPE,
        external_id: String(track.id),
        title:       track.title,
        artist:      track.artist   || null,
        album:       track.albumTitle || null,
        duration:    track.duration  || null,
        cover_url:   track.cover     || null,
        track_number: null,
        disc_number:  null,
        format:      track.highestQuality || DEFAULT_QUALITY,
        bitrate:     null,
        musicbrainz_recording_id: null,
        metadata_json: {
          language:        track.language        || null,
          explicit_content: track.explicitContent || false,
          has_lyrics:      track.hasLyrics        || false,
          play_count:      track.playCount        || null,
          highest_quality: track.highestQuality   || null,
          provider:        track._source          || null,
        },
        score,
        raw: track,
      };
    },

    // ── Actions ───────────────────────────────────────────────────────────────

    async playTrack(track) {
      try {
        const streamData = await this.fetchStream(track.id);
        if (!streamData?.url) throw new Error("No stream URL");

        this.isPlaying = String(track.id);
        document.querySelectorAll(".jss-track-item").forEach(el => {
          el.classList.toggle("playing", el.dataset.id === String(track.id));
        });

        if (this.api?.player?.setTrack) {
          this.api.player.setTrack({
            id:          track.id,
            path:        streamData.url,
            source_type: SOURCE_TYPE,
            title:       track.title,
            artist:      track.artist,
            album:       track.albumTitle || null,
            duration:    track.duration   || null,
            cover_url:   track.cover      || null,
            format:      streamData.quality || DEFAULT_QUALITY,
          });
        }

        this.updateNowPlaying(track);
        this.showToast(`▶ ${track.title} [${streamData.quality}]`);
      } catch (err) {
        console.error("[JioSaavn] Playback error:", err);
        this.showToast("Playback failed — no stream available.", true);
      }
    },

    async saveTrack(track, btn) {
      try {
        if (this.libraryTracks.has(String(track.id))) { this.showToast("Already in library"); return; }
        if (this.api?.library?.addExternalTrack) {
          await this.api.library.addExternalTrack(this.saavnTrackToSearchResult(track));
          this.libraryTracks.add(String(track.id));
          if (btn) { btn.classList.add("saved"); btn.innerHTML = ICONS.heart; btn.title = "Saved to Library"; }
          this.showToast(`Saved: ${track.title}`);
          this.hasNewChanges = true;
        }
      } catch (e) {
        console.error("[JioSaavn] saveTrack error:", e);
        this.showToast("Error saving track", true);
      }
    },

    async saveAllTracks(tracks, albumData = null) {
      if (!tracks?.length) { this.showToast("No tracks to save", true); return; }

      const progressEl   = document.getElementById("jiosaavn-save-progress");
      const progressBar  = progressEl?.querySelector(".jss-progress-bar-inner");
      const progressText = progressEl?.querySelector(".jss-progress-text");
      if (progressEl) progressEl.classList.remove("hidden");

      let savedCount = 0, skippedCount = 0, errorCount = 0;

      for (let i = 0; i < tracks.length; i++) {
        const track = tracks[i];
        const pct = ((i + 1) / tracks.length) * 100;
        if (progressBar)  progressBar.style.width = `${pct}%`;
        if (progressText) progressText.textContent = `Saving ${i + 1} of ${tracks.length} tracks...`;

        if (this.libraryTracks.has(String(track.id))) { skippedCount++; continue; }

        try {
          if (this.api?.library?.addExternalTrack) {
            const result = this.saavnTrackToSearchResult(
              albumData ? { ...track, albumTitle: track.albumTitle || albumData.title, cover: track.cover || albumData.cover, artist: track.artist || albumData.artist } : track
            );
            await this.api.library.addExternalTrack(result);
            this.libraryTracks.add(String(track.id));
            savedCount++;
            const row = document.querySelector(`.jss-track-item[data-id="${track.id}"]`);
            if (row) { const btn = row.querySelector(".jss-save-btn-mini"); if (btn) { btn.classList.add("saved"); btn.innerHTML = ICONS.heart; } }
          }
        } catch (e) {
          console.error("[JioSaavn] Failed to save track", track.id, e);
          errorCount++;
        }
        await new Promise(r => setTimeout(r, 50));
      }

      if (progressEl) progressEl.classList.add("hidden");
      if (progressBar) progressBar.style.width = "0%";

      this.showToast(errorCount === 0
        ? (skippedCount > 0 ? `✓ Saved ${savedCount} tracks (${skippedCount} already in library)` : `✓ Saved all ${savedCount} tracks`)
        : `Saved ${savedCount} tracks, ${errorCount} failed`, errorCount > savedCount / 2);

      this.hasNewChanges = true;
    },

    // searchCoverForRPC: tries all sources in the configured provider order
    async searchCoverForRPC(title, artist, trackId) {
      try {
        const query = `${title} ${artist}`.trim();

        const applyCover = async (cover) => {
          if (cover && trackId && this.api.library?.updateTrackCoverUrl) {
            try { await this.api.library.updateTrackCoverUrl(trackId, cover); } catch {}
          }
          return cover;
        };

        for (const provider of getProviderOrder()) {
          if (provider === "pax") {
            const paxAuth = getPaxAuth();
            if (!paxAuth) continue;
            try {
              const url = `${PAX_BASE}/search?q=${encodeURIComponent(query)}`;
              const res = await (this.api.fetch
                ? this.api.fetch(url, { headers: { "Authorization": paxAuth } })
                : fetch(url,          { headers: { "Authorization": paxAuth } }));
              if (res.ok) {
                const data  = await res.json();
                const items = data?.results || [];
                const cover = items[0]
                  ? ((items[0].image || [])[2]?.url || (items[0].image || [])[2]?.link ||
                     (items[0].image || [])[1]?.url || (items[0].image || [])[1]?.link || null)
                  : null;
                if (cover) return applyCover(cover);
              }
            } catch (e) {
              console.warn("[JioSaavn:searchCoverForRPC] Paxsenix failed:", e.message);
            }
          }

          else if (provider === "direct") {
            try {
              const data  = await JioSaavnAPI.search_songs(query, 0, 5);
              const cover = (data.results?.[0]?.image || [])[2]?.url
                         || (data.results?.[0]?.image || [])[1]?.url || null;
              if (cover) return applyCover(cover);
            } catch (e) {
              console.warn("[JioSaavn:searchCoverForRPC] Direct failed:", e.message);
            }
          }

          else if (provider === "vercel") {
            try {
              const url = `${VERCEL_BASE}/search/songs?query=${encodeURIComponent(query)}&limit=5`;
              const res = await (this.api.fetch ? this.api.fetch(url) : fetch(url));
              if (res.ok) {
                const data  = await res.json();
                const items = data?.data?.results || [];
                const cover = items[0]
                  ? ((items[0].image || [])[2]?.url || (items[0].image || [])[1]?.url || null)
                  : null;
                if (cover) return applyCover(cover);
              }
            } catch (e) {
              console.warn("[JioSaavn:searchCoverForRPC] Vercel failed:", e.message);
            }
          }
        }

        return null;
      } catch (err) {
        console.error("[JioSaavn:searchCoverForRPC]", err);
        return null;
      }
    },

    // updateNowPlaying: the app's player UI is updated via api.player.setTrack().
    // Direct DOM manipulation is unreliable across host app versions — intentional no-op.
    updateNowPlaying(track) { },

    // showToast
    showToast(msg, isError = false, withSettingsLink = false) {
      const toast = document.createElement("div");
      toast.style.cssText = `position:fixed;bottom:100px;left:50%;transform:translateX(-50%);background:${isError ? "#c0392b" : "#333"};color:#fff;padding:10px 20px;border-radius:8px;z-index:10002;font-size:13px;box-shadow:0 4px 12px rgba(0,0,0,0.3);opacity:0;transition:0.3s;display:flex;align-items:center;gap:12px;white-space:nowrap;`;
      const textSpan = document.createElement("span");
      textSpan.textContent = msg;
      toast.appendChild(textSpan);
      document.body.appendChild(toast);
      requestAnimationFrame(() => toast.style.opacity = "1");
      setTimeout(() => { toast.style.opacity = "0"; setTimeout(() => toast.remove(), 300); }, withSettingsLink ? 6000 : 3000);
    },

    start()   { },
    stop()    { this.close(); },
    destroy() {
      this.close();
      document.getElementById("jiosaavn-search-styles-v1")?.remove();
      document.getElementById("jiosaavn-search-panel")?.remove();
      document.getElementById("jiosaavn-search-overlay")?.remove();
      document.getElementById("jss-search-btn")?.remove();
      document.getElementById("jiosaavn-save-progress")?.remove();
    }
  };

  if (typeof Audion !== "undefined" && Audion.register) {
    Audion.register(JioSaavnSearch);
  } else {
    window.JioSaavnSearch = JioSaavnSearch;
    window.AudionPlugin   = JioSaavnSearch;
  }

})();