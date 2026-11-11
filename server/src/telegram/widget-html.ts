/**
 * The shop widget (Bot API 10.4, https://core.telegram.org/bots/widgets): one fixed HTML app in a message bubble,
 * drawn from the state the bot writes (chat_data, widget.ts). Taps send short commands with TelegramWidget.request;
 * the bot answers with the next state. No network, no inputs, no external fonts or images: the look of the site is
 * made of its palette (paper, ink, shu red, indigo), a serif face and a CSS seal. Budget: 4096 bytes after zlib -9
 * (test/unit/telegram-widget.test.ts keeps it honest), so the code is terse on purpose.
 *
 * User text never reaches an attribute or a handler: it is escaped into element text only, and handlers carry the
 * app's own short commands and indices.
 */
const CSS = `
:root{--p:#f4efe6;--s:#fbf8f2;--k:#e9e2d5;--i:#1c1a17;--m:#6b6459;--l:#e2dacb;--r:#c8102e;--b:#23395b;--bs:#dfe5ee;--g:#3d6631;--gs:#e2ead6;--rs:#f7deda}
@media(prefers-color-scheme:dark){:root{--p:#14120f;--s:#1e1b17;--k:#2a2620;--i:#eee7da;--m:#9c9384;--l:#2e2a24;--r:#ef5a5f;--b:#9db1d6;--bs:#1e293b;--g:#93bf80;--gs:#1c2a17;--rs:#3b1c1c}}
*{box-sizing:border-box;margin:0}
body{font:14px/1.35 serif;color:var(--i);background:var(--p);padding:12px;border-radius:14px}
.h{display:flex;align-items:center;gap:8px;margin-bottom:10px}
.se{width:30px;height:30px;border-radius:7px;background:var(--r);color:var(--s);display:grid;place-items:center;font-weight:700;font-size:17px;transform:rotate(-4deg)}
.u{font-weight:700;font-size:15px;flex:1}
.tb,.ch{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px}
button{font:inherit;color:var(--i);background:var(--k);border:0;border-radius:11px;padding:8px 10px;cursor:pointer;transition:transform .12s,background .2s}
button:active{transform:scale(.96)}
.on{background:var(--b);color:var(--s)}
.c{background:var(--s);border:1px solid var(--l);border-radius:14px;padding:12px;margin-bottom:10px}
.g{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.n{font-size:22px;font-weight:700}
.mu{color:var(--m);font-size:12px}
.row{display:flex;align-items:center;gap:8px;width:100%;text-align:left;margin-bottom:6px;background:var(--s);border:1px solid var(--l)}
.row b{flex:1;font-weight:600}
.pr{font-size:30px;font-weight:700;text-align:center;flex:1}
.st{display:flex;align-items:center;gap:8px;margin:8px 0}
.st button{width:44px;font-size:20px}
.main{width:100%;background:var(--r);color:var(--s);font-weight:700;padding:11px;margin-top:4px}
.main[disabled]{opacity:.45}
.ok{background:var(--gs);color:var(--g)}
.no{background:var(--rs);color:var(--r)}
.pill{display:inline-block;border-radius:99px;padding:2px 9px;font-size:12px;background:var(--bs);color:var(--b)}
.bars{display:flex;align-items:flex-end;gap:5px;height:70px;margin:6px 0}
.bars i{flex:1;background:var(--b);border-radius:4px 4px 0 0;min-height:3px}
.t{margin-top:8px;text-align:center;font-size:13px;color:var(--b)}
s{color:var(--m)}`;

