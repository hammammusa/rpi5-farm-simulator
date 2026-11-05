// wb-rules API for the simulated Wiren Board, evaluated inside the QuickJS sandbox before the
// user's scripts. It follows the wb-rules README (github.com/wirenboard/wb-rules): cells are
// the MQTT controls /devices/<device>/controls/<control>; writing an external control publishes
// to …/on and its value changes when the driver answers; virtual devices change at once.
// Host primitives (provided by the simulator): __host_publish, __host_subscribe, __host_log,
// __host_timer, __host_cancel, __host_now.
(function (G) {
  'use strict';
  // the controller's clock is the simulation clock (also in fast-forward): new Date() and
  // Date.now() give simulation time; the time zone is the one of the computer running the page
  var HostDate = G.Date;
  class SimDate extends HostDate {
    constructor() {
      if (arguments.length) super(...arguments);
      else super(__host_now());
    }
    static now() {
      return __host_now();
    }
  }
  G.Date = SimDate;
  var cells = {}; // "dev/ctl" -> { value, type, readonly, meta }
  var virtualDevs = {};
  var rules = [];
  var queue = [];
  var processing = false;
  var callbacks = {}; // host timer id -> fn
  var namedTimers = {}; // startTimer/startTicker name -> { id, firing }
  var mqttTracks = []; // { filter, fn }
  var crons = [];
  var started = false;

  function str(v) {
    if (v === true) return '1';
    if (v === false) return '0';
    if (v === null || v === undefined) return '';
    return String(v);
  }

  function typed(type, payload) {
    switch (type) {
      case 'switch':
      case 'pushbutton':
      case 'alarm':
        return payload === '1' || payload === 'true';
      case 'text':
      case 'rgb':
        return payload;
      default: {
        if (payload === '') return payload;
        var n = Number(payload);
        return isNaN(n) ? payload : n;
      }
    }
  }

  function cell(key) {
    if (!cells[key]) cells[key] = { value: null, type: null, readonly: false, raw: null };
    return cells[key];
  }

  function splitKey(key) {
    var i = key.indexOf('/');
    if (i < 0) throw new Error('control name must be "device/control", got "' + key + '"');
    return [key.slice(0, i), key.slice(i + 1)];
  }

  function readCell(key) {
    splitKey(key);
    var c = cells[key];
    return c ? c.value : null;
  }

  function writeCell(key, v) {
    var p = splitKey(key);
    var dev = p[0];
    var ctl = p[1];
    if (virtualDevs[dev]) {
      var c = cell(key);
      if (c.type === null) throw new Error('virtual device ' + dev + ' has no control ' + ctl);
      var payload = str(v);
      var nv = typed(c.type, payload);
      // a pushbutton is an event: every press reaches the rules, it keeps no state
      if (c.type === 'pushbutton') {
        __host_publish('/devices/' + dev + '/controls/' + ctl, '1', false);
        changed(key, true);
        return;
      }
      __host_publish('/devices/' + dev + '/controls/' + ctl, payload, true);
      if (c.value !== nv) {
        c.value = nv;
        c.raw = payload;
        changed(key, nv);
      }
    } else {
      __host_publish('/devices/' + dev + '/controls/' + ctl + '/on', str(v), false);
    }
  }

  function devProxy(dev) {
    return new Proxy(
      {},
      {
        get: function (_, c) {
          return typeof c === 'string' ? readCell(dev + '/' + c) : undefined;
        },
        set: function (_, c, v) {
          writeCell(dev + '/' + String(c), v);
          return true;
        },
      },
    );
  }

  G.dev = new Proxy(
    {},
    {
      get: function (_, k) {
        if (typeof k !== 'string') return undefined;
        return k.indexOf('/') >= 0 ? readCell(k) : devProxy(k);
      },
      set: function (_, k, v) {
        writeCell(String(k), v);
        return true;
      },
    },
  );

  G.defineVirtualDevice = function (name, def) {
    if (!def || typeof def !== 'object') throw new Error('defineVirtualDevice: definition object expected');
    virtualDevs[name] = true;
    __host_publish('/devices/' + name + '/meta/name', str(def.title && def.title.en ? def.title.en : def.title || name), true);
    __host_publish('/devices/' + name + '/meta', JSON.stringify({ driver: 'wb-rules', title: def.title || name }), true);
    var order = 1;
    var names = Object.keys(def.cells || {});
    for (var i = 0; i < names.length; i++) {
      var ctl = names[i];
      var cd = def.cells[ctl];
      var key = name + '/' + ctl;
      var c = cell(key);
      c.type = cd.type || 'value';
      c.readonly = !!cd.readonly;
      var base = '/devices/' + name + '/controls/' + ctl;
      var meta = { type: c.type, readonly: c.readonly, order: cd.order || order };
      if (cd.min !== undefined) meta.min = cd.min;
      if (cd.max !== undefined) meta.max = cd.max;
      if (cd.units) meta.units = cd.units;
      __host_publish(base + '/meta/type', c.type, true);
      __host_publish(base + '/meta/readonly', c.readonly ? '1' : '0', true);
      if (cd.max !== undefined) __host_publish(base + '/meta/max', str(cd.max), true);
      __host_publish(base + '/meta', JSON.stringify(meta), true);
      var init = cd.value !== undefined ? cd.value : c.type === 'switch' || c.type === 'pushbutton' ? false : c.type === 'text' ? '' : 0;
      c.value = typed(c.type, str(init));
      c.raw = str(init);
      __host_publish(base, c.raw, true);
      order++;
    }
    return getDevice(name);
  };

  // ---------------------------------------------------------------- newer object API
  function getDevice(name) {
    return {
      getId: function () {
        return name;
      },
      isVirtual: function () {
        return !!virtualDevs[name];
      },
      isControlExists: function (c) {
        return !!cells[name + '/' + c];
      },
      getControl: function (c) {
        var key = name + '/' + c;
        return {
          getId: function () {
            return c;
          },
          getValue: function () {
            return readCell(key);
          },
          setValue: function (v) {
            writeCell(key, v && typeof v === 'object' && 'value' in v ? v.value : v);
          },
          getType: function () {
            return cell(key).type;
          },
          getReadonly: function () {
            return cell(key).readonly;
          },
          getError: function () {
            return cell(key).error || '';
          },
        };
      },
    };
  }
  G.getDevice = getDevice;
  G.getControl = function (key) {
    var p = splitKey(key);
    return getDevice(p[0]).getControl(p[1]);
  };

  // ---------------------------------------------------------------- rules
  G.defineRule = function (name, def) {
    if (typeof name === 'object') {
      def = name;
      name = 'rule' + (rules.length + 1);
    }
    if (!def || typeof def.then !== 'function') throw new Error('defineRule("' + name + '"): "then" function is required');
    var kinds = ['whenChanged', 'asSoonAs', 'when', 'cron'].filter(function (k) {
      return def[k] !== undefined;
    });
    if (kinds.length !== 1) throw new Error('defineRule("' + name + '"): exactly one of whenChanged, asSoonAs, when or cron is required');
    var r = { name: name, def: def, kind: kinds[0], last: undefined, enabled: true };
    if (r.kind === 'whenChanged') {
      var w = def.whenChanged;
      r.watch = (Array.isArray(w) ? w : [w]).map(function (x) {
        return typeof x === 'function' ? { fn: x, last: undefined } : { key: String(x) };
      });
    }
    if (r.kind === 'cron') crons.push({ rule: r, spec: parseCron(String(def.cron)), next: 0 });
    rules.push(r);
    return r;
  };
  G.disableRule = function (r) {
    if (r) r.enabled = false;
  };
  G.enableRule = function (r) {
    if (r) r.enabled = true;
  };
  G.runRule = function (r) {
    if (r) r.def.then();
  };

  function run(r, args) {
    try {
      r.def.then.apply(null, args || []);
    } catch (e) {
      reportError(e, 'rule "' + r.name + '"');
    }
  }

  function reportError(e, where) {
    var stack = e && e.stack ? String(e.stack) : '';
    __host_log('error', 'ERROR in ' + where + ': ' + (e && e.name ? e.name + ': ' : '') + (e && e.message ? e.message : String(e)) + (stack ? '\n' + stack : ''));
  }

  function evalCond(fn, where) {
    try {
      return fn();
    } catch (e) {
      reportError(e, where);
      return undefined;
    }
  }

  function changed(key, value) {
    queue.push({ key: key, value: value });
    process();
  }

  function check(changedKey, changedValue) {
    for (var i = 0; i < rules.length; i++) {
      var r = rules[i];
      if (!r.enabled) continue;
      if (r.kind === 'whenChanged') {
        for (var k = 0; k < r.watch.length; k++) {
          var w = r.watch[k];
          if (w.key !== undefined) {
            if (changedKey !== null && w.key === changedKey) {
              var p = splitKey(changedKey);
              run(r, [changedValue, p[0], p[1]]);
            }
          } else {
            var v = evalCond(w.fn, 'rule "' + r.name + '"');
            var was = w.last;
            w.last = v;
            if (was !== undefined && v !== was) run(r, [v]);
          }
        }
      } else if (r.kind === 'asSoonAs') {
        var on = !!evalCond(r.def.asSoonAs, 'rule "' + r.name + '"');
        var prev = r.last;
        r.last = on;
        if (on && !prev) run(r, []);
      } else if (r.kind === 'when') {
        if (evalCond(r.def.when, 'rule "' + r.name + '"')) run(r, []);
      }
    }
  }

  function process() {
    if (processing || !started) return;
    processing = true;
    var guard = 0;
    try {
      while (queue.length) {
        if (++guard > 200) {
          __host_log('error', 'ERROR: rules keep changing each other (more than 200 changes in a row) — stopped this chain to avoid an endless loop');
          queue = [];
          break;
        }
        var ev = queue.shift();
        check(ev.key, ev.value);
      }
    } finally {
      processing = false;
    }
  }

  // ---------------------------------------------------------------- timers
  function addTimer(fn, ms, periodic) {
    if (typeof fn !== 'function') throw new TypeError('timer callback must be a function');
    var id = __host_timer(Math.max(0, Number(ms) || 0), !!periodic);
    callbacks[id] = { fn: fn, periodic: !!periodic };
    return id;
  }
  G.setTimeout = function (fn, ms) {
    return addTimer(fn, ms, false);
  };
  G.setInterval = function (fn, ms) {
    return addTimer(fn, ms, true);
  };
  G.clearTimeout = G.clearInterval = function (id) {
    if (callbacks[id]) {
      delete callbacks[id];
      __host_cancel(id);
    }
  };
  function named(name, ms, periodic) {
    var t = namedTimers[name];
    if (t && t.id) G.clearTimeout(t.id);
    t = namedTimers[name] = { id: 0, firing: false, periodic: periodic };
    t.id = addTimer(function () {
      t.firing = true;
      try {
        changed(null, null);
      } finally {
        t.firing = false;
      }
      if (!periodic) t.id = 0;
    }, ms, periodic);
  }
  G.startTimer = function (name, ms) {
    named(name, ms, false);
  };
  G.startTicker = function (name, ms) {
    named(name, ms, true);
  };
  G.timers = new Proxy(
    {},
    {
      get: function (_, name) {
        var t = namedTimers[name];
        return {
          firing: !!(t && t.firing),
          stop: function () {
            if (t && t.id) G.clearTimeout(t.id);
            if (t) t.id = 0;
          },
        };
      },
    },
  );

  // ---------------------------------------------------------------- cron
  function parseCron(spec) {
    var m = /^@every\s+(\d+(?:\.\d+)?)(ms|s|m|h)$/.exec(spec);
    if (m) return { every: Number(m[1]) * { ms: 1, s: 1000, m: 60000, h: 3600000 }[m[2]] };
    var alias = { '@hourly': '0 0 * * * *', '@daily': '0 0 0 * * *', '@midnight': '0 0 0 * * *', '@weekly': '0 0 0 * * 0', '@monthly': '0 0 0 1 * *', '@yearly': '0 0 0 1 1 *', '@annually': '0 0 0 1 1 *' };
    var s = alias[spec] || spec;
    var f = s.trim().split(/\s+/);
    if (f.length === 5) f.unshift('0');
    if (f.length !== 6) throw new Error('cron: unsupported expression "' + spec + '" (use "@every 10s", "@hourly", "@daily" or "sec min hour day month weekday")');
    return { fields: f };
  }
  function fieldMatch(expr, v) {
    return expr.split(',').some(function (part) {
      var step = 1;
      var sm = /^(.*)\/(\d+)$/.exec(part);
      if (sm) {
        part = sm[1];
        step = Number(sm[2]);
      }
      var lo, hi;
      if (part === '*' || part === '?') {
        lo = 0;
        hi = 99;
      } else if (part.indexOf('-') > 0) {
        lo = Number(part.split('-')[0]);
        hi = Number(part.split('-')[1]);
      } else {
        lo = Number(part);
        hi = sm ? 99 : lo;
      }
      return v >= lo && v <= hi && (v - lo) % step === 0;
    });
  }
  function cronDue(spec, d) {
    var f = spec.fields;
    return fieldMatch(f[0], d.getSeconds()) && fieldMatch(f[1], d.getMinutes()) && fieldMatch(f[2], d.getHours()) && fieldMatch(f[3], d.getDate()) && fieldMatch(f[4], d.getMonth() + 1) && fieldMatch(f[5], d.getDay());
  }

  // ---------------------------------------------------------------- MQTT, logging, misc
  G.trackMqtt = function (filter, fn) {
    mqttTracks.push({ filter: String(filter), fn: fn });
    __host_subscribe(String(filter));
  };
  G.publish = function (topic, payload, qos, retain) {
    __host_publish(String(topic), str(payload), !!retain);
  };

  function format(args) {
    var a = Array.prototype.slice.call(args);
    if (!a.length) return '';
    var fmt = a.shift();
    if (typeof fmt !== 'string') return [fmt].concat(a).map(show).join(' ');
    var s = fmt.replace(/\{\}/g, function () {
      return a.length ? show(a.shift()) : '{}';
    });
    return a.length ? s + ' ' + a.map(show).join(' ') : s;
  }
  function show(v) {
    if (typeof v === 'string') return v;
    if (typeof v === 'object' && v !== null) {
      try {
        return JSON.stringify(v);
      } catch (e) {
        return String(v);
      }
    }
    return String(v);
  }
  function logger(level) {
    return function () {
      __host_log(level, format(arguments));
    };
  }
  G.log = logger('info');
  G.log.debug = logger('debug');
  G.log.info = logger('info');
  G.log.warning = logger('warning');
  G.log.error = logger('error');
  G.debug = logger('debug');
  G.format = function () {
    return format(arguments);
  };
  G.runShellCommand = function (cmd) {
    __host_log('warning', 'runShellCommand("' + cmd + '") is not available in the simulator (Linux is not emulated)');
  };
  G.readConfig = function (path) {
    throw new Error('readConfig("' + path + '") is not available in the simulator (no file system)');
  };
  G.PersistentStorage = function (name, opts) {
    if (!(opts && opts.global)) throw new Error('PersistentStorage: only {global: true} storages are supported');
    var store = G.__storages[name] || (G.__storages[name] = {});
    return store;
  };
  G.__storages = {};
  G.Notify = {
    sendEmail: function (to, subject) {
      __host_log('info', 'Notify.sendEmail to ' + to + ': ' + subject + ' (not sent — simulated)');
    },
    sendSMS: function (to, text) {
      __host_log('info', 'Notify.sendSMS to ' + to + ': ' + text + ' (not sent — simulated)');
    },
  };

  // ---------------------------------------------------------------- entry points for the host
  G.__wb = {
    onMessage: function (topic, payload) {
      var m = /^\/devices\/([^/]+)\/controls\/([^/]+)(\/.*)?$/.exec(topic);
      if (m) {
        var key = m[1] + '/' + m[2];
        var rest = m[3] || '';
        if (rest === '') {
          var c = cell(key);
          var v = typed(c.type, payload);
          var was = c.value;
          c.raw = payload;
          c.value = v;
          if (was !== v) changed(key, v);
        } else if (rest === '/meta/type') {
          var cc = cell(key);
          cc.type = payload;
          if (cc.raw !== null) cc.value = typed(payload, cc.raw);
        } else if (rest === '/meta/readonly') cell(key).readonly = payload === '1';
        else if (rest === '/meta/error') cell(key).error = payload;
        else if (rest === '/on' && virtualDevs[m[1]]) {
          var vc = cell(key);
          if (!vc.readonly) writeCell(key, typed(vc.type, payload));
        }
      }
      for (var i = 0; i < mqttTracks.length; i++) {
        if (__match(mqttTracks[i].filter, topic)) {
          try {
            mqttTracks[i].fn({ topic: topic, value: payload });
          } catch (e) {
            reportError(e, 'trackMqtt("' + mqttTracks[i].filter + '")');
          }
        }
      }
    },
    onTimer: function (id) {
      var cb = callbacks[id];
      if (!cb) return;
      if (!cb.periodic) delete callbacks[id];
      try {
        cb.fn();
      } catch (e) {
        reportError(e, 'timer');
      }
    },
    onTick: function (nowMs) {
      var d = new Date(nowMs);
      for (var i = 0; i < crons.length; i++) {
        var c = crons[i];
        if (!c.rule.enabled) continue;
        if (c.spec.every) {
          if (!c.next) c.next = nowMs + c.spec.every;
          if (nowMs >= c.next) {
            c.next += c.spec.every;
            if (c.next <= nowMs) c.next = nowMs + c.spec.every;
            run(c.rule, []);
          }
        } else {
          var sec = Math.floor(nowMs / 1000);
          if (sec !== c.next && cronDue(c.spec, d)) {
            c.next = sec;
            run(c.rule, []);
          }
        }
      }
    },
    start: function () {
      started = true;
      queue.push({ key: null, value: null });
      process();
    },
    ruleCount: function () {
      return rules.length;
    },
  };

  function __match(filter, topic) {
    var f = filter.split('/');
    var t = topic.split('/');
    for (var i = 0; i < f.length; i++) {
      if (f[i] === '#') return true;
      if (i >= t.length) return false;
      if (f[i] !== '+' && f[i] !== t[i]) return false;
    }
    return f.length === t.length;
  }
})(globalThis);
