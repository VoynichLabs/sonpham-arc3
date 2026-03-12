'use strict';

// ═══════════════════════════════════════════════════════════════
//  GAME  CLASS
// ═══════════════════════════════════════════════════════════════
class Game {
  constructor(){
    this.canvas=document.getElementById('c');
    this.ctx=this.canvas.getContext('2d');
    this.levelIdx=0;
    this.unlockedLevels=1;
    this.score=0;
    this.state='menu';  // menu|playing|win|fail|clear

    // Level state
    this.birds=[];
    this.blocks=[];
    this.pigs=[];
    this.particles=[];
    this.birdQueue=[];     // indices into this.birds not yet launched
    this.activeBirdIdx=-1;
    this.nextBirdTimer=0;

    // Slingshot input
    this.dragging=false;
    this.dragX=0; this.dragY=0;
    this.pullX=0; this.pullY=0;
    this.aimPreview=[];

    this.frameCount=0;
    this.postShotTimer=0;  // wait after bird goes off-screen
    this.bgCache=null;

    this._initUI();
    this._bindInput();
    this._buildLevelBtns();
    requestAnimationFrame(()=>this._loop());
  }

  // ── UI helpers ────────────────────────────────────────────────
  _initUI(){
    this._ovMenu=document.getElementById('ov-menu');
    this._ovWin =document.getElementById('ov-win');
    this._ovFail=document.getElementById('ov-fail');
    this._ovClear=document.getElementById('ov-clear');
    this._hudLevel=document.getElementById('hud-level');
    this._hudScore=document.getElementById('hud-score');
    this._abilityHint=document.getElementById('ability-hint');
    this._stars=[1,2,3].map(i=>document.getElementById('s'+i));
    this._btnNext=document.getElementById('btn-next');
  }

  _setOverlay(name){
    const map={menu:this._ovMenu,win:this._ovWin,fail:this._ovFail,clear:this._ovClear};
    [this._ovMenu,this._ovWin,this._ovFail,this._ovClear].forEach(o=>{
      o.classList.add('hidden');
    });
    if(name&&map[name]) map[name].classList.remove('hidden');
  }

  _buildLevelBtns(){
    const c=document.getElementById('level-btns');
    for(let i=0;i<5;i++){
      const b=document.createElement('button');
      b.textContent=i+1;
      b.className='lvl-btn'+(i>=this.unlockedLevels?' locked':'');
      b.onclick=()=>{ if(i<this.unlockedLevels) this.startLevel(i); };
      c.appendChild(b);
    }
    this._levelBtns=Array.from(c.querySelectorAll('.lvl-btn'));
  }

  _refreshLevelBtns(){
    this._levelBtns.forEach((b,i)=>{
      b.className='lvl-btn'+(i>=this.unlockedLevels?' locked':'');
    });
  }

  // ── Input ─────────────────────────────────────────────────────
  _bindInput(){
    const cv=this.canvas;
    cv.addEventListener('mousedown',e=>this._onDown(e.offsetX,e.offsetY));
    cv.addEventListener('mousemove',e=>this._onMove(e.offsetX,e.offsetY));
    cv.addEventListener('mouseup', e=>this._onUp(e.offsetX,e.offsetY));
    cv.addEventListener('touchstart',e=>{e.preventDefault();const t=this._touch(e);this._onDown(t.x,t.y);},{passive:false});
    cv.addEventListener('touchmove', e=>{e.preventDefault();const t=this._touch(e);this._onMove(t.x,t.y);},{passive:false});
    cv.addEventListener('touchend',  e=>{e.preventDefault();const t=this._touch(e);this._onUp(t.x,t.y);},{passive:false});
  }

  _touch(e){
    const r=this.canvas.getBoundingClientRect();
    const t=e.changedTouches[0]||e.touches[0];
    const scaleX=W/r.width, scaleY=H/r.height;
    return {x:(t.clientX-r.left)*scaleX,y:(t.clientY-r.top)*scaleY};
  }

