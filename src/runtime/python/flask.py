"""Minimal Flask-compatible web framework for the simulator's virtual network.

Requests come from the in-app browser ("Web" tab, http://raspberrypi.local:5000).
Supported: Flask(__name__), @app.route(rule, methods=[...]), @app.get/@app.post,
URL converters <name> <int:name> <float:name> <path:name>, request.method/path/
args/form/json/get_json()/data/headers, jsonify, render_template (files in
templates/ with {{ expression }} substitution), render_template_string,
static files from static/, redirect, url_for, abort, make_response, Response,
@app.errorhandler(code).

Real-Pi patterns that work here:
    app.run(host='0.0.0.0', port=5000)                      # blocks, serves requests
    threading.Thread(target=app.run, kwargs=..., daemon=True).start()  # background
Requests are served cooperatively while the program is inside sleep(), app.run()
or another simulator wait (no real threads in the browser).
"""

import json as _json
import os as _os
import re as _re
import sys as _sys
import traceback as _tb
import urllib.parse as _up

import _simcore
from _simcore import call as _call, post as _post

__version__ = '3.0.3-sim'

_background_server = None


def _sim_reset():
    global _background_server
    _background_server = None


class _Args(dict):
    def get(self, key, default=None, type=None):
        v = super().get(key, default)
        if type is not None and v is not default:
            try:
                return type(v)
            except (TypeError, ValueError):
                return default
        return v

    def getlist(self, key):
        v = super().get(key)
        return [] if v is None else [v]

    def to_dict(self):
        return dict(self)


class _Request:
    def __init__(self):
        self._reset({'method': 'GET', 'path': '/', 'query': '', 'body': '', 'headers': {}})

    def _reset(self, e):
        self.method = e.get('method', 'GET').upper()
        self.path = e.get('path', '/')
        self.query_string = e.get('query', '').encode()
        self.args = _Args(_up.parse_qsl(e.get('query', ''), keep_blank_values=True))
        self.headers = dict(e.get('headers') or {})
        body = e.get('body') or ''
        self.data = body.encode()
        ctype = self.headers.get('Content-Type', self.headers.get('content-type', ''))
        self.content_type = ctype
        self.form = _Args(_up.parse_qsl(body, keep_blank_values=True)) if 'application/x-www-form-urlencoded' in ctype else _Args()
        self.values = _Args({**self.args, **self.form})
        self.is_json = 'application/json' in ctype
        self.url = 'http://raspberrypi.local:5000' + self.path + (('?' + e['query']) if e.get('query') else '')
        self.remote_addr = '192.168.1.50'
        self.endpoint = None
        self.view_args = {}

    def get_json(self, force=False, silent=False, cache=True):
        if not (self.is_json or force):
            if silent:
                return None
            abort(415)
        try:
            return _json.loads(self.data.decode() or 'null')
        except ValueError:
            if silent:
                return None
            abort(400)

    @property
    def json(self):
        return self.get_json(silent=True)

    def get_data(self, as_text=False):
        return self.data.decode() if as_text else self.data


request = _Request()


class HTTPException(Exception):
    def __init__(self, code, description=None):
        super().__init__(code)
        self.code = code
        self.description = description


def abort(code, description=None):
    raise HTTPException(code, description)


class Response:
    def __init__(self, response='', status=200, headers=None, mimetype=None, content_type=None):
        if isinstance(response, bytes):
            response = response.decode('utf-8', 'replace')
        self.data = response if isinstance(response, str) else ''.join(response)
        self.status_code = int(status)
        self.headers = dict(headers or {})
        ct = content_type or (mimetype and (mimetype + ('; charset=utf-8' if mimetype.startswith('text/') else ''))) or 'text/html; charset=utf-8'
        self.headers.setdefault('Content-Type', ct)
        self.mimetype = ct.split(';')[0]

    def get_data(self, as_text=True):
        return self.data

    def set_cookie(self, *a, **k):
        pass


def make_response(*args):
    if len(args) == 1 and isinstance(args[0], Response):
        return args[0]
    return _to_response(args[0] if len(args) == 1 else tuple(args))


def jsonify(*args, **kwargs):
    if args and kwargs:
        raise TypeError('jsonify() behavior undefined when passed both args and kwargs')
    data = args[0] if len(args) == 1 else (list(args) if args else kwargs)
    return Response(_json.dumps(data, ensure_ascii=False, default=str), mimetype='application/json')


