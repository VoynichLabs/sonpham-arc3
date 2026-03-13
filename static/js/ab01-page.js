'use strict';

// ═══════════════════════════════════════════════════════════════
//  GAME CLASS & COORDINATOR — ab01-page.js
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
}

// ═══════════════════════════════════════════════════════════════
//  BOOT
// ═══════════════════════════════════════════════════════════════
const G = new Game();
G.showMenu();
