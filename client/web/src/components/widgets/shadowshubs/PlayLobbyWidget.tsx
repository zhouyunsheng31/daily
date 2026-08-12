// ============================================================================
// Phase 7 §14.4：shadowshubs 游玩大厅 widget
//
// 对应 shadowshubs 原能力：游玩大厅（/play）
// 显示游戏列表（俄罗斯方块/贪吃蛇/2048），点击"开始游戏"在 iframe 中加载
// ============================================================================

import { useState, useMemo, useCallback } from 'react'
import { Gamepad2, Play, ArrowLeft } from 'lucide-react'

interface GameInfo {
  id: string
  title: string
  description: string
  icon: string
  color: string
  buildHtml: () => string
}

// ============================================================================
// 游戏 HTML 生成器（内联，通过 data URL 加载到 iframe）
// ============================================================================

function buildSnakeHtml(): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
*{margin:0;padding:0;box-sizing:border-box}body{background:#1a1a2e;color:#fff;font-family:monospace;display:flex;flex-direction:column;align-items:center;padding:10px}canvas{border:2px solid #50E3C2;border-radius:4px}#s{margin-top:8px;font-size:14px}
</style></head><body><canvas id="c" width="300" height="300"></canvas><div id="s">分数: 0 | 按方向键移动</div><script>
var c=document.getElementById('c'),x=c.getContext('2d'),g=15,W=20,H=20,sn=[{x:10,y:10}],d={x:1,y:0},f={x:5,y:5},sc=0,iv;
function R(){x.fillStyle='#1a1a2e';x.fillRect(0,0,300,300);x.fillStyle='#E74C3C';x.fillRect(f.x*g,f.y*g,g-1,g-1);x.fillStyle='#50E3C2';sn.forEach(function(s){x.fillRect(s.x*g,s.y*g,g-1,g-1)})}
function T(){var h={x:sn[0].x+d.x,y:sn[0].y+d.y};if(h.x<0||h.x>=W||h.y<0||h.y>=H||sn.some(function(s){return s.x===h.x&&s.y===h.y})){clearInterval(iv);document.getElementById('s').textContent='游戏结束! 分数: '+sc+' | 刷新重来';return}sn.unshift(h);if(h.x===f.x&&h.y===f.y){sc++;f={x:Math.floor(Math.random()*W),y:Math.floor(Math.random()*H)};document.getElementById('s').textContent='分数: '+sc+' | 按方向键移动'}else sn.pop();R()}
document.addEventListener('keydown',function(e){var k=e.key;if(k==='ArrowUp'&&d.y===0)d={x:0,y:-1};else if(k==='ArrowDown'&&d.y===0)d={x:0,y:1};else if(k==='ArrowLeft'&&d.x===0)d={x:-1,y:0};else if(k==='ArrowRight'&&d.x===0)d={x:1,y:0};e.preventDefault()});
R();iv=setInterval(T,120);
</script></body></html>`
}

function build2048Html(): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
*{margin:0;padding:0;box-sizing:border-box}body{background:#1a1a2e;color:#fff;font-family:monospace;display:flex;flex-direction:column;align-items:center;padding:10px}#b{display:grid;grid-template-columns:repeat(4,60px);gap:6px;background:#2a2a4e;padding:6px;border-radius:6px;margin-top:8px}.t{width:60px;height:60px;display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:bold;border-radius:4px;background:#3a3a5e}#s{font-size:14px;margin-top:8px}
</style></head><body><div id="s">分数: 0 | 方向键移动</div><div id="b"></div><script>
var b=[],sc=0;function I(){b=[];for(var i=0;i<4;i++){b.push([0,0,0,0])}add();add()}function add(){var e=[];for(var i=0;i<4;i++)for(var j=0;j<4;j++)if(b[i][j]===0)e.push([i,j]);if(e.length===0)return;var p=e[Math.floor(Math.random()*e.length)];b[p[0]][p[1]]=Math.random()<0.5?2:4}function R(){var d=document.getElementById('b');d.innerHTML='';for(var i=0;i<4;i++)for(var j=0;j<4;j++){var t=document.createElement('div');t.className='t';var v=b[i][j];t.textContent=v||'';var c={'2':'#eee4da','4':'#ede0c8','8':'#f2b179','16':'#f59563','32':'#f67c5f','64':'#f65e3b','128':'#edcf72','256':'#edcc61'};if(c[v])t.style.background=c[v];if(v>4)t.style.color='#fff';d.appendChild(t)}}
function slide(r){var n=r.filter(function(v){return v}),c=n.length;for(var i=0;i<n.length-1;i++){if(n[i]===n[i+1]){n[i]*=2;sc+=n[i];n.splice(i+1,1)}}while(n.length<4)n.push(0);return n}
function move(dir){var ch=false;for(var i=0;i<4;i++){var r;if(dir==='L'){r=slide(b[i]);if(r.join()!==b[i].join())ch=true;b[i]=r}else if(dir==='R'){r=slide(b[i].reverse()).reverse();if(r.join()!==b[i].join())ch=true;b[i]=r}else{var col=[b[0][i],b[1][i],b[2][i],b[3][i]];if(dir==='U')r=slide(col);else r=slide(col.reverse()).reverse();if(r.join()!==col.join())ch=true;for(var j=0;j<4;j++)b[j][i]=r[j]}}if(ch){add();document.getElementById('s').textContent='分数: '+sc+' | 方向键移动';R();if(!canMove()){document.getElementById('s').textContent='游戏结束! 分数: '+sc+' | 刷新重来'}}}
function canMove(){for(var i=0;i<4;i++)for(var j=0;j<4;j++){if(b[i][j]===0)return true;if(j<3&&b[i][j]===b[i][j+1])return true;if(i<3&&b[i][j]===b[i+1][j])return true}return false}
document.addEventListener('keydown',function(e){var k=e.key;if(k==='ArrowLeft')move('L');else if(k==='ArrowRight')move('R');else if(k==='ArrowUp')move('U');else if(k==='ArrowDown')move('D');e.preventDefault()});
I();R();
</script></body></html>`
}