  _onDown(x,y){
    if(this.state!=='playing') return;
    if(this.activeBirdIdx<0) return;
    const bird=this.birds[this.activeBirdIdx];
    if(bird.active){
      // In-flight: trigger ability
      const extras=bird.useAbility();
      if(extras) this.birds.push(...extras);
      this._showAbilityHint('');
    } else {
      // On slingshot: start drag
      const d=dist(x,y,SLING_X,SLING_Y);
      if(d<50){this.dragging=true;this.dragX=x;this.dragY=y;}
    }
  }

  _onMove(x,y){
    if(!this.dragging) return;
    const dx=x-SLING_X, dy=y-SLING_Y;
    const d=Math.min(Math.sqrt(dx*dx+dy*dy),MAX_PULL);
    const a=Math.atan2(dy,dx);
    this.pullX=Math.cos(a)*d;
    this.pullY=Math.sin(a)*d;
    this._calcPreview();
  }

  _onUp(x,y){
    if(!this.dragging) return;
    this.dragging=false;
    const d=Math.sqrt(this.pullX*this.pullX+this.pullY*this.pullY);
    if(d<8){this.pullX=0;this.pullY=0;this.aimPreview=[];return;}
    const vx=-this.pullX*BIRD_SPEED_SCALE;
    const vy=-this.pullY*BIRD_SPEED_SCALE;
    const bird=this.birds[this.activeBirdIdx];
    bird.x=SLING_X; bird.y=SLING_Y;
    bird.launch(vx,vy);
    this.pullX=0;this.pullY=0;this.aimPreview=[];
    this._showAbilityHint(ABILITY_HINT[bird.type]);
    this.postShotTimer=180;
  }

  _calcPreview(){
    const vx=-this.pullX*BIRD_SPEED_SCALE;
    const vy=-this.pullY*BIRD_SPEED_SCALE;
    const pts=[];
    let px=SLING_X,py=SLING_Y,pvx=vx,pvy=vy;
    for(let i=0;i<120;i+=2){
      pvy+=GRAV; px+=pvx; py+=pvy;
      if(i%6===0) pts.push({x:px,y:py});
      if(py>GROUND||px>W+50||px<-50) break;
    }
    this.aimPreview=pts;
  }

  // ── Level management ─────────────────────────────────────────
  startLevel(idx){
    this.levelIdx=idx;
    const ld=LEVELS[idx];
    this.state='playing';
    this.score=0;
    this.particles=[];
    this.bgCache=null;
    this.postShotTimer=0;
    this.nextBirdTimer=0;

    // Build birds
    this.birds=ld.birds.map(t=>new Bird(t));
    this.birdQueue=this.birds.map((_,i)=>i);
    this.activeBirdIdx=-1;

    // Build blocks
    this.blocks=ld.blocks.map(b=>new Block(b[0],b[1],b[2],b[3],b[4]));

    // Build pigs
    this.pigs=ld.pigs.map(p=>new Pig(p[0],p[1],p[2]));

    this._setOverlay(null);
    this._hudLevel.textContent=`Level ${idx+1}`;
    this._hudScore.textContent='Score: 0';
    this._loadNextBird();
  }

  _loadNextBird(){
    if(this.birdQueue.length===0){this.activeBirdIdx=-1;return;}
    this.activeBirdIdx=this.birdQueue.shift();
    const bird=this.birds[this.activeBirdIdx];
    bird.x=SLING_X; bird.y=SLING_Y;
    bird.active=false;
    // Queue display: position waiting birds
    this.birdQueue.forEach((bi,qi)=>{
      const b=this.birds[bi];
      b.x=80-qi*32; b.y=GROUND-22-b.r;
    });
  }

  retry(){this.startLevel(this.levelIdx);}
  nextLevel(){this.startLevel(Math.min(this.levelIdx+1,4));}
  showMenu(){this.state='menu';this._setOverlay('menu');this._refreshLevelBtns();}

