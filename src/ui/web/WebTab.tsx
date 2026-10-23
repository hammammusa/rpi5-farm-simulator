// Virtual browser for the Pi's local web interface (http://raspberrypi.local:5000).
// Pages come from the user's Flask program; the page's fetch()/forms/links are
// bridged to Python as virtual HTTP requests. The iframe is sandboxed (no
// same-origin access to the simulator page).
import { useEffect, useRef, useState } from 'react';
import { getRuntime } from '../../state/engine';
import { useApp } from '../../state/store';
import { useT } from '../../i18n';

const BRIDGE = `<script>(function(){
var seq=0,pending={};
function req(method,url,body,headers){return new Promise(function(res){var id=++seq;pending[id]=res;parent.postMessage({__vb:'fetch',id:id,method:method,url:String(url),body:body==null?'':String(body),headers:headers||{}},'*');});}
window.addEventListener('message',function(e){var d=e.data;if(!d||d.__vb!=='resp')return;var r=pending[d.id];if(r){delete pending[d.id];r(d);}});
window.fetch=function(input,init){init=init||{};var url=typeof input==='string'?input:input.url;var h={};if(init.headers){if(init.headers.forEach){init.headers.forEach(function(v,k){h[k]=v});}else{h=Object.assign({},init.headers);}}
var body=init.body;if(body&&typeof body!=='string'){try{body=new URLSearchParams(body).toString();h['Content-Type']=h['Content-Type']||'application/x-www-form-urlencoded';}catch(_){body=String(body);}}
return req((init.method||'GET').toUpperCase(),url,body,h).then(function(d){if(d.status===0)throw new TypeError('Failed to fetch (no server running)');return new Response(d.body,{status:d.status,headers:d.headers});});};
document.addEventListener('click',function(e){var a=e.target.closest&&e.target.closest('a[href]');if(!a)return;var href=a.getAttribute('href');if(!href||href.startsWith('#')||/^(https?:)?\\/\\//.test(href)&&!href.includes('raspberrypi.local'))return;e.preventDefault();parent.postMessage({__vb:'nav',method:'GET',url:href},'*');});
document.addEventListener('submit',function(e){var f=e.target;e.preventDefault();var data=new URLSearchParams(new FormData(f)).toString();var m=(f.getAttribute('method')||'GET').toUpperCase();var url=f.getAttribute('action')||location.pathname;if(m==='GET'){parent.postMessage({__vb:'nav',method:'GET',url:url+(url.includes('?')?'&':'?')+data},'*');}else{parent.postMessage({__vb:'nav',method:m,url:url,body:data,headers:{'Content-Type':'application/x-www-form-urlencoded'}},'*');}});
})();</script>`;

function inject(html: string) {
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => m + BRIDGE);
  return BRIDGE + html;
}

function infoPage(title: string, body: string) {
  return `<!doctype html><meta charset="utf-8"><style>body{font:15px system-ui;margin:40px;color:#333}h1{font-size:20px}code{background:#eee;padding:2px 5px;border-radius:4px}</style><h1>${title}</h1>${body}`;
}

