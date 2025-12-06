
import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";

// --- Configuration ---
const FIREWORK_COLORS = [
    "#FF0055", // Neon Red
    "#FFD700", // Gold
    "#00FFCC", // Cyan
    "#FF4400", // Orange
    "#AA00FF", // Purple
    "#FFFFFF"  // White hot
];

const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4], // Thumb
  [0, 5], [5, 6], [6, 7], [7, 8], // Index
  [0, 9], [9, 10], [10, 11], [11, 12], // Middle
  [0, 13], [13, 14], [14, 15], [15, 16], // Ring
  [0, 17], [17, 18], [18, 19], [19, 20], // Pinky
  [5, 9], [9, 13], [13, 17] // Palm
];

// --- Audio System ---
const speak = (text: string) => {
  if ('speechSynthesis' in window) {
    const speechMap: Record<string, string> = {
        "1": "One",
        "2": "Two",
        "3": "Three",
        "4": "Four",
        "5": "Five"
    };

    const message = speechMap[text];
    if (!message) return;

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(message);
    utterance.rate = 1.2;
    utterance.pitch = 1.0; 
    utterance.volume = 1.0;
    
    // Try to find an English voice
    const voices = window.speechSynthesis.getVoices();
    const enVoice = voices.find(v => v.lang.startsWith('en'));
    if (enVoice) utterance.voice = enVoice;

    window.speechSynthesis.speak(utterance);
  }
};

const playExplosionSound = (ctx: AudioContext) => {
    const t = ctx.currentTime;
    // Create noise buffer
    const bufferSize = ctx.sampleRate * 2; 
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
        data[i] = (Math.random() * 2 - 1); 
    }

    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(800, t);
    filter.frequency.exponentialRampToValueAtTime(10, t + 1.2); 

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.8, t + 0.02); 
    gain.gain.exponentialRampToValueAtTime(0.01, t + 1.0); 

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);

    noise.start(t);
    noise.stop(t + 2);
};

// --- Particle System ---

interface Point {
  x: number;
  y: number;
}

class Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  targetX: number;
  targetY: number;
  color: string;
  size: number;
  
  mode: 'target' | 'gravity' | 'spark';
  life: number;
  decay: number;
  
  targetIndex: number;
  snapToTarget: boolean;

  constructor(width: number, height: number) {
    this.x = Math.random() * width;
    this.y = Math.random() * height;
    this.vx = (Math.random() - 0.5) * 2; 
    this.vy = (Math.random() - 0.5) * 2;
    this.targetX = this.x;
    this.targetY = this.y;
    this.color = FIREWORK_COLORS[Math.floor(Math.random() * FIREWORK_COLORS.length)];
    this.size = Math.random() * 2 + 1;
    
    this.mode = 'spark';
    this.life = Math.random();
    this.decay = 0.01 + Math.random() * 0.02;
    this.targetIndex = -1;
    this.snapToTarget = false;
  }

  update(width: number, height: number, gesture: string, targetsCount: number) {
    if (this.mode === 'gravity') {
        // --- GRAVITY / FALLING SPARKS ---
        this.x += this.vx;
        this.y += this.vy;
        this.vy += 0.15; // Gravity
        this.vx *= 0.95; 
        this.vy *= 0.95;
        
        this.life -= this.decay;
        
        if (this.life <= 0) {
            this.recycle(width, height, gesture, targetsCount);
        }

    } else if (this.mode === 'target') {
        // --- BURNING NUMBER ---
        if (this.snapToTarget) {
            this.x = this.targetX;
            this.y = this.targetY;
            this.snapToTarget = false;
        }

        const dx = this.targetX - this.x;
        const dy = this.targetY - this.y;
        
        this.vx += dx * 0.2;
        this.vy += dy * 0.2;
        this.vx *= 0.5; 
        this.vy *= 0.5;

        this.x += this.vx;
        this.y += this.vy;

        // "Burn" effect
        this.x += (Math.random() - 0.5) * 1.5;
        this.y += (Math.random() - 0.5) * 1.5;

        // Randomly drop
        if (Math.random() < 0.02) {
            this.mode = 'gravity';
            this.vx = (Math.random() - 0.5) * 2;
            this.vy = Math.random() * 2; 
            this.life = 1.0;
            this.decay = 0.03 + Math.random() * 0.05;
        }
    } else if (this.mode === 'spark') {
        // --- IDLE GALAXY ---
        this.x += this.vx;
        this.y += this.vy;
        
        this.vx += (Math.random() - 0.5) * 0.05;
        this.vy += (Math.random() - 0.5) * 0.05;
        this.vx *= 0.98;
        this.vy *= 0.98;

        if (this.x < 0) this.x = width;
        if (this.x > width) this.x = 0;
        if (this.y < 0) this.y = height;
        if (this.y > height) this.y = 0;

        this.life -= 0.005;
        if (this.life <= 0) {
            this.life = 1;
            this.x = Math.random() * width;
            this.y = Math.random() * height;
            this.color = FIREWORK_COLORS[Math.floor(Math.random() * FIREWORK_COLORS.length)];
        }
    }
  }

  recycle(width: number, height: number, gesture: string, targetsCount: number) {
    if (["1", "2", "3", "4", "5"].includes(gesture) && targetsCount > 0) {
        this.mode = 'target';
        this.targetIndex = Math.floor(Math.random() * targetsCount);
        this.snapToTarget = true;
        this.vx = 0;
        this.vy = 0;
        this.life = 1;
        this.color = FIREWORK_COLORS[Math.floor(Math.random() * FIREWORK_COLORS.length)];
    } else {
        this.mode = 'spark';
        this.x = Math.random() * width;
        this.y = Math.random() * height;
        this.life = 1;
        this.size = Math.random() * 2 + 1;
    }
  }

  draw(ctx: CanvasRenderingContext2D) {
    if (this.life <= 0) return;
    ctx.globalAlpha = Math.max(0, this.life);
    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}