function buildTetrisHtml(): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
*{margin:0;padding:0;box-sizing:border-box}body{background:#1a1a2e;color:#fff;font-family:monospace;display:flex;flex-direction:column;align-items:center;padding:10px}canvas{border:2px solid #9B59B6;border-radius:4px}#s{margin-top:8px;font-size:14px}
</style></head><body><canvas id="c" width="200" height="400"></canvas><div id="s">分数: 0 | ←→移动 ↑旋转 ↓加速</div><script>
var c=document.getElementById('c'),x=c.getContext('2d'),W=10,H=20,S=20,g=[],sc=0,pc,pr,pp,pt,iv;
var P=[[[1,1,1,1]],[[1,1],[1,1]],[[0,1,0],[1,1,1]],[[1,0,0],[1,1,1]],[[0,0,1],[1,1,1]],[[1,1,0],[0,1,1]],[[0,1,1],[1,1,0]]];
var C=['#00f0f0','#f0f000','#a000f0','#0000f0','#f0a000','#00f000','#f00000'];
function I(){g=[];for(var i=0;i<H;i++)g.push(new Array(W).fill(-1));np()}
function np(){pc=Math.floor(Math.random()*7);pt=pc;pp=0;pr=0;var s=P[pc][0].length;pc=Math.floor((W-s)/2);if(col(pr,pc,pp,0)){clearInterval(iv);document.getElementById('s').textContent='游戏结束! 分数: '+sc+' | 刷新重来'}}
function col(r,p,sh,dr){var t=P[pt];for(var i=0;i<t.length;i++)for(var j=0;j<t[i].length;j++){if(t[i][j]){var nr=r+i+dr,np2=p+j;if(np2<0||np2>=W||nr>=H)return true;if(nr>=0&&g[nr][np2]!==-1)return true}}return false}
function lock(){var t=P[pt];for(var i=0;i<t.length;i++)for(var j=0;j<t[i].length;j++)if(t[i][j]){var nr=pr+i,np2=pc+j;if(nr>=0)g[nr][np2]=pt}clr();np()}
function clr(){var n=0;for(var i=H-1;i>=0;i--){if(g[i].every(function(v){return v!==-1})){g.splice(i,1);g.unshift(new Array(W).fill(-1));n++;i++}}if(n>0){sc+=n*100;document.getElementById('s').textContent='分数: '+sc+' | ←→移动 ↑旋转 ↓加速'}}
function rot(){var t=P[pt],h=t.length,w=t[0].length,nt=[];for(var i=0;i<w;i++){nt.push([]);for(var j=0;j<h;j++)nt[i].push(t[h-1-j][i])}var op=pp;pp=(pp+1)%4;if(!col(pr,pc,pp,0))P[pt]=nt;else{pp=op}}
function R(){x.fillStyle='#1a1a2e';x.fillRect(0,0,200,400);for(var i=0;i<H;i++)for(var j=0;j<W;j++)if(g[i][j]!==-1){x.fillStyle=C[g[i][j]];x.fillRect(j*S,i*S,S-1,S-1)}var t=P[pt];for(var i=0;i<t.length;i++)for(var j=0;j<t[i].length;j++)if(t[i][j]){x.fillStyle=C[pt];x.fillRect((pc+j)*S,(pr+i)*S,S-1,S-1)}}
function T(){if(!col(pr,pc,pp,1))pr++;else lock();R()}
document.addEventListener('keydown',function(e){var k=e.key;if(k==='ArrowLeft'&&!col(pr,pc-1,pp,0))pc--;else if(k==='ArrowRight'&&!col(pr,pc+1,pp,0))pc++;else if(k==='ArrowUp')rot();else if(k==='ArrowDown'){if(!col(pr,pc,pp,1))pr++;else lock()}e.preventDefault();R()});
I();R();iv=setInterval(T,500);
</script></body></html>`
}

const GAMES: GameInfo[] = [
  {
    id: 'snake',
    title: '贪吃蛇',
    description: '经典贪吃蛇游戏，控制蛇吃食物变长，不要撞墙或自己',
    icon: '🐍',
    color: 'linear-gradient(135deg, #50E3C2, #2ECC71)',
    buildHtml: buildSnakeHtml,
  },
  {
    id: '2048',
    title: '2048',
    description: '合并相同数字达到 2048，简单上手但很难精通',
    icon: '🔢',
    color: 'linear-gradient(135deg, #F39C12, #E67E22)',
    buildHtml: build2048Html,
  },
  {
    id: 'tetris',
    title: '俄罗斯方块',
    description: '经典方块消除游戏，旋转和移动方块填满整行',
    icon: '🟦',
    color: 'linear-gradient(135deg, #9B59B6, #8E44AD)',
    buildHtml: buildTetrisHtml,
  },
]

export interface PlayLobbyWidgetProps {
  onEnter?: () => void
}

export default function PlayLobbyWidget({ onEnter: _onEnter }: PlayLobbyWidgetProps) {
  const [activeGame, setActiveGame] = useState<GameInfo | null>(null)

  const gameDataUrl = useMemo(() => {
    if (!activeGame) return ''
    return `data:text/html;charset=utf-8,${encodeURIComponent(activeGame.buildHtml())}`
  }, [activeGame])

  const handleBack = useCallback(() => setActiveGame(null), [])

  return (
    <div
      className="shadowshubs-widget-card"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        padding: 20,
        borderRadius: 12,
        background: 'linear-gradient(135deg, rgba(74,144,226,0.08), rgba(80,227,194,0.08))',
        border: '1px solid var(--border-default)',
        minHeight: 180,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: 10,
            background: 'linear-gradient(135deg, #4A90E2, #50E3C2)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fff',
          }}
        >
          <Gamepad2 size={22} />
        </div>
        <div>
          <div style={{ fontSize: 15, fontWeight: 600 }}>游玩大厅</div>
          <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>Play Lobby · {activeGame ? activeGame.title : '3 个游戏'}</div>
        </div>
      </div>

      {activeGame ? (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              onClick={handleBack}
              style={{
                padding: '4px 10px',
                borderRadius: 6,
                border: '1px solid var(--border-default)',
                background: 'transparent',
                color: 'var(--text-secondary)',
                fontSize: 11,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                fontFamily: 'inherit',
              }}
            >
              <ArrowLeft size={12} />
              返回列表
            </button>
            <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
              {activeGame.icon} {activeGame.title} — 点击 iframe 获取焦点后用方向键操作
            </span>
          </div>
          <iframe
            src={gameDataUrl}
            title={activeGame.title}
            style={{
              width: '100%',
              height: 420,
              border: '1px solid var(--border-default)',
              borderRadius: 8,
              background: '#1a1a2e',
            }}
          />
        </>
      ) : (
        <>
          <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.6 }}>
            浏览并游玩社区精选 HTML5 游戏，支持即时启动。
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {GAMES.map(game => (
              <div
                key={game.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '8px 10px',
                  borderRadius: 8,
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid var(--border-default)',
                }}
              >
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 8,
                    background: game.color,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 18,
                    flexShrink: 0,
                  }}
                >
                  {game.icon}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{game.title}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-tertiary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {game.description}
                  </div>
                </div>
                <button
                  onClick={() => setActiveGame(game)}
                  style={{
                    padding: '5px 12px',
                    borderRadius: 6,
                    border: 'none',
                    background: 'linear-gradient(135deg, #4A90E2, #50E3C2)',
                    color: '#fff',
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    fontFamily: 'inherit',
                    flexShrink: 0,
                  }}
                >
                  <Play size={11} />
                  开始游戏
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
