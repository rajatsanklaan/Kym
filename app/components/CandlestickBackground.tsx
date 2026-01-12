"use client";

import { useEffect, useRef } from "react";

interface Candlestick {
  open: number;
  close: number;
  high: number;
  low: number;
  width: number;
  delay: number;
}

export default function CandlestickBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Set canvas size
    const resizeCanvas = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);

    // Generate multiple rows of candlesticks for more visual interest
    const generateCandlesticks = (numCandlesticks: number, baseY: number): Candlestick[] => {
      const candlesticks: Candlestick[] = [];
      const spacing = canvas.width / numCandlesticks;

      for (let i = 0; i < numCandlesticks; i++) {
        const isBullish = Math.random() > 0.5;
        const basePrice = 50 + Math.random() * 50;
        const volatility = 5 + Math.random() * 15;
        
        const open = basePrice;
        const close = isBullish 
          ? open + Math.random() * volatility
          : open - Math.random() * volatility;
        const high = Math.max(open, close) + Math.random() * volatility * 0.6;
        const low = Math.min(open, close) - Math.random() * volatility * 0.6;

        candlesticks.push({
          open,
          close,
          high,
          low,
          width: spacing * 0.5,
          delay: i * 0.08,
        });
      }

      return candlesticks;
    };

    // Create multiple rows at different vertical positions
    const rows = [
      { candlesticks: generateCandlesticks(60, canvas.height * 0.2), y: canvas.height * 0.2, speed: 20 },
      { candlesticks: generateCandlesticks(50, canvas.height * 0.5), y: canvas.height * 0.5, speed: 25 },
      { candlesticks: generateCandlesticks(55, canvas.height * 0.8), y: canvas.height * 0.8, speed: 18 },
    ];

    let animationFrame: number;
    let time = 0;

    const drawCandlestick = (
      x: number,
      y: number,
      candle: Candlestick,
      scale: number
    ) => {
      const openY = y - (candle.open - 50) * scale;
      const closeY = y - (candle.close - 50) * scale;
      const highY = y - (candle.high - 50) * scale;
      const lowY = y - (candle.low - 50) * scale;

      const isBullish = candle.close > candle.open;
      const bodyTop = Math.min(openY, closeY);
      const bodyBottom = Math.max(openY, closeY);
      const bodyHeight = Math.max(bodyBottom - bodyTop, 2);

      // Draw wick (high-low line)
      ctx.strokeStyle = isBullish 
        ? "rgba(34, 197, 94, 0.5)" 
        : "rgba(239, 68, 68, 0.5)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x + candle.width / 2, highY);
      ctx.lineTo(x + candle.width / 2, lowY);
      ctx.stroke();

      // Draw body
      ctx.fillStyle = isBullish 
        ? "rgba(34, 197, 94, 0.35)" 
        : "rgba(239, 68, 68, 0.35)";
      ctx.fillRect(
        x + candle.width * 0.15,
        bodyTop,
        candle.width * 0.7,
        bodyHeight
      );

      // Draw body outline
      ctx.strokeStyle = isBullish 
        ? "rgba(34, 197, 94, 0.6)" 
        : "rgba(239, 68, 68, 0.6)";
      ctx.lineWidth = 1;
      ctx.strokeRect(
        x + candle.width * 0.15,
        bodyTop,
        candle.width * 0.7,
        bodyHeight
      );
    };

    const draw = () => {
      // Clear canvas with slight transparency for trailing effect
      ctx.fillStyle = "rgba(1, 42, 74, 0.08)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Draw subtle grid lines
      ctx.strokeStyle = "rgba(255, 255, 255, 0.03)";
      ctx.lineWidth = 1;
      for (let i = 0; i < 6; i++) {
        const y = (canvas.height / 6) * i;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(canvas.width, y);
        ctx.stroke();
      }

      // Draw each row of candlesticks
      rows.forEach((row) => {
        const spacing = canvas.width / row.candlesticks.length;
        row.candlesticks.forEach((candle, index) => {
          // Calculate horizontal position with seamless looping
          const totalWidth = canvas.width + candle.width * 2;
          const offsetX = (time * row.speed + candle.delay * 100) % totalWidth - candle.width;
          
          // Only draw if visible on screen
          if (offsetX + candle.width > 0 && offsetX < canvas.width) {
            drawCandlestick(offsetX, row.y, candle, 2.5);
          }
        });
      });

      time += 0.016; // ~60fps
      animationFrame = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      window.removeEventListener("resize", resizeCanvas);
      cancelAnimationFrame(animationFrame);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 w-full h-full pointer-events-none z-0"
      style={{ opacity: 0.4 }}
    />
  );
}