function getPointsForText(text: string, width: number, height: number): Point[] {
  const points: Point[] = [];
  const offCanvas = document.createElement("canvas");
  offCanvas.width = width;
  offCanvas.height = height;
  const ctx = offCanvas.getContext("2d");
  if (!ctx) return points;

  const fontSize = Math.min(width, height) * 0.7;
  ctx.font = `900 ${fontSize}px "Segoe UI", Roboto, sans-serif`;
  ctx.fillStyle = "white";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, width / 2, height / 2);

  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;
  
  const step = 4; 
  const cx = width / 2;
  const cy = height / 2;

  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const index = (y * width + x) * 4;
      if (data[index + 3] > 128) {
        points.push({
          x: x - cx,
          y: y - cy
        });
      }
    }
  }
  return points;
}

function drawHandSkeleton(ctx: CanvasRenderingContext2D, landmarks: any[]) {
    const width = ctx.canvas.width;
    const height = ctx.canvas.height;
    
    ctx.strokeStyle = "#00FFCC";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    
    // Draw connections
    ctx.beginPath();
    HAND_CONNECTIONS.forEach(([start, end]) => {
        const p1 = landmarks[start];
        const p2 = landmarks[end];
        if(p1 && p2) {
            ctx.moveTo(p1.x * width, p1.y * height);
            ctx.lineTo(p2.x * width, p2.y * height);
        }
    });
    ctx.stroke();

    // Draw joints
    ctx.fillStyle = "#FF0055";
    landmarks.forEach((p: any) => {
        ctx.beginPath();
        ctx.arc(p.x * width, p.y * height, 3, 0, 2 * Math.PI);
        ctx.fill();
    });
}

// --- Main Application ---