def redirect(location, code=302):
    return Response('<a href="%s">Redirecting…</a>' % location, code, {'Location': location})


_current_app = None


def url_for(endpoint, **values):
    app = _current_app
    if endpoint == 'static':
        return '/static/' + values.pop('filename', '')
    for rule, ep, _m, _rx, _conv in (app._rules if app else []):
        if ep == endpoint:
            out = rule
            for k in list(values):
                out2 = _re.sub(r'<(?:[a-z]+:)?%s>' % k, str(values[k]), out)
                if out2 != out:
                    values.pop(k)
                    out = out2
            if values:
                out += '?' + _up.urlencode(values)
            return out
    raise RuntimeError("Could not build url for endpoint '%s'" % endpoint)


_EXPR = _re.compile(r'\{\{\s*(.+?)\s*\}\}')


def render_template_string(source, **context):
    ctx = dict(context)
    ctx.setdefault('request', request)
    ctx.setdefault('url_for', url_for)

    def sub(m):
        expr = m.group(1)
        filt = None
        if '|' in expr:
            expr, filt = [x.strip() for x in expr.rsplit('|', 1)]
        try:
            v = eval(expr, {'__builtins__': __builtins__}, ctx)
        except Exception as e:  # noqa: BLE001
            return '[template error: %s]' % e
        if filt == 'tojson':
            return _json.dumps(v, default=str)
        if filt == 'safe':
            return str(v)
        return _html_escape(str(v))

    return _EXPR.sub(sub, source)


def _html_escape(s):
    return s.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;').replace('"', '&quot;')


def render_template(template_name, **context):
    app = _current_app
    folder = app.template_folder if app else 'templates'
    path = _os.path.join(_simcore.PROJECT, folder, template_name)
    if not _os.path.exists(path):
        raise FileNotFoundError("TemplateNotFound: %s (put it in the project's %s/ folder)" % (template_name, folder))
    with open(path, encoding='utf-8') as f:
        return render_template_string(f.read(), **context)


_CONVERTERS = {'string': r'[^/]+', 'int': r'\d+', 'float': r'\d+(?:\.\d+)?', 'path': r'.+'}


def _compile(rule):
    conv = {}

    def rep(m):
        kind = m.group(1) or 'string'
        name = m.group(2)
        conv[name] = kind
        return '(?P<%s>%s)' % (name, _CONVERTERS.get(kind, _CONVERTERS['string']))

    rx = '^' + _re.sub(r'<(?:([a-z]+):)?(\w+)>', rep, _re.escape(rule).replace('\\<', '<').replace('\\>', '>').replace('\\:', ':')) + '$'
    return _re.compile(rx), conv


_MIME = {'.css': 'text/css', '.js': 'application/javascript', '.json': 'application/json', '.html': 'text/html', '.svg': 'image/svg+xml', '.txt': 'text/plain'}


def _to_response(rv):
    status = 200
    headers = {}
    if isinstance(rv, tuple):
        if len(rv) == 3:
            rv, status, headers = rv
        elif len(rv) == 2:
            rv, x = rv
            if isinstance(x, dict):
                headers = x
            else:
                status = x
    if isinstance(rv, Response):
        rv.status_code = int(status) if status != 200 else rv.status_code
        rv.headers.update(headers)
        return rv
    if isinstance(rv, (dict, list)):
        r = jsonify(rv)
        r.status_code = int(status)
        r.headers.update(headers)
        return r
    if rv is None:
        raise TypeError('The view function did not return a valid response. The function either returned None or ended without a return statement.')
    return Response(str(rv), status, headers)