  // ── Collision helpers ─────────────────────────────────────────
  _circleRect(cx,cy,cr,rx,ry,rw,rh){
    const nx=clamp(cx,rx,rx+rw);
    const ny=clamp(cy,ry,ry+rh);
    const dx=cx-nx, dy=cy-ny;
    return dx*dx+dy*dy<cr*cr;
  }

  _birdVsBlocks(bird){
    if(!bird.active) return;
    for(const blk of this.blocks){
      if(blk.destroyed) continue;
      if(!this._circleRect(bird.x,bird.y,bird.r,blk.x,blk.y,blk.w,blk.h)) continue;

      const spd=Math.sqrt(bird.vx*bird.vx+bird.vy*bird.vy);
      const dmg=({[WOOD]:2,[STONE]:1,[ICE]:3})[blk.type];
      blk.hit(Math.ceil(spd*dmg*.18));
      if(blk.destroyed) this._spawnDestroyParticles(blk);

      // Give block impulse
      blk.vx+=bird.vx*.3;
      blk.vy+=bird.vy*.3;
      blk.angVel+=(bird.x-blk.cx)*.01;

      // Slow bird
      bird.vx*=0.55; bird.vy*=0.55;

      // Damage score
      this._addScore(10);
    }
  }

  _birdVsPigs(bird){
    if(!bird.active) return;
    for(const pig of this.pigs){
      if(pig.destroyed) continue;
      if(dist(bird.x,bird.y,pig.x,pig.y)>bird.r+pig.r) continue;
      const spd=Math.sqrt(bird.vx*bird.vx+bird.vy*bird.vy);
      pig.hit(Math.ceil(spd*.22));
      if(pig.destroyed){
        this._spawnPigDeathParticles(pig);
        this._addScore(500);
      }
      bird.vx*=0.45; bird.vy*=0.45;
    }
  }

  _explodeBird(bird){
    const R=90;
    for(const blk of this.blocks){
      if(blk.destroyed) continue;
      if(dist(bird.x,bird.y,blk.cx,blk.cy)<R){
        blk.hit(6);
        blk.vx+=(blk.cx-bird.x)*.12;
        blk.vy+=(blk.cy-bird.y)*.12-(bird.x>blk.cx?.2:.2);
        blk.angVel+=(blk.cx-bird.x)*.006;
        if(blk.destroyed){this._spawnDestroyParticles(blk);this._addScore(10);}
      }
    }
    for(const pig of this.pigs){
      if(pig.destroyed) continue;
      if(dist(bird.x,bird.y,pig.x,pig.y)<R+pig.r){
        pig.hit(4);
        if(pig.destroyed){this._spawnPigDeathParticles(pig);this._addScore(500);}
      }
    }
    // Explosion particles
    this._spawnExplosion(bird.x,bird.y);
    bird.life=0;
  }

  // ── Particles ─────────────────────────────────────────────────
  _spawnDestroyParticles(blk){
    const cols={[WOOD]:['#a06020','#c08030','#603000'],
                [STONE]:['#888','#aaa','#555'],
                [ICE]:['#c0e8ff','#90c8f0','#ffffff']}[blk.type];
    const N=8;
    for(let i=0;i<N;i++){
      const a=(i/N)*Math.PI*2;
      const sp=2+i*.5;
      this.particles.push(new Particle(
        blk.cx,blk.cy,
        Math.cos(a)*sp,Math.sin(a)*sp,
        cols[i%cols.length],40+i*3,4+i*.5
      ));
    }
  }

  _spawnPigDeathParticles(pig){
    const N=10;
    for(let i=0;i<N;i++){
      const a=(i/N)*Math.PI*2;
      const sp=1.5+i*.6;
      this.particles.push(new Particle(
        pig.x,pig.y,
        Math.cos(a)*sp,Math.sin(a)*sp,
        i%2===0?'#80e040':'#50b020',35+i*2,5
      ));
    }
  }

