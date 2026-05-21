"use client";

import { useEffect, useRef, useState } from "react";
import { SnakeGame } from "@/lib/snakeGame";
import { Progress } from "antd";
import { Analytics } from "@vercel/analytics/next"
const config = {
  pixelSize: 40,
  gameWidth: 10,
  gameHeight: 10,
  moveSpeed: 100,
};

export default function Page() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const gameRef = useRef<SnakeGame | null>(null);
  const runningRef = useRef(false);
  const manualRunningRef = useRef(false);
  const playTimerRef = useRef<NodeJS.Timeout | null>(null);
  const loadingTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isModelReadyRef = useRef(false);

  const [score, setScore] = useState(0);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [loadingModel, setLoadingModel] = useState(false);
  const [loadingPercent, setLoadingPercent] = useState(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const game = new SnakeGame(config, canvas);
    gameRef.current = game;

    const worker = new Worker("/workers/infer-worker.js");
    workerRef.current = worker;

    worker.onmessage = (ev: MessageEvent) => {
      const data = ev.data as { type: string; action?: number; message?: string };

      if (data.type === "model_loaded") {
        isModelReadyRef.current = true;
        // 1. 清除伪进度定时器
        if (loadingTimerRef.current) {
          clearInterval(loadingTimerRef.current);
        }
        // 2. 瞬间拉满到 100%
        setLoadingPercent(100);
        // 3. 延迟 400ms，优雅淡出蒙层并正式启动游戏运行逻辑
        setTimeout(() => {
          setLoadingModel(false);
        }, 200);
      }

      if (data.type === "action" && typeof data.action === "number") {
        const game = gameRef.current;
        if (!game || !runningRef.current) return;

        game.handleAction(data.action);
        game.update();
        game.render();
        setScore(game.score);

        if (game.done) {
          worker.postMessage({ type: "reset" });
        }

        // 使用 moveSpeed 参数作为延迟时间，完美控制 AI 模式下蛇的移动速度！
        setTimeout(() => {
          if (runningRef.current) {
            requestNextStep();
          }
        }, config.moveSpeed);
      }
      if (data.type === "error") {
        runningRef.current = false;
        setLoadingModel(false);
        setError(data.message ?? "Inference failed");
      }
      if (data.type === "reset_done") {
        // no-op
      }
    };

    // 监听键盘事件，修复传统手动 WASD 控制逻辑
    const handleKeyDown = (e: KeyboardEvent) => {
      const game = gameRef.current;
      if (!game) return;

      const key = e.key.toLowerCase();
      // 映射 w, a, s, d 极其对应的方向键
      const keyMap: Record<string, "w" | "a" | "s" | "d"> = {
        w: "w", arrowup: "w",
        s: "s", arrowdown: "s",
        a: "a", arrowleft: "a",
        d: "d", arrowright: "d",
      };

      if (key in keyMap) {
        if (e.key.startsWith("Arrow")) {
          e.preventDefault(); // 阻止方向键引起浏览器滚动
        }
        game.handleKey(keyMap[key]);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    setReady(true);

    return () => {
      runningRef.current = false;
      if (playTimerRef.current) {
        clearInterval(playTimerRef.current);
      }
      if (loadingTimerRef.current) {
        clearInterval(loadingTimerRef.current);
      }
      worker.terminate();
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  const requestNextStep = async () => {
    const canvas = canvasRef.current;
    const game = gameRef.current;
    const worker = workerRef.current;
    if (!canvas || !game || !worker || !runningRef.current) return;

    const imageBitmap = await createImageBitmap(canvas);
    worker.postMessage(
      { type: "infer", imageBitmap, features: game.getAuxiliaryFeatures() },
      [imageBitmap]
    );
  };

  const startAI = () => {
    // 启动 AI 前停止手动运行
    stopManual();

    setError(null);

    // 如果模型还没有加载完毕过，则展示精巧的阻尼伪进度条蒙层
    if (!isModelReadyRef.current) {
      setLoadingModel(true);
      setLoadingPercent(0);

      if (loadingTimerRef.current) {
        clearInterval(loadingTimerRef.current);
      }

      let currentPercent = 0;
      // 阻尼增长算法：前段极速飙升，中段匀速爬行，后段无限逼近 95%
      loadingTimerRef.current = setInterval(() => {
        if (currentPercent < 40) {
          currentPercent += Math.floor(Math.random() * 5) + 6; // 每次 +6 ~ +10
        } else if (currentPercent < 80) {
          currentPercent += Math.floor(Math.random() * 3) + 1; // 每次 +1 ~ +3
        } else if (currentPercent < 95) {
          currentPercent += 1;
        }
        setLoadingPercent(Math.min(95, currentPercent));
      }, 120);
    }

    runningRef.current = true;
    requestNextStep();
  };

  const stopAI = () => {
    runningRef.current = false;
  };

  // 手动控制：启动传统游戏循环
  const startManual = () => {
    // 启动手动模式前停止 AI 推理模式
    stopAI();

    if (playTimerRef.current) {
      clearInterval(playTimerRef.current);
    }

    manualRunningRef.current = true;

    // 启动一个周期为 moveSpeed 毫秒的贪吃蛇自动行走定时器
    playTimerRef.current = setInterval(() => {
      const game = gameRef.current;
      if (!game || !manualRunningRef.current) return;

      game.update();
      game.render();
      setScore(game.score);
    }, config.moveSpeed);
  };

  const stopManual = () => {
    manualRunningRef.current = false;
    if (playTimerRef.current) {
      clearInterval(playTimerRef.current);
      playTimerRef.current = null;
    }
  };

  const resetGame = () => {
    const game = gameRef.current;
    if (!game) return;

    // 重置时彻底清理所有的定时器和循环状态，防止出现残存运行
    stopManual();
    stopAI();

    if (loadingTimerRef.current) {
      clearInterval(loadingTimerRef.current);
      loadingTimerRef.current = null;
    }
    setLoadingModel(false);
    setLoadingPercent(0);

    game.reset();
    game.render();
    setScore(0);
    workerRef.current?.postMessage({ type: "reset" });
  };

  return (
    <main>
      <Analytics />
      {/* 炫酷磨砂加载蒙层 */}
      {loadingModel && (
        <div className="model-loading-overlay">
          <div className="model-loading-box">
            <div className="model-loading-title">模型加载中...</div>
            <Progress
              percent={loadingPercent}
              status="active"
              strokeColor={{
                "0%": "#108ee9",
                "100%": "#57e389",
              }}
            />
          </div>
        </div>
      )}

      <section className="shell">
        <div className="header">
          <div className="title">E2E RL纯前端推理示例</div>
          <div className="meta">10x10x40 · 4-frame stack</div>
        </div>

        <div className="stage">
          <canvas ref={canvasRef} id="gameCanvas" />

          <aside className="side">
            <button onClick={startAI} disabled={!ready}>Start Agent</button>
            <button onClick={stopAI}>Stop Agent</button>
            <button onClick={startManual} className="manual-btn">Start Manual</button>
            <button onClick={stopManual}>Stop Manual</button>
            <button onClick={resetGame}>Reset</button>

            <div className="status">
              <div>Score: <span>{score}</span></div>

              <div>Training: <span className="ok">Pytorch</span></div>
              <div>Model: <span className="ok">CNN+MLP+QLearning</span></div>
              <div>Inference: <span className="ok">WebWorker + ORT-WASM</span></div>
              {error ? <div className="err">Error: {error}</div> : null}
            </div>
          </aside>
        </div>
      </section>
    </main>
  );
}