const JS = `
var W=TelegramWidget,S={},L={},T='',ST={P:'🟢 В продаже',R:'🔒 Идёт сделка',H:'🙈 Снята',D:'📝 Черновик',S:'✅ Продана',B:'🚫 Снята модератором'},
NC=['Сделки','Предложения цены','Аукционы','Сообщения','♡ и корзина','Вечерняя сводка','Избранное','Аккаунт'];
function e(x){return String(x==null?'':x).replace(/[&<>"']/g,function(c){return'&#'+c.charCodeAt(0)+';'})}
function byn(n){return n==null?'договорная':Number(n).toLocaleString('ru-RU')+' BYN'}
function hap(k){try{k?W.HapticFeedback.impactOccurred('light'):W.HapticFeedback.selectionChanged()}catch(x){}}
function set(j){try{S=j?JSON.parse(j):{};}catch(x){S={}}L={};T=S.t||'';r()}
function q(d){hap(1);T='…';r();W.request(d).then(function(a){a&&a.result?set(a.result):(T='',r())},function(x){T=x&&x.code=='RATE_LIMITED'?'Не так быстро':'Не получилось — попробуйте ещё раз';r()})}
function loc(k,v){hap();L[k]=v;r()}
function b(t,c,k){return'<button class="'+(k||'')+'" onclick="'+c+'">'+t+'</button>'}
function tabs(){var w=S.w?' · '+S.w:'';return'<div class="tb">'+[['🏮','h'],['Вещи','l:a:0'],['Сделки'+w,'d'],['Покупки','b'],['📊','t'],['🔔','n']].map(function(x){var on=S.s==x[1][0];return b(x[0],"q('"+x[1]+"')",on?'on':'')}).join('')+'</div>'}
function home(){var n=S.n||[0,0,0,0],l=['В продаже','Сняты','Черновики','Проданы'],f='ahds';
return'<div class="g">'+n.map(function(v,i){return b('<div class="n">'+v+'</div><div class="mu">'+l[i]+'</div>',"q('l:"+f[i]+":0')",'c')}).join('')+'</div>'+(S.w?b('🛍 Ждут вашего ответа: '+S.w,"q('d')",'main'):'')+(S.k?b('🔁 Другой магазин',"q('x')"):'')}
function list(){var f=S.f||'a',h='<div class="ch">'+[['a','В продаже'],['h','Снятые'],['d','Черновики'],['s','Проданные']].map(function(x){return b(x[1],"q('l:"+x[0]+":0')",f==x[0]?'on':'')}).join('')+'</div>';
var i=S.i||[];h+=i.length?i.map(function(x,k){return b('<b>'+e(x[0])+'</b><span class="mu">'+byn(x[1])+'</span>',"q('o:"+k+"')",'row')}).join(''):'<p class="mu">Пусто.</p>';
if(S.P>1)h+='<div class="st">'+b('‹',S.p>0?"q('l:"+f+":"+(S.p-1)+"')":'')+'<span class="pr" style="font-size:14px">'+(S.p+1)+' / '+S.P+'</span>'+b('›',S.p<S.P-1?"q('l:"+f+":"+(S.p+1)+"')":'')+'</div>';return h}
function item(){var c=L.c==null?S.c:L.c,st=S.st,ed=/[PHD]/.test(st)&&!S.au,h='<div class="c"><b style="font-size:16px">'+e(S.T)+'</b><div style="margin:6px 0"><span class="pill">'+(ST[st]||st)+'</span></div>';
if(/[PR]/.test(st))h+='<div class="mu">👁 '+S.v+' · ♡ '+S.fv+(S.of?' · торг принимается':'')+'</div>';
if(ed){var sp=L.s||5;h+='<div class="st">'+b('−','loc(\\'c\\','+Math.max(1,(c||0)-sp)+')')+'<span class="pr">'+byn(c)+'</span>'+b('+','loc(\\'c\\','+Math.min(1e5,(c||0)+sp)+')')+'</div><div class="ch">'+[1,5,10,50,100].map(function(x){return b('±'+x,'loc(\\'s\\','+x+')',sp==x?'on':'')}).join('')+'</div>';
if(S.c&&c*2<S.c)h+='<p class="mu" style="color:var(--r)">Больше чем вдвое дешевле — точно?</p>';
h+='<button class="main" '+(c==S.c||!c?'disabled':'')+' onclick="q(\\'P:'+c+'\\')">Сохранить · '+byn(c)+'</button>'}else if(S.o)h+='<div class="pr">'+byn(S.c)+' <s style="font-size:16px">'+byn(S.o)+'</s></div>';else h+='<div class="pr">'+byn(S.c)+'</div>';
h+='</div>';var z=S.z||[];if(z.length>1)h+='<div class="mu">Размеры в наличии — нажмите проданный:</div><div class="ch">'+z.map(function(x,k){return L.z===k?b('Убрать '+e(x)+'?',"q('Z:"+k+"')",'no'):b(e(x)+' ✕','loc(\\'z\\','+k+')')}).join('')+'</div>';
var a=[];if(st=='P'){a.push(b('🙈 Снять',"q('H')"));if(S.bu==0)a.push(b('⏫ Поднять',"q('B')"));if(S.fx)a.push(b(S.of?'🤝 Торг: вкл':'🤝 Торг: выкл',"q('O')",S.of?'ok':''))}
if(st=='H'&&!S.ha)a.push(b('👁 Вернуть в продажу',"q('U')",'ok'));if(st=='D')a.push(b('🚀 Опубликовать',"q('U')",'ok'));
if(st=='P'||st=='H'&&!S.ha)a.push(L.x?b('Точно продано? Да',"q('S')",'no'):b('✅ Продано','loc(\\'x\\',1)'));
return h+'<div class="ch">'+a.join('')+'</div>'+b('← К списку',"q('l:"+(S.f||'a')+":0')")}
function deals(){var i=S.i||[];return i.length?i.map(function(x,k){return'<div class="c"><b>'+(x[0]=='r'?'🛍 ':'💬 ')+'@'+e(x[1])+'</b> · '+byn(x[3])+'<div class="mu" style="margin:4px 0 8px">'+e(x[2])+'</div><div class="g">'+b('✅ Принять',"q('da:"+k+"')",'ok')+(L.d===k?b('Отклонить?',"q('dx:"+k+"')",'no'):b('✖️ Отклонить','loc(\\'d\\','+k+')'))+'</div></div>'}).join(''):'<p class="mu">Ничего не ждёт ответа.</p>'}
function stats(){var d=S.d||[],m=Math.max.apply(null,d.concat(1));return'<div class="mu">Просмотры за 7 дней</div><div class="bars">'+d.map(function(v){return'<i style="height:'+Math.round(v/m*100)+'%"></i>'}).join('')+'</div><div class="g">'+[['👁',S.v],['♡',S.f],['🛒',S.c],['✉️',S.m],['💬',S.o],['🛍',S.r]].map(function(x){return'<div class="c"><span class="n">'+x[1]+'</span> '+x[0]+'</div>'}).join('')+'</div>'}
function buys(){var i=S.i||[];return i.length?i.map(function(x){return'<div class="c"><b>'+e(x[1])+'</b> · '+byn(x[2])+'<div class="mu" style="margin:4px 0">'+e(x[3])+'</div>'+(x[0]=='c'?'<div class="g">'+b('✅ Принять',"q('ba:"+x[4]+"')",'ok')+(L.y===x[4]?b('Отклонить?',"q('bx:"+x[4]+"')",'no'):b('✖️ Отклонить','loc(\\'y\\','+x[4]+')'))+'</div>':'')+'</div>'}).join(''):'<p class="mu">Активных покупок нет.</p>'}
function nots(){return(S.q||[]).map(function(v,k){return b((v?'✅ ':'⬜️ ')+NC[k],"q('nt:"+k+"')",'row')}).join('')}
function acc(){return(S.a||[]).map(function(x,k){return b('@'+e(x),"q('xa:"+k+"')",'row')}).join('')}
function r(){var s=S.s,h='<div class="h"><div class="se">市</div><div class="u">'+(S.u?'@'+e(S.u):'ichiba')+'</div></div>';
if(!s)h+='<div class="c">'+(S.e?e(S.e):'Магазин ichiba')+'</div>'+b('Открыть',"q('h')",'main');
else{if(s!='x')h+=tabs();h+=s=='h'?home():s=='l'?list():s=='i'?item():s=='d'?deals():s=='b'?buys():s=='t'?stats():s=='n'?nots():acc()}
document.getElementById('a').innerHTML=h+(T?'<div class="t">'+e(T)+'</div>':'')}
W.onEvent('chatDataChanged',function(){set(W.chatData)});set(W.chatData);try{W.ready()}catch(x){}`;