  _spawnExplosion(x,y){
    const N=16;
    for(let i=0;i<N;i++){
      const a=(i/N)*Math.PI*2;
      const sp=3+i*.7;
      const cols=['#ff8800','#ffcc00','#ff4400','#fff'];
      this.particles.push(new Particle(
        x,y,Math.cos(a)*sp,Math.sin(a)*sp,
        cols[i%cols.length],50+i,6+(i%4)
      ));
    }
    // Shockwave flash particles outward
    for(let i=0;i<8;i++){
      const a=(i/8)*Math.PI*2;
      this.particles.push(new Particle(
        x,y,Math.cos(a)*8,Math.sin(a)*8,
        '#ffffff',20,3
      ));
    }
  }

  _addScore(n){
    this.score+=n;
    this._hudScore.textContent=`Score: ${this.score}`;
  }

  _showAbilityHint(txt){
    const el=this._abilityHint;
    el.style.opacity=txt?'1':'0';
    el.textContent=txt;
  }

  // ── Win/Fail check ───────────────────────────────────────────
  _checkEnd(){
    const alivePigs=this.pigs.filter(p=>!p.destroyed);
    if(alivePigs.length===0){
      // Win!
      const birdsLeft=this.birdQueue.length+(this.activeBirdIdx>=0&&!this.birds[this.activeBirdIdx].active?1:0);
      this._addScore(birdsLeft*200);
      const stars=this.score>4000?3:this.score>2000?2:1;
      this.state='win';
      // Unlock next
      if(this.levelIdx+1<5) this.unlockedLevels=Math.max(this.unlockedLevels,this.levelIdx+2);
      this._refreshLevelBtns();
      // Animate stars
      setTimeout(()=>{
        this._setOverlay('win');
        document.getElementById('win-score').textContent=`Score: ${this.score}`;
        this._stars.forEach((s,i)=>{
          s.className='star unlit';
          if(i<stars){
            setTimeout(()=>{s.className='star lit';},i*400+200);
          }
        });
        this._btnNext.style.display=this.levelIdx<4?'inline-block':'none';
        if(this.levelIdx===4){
          setTimeout(()=>{
            this._setOverlay('clear');
            this.unlockedLevels=1;
          },2000);
        }
      },1000);
      return;
    }

    // Check fail: no birds left and active bird has landed/gone
    const active=this.activeBirdIdx>=0?this.birds[this.activeBirdIdx]:null;
    const flyingExtra=this.birds.some((b,i)=>b.active&&i!==this.activeBirdIdx);
    if(this.birdQueue.length===0&&(!active||active.landed||active.dead)&&!flyingExtra){
      this.state='fail';
      setTimeout(()=>this._setOverlay('fail'),1200);
    }
  }

  // ── Main loop ─────────────────────────────────────────────────
  _loop(){
    requestAnimationFrame(()=>this._loop());
    this.frameCount++;
    const ctx=this.ctx;
    ctx.clearRect(0,0,W,H);

    this._drawBG();

    if(this.state==='playing'||this.state==='win'||this.state==='fail'){
      this._updatePhysics();
      this._drawWorld();
    }
  }