class Flask:
    _sim_flask_app = True

    def __init__(self, import_name, static_url_path=None, static_folder='static', template_folder='templates', **kw):
        global _current_app
        self.import_name = import_name
        self.static_folder = static_folder
        self.template_folder = template_folder
        self._rules = []
        self._errors = {}
        self._before = []
        self.config = {'DEBUG': False}
        self.debug = False
        _current_app = self

    def route(self, rule, methods=None, endpoint=None, **options):
        def deco(fn):
            self.add_url_rule(rule, endpoint or fn.__name__, fn, methods=methods)
            return fn
        return deco

    def get(self, rule, **kw):
        return self.route(rule, methods=['GET'], **kw)

    def post(self, rule, **kw):
        return self.route(rule, methods=['POST'], **kw)

    def put(self, rule, **kw):
        return self.route(rule, methods=['PUT'], **kw)

    def delete(self, rule, **kw):
        return self.route(rule, methods=['DELETE'], **kw)

    def add_url_rule(self, rule, endpoint=None, view_func=None, methods=None, **kw):
        rx, conv = _compile(rule)
        ms = set(m.upper() for m in (methods or ['GET']))
        if 'GET' in ms:
            ms.add('HEAD')
        ms.add('OPTIONS')
        self._rules.append((rule, endpoint or view_func.__name__, (view_func, ms), rx, conv))

    def errorhandler(self, code):
        def deco(fn):
            self._errors[code] = fn
            return fn
        return deco

    def before_request(self, fn):
        self._before.append(fn)
        return fn

    def _dispatch(self, e):
        request._reset(e)
        path = request.path
        try:
            for fn in self._before:
                rv = fn()
                if rv is not None:
                    return _to_response(rv)
            if path.startswith('/static/'):
                fp = _os.path.join(_simcore.PROJECT, self.static_folder, path[len('/static/'):])
                if _os.path.isfile(fp):
                    with open(fp, encoding='utf-8') as f:
                        return Response(f.read(), mimetype=_MIME.get(_os.path.splitext(fp)[1], 'text/plain'))
                abort(404)
            allowed = False
            for rule, ep, (view, methods), rx, conv in self._rules:
                m = rx.match(path)
                if not m:
                    continue
                allowed = True
                if request.method not in methods:
                    continue
                kwargs = {}
                for k, v in m.groupdict().items():
                    kind = conv.get(k)
                    kwargs[k] = int(v) if kind == 'int' else float(v) if kind == 'float' else _up.unquote(v)
                request.endpoint = ep
                request.view_args = kwargs
                return _to_response(view(**kwargs))
            abort(405 if allowed else 404)
        except HTTPException as he:
            h = self._errors.get(he.code)
            if h:
                return _to_response((h(he), he.code))
            return Response('<h1>%d %s</h1><p>%s</p>' % (he.code, _REASONS.get(he.code, ''), he.description or ''), he.code)
        except (KeyboardInterrupt, SystemExit):
            raise
        except Exception as ex:  # noqa: BLE001
            _sys.stderr.write('[%s] ERROR in app: Exception on %s [%s]\n' % (_simcore.now(), path, request.method))
            _tb.print_exc()
            h = self._errors.get(500)
            if h:
                return _to_response((h(ex), 500))
            return Response('<h1>500 Internal Server Error</h1><pre>%s</pre>' % _html_escape(''.join(_tb.format_exception_only(type(ex), ex))), 500)

    def _handle(self, e):
        r = self._dispatch(e)
        _post('http.response', id=e['id'], status=r.status_code, headers=r.headers, body=r.data)
        print('192.168.1.50 - - "%s %s HTTP/1.1" %d -' % (e.get('method', 'GET'), e.get('path', '/'), r.status_code))

    def _start(self, host, port):
        global _current_app
        _current_app = self
        port = int(port or 5000)
        _call('http.serve', port=port)
        _simcore.set_http_handler(self._handle)
        print(' * Serving Flask app %r' % self.import_name)
        print(' * Running on http://raspberrypi.local:%d  (open the Web tab)' % port)

    def run(self, host=None, port=None, debug=None, load_dotenv=True, use_reloader=None, threaded=None, **options):
        self._start(host, port)
        _simcore.idle_forever()

    def _sim_serve_background(self, host=None, port=None, debug=None, **options):
        global _background_server
        self._start(host, port)
        _background_server = self

    def test_request(self, method, path, body='', headers=None):
        """Simulator helper: call a route directly and return the Response."""
        q = ''
        if '?' in path:
            path, q = path.split('?', 1)
        return self._dispatch({'method': method, 'path': path, 'query': q, 'body': body, 'headers': headers or {}})


_REASONS = {400: 'Bad Request', 404: 'Not Found', 405: 'Method Not Allowed', 415: 'Unsupported Media Type', 500: 'Internal Server Error'}