export default function WebTab() {
  const t = useT();
  const rs = useApp((s) => s.runtimeState);
  const [url, setUrl] = useState('/');
  const [addr, setAddr] = useState('/');
  const [doc, setDoc] = useState('');
  const [status, setStatus] = useState('');
  const [width, setWidth] = useState<'desktop' | 'tablet' | 'phone'>('desktop');
  const frame = useRef<HTMLIFrameElement>(null);

  const navigate = async (method: string, path: string, body = '', headers: Record<string, string> = {}) => {
    const rt = getRuntime();
    setAddr(path);
    if (!rt || rt.state !== 'running' || rt.serverPort === null) {
      setDoc(
        infoPage(
          t('This site can’t be reached'),
          `<p>${t('raspberrypi.local refused to connect. Start a Python program that runs a Flask web server, for example:')}</p><pre>from flask import Flask\napp = Flask(__name__)\n\n@app.route('/')\ndef home():\n    return '&lt;h1&gt;Hello from the Pi&lt;/h1&gt;'\n\napp.run(host='0.0.0.0', port=5000)</pre><p>${t('Then press Reload. Example 19 and 20 contain a complete farm dashboard.')}</p>`,
        ),
      );
      setStatus(t('connection refused'));
      return;
    }
    setStatus(t('loading…'));
    const r = await rt.http(method, path, body, headers);
    setStatus(`${r.status}`);
    if (r.status >= 300 && r.status < 400 && r.headers.Location) return navigate('GET', r.headers.Location);
    setUrl(path);
    const ct = (r.headers['Content-Type'] ?? r.headers['content-type'] ?? 'text/html').toLowerCase();
    if (ct.includes('json')) {
      let pretty = r.body;
      try {
        pretty = JSON.stringify(JSON.parse(r.body), null, 2);
      } catch {
        /* keep raw */
      }
      setDoc(`<!doctype html><meta charset="utf-8"><pre style="font:13px monospace;white-space:pre-wrap">${pretty.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</pre>`);
    } else if (ct.includes('text/plain')) setDoc(`<pre>${r.body.replace(/</g, '&lt;')}</pre>`);
    else setDoc(inject(r.body));
  };

  useEffect(() => {
    const onMsg = async (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow) return;
      const d = e.data;
      if (!d || typeof d !== 'object') return;
      if (d.__vb === 'fetch') {
        const rt = getRuntime();
        const target = new URL(d.url, `http://raspberrypi.local:5000${url}`);
        const r = rt && rt.state === 'running' ? await rt.http(d.method, target.pathname + target.search, d.body, d.headers) : { status: 0, headers: {}, body: '' };
        frame.current?.contentWindow?.postMessage({ __vb: 'resp', id: d.id, status: r.status, headers: r.headers, body: r.body }, '*');
      } else if (d.__vb === 'nav') {
        const target = new URL(d.url, `http://raspberrypi.local:5000${url}`);
        void navigate(d.method, target.pathname + target.search, d.body ?? '', d.headers ?? {});
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  });

  useEffect(() => {
    void navigate('GET', url);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rs]);

  return (
    <div className="web-tab">
      <div className="browser-bar row">
        <button onClick={() => void navigate('GET', url)} title={t('Reload')} aria-label={t('Reload')} data-testid="web-reload">
          ⟳
        </button>
        <form
          className="addr"
          onSubmit={(e) => {
            e.preventDefault();
            const u = addr.replace(/^https?:\/\/[^/]+/, '') || '/';
            void navigate('GET', u.startsWith('/') ? u : '/' + u);
          }}
        >
          <span className="muted" dir="ltr">
            http://raspberrypi.local:5000
          </span>
          <input value={addr} onChange={(e) => setAddr(e.target.value)} dir="ltr" aria-label={t('Address')} data-testid="web-address" />
        </form>
        <span className="pill">{status}</span>
        <div className="seg">
          {(['desktop', 'tablet', 'phone'] as const).map((w) => (
            <button key={w} className={width === w ? 'on' : ''} onClick={() => setWidth(w)}>
              {w === 'desktop' ? '🖥' : w === 'tablet' ? '📱↔' : '📱'} {t(w)}
            </button>
          ))}
        </div>
      </div>
      <div className="browser-stage">
        <iframe
          ref={frame}
          title={t('Raspberry Pi web interface')}
          sandbox="allow-scripts allow-forms allow-modals"
          srcDoc={doc}
          style={{ width: width === 'desktop' ? '100%' : width === 'tablet' ? 820 : 390 }}
          data-testid="web-frame"
        />
      </div>
      <p className="muted small" style={{ padding: '0 12px' }}>
        {t('The page is served by YOUR Python program (Flask). Requests are handled while the program is in sleep(), app.run() or another wait. On a real Pi the same code serves http://<pi-address>:5000 to phones on the local network.')}
      </p>
    </div>
  );
}
