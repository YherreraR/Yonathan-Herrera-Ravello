
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { Target, Zap, Play, RotateCcw, Home, HelpCircle, Trophy, AlertTriangle, BookOpen, ChevronRight, ChevronLeft, X, ListOrdered, Save, User, Pause, PlayCircle, ArrowRight, CheckCircle2, AlertCircle, Sparkles } from 'lucide-react';

// --- Constants & Types ---

type GameMode = 'multiples' | 'divisors';
type GameState = 'menu' | 'playing' | 'gameover' | 'victory' | 'tutorial' | 'leaderboard' | 'flowchart';

interface Point {
  x: number;
  y: number;
}

interface Ball {
  id: number;
  value: number;
  pos: number; // 0 to 1 along the path
  color: string;
}

interface Projectile {
  x: number;
  y: number;
  vx: number;
  vy: number;
  value: number;
  color: string;
}

interface Effect {
  type: 'particle' | 'text' | 'combo';
  x: number;
  y: number;
  vx?: number;
  vy?: number;
  life: number;
  maxLife: number;
  text?: string;
  color: string;
  size?: number;
  scale?: number;
}

interface ScoreRecord {
  name: string;
  score: number;
  mode: string;
  target: number;
  date: string;
}

const COLORS = [
  '#f43f5e', // rose
  '#06b6d4', // cyan
  '#8b5cf6', // violet
  '#10b981', // emerald
  '#f59e0b', // amber
];

const BALL_RADIUS = 20;
const PROJECTILE_SPEED = 12;
const PATH_SAMPLES = 1000;
const INITIAL_SPEED = 0.00025;
const SPEED_INCREMENT = 0.00006;
const ENERGY_GAIN = 10;
const ENERGY_LOSS = 20; // Double the gain per request

// --- Utility Functions ---

const getRandomInt = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;

const getConditionMatch = (val: number, target: number, mode: GameMode): boolean => {
  if (mode === 'multiples') {
    return val % target === 0;
  } else {
    return val !== 0 && target % val === 0;
  }
};

const generatePath = (width: number, height: number): Point[] => {
  const points: Point[] = [];
  const centerX = width / 2;
  const centerY = height / 2;
  const maxRadius = Math.min(width, height) * 0.45;
  const loops = 3;

  for (let i = 0; i <= PATH_SAMPLES; i++) {
    const t = i / PATH_SAMPLES;
    const angle = t * Math.PI * 2 * loops;
    const radius = maxRadius * (1 - t * 0.8);
    points.push({
      x: centerX + Math.cos(angle) * radius,
      y: centerY + Math.sin(angle) * radius,
    });
  }
  return points;
};

// --- Main Component ---

