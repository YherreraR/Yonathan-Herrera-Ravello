
import React, { useState, useEffect, useRef, useCallback, useLayoutEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { Target, Zap, Play, RotateCcw, Home, HelpCircle, Trophy, AlertTriangle, BookOpen, ChevronRight, ChevronLeft, X, ListOrdered, Save, User, Pause, PlayCircle, ArrowRight, CheckCircle2, AlertCircle, Sparkles, MousePointer2 } from 'lucide-react';

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
  type: 'particle' | 'text' | 'combo' | 'ui';
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
const ENERGY_GAIN = 15; // Increased from 10 to 15 to help filling the bar
const ENERGY_LOSS = 20;

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
  const maxRadius = Math.min(width, height) * 0.42;
  const loops = 3;

  for (let i = 0; i <= PATH_SAMPLES; i++) {
    const t = i / PATH_SAMPLES;
    const angle = t * Math.PI * 2 * loops;
    const radius = maxRadius * (1 - t * 0.82);
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
  const [dimensions, setDimensions] = useState({ width: window.innerWidth, height: window.innerHeight });

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
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
  const swapCooldownRef = useRef<number>(0);

  // Resize handler
  useLayoutEffect(() => {
    const updateSize = () => {
      if (containerRef.current) {
        const { clientWidth, clientHeight } = containerRef.current;
        setDimensions({ width: clientWidth, height: clientHeight });
        pathRef.current = generatePath(clientWidth, clientHeight);
      }
    };
    window.addEventListener('resize', updateSize);
    updateSize();
    return () => window.removeEventListener('resize', updateSize);
  }, []);

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

  const spawnText = (x: number, y: number, text: string, color: string, size = 20, type: 'text' | 'combo' | 'ui' = 'text') => {
    effectsRef.current.push({
      type,
      x,
      y,
      vy: type === 'ui' ? 0 : -1.2,
      life: 1,
      maxLife: 1,
      text,
      color,
      size,
      scale: 1,
    });
  };

  const generateFairBallValue = (target: number, mode: GameMode, lvl: number, forceType?: 'match' | 'no-match'): number => {
    // Significantly increased match probability (Start at 90%, floor at 65%)
    const matchProb = Math.max(0.65, 0.90 - (lvl - 1) * 0.05);
    const shouldMatch = forceType === 'match' ? true : (forceType === 'no-match' ? false : Math.random() < matchProb);
    
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

  const handleSwap = useCallback(() => {
    if (gameState !== 'playing' || isPaused || Date.now() < swapCooldownRef.current) return;
    
    const temp = currentBallValueRef.current;
    currentBallValueRef.current = nextBallValueRef.current;
    nextBallValueRef.current = temp;
    
    swapCooldownRef.current = Date.now() + 200;
    
    spawnText(dimensions.width / 2, dimensions.height / 2 - 60, "¡CAMBIO!", "#0ea5e9", 14, "ui");
  }, [gameState, isPaused, dimensions]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault();
        handleSwap();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleSwap]);

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
    const ballCount = 10 + lvl * 3;
    for (let i = 0; i < ballCount; i++) {
      let force: 'match' | 'no-match' | undefined = undefined;
      // Guarantee at least 2 target balls for every 1 non-target ball
      if (i % 3 !== 1) force = 'match'; 
      else force = 'no-match';

      const value = generateFairBallValue(target, mode, lvl, force);
      initialBalls.push({
        id: ballCounterRef.current++,
        value,
        pos: -i * 0.035,
        color: COLORS[getRandomInt(0, COLORS.length - 1)],
      });
    }
    ballsRef.current = initialBalls;
    
    currentBallValueRef.current = generateFairBallValue(target, mode, lvl, 'match');
    nextBallValueRef.current = generateFairBallValue(target, mode, lvl, 'match');
  };

  const handleMouseMove = (e: React.MouseEvent | React.TouchEvent) => {
    if (isPaused) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    
    let x, y;
    if ('touches' in e) {
        x = e.touches[0].clientX - rect.left;
        y = e.touches[0].clientY - rect.top;
    } else {
        x = e.clientX - rect.left;
        y = e.clientY - rect.top;
    }
    
    mousePosRef.current = { x, y };

    const centerX = dimensions.width / 2;
    const centerY = dimensions.height / 2;
    shooterAngleRef.current = Math.atan2(y - centerY, x - centerX);
  };

  const handleShoot = (e: React.MouseEvent | React.TouchEvent) => {
    if (gameState !== 'playing' || isPaused) return;
    
    if ('button' in e && e.button === 2) {
        e.preventDefault();
        handleSwap();
        return;
    }

    const centerX = dimensions.width / 2;
    const centerY = dimensions.height / 2;
    const angle = shooterAngleRef.current;

    projectilesRef.current.push({
      x: centerX + Math.cos(angle) * 40,
      y: centerY + Math.sin(angle) * 40,
      vx: Math.cos(angle) * PROJECTILE_SPEED,
      vy: Math.sin(angle) * PROJECTILE_SPEED,
      value: currentBallValueRef.current,
      color: '#ffffff',
    });

    // Strategy: check if we have enough target balls on the board.
    // If fewer than 4 balls match the criteria, force the next shooter ball to be a match.
    const matchingBallsOnBoard = ballsRef.current.filter(b => getConditionMatch(b.value, targetNumber, gameMode)).length;
    const needsMoreMatches = matchingBallsOnBoard < 4;
    const forceType = needsMoreMatches ? 'match' : (Math.random() < 0.7 ? 'match' : undefined);

    currentBallValueRef.current = nextBallValueRef.current;
    nextBallValueRef.current = generateFairBallValue(targetNumber, gameMode, level, forceType as any);
  };

  const update = (time: number) => {
    if (gameState !== 'playing') return;
    
    if (!isPaused) {
      lastTimeRef.current = time;

      let gameOver = false;
      ballsRef.current.forEach((ball) => {
        ball.pos += gameSpeedRef.current;
        if (ball.pos >= 1) gameOver = true;
      });

      if (gameOver) {
        setGameState('gameover');
        return;
      }

      const path = pathRef.current;
      projectilesRef.current = projectilesRef.current.filter((proj) => {
        proj.x += proj.vx;
        proj.y += proj.vy;

        if (proj.x < 0 || proj.x > dimensions.width || proj.y < 0 || proj.y > dimensions.height) return false;

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

      effectsRef.current = effectsRef.current.filter(eff => {
        eff.life -= 0.015;
        eff.x += (eff.vx || 0);
        eff.y += (eff.vy || 0);
        if (eff.type === 'combo') {
            eff.scale = 1 + Math.sin(eff.life * 10) * 0.2;
        }
        return eff.life > 0;
      });

      if (screenShakeRef.current > 0) {
        screenShakeRef.current -= 0.5;
      }

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
      setEnergy(prev => Math.min(100, prev + ENERGY_GAIN));

      toRemoveIndices.forEach(idx => {
        const b = ballsRef.current[idx];
        const pIdx = Math.floor(b.pos * (PATH_SAMPLES - 1));
        const p = pathRef.current[pIdx];
        spawnParticles(p.x, p.y, b.color, 12);
      });

      if (toRemoveIndices.length >= 3) {
        spawnText(hitPoint.x, hitPoint.y - 40, `¡COMBO x${toRemoveIndices.length}!`, '#fcd34d', 36, 'combo');
        screenShakeRef.current = 8;
      } else {
        spawnText(hitPoint.x, hitPoint.y - 20, `+${points}`, '#fff', 24);
        screenShakeRef.current = 3;
      }

      ballsRef.current = ballsRef.current.filter((_, idx) => !toRemoveIndices.includes(idx));
    } else {
      const newBall: Ball = {
        id: ballCounterRef.current++,
        value: shotValue,
        pos: hitBall.pos - 0.03,
        color: COLORS[getRandomInt(0, COLORS.length - 1)],
      };
      
      const newBalls = [...ballsRef.current];
      newBalls.splice(ballIndex, 0, newBall);
      ballsRef.current = newBalls;
      
      setEnergy(prev => Math.max(0, prev - ENERGY_LOSS));
      
      spawnParticles(hitPoint.x, hitPoint.y, '#ffffff', 4);
      spawnText(hitPoint.x, hitPoint.y - 30, `-ERROR`, '#f43f5e', 18);
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

    ctx.clearRect(-20, -20, dimensions.width + 40, dimensions.height + 40);

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
    if (endPoint) {
        ctx.beginPath();
        ctx.fillStyle = '#000';
        ctx.shadowBlur = 15;
        ctx.shadowColor = '#f00';
        ctx.arc(endPoint.x, endPoint.y, 25 + Math.sin(Date.now() / 200) * 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
    }

    ballsRef.current.forEach((ball) => {
      if (ball.pos < 0 || ball.pos > 1) return;
      const pIdx = Math.floor(ball.pos * (PATH_SAMPLES - 1));
      const p = pathRef.current[pIdx];
      if (!p) return;

      const isMatch = getConditionMatch(ball.value, targetNumber, gameMode);
      if (isMatch) {
        ctx.shadowBlur = 25; // More intense glow
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
        } else if (eff.type === 'ui') {
            ctx.shadowBlur = 10;
            ctx.shadowColor = 'rgba(14, 165, 233, 0.5)';
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

    const centerX = dimensions.width / 2;
    const centerY = dimensions.height / 2;
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
    
    ctx.font = 'bold 9px Inter, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.fillText('CLICK DER./ESPACIO', centerX, centerY - 48);

    ctx.font = 'bold 13px Inter, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillText('SIG: ' + nextBallValueRef.current.toString(), centerX, centerY + 58);

    if (isPaused) {
        ctx.fillStyle = 'rgba(0,0,0,0.4)';
        ctx.fillRect(0, 0, dimensions.width, dimensions.height);
        ctx.fillStyle = '#fff';
        ctx.font = 'black 60px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText("PAUSA", centerX, centerY - 20);
        ctx.font = 'bold 20px Inter, sans-serif';
        ctx.fillText("Pulsa el botón de pausa para continuar", centerX, centerY + 40);
    }

    ctx.restore();
  }, [gameState, targetNumber, gameMode, isPaused, energy, level, dimensions]);

  useEffect(() => {
    pathRef.current = generatePath(dimensions.width, dimensions.height);
    if (gameState === 'playing') {
      requestRef.current = requestAnimationFrame(update);
    }
    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [gameState, dimensions]);

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
      desc: "Mueve el ratón para apuntar. Clic para disparar. ¡TIP! Pulsa ESPACIO o Clic Derecho para intercambiar por la siguiente bola.",
      icon: <MousePointer2 className="w-12 h-12 text-indigo-400" />
    },
    {
      title: "La Regla de Oro",
      desc: "Solo puedes eliminar esferas si el número que disparas Y el número al que golpeas cumplen la condición del nivel (Múltiplos o Divisores).",
      icon: <Target className="w-12 h-12 text-emerald-400" />
    },
    {
      title: "Barra de Energía",
      desc: "Acierta disparos para llenar la barra de energía. ¡Ahora ganas +15 por acierto para facilitar tu progreso!",
      icon: <Sparkles className="w-12 h-12 text-amber-400" />
    }
  ];

  return (
    <div className="fixed inset-0 bg-slate-950 text-white font-sans flex flex-col items-center justify-center overflow-hidden selection:bg-indigo-500/30 touch-none" onContextMenu={(e) => e.preventDefault()}>
      {gameState === 'playing' && (
        <div className="absolute inset-0 p-4 sm:p-6 pointer-events-none z-10 flex flex-col justify-between">
          <div className="flex justify-between items-start">
            <div className="flex flex-col gap-2 sm:gap-4 items-start pointer-events-auto">
                <div className="bg-slate-900/80 backdrop-blur-xl p-3 sm:p-5 rounded-2xl sm:rounded-3xl border border-white/10 shadow-2xl ring-1 ring-white/5">
                    <div className="flex items-center gap-2 sm:gap-3 mb-1">
                    <div className="p-1 sm:p-2 bg-indigo-500/20 rounded-lg">
                        <Target className="w-4 h-4 sm:w-5 sm:h-5 text-indigo-400" />
                    </div>
                    <span className="text-slate-400 text-[8px] sm:text-xs font-bold uppercase tracking-[0.2em]">Objetivo</span>
                    </div>
                    <h2 className="text-lg sm:text-2xl font-black tracking-tight">
                    {gameMode === 'multiples' ? 'Múltiplos' : 'Divisores'} de{' '}
                    <span className="text-indigo-400">{targetNumber}</span>
                    </h2>
                </div>
                
                <div className="w-40 sm:w-64 bg-slate-900/80 backdrop-blur-xl p-3 sm:p-4 rounded-2xl sm:rounded-3xl border border-white/10 shadow-2xl flex flex-col gap-1 sm:gap-2">
                    <div className="flex justify-between items-center px-1">
                        <span className="text-[7px] sm:text-[10px] font-black text-slate-500 uppercase tracking-widest">Energía Matemática</span>
                        <Sparkles className={`w-2 h-2 sm:w-3 sm:h-3 ${energy === 100 ? 'text-amber-400 animate-pulse' : 'text-slate-600'}`} />
                    </div>
                    <div className="h-2 sm:h-3 w-full bg-slate-950 rounded-full overflow-hidden border border-white/5 relative">
                        <div 
                            className={`h-full transition-all duration-300 relative ${energy === 100 ? 'bg-amber-400 shadow-[0_0_15px_rgba(245,158,11,0.5)]' : 'bg-gradient-to-r from-indigo-600 to-indigo-400'}`}
                            style={{ width: `${energy}%` }}
                        />
                    </div>
                </div>
            </div>

            <div className="flex flex-col items-end gap-2 sm:gap-3">
                <div className="bg-slate-900/80 backdrop-blur-xl p-3 sm:p-5 rounded-2xl sm:rounded-3xl border border-white/10 shadow-2xl ring-1 ring-white/5 min-w-[100px] sm:min-w-[160px]">
                    <div className="text-slate-400 text-[8px] sm:text-[10px] font-bold uppercase tracking-[0.2em] mb-1 text-right">Score</div>
                    <div className="text-xl sm:text-4xl font-black text-right tabular-nums text-transparent bg-clip-text bg-gradient-to-br from-white to-slate-500">
                        {score.toLocaleString()}
                    </div>
                </div>
                <div className="bg-indigo-600 px-3 py-1 sm:px-5 sm:py-2 rounded-xl sm:rounded-2xl border border-white/10 shadow-xl text-[10px] sm:text-sm font-black tracking-widest uppercase">
                    LVL {level}
                </div>
            </div>
          </div>

          <div className="flex justify-start pointer-events-auto">
            <button 
                onClick={() => setIsPaused(!isPaused)}
                className="bg-slate-900/80 backdrop-blur-xl p-3 sm:p-5 rounded-2xl sm:rounded-3xl border border-white/10 shadow-2xl ring-1 ring-white/5 hover:bg-slate-800 transition-colors"
            >
                {isPaused ? <PlayCircle className="w-6 h-6 sm:w-8 sm:h-8 text-emerald-400" /> : <Pause className="w-6 h-6 sm:w-8 sm:h-8 text-white" />}
            </button>
          </div>
        </div>
      )}

      <div className="w-full h-full relative" ref={containerRef}>
        <canvas
          ref={canvasRef}
          width={dimensions.width}
          height={dimensions.height}
          onMouseMove={handleMouseMove}
          onTouchMove={handleMouseMove}
          onMouseDown={handleShoot}
          onTouchStart={handleShoot}
          className={`transition-all duration-700 ${gameState !== 'playing' ? 'opacity-30 blur-sm scale-95 pointer-events-none' : 'opacity-100 scale-100'}`}
        />

        {gameState === 'menu' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/60 backdrop-blur-md p-6 text-center animate-in fade-in duration-500 z-50 overflow-y-auto">
            <div className="mb-4 sm:mb-6 p-4 sm:p-6 bg-indigo-600 rounded-[1.5rem] sm:rounded-[2rem] shadow-[0_0_60px_rgba(79,70,229,0.4)] animate-bounce-slow">
              <Zap className="w-10 h-10 sm:w-16 sm:h-16 text-white fill-current" />
            </div>
            <h1 className="text-4xl sm:text-6xl font-black mb-2 tracking-tighter bg-clip-text text-transparent bg-gradient-to-b from-white via-white to-slate-500">
              MATH ZUMA
            </h1>
            
            <div className="w-full max-w-xs mb-6 sm:mb-8">
              <label className="text-slate-400 text-[10px] font-black uppercase tracking-[0.3em] block mb-2">Objetivo (Opcional)</label>
              <div className="relative group">
                <Target className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 sm:w-5 sm:h-5 text-indigo-500 group-hover:scale-110 transition-transform" />
                <input 
                  type="number"
                  placeholder="Aleatorio"
                  value={customTarget}
                  onChange={(e) => setCustomTarget(e.target.value)}
                  className="w-full bg-slate-900/80 border border-white/10 rounded-xl sm:rounded-2xl py-3 sm:py-4 pl-10 sm:pl-12 pr-4 text-center font-bold text-lg sm:text-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all placeholder:text-slate-700"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6 w-full max-w-lg mb-6 sm:mb-8">
              <button
                onClick={() => startGame('multiples')}
                className="group relative flex flex-row sm:flex-col items-center gap-4 sm:gap-1 p-4 sm:p-8 bg-slate-900/80 backdrop-blur-md border border-white/5 rounded-[1.5rem] sm:rounded-[2rem] hover:border-indigo-500 transition-all active:scale-95"
              >
                <div className="p-3 sm:p-4 bg-indigo-500/10 rounded-xl sm:rounded-2xl group-hover:bg-indigo-500/20 transition-colors">
                  <Play className="w-6 h-6 sm:w-8 sm:h-8 text-indigo-400 fill-current" />
                </div>
                <div className="flex flex-col sm:items-center text-left sm:text-center">
                    <span className="font-black text-lg sm:text-xl tracking-tight">Múltiplos</span>
                    <span className="text-slate-500 text-[8px] sm:text-[10px] font-bold uppercase tracking-widest">N × X</span>
                </div>
              </button>

              <button
                onClick={() => startGame('divisors')}
                className="group relative flex flex-row sm:flex-col items-center gap-4 sm:gap-1 p-4 sm:p-8 bg-slate-900/80 backdrop-blur-md border border-white/5 rounded-[1.5rem] sm:rounded-[2rem] hover:border-cyan-500 transition-all active:scale-95"
              >
                <div className="p-3 sm:p-4 bg-cyan-500/10 rounded-xl sm:rounded-2xl group-hover:bg-cyan-500/20 transition-colors">
                  <Target className="w-6 h-6 sm:w-8 sm:h-8 text-cyan-400" />
                </div>
                <div className="flex flex-col sm:items-center text-left sm:text-center">
                    <span className="font-black text-lg sm:text-xl tracking-tight">Divisores</span>
                    <span className="text-slate-500 text-[8px] sm:text-[10px] font-bold uppercase tracking-widest">N / X</span>
                </div>
              </button>
            </div>

            <div className="flex flex-wrap justify-center gap-3">
               <button
                  onClick={() => { setGameState('tutorial'); setTutorialStep(0); }}
                  className="flex items-center gap-2 px-4 py-2 sm:px-6 sm:py-3 bg-slate-800/80 hover:bg-slate-700 rounded-lg sm:rounded-xl font-bold text-white text-[10px] sm:text-sm transition-all border border-white/5"
                >
                  <BookOpen className="w-4 h-4 sm:w-5 sm:h-5" />
                  GUÍA
                </button>
               <button
                  onClick={() => setGameState('leaderboard')}
                  className="flex items-center gap-2 px-4 py-2 sm:px-6 sm:py-3 bg-slate-800/80 hover:bg-slate-700 rounded-lg sm:rounded-xl font-bold text-white text-[10px] sm:text-sm transition-all border border-white/5"
                >
                  <ListOrdered className="w-4 h-4 sm:w-5 sm:h-5 text-amber-500" />
                  RANKING
                </button>
            </div>
          </div>
        )}

        {gameState === 'flowchart' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/90 backdrop-blur-2xl p-6 text-center animate-in fade-in duration-500 z-50 overflow-y-auto">
                <h2 className="text-2xl sm:text-4xl font-black mb-6 sm:mb-8 tracking-tighter text-indigo-400 uppercase">Ajuste de Combate</h2>
                
                <div className="flex flex-col items-center gap-3 sm:gap-4 w-full max-w-md">
                    <div className="flex items-center gap-4 p-3 sm:p-4 bg-slate-900 border border-white/10 rounded-xl sm:rounded-2xl w-full">
                        <div className="p-2 sm:p-3 bg-indigo-500/20 rounded-lg"><Target className="w-5 h-5 text-indigo-400"/></div>
                        <div className="text-left">
                            <div className="text-[8px] sm:text-[10px] font-black text-slate-500 uppercase">MISIÓN</div>
                            <div className="text-xs sm:text-sm font-bold">Número objetivo: {targetNumber}</div>
                        </div>
                    </div>
                    <ArrowRight className="w-4 h-4 text-slate-700 rotate-90"/>
                    
                    <div className="flex items-center gap-4 p-3 sm:p-4 bg-slate-900 border border-white/10 rounded-xl sm:rounded-2xl w-full">
                        <div className="p-2 sm:p-3 bg-emerald-500/20 rounded-lg"><Sparkles className="w-5 h-5 text-emerald-400"/></div>
                        <div className="text-left">
                            <div className="text-[8px] sm:text-[10px] font-black text-slate-500 uppercase">EQUILIBRIO</div>
                            <div className="text-xs sm:text-sm font-bold">Probabilidad de objetivos aumentada al 90%.</div>
                        </div>
                    </div>
                    <ArrowRight className="w-4 h-4 text-slate-700 rotate-90"/>

                    <div className="relative p-4 sm:p-6 bg-slate-800 border-2 border-indigo-500/50 rounded-2xl sm:rounded-3xl w-full">
                        <div className="text-[8px] sm:text-[10px] font-black text-indigo-400 uppercase mb-2">VALIDACIÓN</div>
                        <div className="text-sm sm:text-lg font-black tracking-tight">¿Es un {gameMode === 'multiples' ? 'Múltiplo' : 'Divisor'}?</div>
                        
                        <div className="flex gap-2 sm:gap-4 mt-4 sm:mt-6">
                            <div className="flex-1 p-2 bg-emerald-500/10 border border-emerald-500/30 rounded-xl">
                                <CheckCircle2 className="w-4 h-4 sm:w-6 sm:h-6 text-emerald-400 mx-auto mb-1 sm:mb-2"/>
                                <div className="text-[10px] font-black text-emerald-400">SÍ</div>
                            </div>
                            <div className="flex-1 p-2 bg-rose-500/10 border border-rose-500/30 rounded-xl">
                                <AlertCircle className="w-4 h-4 sm:w-6 sm:h-6 text-rose-400 mx-auto mb-1 sm:mb-2"/>
                                <div className="text-[10px] font-black text-rose-400">NO</div>
                            </div>
                        </div>
                    </div>
                </div>

                <button
                    onClick={() => setGameState('playing')}
                    className="mt-8 sm:mt-10 px-8 py-3 sm:px-12 sm:py-5 bg-indigo-600 hover:bg-indigo-500 rounded-xl sm:rounded-2xl font-black text-lg sm:text-xl text-white transition-all shadow-2xl active:scale-95 flex items-center gap-3 sm:gap-4"
                >
                    ¡INICIAR!
                    <Play className="w-5 h-5 sm:w-6 sm:h-6 fill-current"/>
                </button>
            </div>
        )}

        {gameState === 'leaderboard' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/95 backdrop-blur-2xl p-6 text-center animate-in fade-in duration-500 z-50 overflow-hidden">
            <button 
              onClick={() => setGameState('menu')}
              className="absolute top-4 right-4 sm:top-8 sm:right-8 p-2 sm:p-3 bg-white/5 hover:bg-white/10 rounded-full"
            >
              <X className="w-5 h-5 sm:w-6 sm:h-6" />
            </button>
            
            <div className="w-full max-w-xl h-full flex flex-col pt-12 pb-8">
              <div className="flex items-center justify-center gap-3 mb-6">
                <Trophy className="w-8 h-8 sm:w-10 sm:h-10 text-amber-500" />
                <h2 className="text-2xl sm:text-4xl font-black uppercase tracking-tighter">Ranking</h2>
              </div>

              <div className="flex-1 bg-slate-900/50 border border-white/5 rounded-[1.5rem] overflow-hidden flex flex-col">
                <div className="flex-1 overflow-y-auto scrollbar-hide">
                  <table className="w-full text-left border-collapse">
                    <thead className="bg-white/5 sticky top-0">
                      <tr>
                        <th className="px-4 py-3 text-[7px] sm:text-[10px] font-black uppercase tracking-widest text-slate-500">Rango</th>
                        <th className="px-4 py-3 text-[7px] sm:text-[10px] font-black uppercase tracking-widest text-slate-500">Jugador</th>
                        <th className="px-4 py-3 text-[7px] sm:text-[10px] font-black uppercase tracking-widest text-slate-500 text-right">Puntos</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {leaderboard.length > 0 ? leaderboard.map((record, i) => (
                        <tr key={i} className="hover:bg-white/5 transition-colors">
                          <td className="px-4 py-3 font-black text-xs sm:text-base text-slate-500">#{i + 1}</td>
                          <td className="px-4 py-3 font-bold text-xs sm:text-base text-white truncate max-w-[120px]">{record.name}</td>
                          <td className="px-4 py-3 font-black text-xs sm:text-base text-right text-emerald-400">{record.score.toLocaleString()}</td>
                        </tr>
                      )) : (
                        <tr>
                          <td colSpan={3} className="px-6 py-12 text-center text-slate-600 font-bold uppercase text-[10px]">Sin registros</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <button
                onClick={() => setGameState('menu')}
                className="mt-6 px-6 py-3 bg-indigo-600 hover:bg-indigo-500 rounded-xl font-black text-white text-sm"
              >
                VOLVER
              </button>
            </div>
          </div>
        )}

        {gameState === 'tutorial' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/95 backdrop-blur-2xl p-6 text-center animate-in fade-in duration-500 z-50">
            <button 
              onClick={() => setGameState('menu')}
              className="absolute top-4 right-4 p-2 bg-white/5 rounded-full"
            >
              <X className="w-5 h-5" />
            </button>
            
            <div className="max-w-md w-full flex flex-col items-center">
              <div className="mb-6 p-6 sm:p-8 bg-indigo-500/20 rounded-[2rem] border border-indigo-500/30">
                {tutorialSteps[tutorialStep].icon}
              </div>
              
              <div className="mb-8 min-h-[120px]">
                <h2 className="text-2xl sm:text-3xl font-black mb-4 uppercase">
                  {tutorialSteps[tutorialStep].title}
                </h2>
                <p className="text-slate-300 text-sm sm:text-lg">
                  {tutorialSteps[tutorialStep].desc}
                </p>
              </div>

              <div className="flex items-center gap-4 w-full justify-between">
                <button
                  disabled={tutorialStep === 0}
                  onClick={() => setTutorialStep(prev => prev - 1)}
                  className={`p-3 rounded-xl transition-all ${tutorialStep === 0 ? 'opacity-20 grayscale' : 'bg-slate-800'}`}
                >
                  <ChevronLeft className="w-6 h-6" />
                </button>

                <div className="flex gap-1.5">
                  {tutorialSteps.map((_, i) => (
                    <div key={i} className={`h-1.5 rounded-full transition-all ${i === tutorialStep ? 'w-6 bg-indigo-500' : 'w-1.5 bg-slate-800'}`} />
                  ))}
                </div>

                {tutorialStep < tutorialSteps.length - 1 ? (
                  <button
                    onClick={() => setTutorialStep(prev => prev + 1)}
                    className="p-3 bg-indigo-600 rounded-xl"
                  >
                    <ChevronRight className="w-6 h-6" />
                  </button>
                ) : (
                  <button
                    onClick={() => setGameState('menu')}
                    className="px-6 py-3 bg-emerald-600 rounded-xl font-black text-xs"
                  >
                    LISTO
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {(gameState === 'gameover' || gameState === 'victory') && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/80 backdrop-blur-xl p-6 text-center animate-in fade-in duration-500 z-50">
            <div className={`mb-4 p-5 rounded-full border ${gameState === 'gameover' ? 'bg-rose-500/20 border-rose-500/30' : 'bg-emerald-500/20 border-emerald-500/30'}`}>
              {gameState === 'gameover' ? <AlertTriangle className="w-12 h-12 text-rose-500" /> : <Trophy className="w-12 h-12 text-emerald-400" />}
            </div>
            <h2 className={`text-4xl sm:text-6xl font-black mb-2 tracking-tighter ${gameState === 'gameover' ? 'text-rose-500' : 'text-emerald-400'}`}>
              {gameState === 'gameover' ? 'GAME OVER' : 'VICTORIA'}
            </h2>
            
            <div className="bg-slate-900/80 p-5 sm:p-6 rounded-[1.5rem] sm:rounded-[2rem] border border-white/10 mb-6 sm:mb-8 w-64 sm:w-80 shadow-2xl">
              <div className="text-slate-500 text-[8px] sm:text-[10px] font-black uppercase tracking-widest mb-1">Score</div>
              <div className="text-3xl sm:text-5xl font-black text-indigo-400 tabular-nums mb-4 sm:mb-6">{score.toLocaleString()}</div>
              
              {!scoreSaved ? (
                <div className="space-y-3">
                  <input 
                    type="text"
                    placeholder="Tu Nombre"
                    value={playerName}
                    onChange={(e) => setPlayerName(e.target.value)}
                    maxLength={15}
                    className="w-full bg-slate-950 border border-white/5 rounded-lg py-2 sm:py-3 px-4 text-xs sm:text-sm font-bold focus:outline-none"
                  />
                  <button 
                    onClick={saveScore}
                    className="w-full flex items-center justify-center gap-2 py-2 sm:py-3 bg-indigo-600 hover:bg-indigo-500 rounded-lg sm:rounded-xl font-black text-[10px] sm:text-xs transition-all active:scale-95"
                  >
                    <Save className="w-3 h-3 sm:w-4 sm:h-4" />
                    GUARDAR SCORE
                  </button>
                </div>
              ) : (
                <div className="flex items-center justify-center gap-2 text-emerald-400 font-black text-[10px] uppercase py-2">
                  <Zap className="w-3 h-3 fill-current" />
                  Score Guardado
                </div>
              )}
            </div>

            <div className="flex gap-3 sm:gap-4">
              {gameState === 'victory' ? (
                <button
                  onClick={nextLevel}
                  className="px-6 py-3 sm:px-10 sm:py-5 bg-emerald-600 hover:bg-emerald-500 rounded-xl sm:rounded-2xl font-black text-white transition-all hover:scale-105 active:scale-95"
                >
                  SIGUIENTE
                </button>
              ) : (
                <button
                  onClick={restartGame}
                  className="px-6 py-3 sm:px-10 sm:py-5 bg-indigo-600 hover:bg-indigo-500 rounded-xl sm:rounded-2xl font-black text-white transition-all hover:scale-105 active:scale-95"
                >
                  REINTENTAR
                </button>
              )}
              <button
                onClick={() => setGameState('menu')}
                className="p-3 sm:p-5 bg-slate-800 hover:bg-slate-700 rounded-xl sm:rounded-2xl transition-all"
              >
                <Home className="w-5 h-5 sm:w-6 sm:h-6" />
              </button>
            </div>
          </div>
        )}
      </div>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;700;900&display=swap');
        body { 
          margin: 0; 
          background: #020617; 
          font-family: 'Inter', sans-serif; 
          cursor: crosshair; 
          user-select: none;
          overflow: hidden;
          width: 100vw;
          height: 100vh;
        }
        canvas { touch-action: none; display: block; }
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

const rootElement = document.getElementById('root');
if (rootElement) {
  createRoot(rootElement).render(<ZumaMathGame />);
}
