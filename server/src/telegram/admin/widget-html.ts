/**
 * The admin panel as an HTML widget in a Telegram message (Bot API 10.4, https://core.telegram.org/bots/widgets).
 * One fixed renderer: the screen to draw is a small JSON model the bot writes into the message's chat_data and
 * public_data (≤1 KB each, joined by a revision number); a tap sends `b<rev>.<n>` and the bot answers by editing that
 * data. The widget has no network, no inputs and no HTML from data: every value becomes a text node; the only markup
 * it reads is <b>, <i>, <code>, <s> and the spoiler, which the bot writes itself (widget-model.ts).
 *
 * Telegram's limits: 32 KB of HTML, 4 KB after zlib — the unit test checks both.
 * Colours are the site's (client/src/app/globals.css): paper, ink, shu red, ok green, kraft.
 */
const CSS = `
:root{--p:#f4efe6;--s:#fbf8f2;--k:#ece5d8;--i:#1c1a17;--i2:#48433b;--m:#6b6459;--l:#e2dacb;--r:#c8102e;--rs:#f7deda;--o:#3d6631;--os:#e2ead6;--w:#855400;--ws:#f4e8cb;--a:#1c1a17;--ai:#f4efe6}
@media (prefers-color-scheme:dark){:root{--p:#14120f;--s:#1e1b17;--k:#0f0e0b;--i:#eee7da;--i2:#cfc6b6;--m:#9c9384;--l:#2e2a24;--r:#ef5a5f;--rs:#3b1c1c;--o:#93bf80;--os:#1c2a17;--w:#e2b457;--ws:#33280f;--a:#eee7da;--ai:#14120f}}
*{box-sizing:border-box;margin:0}
body{background:var(--p);color:var(--i);font:14px/1.35 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;padding:12px 12px calc(12px + env(safe-area-inset-bottom))}
h1{font:700 19px/1.2 "Noto Serif",Georgia,serif;display:flex;gap:8px;align-items:center}
h1 i{display:inline-block;width:10px;height:10px;border-radius:50%;background:var(--r);flex:none;font-style:normal}
.n{margin-top:8px;padding:7px 10px;border-radius:10px;background:var(--ws);color:var(--w);font-size:13px}
.n.e{background:var(--rs);color:var(--r)}
.t{display:flex;gap:6px;margin-top:10px;flex-wrap:wrap}
.t b{padding:6px 11px;border-radius:999px;background:var(--k);color:var(--i2);font:600 12px system-ui,sans-serif;cursor:pointer}
.t b.on{background:var(--a);color:var(--ai)}
.g{margin-top:12px;font:700 11px system-ui,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:var(--m)}
.c{margin-top:8px;padding:10px 12px;border-radius:14px;background:var(--s);border:1px solid var(--l)}
.c p+p{margin-top:4px}
.k{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
.k div{flex:1 1 30%;min-width:92px;padding:8px 10px;border-radius:12px;background:var(--s);border:1px solid var(--l)}
.k u{display:block;text-decoration:none;font:700 20px/1.1 "Noto Serif",Georgia,serif}
.k small{display:block;color:var(--m);font-size:11px;margin-top:2px}
.k .x{background:var(--rs);border-color:var(--rs)}.k .x u{color:var(--r)}
.k .y{background:var(--os);border-color:var(--os)}.k .y u{color:var(--o)}
.r{display:grid;grid-template-columns:1fr 70px 28px;gap:8px;align-items:center;font-size:12px;margin-top:5px}
.r span:nth-child(2){height:6px;border-radius:3px;background:var(--k);overflow:hidden}
.r em{display:block;height:100%;background:var(--a)}
.r span:last-child{text-align:right;font-weight:600}
.a{display:flex;gap:6px;margin-top:6px}
.a b{flex:1;padding:9px 8px;border-radius:12px;background:var(--s);border:1px solid var(--l);text-align:center;font:600 13px system-ui,sans-serif;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.a b.l{text-align:left;font-weight:500}
.a b.p{background:var(--a);color:var(--ai);border-color:var(--a)}
.a b.ok{background:var(--o);color:var(--p);border-color:var(--o)}
.a b.d{background:var(--rs);color:var(--r);border-color:var(--rs)}
.a b.q{background:none;border-color:transparent;color:var(--m)}
.a b.w{opacity:.45}
.v{overflow:hidden}
.f{margin-top:10px;display:flex;justify-content:space-between;align-items:center;color:var(--m);font-size:12px}
.f b{cursor:pointer;padding:4px 8px;border-radius:8px;background:var(--k);color:var(--i2)}
code{font:12px ui-monospace,Menlo,monospace}
.sp{background:var(--i);color:var(--i);border-radius:4px;cursor:pointer}
`;