const CARD_JS = `
var W=TelegramWidget,S={},L=0,T='';
function e(x){return String(x==null?'':x).replace(/[&<>"']/g,function(c){return'&#'+c.charCodeAt(0)+';'})}
function byn(n){return Number(n).toLocaleString('ru-RU')+' BYN'}
function b(t,c,k){return'<button class="'+(k||'')+'" onclick="'+c+'">'+t+'</button>'}
function set(j){try{S=j?JSON.parse(j):{}}catch(x){S={}}L=0;T='';r()}
function q(d){try{W.HapticFeedback.impactOccurred('light')}catch(x){}T='…';r();W.request(d).then(function(a){a&&a.result?set(a.result):(T='',r())},function(x){T=x&&x.code=='RATE_LIMITED'?'Не так быстро':'Не получилось — попробуйте ещё раз';r()})}
function ln(){var l=(S.l||[]).slice();if(S.u)l.push(['Открыть на ichiba ↗',S.u]);return l}
function go(k){var l=ln()[k];if(l)W.openLink(l[1])}
function cq(k){var c=(S.c||[])[k];if(c)q(c[1])}
function no(){L=1;r()}
function r(){var h='<div class="h"><div class="se">市</div><div class="u">'+e(S.h||'ichiba')+'</div></div>',x=S.x||[];
if(S.w||S.t||S.p!=null||S.m||x.length){h+='<div class="c">'+(S.w?'<div class="mu">'+e(S.w)+'</div>':'')+(S.t?'<b style="font-size:16px">'+e(S.t)+'</b>':'');
if(S.p!=null)h+='<div class="pr">'+byn(S.p)+(S.o!=null?' <s style="font-size:16px">'+byn(S.o)+'</s>':'')+'</div>';
h+=x.map(function(s){return'<p style="white-space:pre-line;margin:4px 0">'+e(s)+'</p>'}).join('')+(S.m?'<div class="mu">'+e(S.m)+'</div>':'')+'</div>'}
if(S.d)h+='<div class="c" style="text-align:center;font-weight:700">'+e(S.d)+'</div>';
else if(S.a)h+='<div class="g">'+b('✅ Принять',"q('na')",'ok')+(L?b('Точно отклонить?',"q('nx')",'no'):b('✖️ Отклонить','no()'))+'</div>';
h+=(S.c||[]).map(function(c,k){return b(e(c[0]),'cq('+k+')',k?'row':'main')}).join('');
h+=ln().map(function(l,k){return b(e(l[0])+' ↗','go('+k+')','row')}).join('');
document.getElementById('a').innerHTML=h+(T?'<div class="t">'+e(T)+'</div>':'')}
W.onEvent('chatDataChanged',function(){set(W.chatData)});set(W.chatData);try{W.ready()}catch(x){}`;

/** The bot's one card for everything that isn't the shop menu: replies, notifications, deal cards (cards.ts). */
export const CARD_HTML = `<style>${CSS.replace(/\n/g, '')}</style><body><div id="a"></div><script>${CARD_JS.trim()}</script>`;
/** Deal cards are cards with «Принять / Отклонить» (state.a). */
export const NOTICE_HTML = CARD_HTML;

export const WIDGET_HTML = `<style>${CSS.replace(/\n/g, '')}</style><body><div id="a"></div><script>${JS.trim()}</script>`;