const ZumaMathGame = () => {
  const [gameState, setGameState] = useState<GameState>('menu');
  const [isPaused, setIsPaused] = useState(false);
  const [gameMode, setGameMode] = useState<GameMode>('multiples');
  const [targetNumber, setTargetNumber] = useState<number>(5);
  const [customTarget, setCustomTarget] = useState<string>('');
  const [score, setScore] = useState<number>(0);
  const [energy, setEnergy] = useState<number>(0);
  const [level, setLevel] = useState<number>(1);
  const [highScore, setHighScore] = useState<number>(0);
  const [tutorialStep, setTutorialStep] = useState(0);
  const [leaderboard, setLeaderboard] = useState<ScoreRecord[]>([]);
  const [playerName, setPlayerName] = useState<string>('');
  const [scoreSaved, setScoreSaved] = useState<boolean>(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const requestRef = useRef<number>();
  const pathRef = useRef<Point[]>([]);
  const ballsRef = useRef<Ball[]>([]);
  const projectilesRef = useRef<Projectile[]>([]);
  const effectsRef = useRef<Effect[]>([]);
  const shooterAngleRef = useRef<number>(0);
  const nextBallValueRef = useRef<number>(5);
  const currentBallValueRef = useRef<number>(5);
  const mousePosRef = useRef<Point>({ x: 0, y: 0 });
  const gameSpeedRef = useRef<number>(INITIAL_SPEED);
  const lastTimeRef = useRef<number>(0);
  const ballCounterRef = useRef<number>(0);
  const screenShakeRef = useRef<number>(0);

  const spawnParticles = (x: number, y: number, color: string, count = 8) => {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = Math.random() * 4 + 2;
      effectsRef.current.push({
        type: 'particle',
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 1,
        maxLife: 1,
        color,
        size: Math.random() * 4 + 2,
      });
    }
  };

  const spawnText = (x: number, y: number, text: string, color: string, size = 20, type: 'text' | 'combo' = 'text') => {
    effectsRef.current.push({
      type,
      x,
      y,
      vy: -1.2,
      life: 1,
      maxLife: 1,
      text,
      color,
      size,
      scale: 1,
    });
  };

  const generateFairBallValue = (target: number, mode: GameMode, forceType?: 'match' | 'no-match'): number => {
    // Increased match probability to 70% to satisfy user request "too few target balls"
    const shouldMatch = forceType === 'match' ? true : (forceType === 'no-match' ? false : Math.random() > 0.3);
    
    if (mode === 'multiples') {
      if (shouldMatch) {
        return target * getRandomInt(1, 10);
      } else {
        let val;
        let attempts = 0;
        do {
          val = getRandomInt(1, 50);
          attempts++;
        } while (val % target === 0 && attempts < 20);
        return val;
      }
    } else {
      const divisors = [];
      for (let i = 1; i <= target; i++) if (target % i === 0) divisors.push(i);
      
      if (shouldMatch && divisors.length > 0) {
        return divisors[getRandomInt(0, divisors.length - 1)];
      } else {
        let val;
        let attempts = 0;
        do {
          val = getRandomInt(1, target + 15);
          attempts++;
        } while (val !== 0 && target % val === 0 && attempts < 20);
        return val;
      }
    }
  };

  const initLevel = (lvl: number, mode: GameMode, chosenTarget?: number) => {
    let target = chosenTarget || targetNumber;
    
    if (!chosenTarget) {
      if (mode === 'multiples') {
        target = getRandomInt(2, 9);
      } else {
        const choices = [12, 16, 18, 20, 24, 30, 36, 40, 48, 60];
        target = choices[getRandomInt(0, choices.length - 1)];
      }
    }

    setTargetNumber(target);
    setScore(0);
    setEnergy(0);
    setLevel(lvl);
    setScoreSaved(false);
    setIsPaused(false);
    gameSpeedRef.current = INITIAL_SPEED + (lvl - 1) * SPEED_INCREMENT;
    projectilesRef.current = [];
    effectsRef.current = [];
    ballCounterRef.current = 0;
    
    const initialBalls: Ball[] = [];
    const ballCount = 12 + lvl * 3;
    for (let i = 0; i < ballCount; i++) {
      // Increase initial match ratio to 2 out of 3 balls
      let force: 'match' | 'no-match' | undefined = undefined;
      if (i % 3 !== 1) force = 'match'; 
      else force = 'no-match';

      const value = generateFairBallValue(target, mode, force);
      initialBalls.push({
        id: ballCounterRef.current++,
        value,
        pos: -i * 0.035,
        color: COLORS[getRandomInt(0, COLORS.length - 1)],
      });
    }
    ballsRef.current = initialBalls;
    
    currentBallValueRef.current = generateFairBallValue(target, mode, 'match');
    nextBallValueRef.current = generateFairBallValue(target, mode);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isPaused) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    mousePosRef.current = { x, y };

    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    shooterAngleRef.current = Math.atan2(y - centerY, x - centerX);
  };

  const handleShoot = () => {
    if (gameState !== 'playing' || isPaused) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    const angle = shooterAngleRef.current;

    projectilesRef.current.push({
      x: centerX + Math.cos(angle) * 40,
      y: centerY + Math.sin(angle) * 40,
      vx: Math.cos(angle) * PROJECTILE_SPEED,
      vy: Math.sin(angle) * PROJECTILE_SPEED,
      value: currentBallValueRef.current,
      color: '#ffffff',
    });

    const hasMatchOnBoard = ballsRef.current.some(b => getConditionMatch(b.value, targetNumber, gameMode));
    // High chance of providing a match if the board is getting crowded or needs clearing
    const forceType = !hasMatchOnBoard ? (Math.random() > 0.1 ? 'match' : undefined) : (Math.random() > 0.4 ? 'match' : undefined);

    currentBallValueRef.current = nextBallValueRef.current;
    nextBallValueRef.current = generateFairBallValue(targetNumber, gameMode, forceType as any);
  };

  const update = (time: number) => {
    if (gameState !== 'playing') return;
    
    if (!isPaused) {
      lastTimeRef.current = time;

      // 1. Move balls along path
      let gameOver = false;
      ballsRef.current.forEach((ball) => {
        ball.pos += gameSpeedRef.current;
        if (ball.pos >= 1) gameOver = true;
      });

      if (gameOver) {
        setGameState('gameover');
        return;
      }

      // 2. Move projectiles and detect collisions
      const path = pathRef.current;
      projectilesRef.current = projectilesRef.current.filter((proj) => {
        proj.x += proj.vx;
        proj.y += proj.vy;

        if (proj.x < 0 || proj.x > 800 || proj.y < 0 || proj.y > 600) return false;

        for (let i = 0; i < ballsRef.current.length; i++) {
          const ball = ballsRef.current[i];
          if (ball.pos < 0) continue;

          const pathIdx = Math.floor(ball.pos * (PATH_SAMPLES - 1));
          const ballPoint = path[pathIdx];
          const dist = Math.sqrt((proj.x - ballPoint.x) ** 2 + (proj.y - ballPoint.y) ** 2);
          
          if (dist < BALL_RADIUS * 1.5) {
            handleHit(ball, proj.value, i);
            return false;
          }
        }
        return true;
      });

      // 3. Update effects
      effectsRef.current = effectsRef.current.filter(eff => {
        eff.life -= 0.015;
        eff.x += (eff.vx || 0);
        eff.y += (eff.vy || 0);
        if (eff.type === 'combo') {
            eff.scale = 1 + Math.sin(eff.life * 10) * 0.2;
        }
        return eff.life > 0;
      });

      // 4. Update screen shake
      if (screenShakeRef.current > 0) {
        screenShakeRef.current -= 0.5;
      }

      // 5. Check for victory
      if (ballsRef.current.length === 0) {
        setGameState('victory');
      }
    }

    draw();
    requestRef.current = requestAnimationFrame(update);
  };

  const handleHit = (hitBall: Ball, shotValue: number, ballIndex: number) => {
    const shotMatches = getConditionMatch(shotValue, targetNumber, gameMode);
    const hitMatches = getConditionMatch(hitBall.value, targetNumber, gameMode);

    const pathIdx = Math.floor(hitBall.pos * (PATH_SAMPLES - 1));
    const hitPoint = pathRef.current[pathIdx];

    if (shotMatches && hitMatches) {
      let toRemoveIndices = [ballIndex];
      for (let j = ballIndex + 1; j < ballsRef.current.length; j++) {
        if (getConditionMatch(ballsRef.current[j].value, targetNumber, gameMode)) {
          toRemoveIndices.push(j);
        } else break;
      }
      for (let j = ballIndex - 1; j >= 0; j--) {
        if (getConditionMatch(ballsRef.current[j].value, targetNumber, gameMode)) {
          toRemoveIndices.push(j);
        } else break;
      }

      const points = toRemoveIndices.length * 100;
      setScore(prev => prev + points);
      
      // Update energy: Add for hit
      setEnergy(prev => Math.min(100, prev + ENERGY_GAIN));

      toRemoveIndices.forEach(idx => {
        const b = ballsRef.current[idx];
        const pIdx = Math.floor(b.pos * (PATH_SAMPLES - 1));
        const p = pathRef.current[pIdx];
        spawnParticles(p.x, p.y, b.color, 12);
      });

      if (toRemoveIndices.length >= 3) {
        spawnText(hitPoint.x, hitPoint.y - 40, `¡COMBO x${toRemoveIndices.length}!`, '#fcd34d', 40, 'combo');
        screenShakeRef.current = 8;
      } else {
        spawnText(hitPoint.x, hitPoint.y - 20, `+${points}`, '#fff', 24);
        screenShakeRef.current = 3;
      }

      ballsRef.current = ballsRef.current.filter((_, idx) => !toRemoveIndices.includes(idx));
    } else {
      // Mismatch: Add ball to chain and penalize energy
      const newBall: Ball = {
        id: ballCounterRef.current++,
        value: shotValue,
        pos: hitBall.pos - 0.03,
        color: COLORS[getRandomInt(0, COLORS.length - 1)],
      };
      
      const newBalls = [...ballsRef.current];
      newBalls.splice(ballIndex, 0, newBall);
      ballsRef.current = newBalls;
      
      // Update energy: Penalty for miss (double of gain)
      setEnergy(prev => Math.max(0, prev - ENERGY_LOSS));
      
      spawnParticles(hitPoint.x, hitPoint.y, '#ffffff', 4);
      spawnText(hitPoint.x, hitPoint.y - 30, `-ERROR`, '#f43f5e', 20);
      screenShakeRef.current = 5;
      
      for (let i = 1; i < ballsRef.current.length; i++) {
        if (ballsRef.current[i].pos > ballsRef.current[i-1].pos - 0.035) {
          ballsRef.current[i].pos = ballsRef.current[i-1].pos - 0.035;
        }
      }
    }
  };

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.save();
    if (screenShakeRef.current > 0) {
      const shakeX = (Math.random() - 0.5) * screenShakeRef.current;
      const shakeY = (Math.random() - 0.5) * screenShakeRef.current;
      ctx.translate(shakeX, shakeY);
    }

    ctx.clearRect(-10, -10, canvas.width + 20, canvas.height + 20);

    // Background Path
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 40;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    pathRef.current.forEach((p, i) => {
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.stroke();

    const endPoint = pathRef.current[PATH_SAMPLES];
    ctx.beginPath();
    ctx.fillStyle = '#000';
    ctx.shadowBlur = 15;
    ctx.shadowColor = '#f00';
    ctx.arc(endPoint.x, endPoint.y, 25 + Math.sin(Date.now() / 200) * 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    // Balls
    ballsRef.current.forEach((ball) => {
      if (ball.pos < 0 || ball.pos > 1) return;
      const pIdx = Math.floor(ball.pos * (PATH_SAMPLES - 1));
      const p = pathRef.current[pIdx];

      const isMatch = getConditionMatch(ball.value, targetNumber, gameMode);
      if (isMatch) {
        ctx.shadowBlur = 20;
        ctx.shadowColor = ball.color;
      }

      ctx.beginPath();
      ctx.fillStyle = ball.color;
      ctx.arc(p.x, p.y, BALL_RADIUS, 0, Math.PI * 2);
      ctx.fill();
      
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 15px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(ball.value.toString(), p.x, p.y);
    });

    // Projectiles
    projectilesRef.current.forEach((proj) => {
      ctx.beginPath();
      ctx.fillStyle = proj.color;
      ctx.shadowBlur = 15;
      ctx.shadowColor = '#fff';
      ctx.arc(proj.x, proj.y, 11, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;

      ctx.fillStyle = '#000';
      ctx.font = 'bold 12px Inter, sans-serif';
      ctx.fillText(proj.value.toString(), proj.x, proj.y);
    });

    // Effects
    effectsRef.current.forEach(eff => {
      ctx.globalAlpha = eff.life;
      if (eff.type === 'particle') {
        ctx.beginPath();
        ctx.fillStyle = eff.color;
        ctx.arc(eff.x, eff.y, eff.size || 3, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.save();
        ctx.translate(eff.x, eff.y);
        if (eff.type === 'combo') {
            const scale = eff.scale || 1;
            ctx.scale(scale, scale);
            ctx.shadowBlur = 15;
            ctx.shadowColor = eff.color;
        } else {
            ctx.shadowBlur = 5;
            ctx.shadowColor = 'rgba(0,0,0,0.5)';
        }
        ctx.fillStyle = eff.color;
        ctx.font = `bold ${eff.size}px Inter, sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(eff.text || '', 0, 0);
        ctx.restore();
      }
    });
    ctx.globalAlpha = 1;

    // Shooter
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.rotate(shooterAngleRef.current);
    ctx.fillStyle = '#334155';
    ctx.beginPath();
    ctx.roundRect(-22, -18, 65, 36, 10);
    ctx.fill();
    ctx.fillStyle = '#0ea5e9';
    ctx.fillRect(38, -6, 6, 12);
    ctx.restore();

    ctx.beginPath();
    ctx.fillStyle = '#0f172a';
    ctx.strokeStyle = energy === 100 ? '#f59e0b' : '#0ea5e9';
    ctx.lineWidth = 4;
    ctx.arc(centerX, centerY, 38, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#fff';
    ctx.font = 'bold 26px Inter, sans-serif';
    ctx.fillText(currentBallValueRef.current.toString(), centerX, centerY);
    
    ctx.font = 'bold 13px Inter, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillText('SIGUIENTE: ' + nextBallValueRef.current.toString(), centerX, centerY + 58);

    if (isPaused) {
        ctx.fillStyle = 'rgba(0,0,0,0.4)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#fff';
        ctx.font = 'black 60px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText("PAUSA", centerX, centerY - 20);
        ctx.font = 'bold 20px Inter, sans-serif';
        ctx.fillText("Pulsa el botón de pausa para continuar", centerX, centerY + 40);
    }

    ctx.restore();
  }, [gameState, targetNumber, gameMode, isPaused, energy]);

  useEffect(() => {
    pathRef.current = generatePath(800, 600);
    if (gameState === 'playing') {
      requestRef.current = requestAnimationFrame(update);
    }
    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [gameState]);

  const saveScore = () => {
    if (scoreSaved) return;
    const name = playerName.trim() || 'Jugador Anónimo';
    const newRecord: ScoreRecord = {
      name,
      score,
      mode: gameMode === 'multiples' ? 'Múltiplos' : 'Divisores',
      target: targetNumber,
      date: new Date().toLocaleDateString()
    };
    
    const updatedLeaderboard = [...leaderboard, newRecord]
      .sort((a, b) => b.score - a.score)
      .slice(0, 30);
    
    setLeaderboard(updatedLeaderboard);
    localStorage.setItem('zuma_math_leaderboard', JSON.stringify(updatedLeaderboard));
    setScoreSaved(true);
  };

  const startGame = (mode: GameMode) => {
    setGameMode(mode);
    const chosen = parseInt(customTarget);
    const target = isNaN(chosen) ? undefined : chosen;
    setGameState('flowchart'); 
    initLevel(1, mode, target);
  };

  const restartGame = () => {
    setGameState('playing');
    initLevel(1, gameMode, targetNumber);
  };

  const nextLevel = () => {
    setGameState('playing');
    initLevel(level + 1, gameMode, targetNumber);
  };

  useEffect(() => {
    const stored = localStorage.getItem('zuma_math_highscore');
    if (stored) setHighScore(parseInt(stored));
    
    const storedLeaderboard = localStorage.getItem('zuma_math_leaderboard');
    if (storedLeaderboard) setLeaderboard(JSON.parse(storedLeaderboard));
  }, []);

  useEffect(() => {
    if (score > highScore) {
      setHighScore(score);
      localStorage.setItem('zuma_math_highscore', score.toString());
    }
  }, [score, highScore]);

  const tutorialSteps = [
    {
      title: "Bienvenido a Math Zuma",
      desc: "Este es un juego de agilidad mental y puntería. Tu objetivo es limpiar la línea de números antes de que lleguen al centro.",
      icon: <Zap className="w-12 h-12 text-indigo-400" />
    },
    {
      title: "Controles",
      desc: "Mueve el ratón para apuntar tu torreta central. Haz clic para disparar la esfera numérica actual.",
      icon: <Play className="w-12 h-12 text-indigo-400" />
    },
    {
      title: "La Regla de Oro",
      desc: "Solo puedes eliminar esferas si el número que disparas Y el número al que golpeas cumplen la condición del nivel (Múltiplos o Divisores).",
      icon: <Target className="w-12 h-12 text-emerald-400" />
    },
    {
      title: "Barra de Energía",
      desc: "Acierta disparos para llenar la barra de energía. ¡Cuidado! Fallar un disparo restará el doble de lo que ganarías por acertar.",
      icon: <Sparkles className="w-12 h-12 text-amber-400" />
    },
    {
      title: "Peligro: El Vacío",
      desc: "Si una sola esfera llega al agujero negro central, la partida terminará. ¡Mantén la línea bajo control!",
      icon: <AlertTriangle className="w-12 h-12 text-rose-500" />
    }
  ];

  return (
    <div className="min-h-screen bg-slate-950 text-white font-sans flex flex-col items-center justify-center overflow-hidden selection:bg-indigo-500/30">
      {/* HUD */}
      {gameState === 'playing' && (
        <div className="absolute top-0 left-0 w-full p-6 flex justify-between items-start pointer-events-none z-10">
          <div className="flex flex-col gap-4 items-start pointer-events-auto">
            <div className="bg-slate-900/90 backdrop-blur-xl p-5 rounded-3xl border border-white/10 shadow-2xl ring-1 ring-white/5">
                <div className="flex items-center gap-3 mb-1">
                <div className="p-2 bg-indigo-500/20 rounded-xl">
                    <Target className="w-5 h-5 text-indigo-400" />
                </div>
                <span className="text-slate-400 text-xs font-bold uppercase tracking-[0.2em]">Misión de Nivel</span>
                </div>
                <h2 className="text-2xl font-black tracking-tight">
                {gameMode === 'multiples' ? 'Múltiplos' : 'Divisores'} de{' '}
                <span className="text-indigo-400 px-2 py-0.5 bg-indigo-400/10 rounded-lg">{targetNumber}</span>
                </h2>
            </div>
            
            {/* Energy Bar UI */}
            <div className="w-64 bg-slate-900/90 backdrop-blur-xl p-4 rounded-3xl border border-white/10 shadow-2xl flex flex-col gap-2">
                <div className="flex justify-between items-center px-1">
                    <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Energía Matemática</span>
                    <Sparkles className={`w-3 h-3 ${energy === 100 ? 'text-amber-400 animate-pulse' : 'text-slate-600'}`} />
                </div>
                <div className="h-3 w-full bg-slate-950 rounded-full overflow-hidden border border-white/5 relative">
                    <div 
                        className={`h-full transition-all duration-300 relative ${energy === 100 ? 'bg-amber-400 shadow-[0_0_15px_rgba(245,158,11,0.5)]' : 'bg-gradient-to-r from-indigo-600 to-indigo-400'}`}
                        style={{ width: `${energy}%` }}
                    >
                        {energy > 0 && <div className="absolute top-0 right-0 h-full w-4 bg-white/20 blur-sm" />}
                    </div>
                </div>
            </div>

            <button 
                onClick={() => setIsPaused(!isPaused)}
                className="bg-slate-900/90 backdrop-blur-xl p-5 rounded-3xl border border-white/10 shadow-2xl ring-1 ring-white/5 hover:bg-slate-800 transition-colors"
            >
                {isPaused ? <PlayCircle className="w-8 h-8 text-emerald-400" /> : <Pause className="w-8 h-8 text-white" />}
            </button>
          </div>

          <div className="flex flex-col items-end gap-3">
            <div className="bg-slate-900/90 backdrop-blur-xl p-5 rounded-3xl border border-white/10 shadow-2xl ring-1 ring-white/5 min-w-[160px]">
              <div className="text-slate-400 text-[10px] font-bold uppercase tracking-[0.2em] mb-1 text-right">Puntuación</div>
              <div className="text-4xl font-black text-right tabular-nums text-transparent bg-clip-text bg-gradient-to-br from-white to-slate-500">
                {score.toLocaleString()}
              </div>
            </div>
            <div className="bg-indigo-600 px-5 py-2 rounded-2xl border border-white/10 shadow-xl text-sm font-black tracking-widest uppercase">
              NIVEL {level}
            </div>
          </div>
        </div>
      )}

      {/* Main Canvas Area */}
      <div className="relative">
        <canvas
          ref={canvasRef}
          width={800}
          height={600}
          onMouseMove={handleMouseMove}
          onClick={handleShoot}
          className={`rounded-[2.5rem] shadow-[0_0_100px_rgba(0,0,0,0.5)] bg-slate-900/50 border border-white/5 transition-all duration-700 ${gameState !== 'playing' ? 'opacity-30 blur-sm scale-95 pointer-events-none' : 'opacity-100 scale-100'}`}
        />

        {/* Menu Overlay */}
        {gameState === 'menu' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/40 backdrop-blur-sm rounded-[2.5rem] p-8 text-center animate-in fade-in zoom-in duration-500">
            <div className="mb-6 p-6 bg-indigo-600 rounded-[2rem] shadow-[0_0_60px_rgba(79,70,229,0.4)] animate-bounce-slow">
              <Zap className="w-16 h-16 text-white fill-current" />
            </div>
            <h1 className="text-6xl font-black mb-2 tracking-tighter bg-clip-text text-transparent bg-gradient-to-b from-white via-white to-slate-500">
              MATH ZUMA
            </h1>
            
            <div className="w-full max-w-sm mb-8">
              <label className="text-slate-400 text-[10px] font-black uppercase tracking-[0.3em] block mb-2">Número Objetivo (Opcional)</label>
              <div className="relative group">
                <Target className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-indigo-500 group-hover:scale-110 transition-transform" />
                <input 
                  type="number"
                  placeholder="Aleatorio si vacío"
                  value={customTarget}
                  onChange={(e) => setCustomTarget(e.target.value)}
                  className="w-full bg-slate-900/80 border border-white/10 rounded-2xl py-4 pl-12 pr-4 text-center font-bold text-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all placeholder:text-slate-700"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-6 w-full max-w-xl mb-8">
              <button
                onClick={() => startGame('multiples')}
                className="group relative flex flex-col items-center p-8 bg-slate-900/80 backdrop-blur-md border border-white/5 rounded-[2rem] hover:border-indigo-500 transition-all hover:-translate-y-2 hover:shadow-[0_25px_50px_-15px_rgba(79,70,229,0.4)]"
              >
                <div className="mb-4 p-4 bg-indigo-500/10 rounded-2xl group-hover:bg-indigo-500/20 transition-colors">
                  <Play className="w-8 h-8 text-indigo-400 fill-current" />
                </div>
                <span className="font-black text-xl mb-1 tracking-tight">Múltiplos</span>
                <span className="text-slate-500 text-[10px] font-bold uppercase tracking-widest">N × X</span>
              </button>

              <button
                onClick={() => startGame('divisors')}
                className="group relative flex flex-col items-center p-8 bg-slate-900/80 backdrop-blur-md border border-white/5 rounded-[2rem] hover:border-cyan-500 transition-all hover:-translate-y-2 hover:shadow-[0_25px_50px_-15px_rgba(6,182,212,0.4)]"
              >
                <div className="mb-4 p-4 bg-cyan-500/10 rounded-2xl group-hover:bg-cyan-500/20 transition-colors">
                  <Target className="w-8 h-8 text-cyan-400" />
                </div>
                <span className="font-black text-xl mb-1 tracking-tight">Divisores</span>
                <span className="text-slate-500 text-[10px] font-bold uppercase tracking-widest">N / X</span>
              </button>
            </div>

            <div className="flex gap-4">
               <button
                  onClick={() => { setGameState('tutorial'); setTutorialStep(0); }}
                  className="flex items-center gap-3 px-6 py-3 bg-slate-800/80 hover:bg-slate-700 rounded-xl font-bold text-white text-sm transition-all border border-white/5 hover:border-indigo-500/50"
                >
                  <BookOpen className="w-5 h-5" />
                  ¿CÓMO JUGAR?
                </button>
               <button
                  onClick={() => setGameState('leaderboard')}
                  className="flex items-center gap-3 px-6 py-3 bg-slate-800/80 hover:bg-slate-700 rounded-xl font-bold text-white text-sm transition-all border border-white/5 hover:border-amber-500/50"
                >
                  <ListOrdered className="w-5 h-5 text-amber-500" />
                  RANKING
                </button>
            </div>
          </div>
        )}

        {/* Flowchart Instructions */}
        {gameState === 'flowchart' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/90 backdrop-blur-2xl rounded-[2.5rem] p-10 text-center animate-in fade-in zoom-in duration-500 z-50">
                <h2 className="text-4xl font-black mb-8 tracking-tighter text-indigo-400">GUÍA DE COMBATE MATEMÁTICO</h2>
                
                <div className="flex flex-col items-center gap-4 w-full max-w-2xl">
                    {/* Level Select */}
                    <div className="flex items-center gap-4 p-4 bg-slate-900 border border-white/10 rounded-2xl w-full">
                        <div className="p-3 bg-indigo-500/20 rounded-xl"><Target className="w-6 h-6 text-indigo-400"/></div>
                        <div className="text-left">
                            <div className="text-xs font-black text-slate-500 uppercase">INICIO</div>
                            <div className="text-sm font-bold">Seleccionas un número objetivo ({targetNumber})</div>
                        </div>
                    </div>
                    <ArrowRight className="w-5 h-5 text-slate-700 rotate-90"/>
                    
                    {/* Shoot */}
                    <div className="flex items-center gap-4 p-4 bg-slate-900 border border-white/10 rounded-2xl w-full">
                        <div className="p-3 bg-cyan-500/20 rounded-xl"><Zap className="w-6 h-6 text-cyan-400"/></div>
                        <div className="text-left">
                            <div className="text-xs font-black text-slate-500 uppercase">DISPARO</div>
                            <div className="text-sm font-bold">Apuntas y disparas esferas numéricas</div>
                        </div>
                    </div>
                    <ArrowRight className="w-5 h-5 text-slate-700 rotate-90"/>

                    {/* Logic Branch */}
                    <div className="relative p-6 bg-slate-800 border-2 border-indigo-500/50 rounded-3xl w-full shadow-[0_0_30px_rgba(79,70,229,0.2)]">
                        <div className="text-xs font-black text-indigo-400 uppercase mb-2">VALIDACIÓN LÓGICA</div>
                        <div className="text-lg font-black tracking-tight">¿Es la esfera un {gameMode === 'multiples' ? 'Múltiplo' : 'Divisor'}?</div>
                        
                        <div className="flex gap-4 mt-6">
                            <div className="flex-1 p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl">
                                <CheckCircle2 className="w-6 h-6 text-emerald-400 mx-auto mb-2"/>
                                <div className="text-xs font-black text-emerald-400">SÍ</div>
                                <div className="text-[10px] text-slate-400">¡+ ENERGÍA Y PUNTOS!</div>
                            </div>
                            <div className="flex-1 p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl">
                                <AlertCircle className="w-6 h-6 text-rose-400 mx-auto mb-2"/>
                                <div className="text-xs font-black text-rose-400">NO</div>
                                <div className="text-[10px] text-slate-400">¡- DOBLE ENERGÍA!</div>
                            </div>
                        </div>
                    </div>

                    <ArrowRight className="w-5 h-5 text-slate-700 rotate-90"/>

                    {/* Final Result */}
                    <div className="flex items-center gap-4 p-4 bg-slate-900 border border-white/10 rounded-2xl w-full">
                        <div className="p-3 bg-amber-500/20 rounded-xl"><Trophy className="w-6 h-6 text-amber-400"/></div>
                        <div className="text-left">
                            <div className="text-xs font-black text-slate-500 uppercase">OBJETIVO</div>
                            <div className="text-sm font-bold">Limpiar la línea antes de que toque el centro</div>
                        </div>
                    </div>
                </div>

                <button
                    onClick={() => setGameState('playing')}
                    className="mt-10 px-12 py-5 bg-indigo-600 hover:bg-indigo-500 rounded-2xl font-black text-xl text-white transition-all shadow-2xl active:scale-95 flex items-center gap-4"
                >
                    INICIAR COMBATE
                    <Play className="w-6 h-6 fill-current"/>
                </button>
            </div>
        )}

        {gameState === 'leaderboard' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/90 backdrop-blur-2xl rounded-[2.5rem] p-12 text-center animate-in fade-in zoom-in duration-500 z-50">
            <button 
              onClick={() => setGameState('menu')}
              className="absolute top-8 right-8 p-3 bg-white/5 hover:bg-white/10 rounded-full transition-colors"
            >
              <X className="w-6 h-6" />
            </button>
            
            <div className="w-full max-w-2xl">
              <div className="flex items-center justify-center gap-4 mb-8">
                <Trophy className="w-10 h-10 text-amber-500" />
                <h2 className="text-4xl font-black uppercase tracking-tighter">Ranking Global</h2>
              </div>

              <div className="bg-slate-900/50 border border-white/5 rounded-[2rem] overflow-hidden">
                <div className="max-h-[350px] overflow-y-auto scrollbar-hide">
                  <table className="w-full text-left border-collapse">
                    <thead className="bg-white/5 sticky top-0">
                      <tr>
                        <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-slate-500">Rango</th>
                        <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-slate-500">Jugador</th>
                        <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-slate-500 text-right">Puntos</th>
                        <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-slate-500">Modo</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {leaderboard.length > 0 ? leaderboard.map((record, i) => (
                        <tr key={i} className="hover:bg-white/5 transition-colors group">
                          <td className="px-6 py-4 font-black text-slate-500">#{i + 1}</td>
                          <td className="px-6 py-4 font-bold text-white group-hover:text-indigo-400 transition-colors">{record.name}</td>
                          <td className="px-6 py-4 font-black text-right text-emerald-400">{record.score.toLocaleString()}</td>
                          <td className="px-6 py-4 text-xs font-bold text-slate-400">{record.mode} ({record.target})</td>
                        </tr>
                      )) : (
                        <tr>
                          <td colSpan={4} className="px-6 py-12 text-center text-slate-600 font-bold uppercase tracking-widest">Aún no hay registros</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <button
                onClick={() => setGameState('menu')}
                className="mt-8 px-8 py-4 bg-indigo-600 hover:bg-indigo-500 rounded-2xl font-black text-white transition-all shadow-lg active:scale-95"
              >
                VOLVER AL MENÚ
              </button>
            </div>
          </div>
        )}

        {gameState === 'tutorial' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/90 backdrop-blur-2xl rounded-[2.5rem] p-12 text-center animate-in fade-in zoom-in duration-500 z-50">
            <button 
              onClick={() => setGameState('menu')}
              className="absolute top-8 right-8 p-3 bg-white/5 hover:bg-white/10 rounded-full transition-colors"
            >
              <X className="w-6 h-6" />
            </button>
            
            <div className="max-w-xl w-full flex flex-col items-center">
              <div className="mb-10 p-8 bg-indigo-500/20 rounded-[2.5rem] border border-indigo-500/30 shadow-2xl animate-pulse">
                {tutorialSteps[tutorialStep].icon}
              </div>
              
              <div className="mb-12 min-h-[160px]">
                <h2 className="text-4xl font-black mb-6 tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-white to-slate-400 uppercase">
                  {tutorialSteps[tutorialStep].title}
                </h2>
                <p className="text-slate-300 text-xl font-medium leading-relaxed">
                  {tutorialSteps[tutorialStep].desc}
                </p>
              </div>

              <div className="flex items-center gap-6 w-full justify-between">
                <button
                  disabled={tutorialStep === 0}
                  onClick={() => setTutorialStep(prev => prev - 1)}
                  className={`flex items-center gap-2 px-6 py-4 rounded-2xl font-bold transition-all ${tutorialStep === 0 ? 'opacity-20 grayscale' : 'bg-slate-800 hover:bg-slate-700 active:scale-95'}`}
                >
                  <ChevronLeft className="w-5 h-5" />
                  ATRÁS
                </button>

                <div className="flex gap-2">
                  {tutorialSteps.map((_, i) => (
                    <div key={i} className={`h-2 rounded-full transition-all ${i === tutorialStep ? 'w-8 bg-indigo-500' : 'w-2 bg-slate-800'}`} />
                  ))}
                </div>

                {tutorialStep < tutorialSteps.length - 1 ? (
                  <button
                    onClick={() => setTutorialStep(prev => prev + 1)}
                    className="flex items-center gap-2 px-8 py-4 bg-indigo-600 hover:bg-indigo-500 rounded-2xl font-black text-white transition-all shadow-lg active:scale-95"
                  >
                    SIGUIENTE
                    <ChevronRight className="w-5 h-5" />
                  </button>
                ) : (
                  <button
                    onClick={() => setGameState('menu')}
                    className="flex items-center gap-2 px-8 py-4 bg-emerald-600 hover:bg-emerald-500 rounded-2xl font-black text-white transition-all shadow-lg active:scale-95"
                  >
                    ¡ENTENDIDO!
                    <Zap className="w-5 h-5 fill-current" />
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {(gameState === 'gameover' || gameState === 'victory') && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/80 backdrop-blur-xl rounded-[2.5rem] p-8 text-center animate-in fade-in zoom-in duration-500">
            <div className={`mb-6 p-6 rounded-full border ${gameState === 'gameover' ? 'bg-rose-500/20 border-rose-500/30' : 'bg-emerald-500/20 border-emerald-500/30'}`}>
              {gameState === 'gameover' ? <AlertTriangle className="w-16 h-16 text-rose-500" /> : <Trophy className="w-16 h-16 text-emerald-400" />}
            </div>
            <h2 className={`text-6xl font-black mb-2 tracking-tighter ${gameState === 'gameover' ? 'text-rose-500' : 'text-emerald-400'}`}>
              {gameState === 'gameover' ? 'COLAPSO TOTAL' : '¡LOGRADO!'}
            </h2>
            <p className="text-slate-400 mb-8 text-xl font-medium">
              {gameState === 'gameover' ? '¡El agujero negro ha consumido los cálculos!' : 'Anomalías matemáticas neutralizadas con éxito.'}
            </p>
            
            <div className="bg-slate-900/80 p-6 rounded-[2rem] border border-white/10 mb-8 w-80 shadow-2xl relative group">
              <div className="text-slate-500 text-[10px] font-black uppercase tracking-widest mb-1">Puntuación</div>
              <div className="text-5xl font-black text-indigo-400 tabular-nums mb-6">{score.toLocaleString()}</div>
              
              {!scoreSaved ? (
                <div className="space-y-3">
                  <div className="relative">
                    <User className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                    <input 
                      type="text"
                      placeholder="Nombre del Piloto"
                      value={playerName}
                      onChange={(e) => setPlayerName(e.target.value)}
                      maxLength={15}
                      className="w-full bg-slate-950 border border-white/5 rounded-xl py-3 pl-11 pr-4 text-sm font-bold focus:outline-none focus:ring-1 focus:ring-indigo-500/50 transition-all"
                    />
                  </div>
                  <button 
                    onClick={saveScore}
                    className="w-full flex items-center justify-center gap-2 py-3 bg-indigo-600 hover:bg-indigo-500 rounded-xl font-black text-xs transition-all active:scale-95"
                  >
                    <Save className="w-4 h-4" />
                    GUARDAR EN RANKING
                  </button>
                </div>
              ) : (
                <div className="flex items-center justify-center gap-2 text-emerald-400 font-black text-xs uppercase tracking-widest py-3">
                  <Zap className="w-4 h-4 fill-current" />
                  Puntaje Guardado
                </div>
              )}
            </div>

            <div className="flex gap-4">
              {gameState === 'victory' ? (
                <button
                  onClick={nextLevel}
                  className="flex items-center gap-3 px-10 py-5 bg-emerald-600 hover:bg-emerald-500 rounded-2xl font-black text-white transition-all hover:scale-105 shadow-[0_20px_40px_-10px_rgba(16,185,129,0.4)]"
                >
                  <Play className="w-6 h-6 fill-current" />
                  SIGUIENTE
                </button>
              ) : (
                <button
                  onClick={restartGame}
                  className="flex items-center gap-3 px-10 py-5 bg-indigo-600 hover:bg-indigo-500 rounded-2xl font-black text-white transition-all hover:scale-105 shadow-[0_20px_40px_-10px_rgba(79,70,229,0.4)]"
                >
                  <RotateCcw className="w-6 h-6" />
                  REINTENTAR
                </button>
              )}
              <button
                onClick={() => setGameState('menu')}
                className="flex items-center gap-3 px-10 py-5 bg-slate-800 hover:bg-slate-700 rounded-2xl font-black text-white transition-all"
              >
                <Home className="w-6 h-6" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Footer Info */}
      <div className="mt-12 flex flex-wrap justify-center items-center gap-12 text-slate-500 text-xs font-black uppercase tracking-[0.3em] px-4 text-center opacity-60">
        <div className="flex items-center gap-3">
          <HelpCircle className="w-5 h-5 text-indigo-500" />
          <span>Raton para apuntar / Clic para disparar</span>
        </div>
        <div className="flex items-center gap-3">
          <Sparkles className="w-5 h-5 text-amber-500" />
          <span>Llena la barra de energía acertando</span>
        </div>
      </div>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;700;900&display=swap');
        body { 
          margin: 0; 
          background: #020617; 
          font-family: 'Inter', sans-serif; 
          cursor: crosshair; 
          user-select: none;
        }
        canvas { touch-action: none; cursor: crosshair; }
        .scrollbar-hide::-webkit-scrollbar { display: none; }
        .scrollbar-hide { -ms-overflow-style: none; scrollbar-width: none; }
        .animate-bounce-slow { animation: bounce 3s infinite; }
        @keyframes bounce {
          0%, 100% { transform: translateY(-5%); animation-timing-function: cubic-bezier(0.8, 0, 1, 1); }
          50% { transform: translateY(0); animation-timing-function: cubic-bezier(0, 0, 0.2, 1); }
        }
      `}</style>
    </div>
  );
};

// Render
const rootElement = document.getElementById('root');
if (rootElement) {
  createRoot(rootElement).render(<ZumaMathGame />);
}