const App = () => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  
  const [loading, setLoading] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [currentGesture, setCurrentGesture] = useState<string>("none");
  const [modelLoaded, setModelLoaded] = useState(false);
  const [debugMsg, setDebugMsg] = useState("Initializing...");
  const [showHelp, setShowHelp] = useState(false);
  
  const particlesRef = useRef<Particle[]>([]);
  const animationFrameRef = useRef<number>(0);
  const targetPointsRef = useRef<Point[]>([]);
  const currentGestureRef = useRef<string>("none"); 

  const prevGestureRef = useRef<string>("none");
  const handLandmarkerRef = useRef<HandLandmarker | null>(null);
  const lastVideoTimeRef = useRef<number>(-1);
  const angleRef = useRef<number>(0);

  useEffect(() => {
    const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
    if (AudioContext) {
        audioCtxRef.current = new AudioContext();
    }
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const handleResize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      if (particlesRef.current.length === 0) {
        for(let i=0; i<6000; i++) {
            particlesRef.current.push(new Particle(canvas.width, canvas.height));
        }
      }
    };
    window.addEventListener("resize", handleResize);
    handleResize();

    const loop = () => {
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = "rgba(0, 0, 0, 0.2)"; 
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      
      ctx.globalCompositeOperation = "lighter";

      const particles = particlesRef.current;
      const targets = targetPointsRef.current;
      const gesture = currentGestureRef.current;
      
      angleRef.current += 0.02;
      
      let cos = 1, sin = 0, cx = 0, cy = 0;
      if (["1", "2", "3", "4", "5"].includes(gesture)) {
          cos = Math.cos(angleRef.current);
          sin = Math.sin(angleRef.current);
          cx = canvas.width / 2;
          cy = canvas.height / 2;
      }

      // Fireworks for Fist
      if (gesture === "fist") {
          if (Math.random() < 0.15) { 
              const centerX = Math.random() * canvas.width * 0.8 + canvas.width * 0.1;
              const centerY = Math.random() * canvas.height * 0.6 + canvas.height * 0.1;
              const baseColor = FIREWORK_COLORS[Math.floor(Math.random() * FIREWORK_COLORS.length)];
              
              if (audioCtxRef.current && audioCtxRef.current.state === 'running') {
                  playExplosionSound(audioCtxRef.current);
              }

              let count = 0;
              for(let i = 0; i < particles.length && count < 100; i++) {
                  const p = particles[i];
                  if (p.life <= 0.1 || p.mode === 'spark') {
                      p.mode = 'gravity';
                      p.x = centerX;
                      p.y = centerY;
                      const angle = Math.random() * Math.PI * 2;
                      const speed = Math.random() * 9 + 3;
                      p.vx = Math.cos(angle) * speed;
                      p.vy = Math.sin(angle) * speed;
                      p.color = baseColor;
                      p.size = Math.random() * 3 + 1.5;
                      p.life = 1.0;
                      p.decay = 0.01 + Math.random() * 0.02;
                      count++;
                  }
              }
          }
      }

      particles.forEach((p) => {
        if (p.mode === 'target' && p.targetIndex >= 0 && p.targetIndex < targets.length) {
            const pt = targets[p.targetIndex];
            const rx = pt.x * cos;
            const rz = pt.x * sin; 
            const fov = 1000;
            const scale = fov / (fov + rz);
            p.targetX = rx * scale + cx;
            p.targetY = pt.y * scale + cy;
        }

        p.update(canvas.width, canvas.height, gesture, targets.length);
        p.draw(ctx);
      });

      animationFrameRef.current = requestAnimationFrame(loop);
    };

    loop();

    return () => {
      window.removeEventListener("resize", handleResize);
      cancelAnimationFrame(animationFrameRef.current);
    };
  }, []);

  useEffect(() => {
    currentGestureRef.current = currentGesture; 

    const canvas = canvasRef.current;
    if (!canvas) return;

    if (currentGesture !== "none" && currentGesture !== prevGestureRef.current) {
        if (["1", "2", "3", "4", "5"].includes(currentGesture)) {
            speak(currentGesture);
            if (audioCtxRef.current && audioCtxRef.current.state === 'suspended') {
                audioCtxRef.current.resume();
            }
        }
    }
    prevGestureRef.current = currentGesture;

    let points: Point[] = [];
    const w = canvas.width;
    const h = canvas.height;

    if (["1", "2", "3", "4", "5"].includes(currentGesture)) {
      points = getPointsForText(currentGesture, w, h);
    } 

    targetPointsRef.current = points;
    
    if (points.length > 0) {
        const particles = particlesRef.current;
        particles.forEach((p) => {
            if (p.mode !== 'target' || p.targetIndex === -1) {
                p.mode = 'target';
                p.targetIndex = Math.floor(Math.random() * points.length);
                p.life = 1;
                p.color = FIREWORK_COLORS[Math.floor(Math.random() * FIREWORK_COLORS.length)];
                if (Math.random() > 0.5) p.snapToTarget = true;
            }
        });
    }

  }, [currentGesture]);

  useEffect(() => {
      const loadModel = async () => {
          try {
              setDebugMsg("Checking offline cache...");
              
              const vision = await FilesetResolver.forVisionTasks(
                  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.8/wasm"
              );

              const modelUrl = `https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`;
              let finalModelPath = modelUrl;

              if ('caches' in window) {
                const cacheName = 'particle-magic-v1';
                try {
                    const cache = await caches.open(cacheName);
                    const cachedResponse = await cache.match(modelUrl);
                    
                    if (cachedResponse) {
                        const blob = await cachedResponse.blob();
                        finalModelPath = URL.createObjectURL(blob);
                    } else {
                        setDebugMsg("Downloading Model (approx 10MB)...");
                        const response = await fetch(modelUrl);
                        if(response.ok) {
                            cache.put(modelUrl, response.clone());
                            const blob = await response.blob();
                            finalModelPath = URL.createObjectURL(blob);
                        }
                    }
                } catch (e) {
                    console.warn("Cache fallback", e);
                }
              }

              handLandmarkerRef.current = await HandLandmarker.createFromOptions(vision, {
                  baseOptions: {
                      modelAssetPath: finalModelPath,
                      delegate: "GPU"
                  },
                  runningMode: "VIDEO",
                  numHands: 1
              });
              setModelLoaded(true);
              setDebugMsg("Ready. Click to Start.");
          } catch (e) {
              console.error("Failed to load MediaPipe model", e);
              setDebugMsg("Error. Check connection.");
              alert("Failed to load AI model.");
          }
      };
      loadModel();
  }, []);

  const startCamera = async () => {
      if (!handLandmarkerRef.current) return;
      setLoading(true);
      if (audioCtxRef.current) audioCtxRef.current.resume();
      if ('speechSynthesis' in window) window.speechSynthesis.getVoices();

      try {
          const stream = await navigator.mediaDevices.getUserMedia({
              video: { width: 320, height: 240, frameRate: 30 }
          });
          
          if (videoRef.current) {
              videoRef.current.srcObject = stream;
              videoRef.current.onloadedmetadata = () => {
                  videoRef.current?.play();
                  setLoading(false);
                  setIsRunning(true);
                  predictWebcam();
              };
          }
      } catch (err) {
          console.error("Camera error", err);
          alert("Could not access camera.");
          setLoading(false);
      }
  };

  const predictWebcam = () => {
      const video = videoRef.current;
      const landmarker = handLandmarkerRef.current;
      const overlayCanvas = overlayCanvasRef.current;
      
      if (video && landmarker && video.readyState >= 2) {
           let startTimeMs = performance.now();
           if (lastVideoTimeRef.current !== video.currentTime) {
               lastVideoTimeRef.current = video.currentTime;
               const result = landmarker.detectForVideo(video, startTimeMs);
               
               // Manual Skeleton Drawing
               if (overlayCanvas) {
                   const ctx = overlayCanvas.getContext('2d');
                   if (ctx) {
                       ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
                       if (overlayCanvas.width !== video.videoWidth || overlayCanvas.height !== video.videoHeight) {
                           overlayCanvas.width = video.videoWidth;
                           overlayCanvas.height = video.videoHeight;
                       }
                       if (result.landmarks) {
                           for (const landmarks of result.landmarks) {
                               drawHandSkeleton(ctx, landmarks);
                           }
                       }
                   }
               }

               if (result.landmarks && result.landmarks.length > 0) {
                   const landmarks = result.landmarks[0];
                   const wrist = landmarks[0];
                   
                   function isFingerExtended(tipIdx: number, pipIdx: number) {
                       const tip = landmarks[tipIdx];
                       const pip = landmarks[pipIdx];
                       const dTip = (tip.x - wrist.x)**2 + (tip.y - wrist.y)**2;
                       const dPip = (pip.x - wrist.x)**2 + (pip.y - wrist.y)**2;
                       return dTip > dPip;
                   }
                   
                   let fingersUp = 0;
                   if (isFingerExtended(8, 6)) fingersUp++; 
                   if (isFingerExtended(12, 10)) fingersUp++; 
                   if (isFingerExtended(16, 14)) fingersUp++; 
                   if (isFingerExtended(20, 18)) fingersUp++; 
                   
                   const tip4 = landmarks[4];
                   const ip3 = landmarks[3];
                   const mcp17 = landmarks[17]; 
                   const dTip4 = (tip4.x - mcp17.x)**2 + (tip4.y - mcp17.y)**2;
                   const dIp3 = (ip3.x - mcp17.x)**2 + (ip3.y - mcp17.y)**2;
                   const mcp5 = landmarks[5]; 
                   const dTip4Mcp5 = (tip4.x - mcp5.x)**2 + (tip4.y - mcp5.y)**2;
                   
                   if (dTip4 > dIp3 && dTip4Mcp5 > 0.005) fingersUp++;

                   if (fingersUp === 0) setCurrentGesture("fist");
                   else if (fingersUp >= 1 && fingersUp <= 5) setCurrentGesture(String(fingersUp));
                   else setCurrentGesture("none");

               } else {
                   setCurrentGesture("none");
               }
           }
      }
      
      if (video && !video.paused && !video.ended) {
          requestAnimationFrame(predictWebcam);
      }
  };

  return (
    <div style={{ position: "relative", width: "100vw", height: "100vh", overflow: "hidden", fontFamily: "sans-serif" }}>
      <canvas ref={canvasRef} style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%" }} />

      <div style={{ position: "absolute", top: 20, left: 20, color: "white", zIndex: 10, pointerEvents: "none" }}>
        <h1 style={{ margin: 0, fontSize: "2rem", textShadow: "0 0 15px rgba(255, 215, 0, 0.8)", fontFamily: "'Segoe UI', Roboto, sans-serif" }}>Firework Magic</h1>
        <p style={{ margin: "5px 0", fontSize: "1rem", color: "#ccc" }}>
          🖐 1-5 fingers for 3D Burning Numbers <br/>
          ✊ Fist for Fireworks
        </p>
        
        <div style={{ pointerEvents: "auto", display: "flex", gap: "10px", alignItems: "center" }}>
            {!isRunning && (
            <button 
                onClick={startCamera}
                disabled={!modelLoaded || loading}
                style={{
                background: modelLoaded ? "linear-gradient(90deg, #FF4400 0%, #FFD700 100%)" : "#555",
                border: "none",
                color: "white",
                padding: "12px 30px",
                borderRadius: "30px",
                fontSize: "1.2rem",
                cursor: modelLoaded ? "pointer" : "wait",
                marginTop: "15px",
                fontWeight: "bold",
                boxShadow: modelLoaded ? "0 0 25px rgba(255, 68, 0, 0.6)" : "none",
                textTransform: "uppercase",
                letterSpacing: "1px",
                transition: "all 0.2s"
                }}
            >
                {loading ? "Igniting..." : debugMsg}
            </button>
            )}
        </div>

        {isRunning && (
           <div style={{ marginTop: 20 }}>
               <span style={{ fontSize: "0.8rem", color: "#888", textTransform: "uppercase", letterSpacing: "1px" }}>Detected Gesture</span><br/>
               <strong style={{ 
                   color: currentGesture === "fist" ? "#FFD700" : "#00FFFF", 
                   fontSize: "3rem", 
                   fontFamily: "monospace",
                   textShadow: "0 0 20px currentColor"
               }}>
                   {currentGesture === "none" ? "--" : currentGesture === "fist" ? "FIREWORKS" : currentGesture}
               </strong>
           </div>
        )}
      </div>

      <button 
        onClick={() => setShowHelp(!showHelp)}
        style={{
            position: "absolute", bottom: 20, left: 20,
            background: "rgba(255,255,255,0.1)", color: "white", border: "1px solid rgba(255,255,255,0.3)",
            width: "30px", height: "30px", borderRadius: "50%", cursor: "pointer", zIndex: 50, fontSize: "16px"
        }}
      >
        ?
      </button>

      {showHelp && (
          <div style={{
              position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
              background: "rgba(0,0,0,0.9)", padding: "30px", borderRadius: "15px", border: "1px solid #FFD700",
              zIndex: 100, maxWidth: "500px", color: "white", lineHeight: "1.5"
          }}>
              <h2 style={{marginTop: 0, color: "#FFD700"}}>Offline Setup</h2>
              <p>To run without internet, place these files in the same folder as index.html:</p>
              <ul style={{fontSize: "0.9em", color: "#aaa"}}>
                  <li><a href="https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task" target="_blank" style={{color:"#FF4400"}}>hand_landmarker.task</a></li>
                  <li><a href="https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.8/wasm/vision_wasm_internal.wasm" target="_blank" style={{color:"#FF4400"}}>vision_wasm_internal.wasm</a></li>
                  <li><a href="https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.8/wasm/vision_wasm_internal.js" target="_blank" style={{color:"#FF4400"}}>vision_wasm_internal.js</a></li>
              </ul>
              <button onClick={() => setShowHelp(false)} style={{
                  background: "#333", border: "none", color: "white", padding: "8px 20px", borderRadius: "5px", cursor: "pointer", marginTop: "10px"
              }}>Close</button>
          </div>
      )}

      <div style={{ position: "absolute", bottom: 20, right: 20, display: isRunning ? "block" : "none", zIndex: 20, opacity: 0.8 }}>
          <div style={{ position: "relative", width: 240, height: 180 }}>
              <video 
                ref={videoRef} autoPlay
                style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", borderRadius: 12, transform: "scaleX(-1)", objectFit: "cover", boxShadow: "0 0 15px rgba(255, 68, 0, 0.3)", border: "1px solid rgba(255,255,255,0.2)" }} 
                muted playsInline
              />
              <canvas 
                ref={overlayCanvasRef}
                style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", borderRadius: 12, transform: "scaleX(-1)", pointerEvents: "none" }}
              />
          </div>
      </div>
    </div>
  );
};

const initApp = () => {
    const container = document.getElementById("app");
    if (container) {
        createRoot(container).render(<App />);
    }
};

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initApp);
} else {
    initApp();
}