const JS = `
var W=window.TelegramWidget,R=document.getElementById('x'),busy=0,shown=-1,last=null;
function el(t,c,p){var e=document.createElement(t);if(c)e.className=c;if(p)p.appendChild(e);return e}
function ent(s){return s.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&amp;/g,'&')}
function rich(p,s){var st=[p],re=/<(\\/?)(b|i|code|s|sp)>/g,m,at=0;
function txt(t){if(t)st[st.length-1].appendChild(document.createTextNode(ent(t)))}
while((m=re.exec(s))){txt(s.slice(at,m.index));at=re.lastIndex;
if(m[1]){if(st.length>1)st.pop()}else{var e=el(m[2]=='sp'?'span':m[2],m[2]=='sp'?'sp':'',st[st.length-1]);
if(m[2]=='sp')e.onclick=function(){this.className=''};st.push(e)}}txt(s.slice(at))}
function req(d,b){if(busy||!W)return;busy=1;if(b)b.className+=' w';
W.request(d).then(function(a){var r=null;try{r=JSON.parse(a.result)}catch(e){}
if(r&&(r.e||r.t)){note(r.e||r.t,!!r.e);busy=0;if(b)b.className=b.className.replace(' w','')}
setTimeout(function(){if(busy){busy=0;draw()}},14000)},function(e){busy=0;note(e.code=='RATE_LIMITED'?'Слишком часто — секунду':'Нет связи с ботом, попробуйте ещё раз',1);if(b)b.className=b.className.replace(' w','')})}
function note(t,e){var n=document.getElementById('n');if(!n){n=el('p','n');R.insertBefore(n,R.children[1]||null);n.id='n'}n.className='n'+(e?' e':'');n.textContent=t}
function tap(b,d){b.onclick=function(){if(typeof d=='string')W&&W.openLink(d);else req('b'+last.r+'.'+d,b)}}
function model(){var c=W&&W.chatData,p=W&&W.publicData;if(!c)return null;var i=c.indexOf('|'),j=p?p.indexOf('|'):-1;
if(c.slice(0,i)!=(j<0?c.slice(0,i):p.slice(0,j)))return null;try{return JSON.parse(c.slice(i+1)+(j<0?'':p.slice(j+1)))}catch(e){return null}}
function draw(){var m=model();if(!m||m.r==shown&&!busy)return;busy=0;shown=m.r;last=m;R.textContent='';
var h=el('h1','',R);el('i','',h);rich(el('span','',h),m.h||'Админка');
if(m.n)note(m.n,m.ne);
if(m.t){var t=el('div','t',R);m.t.forEach(function(x){var b=el('b',x[2]?'on':'',t);b.textContent=x[0];tap(b,x[1])})}
var V=el('div','v',R),nt=m.t?m.t.length:0,ar=(m.a||[]).length;V.style.maxHeight=Math.max(110,560-40-(nt?34*Math.ceil(nt/4):0)-(m.n?40:0)-ar*44-34)+'px';
(m.b||[]).forEach(function(x){
if(x[0]=='g')el('p','g',V).textContent=x[1];
else if(x[0]=='p'){var c=V.lastChild&&V.lastChild.className=='c'?V.lastChild:el('div','c',V);rich(el('p','',c),x[1])}
else if(x[0]=='k'){var k=el('div','k',V);x[1].forEach(function(y){var d=el('div',y[3]==1?'x':y[3]==2?'y':'',k);el('u','',d).textContent=y[1];el('small','',d).textContent=y[0]+(y[2]?' · '+y[2]:'')})}
else if(x[0]=='r'){var mx=1;x[1].forEach(function(y){mx=Math.max(mx,y[1])});x[1].forEach(function(y){var r=el('div','r',V);el('span','',r).textContent=y[0];el('em','',el('span','',r)).style.width=Math.max(4,y[1]/mx*100)+'%';el('span','',r).textContent=y[1]})}});
(m.a||[]).forEach(function(row){var a=el('div','a',R);row.forEach(function(x){var b=el('b',x[2]||'',a);b.textContent=x[0];tap(b,x[1])})});
var f=el('div','f',R);if(m.p){var p=el('span','',f);m.p.forEach(function(x){var b=el('b','',p);b.textContent=x[0];if(x[1]!=null)tap(b,x[1]);p.appendChild(document.createTextNode(' '))})}else el('span','',f);
var z=el('span','',f);if(m.u||(m.b||[]).some(function(x){return x[0]=='p'})){var u=el('b','',z);u.textContent='📄 Целиком';u.onclick=function(){req('f'+m.r,u)}}
var q=el('b','',z);q.textContent='↻';q.onclick=function(){req('r'+m.r,q)};z.insertBefore(document.createTextNode(' '),q)}
if(W){W.onEvent('chatDataChanged',draw);W.onEvent('publicDataChanged',draw);draw();W.ready&&W.ready()}
if(!last){R.textContent='';var h=el('h1','',R);el('i','',h);el('span','',h).textContent='Админка ichiba';el('p','c',R).textContent=W?'Загрузка…':'Откройте в Telegram'}
`;

const min = (s: string) => s.replace(/\n+/g, '').replace(/\s*([{};:,>])\s*/g, '$1');

/** The widget's HTML, built once. */
export const ADMIN_WIDGET_HTML = `<style>${min(CSS)}</style><div id="x"></div><script>${JS.trim()}</script>`;