  // ── Background ───────────────────────────────────────────────
  _drawBG(){
    const ctx=this.ctx;
    const lvl=this.levelIdx;
    // Sky gradient
    const sky=ctx.createLinearGradient(0,0,0,H);
    if(lvl===2){
      sky.addColorStop(0,'#ff9a3c');  // sunset
      sky.addColorStop(.45,'#ff6b6b');
      sky.addColorStop(1,'#2a1a3a');
    } else {
      sky.addColorStop(0,'#1e90ff');
      sky.addColorStop(.6,'#87ceeb');
      sky.addColorStop(1,'#c9e8ff');
    }
    ctx.fillStyle=sky;
    ctx.fillRect(0,0,W,H);

    // Clouds (fixed positions)
    ctx.fillStyle='rgba(255,255,255,0.82)';
    [[120,80,55,30],[280,55,70,35],[500,90,60,28],[720,65,80,38],[830,100,50,25]].forEach(([cx,cy,rw,rh])=>{
      ctx.beginPath();
      ctx.ellipse(cx,cy,rw,rh,0,0,Math.PI*2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(cx-rw*.4,cy+rh*.3,rw*.6,rh*.7,0,0,Math.PI*2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(cx+rw*.4,cy+rh*.3,rw*.6,rh*.7,0,0,Math.PI*2);
      ctx.fill();
    });

    // Mountains
    ctx.fillStyle=lvl===2?'#6a3a2a':'#5a8a3a';
    [[200,GROUND-60,150],[450,GROUND-90,200],[700,GROUND-50,180]].forEach(([mx,my,mw])=>{
      ctx.beginPath();
      ctx.moveTo(mx-mw/2,GROUND);
      ctx.lineTo(mx,my);
      ctx.lineTo(mx+mw/2,GROUND);
      ctx.closePath();
      ctx.fill();
    });
    // Mountain highlights
    ctx.fillStyle=lvl===2?'#a06a4a':'#7ab05a';
    [[200,GROUND-60,50],[450,GROUND-90,70],[700,GROUND-50,55]].forEach(([mx,my,mw])=>{
      ctx.beginPath();
      ctx.moveTo(mx,my);
      ctx.lineTo(mx+mw/2,GROUND);
      ctx.lineTo(mx,GROUND);
      ctx.closePath();
      ctx.fill();
    });

    // Ground
    const grd=ctx.createLinearGradient(0,GROUND,0,H);
    grd.addColorStop(0,'#5a9a30');
    grd.addColorStop(.08,'#4a8a20');
    grd.addColorStop(1,'#3a6a18');
    ctx.fillStyle=grd;
    ctx.fillRect(0,GROUND,W,H-GROUND);

    // Ground edge highlight
    ctx.fillStyle='#70c040';
    ctx.fillRect(0,GROUND,W,5);
  }

  // ── Physics update ───────────────────────────────────────────
  _updatePhysics(){
    if(this.state!=='playing') return;

    // Update active bird
    if(this.activeBirdIdx>=0){
      const bird=this.birds[this.activeBirdIdx];
      bird.update();
      this._birdVsBlocks(bird);
      this._birdVsPigs(bird);

      // Black bomb fuse
      if(bird.type===BLK&&bird.active&&bird.fuseTimer===0&&!bird.abilityUsed){
        bird.abilityUsed=true;
        this._explodeBird(bird);
      }
      // On explicit explode
      if(bird.type===BLK&&bird.active&&bird.abilityUsed&&bird.fuseTimer===1&&!bird.dead){
        this._explodeBird(bird);
      }

      if(bird.dead||bird.landed){
        this.postShotTimer--;
        if(this.postShotTimer<=0){
          this._showAbilityHint('');
          this._loadNextBird();
          this._checkEnd();
        }
      }
    }

    // Update extra birds (blue splits etc.)
    for(let i=0;i<this.birds.length;i++){
      if(i===this.activeBirdIdx) continue;
      const b=this.birds[i];
      if(!b.active||b.dead) continue;
      b.update();
      this._birdVsBlocks(b);
      this._birdVsPigs(b);
      if(b.type===BLK&&b.fuseTimer===0&&!b.abilityUsed){
        b.abilityUsed=true; this._explodeBird(b);
      }
    }

    // Blocks: apply velocity (knocked blocks slide a bit)
    for(const blk of this.blocks){
      if(blk.destroyed) continue;
      blk.vy+=GRAV*.6;
      blk.angle+=blk.angVel;
      blk.angVel*=0.92;
      blk.x+=blk.vx; blk.y+=blk.vy;
      blk.vx*=0.85;
      // Ground
      if(blk.y+blk.h>=GROUND){blk.y=GROUND-blk.h;blk.vy*=-.15;blk.vx*=.8;blk.angVel*=.6;}
    }

    // Particles
    this.particles=this.particles.filter(p=>{p.update();return !p.dead;});

    // Pigs: simple gravity if not on ground
    for(const pig of this.pigs){
      if(pig.destroyed) continue;
      if(pig.y+pig.r<GROUND){pig.y=Math.min(pig.y+GRAV*2,GROUND-pig.r);}
    }
  }

  // ── Draw world ───────────────────────────────────────────────
  _drawWorld(){
    const ctx=this.ctx;

    // Slingshot
    this._drawSlingshot();

    // Blocks
    for(const blk of this.blocks) blk.draw(ctx);

    // Pigs
    for(const pig of this.pigs) pig.draw(ctx);

    // Particles
    for(const p of this.particles) p.draw(ctx);

    // Queued birds (not yet launched)
    this.birdQueue.forEach((bi,qi)=>{
      const b=this.birds[bi];
      const qx=80-qi*30, qy=GROUND-b.r-4;
      b.x=qx; b.y=qy;
      b.draw(ctx);
    });

    // Active bird
    if(this.activeBirdIdx>=0){
      const bird=this.birds[this.activeBirdIdx];
      // Draw trajectory preview
      if(!bird.active&&this.dragging&&this.aimPreview.length>0){
        ctx.save();
        ctx.setLineDash([6,8]);
        ctx.strokeStyle='rgba(255,255,255,0.55)';
        ctx.lineWidth=2;
        ctx.beginPath();
        this.aimPreview.forEach((p,i)=>{
          i===0?ctx.moveTo(p.x,p.y):ctx.lineTo(p.x,p.y);
        });
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      }
      bird.draw(ctx);

      // Draw slingshot elastic when aiming
      if(!bird.active){
        this._drawElastic(bird.x,bird.y);
      }
    }

    // Extra birds (split)
    for(let i=0;i<this.birds.length;i++){
      if(i===this.activeBirdIdx) continue;
      const b=this.birds[i];
      if(b.active&&!b.dead) b.draw(ctx);
    }
  }

  _drawSlingshot(){
    const ctx=this.ctx;
    const sx=SLING_X, groundY=GROUND;

    // Posts
    ctx.save();
    ctx.strokeStyle='#6b3a10';
    ctx.lineWidth=10;
    ctx.lineCap='round';

    // Left fork
    ctx.beginPath();
    ctx.moveTo(sx-22,groundY);
    ctx.lineTo(sx-8,SLING_Y-18);
    ctx.stroke();
    // Right fork
    ctx.beginPath();
    ctx.moveTo(sx+22,groundY);
    ctx.lineTo(sx+8,SLING_Y-18);
    ctx.stroke();

    // Fork tips
    ctx.fillStyle='#4a2808';
    ctx.beginPath();ctx.arc(sx-8,SLING_Y-18,6,0,Math.PI*2);ctx.fill();
    ctx.beginPath();ctx.arc(sx+8,SLING_Y-18,6,0,Math.PI*2);ctx.fill();

    // Main trunk
    ctx.beginPath();
    ctx.moveTo(sx,groundY);
    ctx.lineTo(sx,SLING_Y+10);
    ctx.strokeStyle='#8b4a15';
    ctx.lineWidth=12;
    ctx.stroke();

    // Highlight
    ctx.beginPath();
    ctx.moveTo(sx+2,groundY);
    ctx.lineTo(sx+2,SLING_Y+10);
    ctx.strokeStyle='rgba(255,200,100,.3)';
    ctx.lineWidth=4;
    ctx.stroke();

    ctx.restore();
  }

  _drawElastic(bx,by){
    const ctx=this.ctx;
    const lx=SLING_X-8, ly=SLING_Y-18;
    const rx=SLING_X+8, ry=SLING_Y-18;

    ctx.save();
    ctx.strokeStyle='#8b6914';
    ctx.lineWidth=3;
    ctx.lineCap='round';

    // Left band: fork tip -> bird -> mid
    ctx.beginPath();
    ctx.moveTo(lx,ly);
    ctx.lineTo(bx,by);
    ctx.stroke();

    // Right band: fork tip -> bird
    ctx.beginPath();
    ctx.moveTo(rx,ry);
    ctx.lineTo(bx,by);
    ctx.stroke();

    ctx.restore();
  }
}
