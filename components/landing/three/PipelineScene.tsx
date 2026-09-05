"use client";

/**
 * Scroll-scrubbed 3D scene for the six-stage recovery pipeline.
 *
 * A single glowing token (the "case") moves along a curved path as the user
 * scrolls the pinned section, changing colour + emitting a burst at each of
 * the six stage keyframes. The stage cards on the right light up in sync.
 *
 * Uses GSAP ScrollTrigger to drive a numeric progress value (0..1) that a
 * <ProgressBridge/> component publishes into the R3F world via a ref.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Float } from "@react-three/drei";
import * as THREE from "three";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { Icon } from "@/components/landing/icons";

if (typeof window !== "undefined") {
  gsap.registerPlugin(ScrollTrigger);
}

const STAGES = [
  { icon: "detect",   name: "Detect",   color: "#e0a96b", copy: "A payment.failed webhook, an abandoned checkout, or an overdue invoice opens a case." },
  { icon: "diagnose", name: "Diagnose", color: "#7bb2ff", copy: "A rules table maps the Razorpay code to a cause. Unclear ones go to review, never a guess." },
  { icon: "decide",   name: "Decide",   color: "#c68bff", copy: "The policy for that cause picks one action and mints a real Razorpay Payment Link." },
  { icon: "draft",    name: "Draft",    color: "#ffd166", copy: "A template fills in the real name, amount and link — no invented facts." },
  { icon: "send",     name: "Send",     color: "#4fd8a6", copy: "The message goes out over email via Brevo, with the delivery reference recorded." },
  { icon: "recover",  name: "Recover",  color: "#2fb684", copy: "When the customer pays, the amount and time-to-recovery are logged on the case." },
] as const;

/* -------- The path the token travels along -------------------------- */

function usePathCurve() {
  return useMemo(() => {
    // A gently arcing spline across the scene.
    const points = [
      new THREE.Vector3(-4.2, 1.4, -0.6),
      new THREE.Vector3(-2.6, 0.4, 0.4),
      new THREE.Vector3(-0.9, 1.1, -0.3),
      new THREE.Vector3(0.8, 0.2, 0.3),
      new THREE.Vector3(2.4, 1.0, -0.4),
      new THREE.Vector3(4.2, 0.3, 0.5),
    ];
    return new THREE.CatmullRomCurve3(points, false, "catmullrom", 0.55);
  }, []);
}

/* -------- The 3D scene, driven by a scroll-progress ref ------------- */

function PathRibbon({ curve }: { curve: THREE.CatmullRomCurve3 }) {
  const geom = useMemo(() => new THREE.TubeGeometry(curve, 120, 0.03, 8, false), [curve]);
  return (
    <mesh geometry={geom}>
      <meshBasicMaterial color="#2a3527" transparent opacity={0.7} />
    </mesh>
  );
}

function PathTrail({ curve, progressRef }: { curve: THREE.CatmullRomCurve3; progressRef: React.MutableRefObject<number> }) {
  const meshRef = useRef<THREE.Mesh>(null);
  useFrame(() => {
    const m = meshRef.current;
    if (!m) return;
    const p = Math.max(0.001, Math.min(1, progressRef.current));
    // Rebuild a partial-tube by scaling geometry's drawRange.
    const geom = m.geometry as THREE.BufferGeometry;
    const total = (geom.index?.count ?? 0);
    geom.setDrawRange(0, Math.floor(total * p));
  });
  const geom = useMemo(() => new THREE.TubeGeometry(curve, 240, 0.055, 8, false), [curve]);
  return (
    <mesh ref={meshRef} geometry={geom}>
      <meshBasicMaterial color="#4fd8a6" transparent opacity={0.9} />
    </mesh>
  );
}

function StageMarkers({ curve }: { curve: THREE.CatmullRomCurve3 }) {
  const positions = useMemo(
    () => STAGES.map((_, i) => curve.getPointAt(i / (STAGES.length - 1))),
    [curve],
  );
  return (
    <>
      {positions.map((p, i) => (
        <mesh key={i} position={p}>
          <sphereGeometry args={[0.08, 16, 16]} />
          <meshBasicMaterial color={STAGES[i].color} />
        </mesh>
      ))}
    </>
  );
}

function Token({
  curve,
  progressRef,
  colorRef,
}: {
  curve: THREE.CatmullRomCurve3;
  progressRef: React.MutableRefObject<number>;
  colorRef: React.MutableRefObject<THREE.Color>;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const matRef = useRef<THREE.MeshPhysicalMaterial>(null);

  useFrame((state) => {
    const p = Math.max(0, Math.min(1, progressRef.current));
    const pos = curve.getPointAt(p);
    const m = meshRef.current;
    if (m) {
      m.position.copy(pos);
      const t = state.clock.getElapsedTime();
      m.rotation.y = t * 1.6;
      m.rotation.x = Math.sin(t * 1.2) * 0.4;
      // Small breathing scale near stage keyframes for a pulse feel.
      const nearStage = STAGES.reduce((min, _, i) => {
        const d = Math.abs(p - i / (STAGES.length - 1));
        return Math.min(min, d);
      }, 1);
      const pulse = Math.max(0, 1 - nearStage * 22);
      const s = 1 + pulse * 0.35;
      m.scale.setScalar(s);
    }
    if (matRef.current) {
      // Ease toward target colour set by scroll.
      matRef.current.color.lerp(colorRef.current, 0.12);
      matRef.current.emissive.copy(matRef.current.color).multiplyScalar(0.55);
    }
  });

  return (
    <Float speed={2} rotationIntensity={0.25} floatIntensity={0.3}>
      <mesh ref={meshRef} castShadow>
        <icosahedronGeometry args={[0.28, 1]} />
        <meshPhysicalMaterial
          ref={matRef}
          color="#4fd8a6"
          emissive="#0e3a2a"
          emissiveIntensity={0.9}
          metalness={0.4}
          roughness={0.22}
          clearcoat={0.7}
        />
      </mesh>
    </Float>
  );
}

function PipelineCanvas({
  progressRef,
  colorRef,
}: {
  progressRef: React.MutableRefObject<number>;
  colorRef: React.MutableRefObject<THREE.Color>;
}) {
  const curve = usePathCurve();
  return (
    <Canvas
      dpr={[1, 1.5]}
      camera={{ position: [0, 0.9, 6], fov: 42 }}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
    >
      <ambientLight intensity={0.4} />
      <directionalLight position={[4, 5, 6]} intensity={1.0} />
      <pointLight position={[-4, -2, 3]} intensity={1.1} color="#4fd8a6" />
      <pointLight position={[3.5, 3, -2]} intensity={0.7} color="#e0a96b" />

      <PathRibbon curve={curve} />
      <PathTrail curve={curve} progressRef={progressRef} />
      <StageMarkers curve={curve} />
      <Token curve={curve} progressRef={progressRef} colorRef={colorRef} />
    </Canvas>
  );
}

/* -------- Root pinned section --------------------------------------- */

export default function PipelineScene() {
  const sectionRef = useRef<HTMLDivElement | null>(null);
  const progressRef = useRef(0);
  const colorRef = useRef(new THREE.Color(STAGES[0].color));
  const [activeIdx, setActiveIdx] = useState(0);

  useLayoutEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const trigger = ScrollTrigger.create({
      trigger: el,
      start: "top top",
      end: "+=" + window.innerHeight * (STAGES.length - 1) * 0.9,
      pin: true,
      scrub: 0.5,
      onUpdate: (self) => {
        const p = self.progress;
        progressRef.current = p;
        // Which stage is closest → drives colour + active card.
        const raw = p * (STAGES.length - 1);
        const idx = Math.round(raw);
        setActiveIdx(idx);
        // Blend colour between adjacent stages.
        const i0 = Math.floor(raw);
        const i1 = Math.min(STAGES.length - 1, i0 + 1);
        const t = raw - i0;
        const c0 = new THREE.Color(STAGES[i0].color);
        const c1 = new THREE.Color(STAGES[i1].color);
        colorRef.current = c0.lerp(c1, t);
      },
    });

    return () => {
      trigger.kill();
    };
  }, []);

  // On reduced-motion, we still want the section rendered flat (no pin, no
  // scrub). The Canvas will just sit at progress=0.
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    setReduced(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);

  return (
    <section id="how" ref={sectionRef} className="lp-pipeline-3d">
      <div className="lp-pipeline-3d-inner">
        <div className="lp-pipeline-3d-copy">
          <p className="lp-eyebrow">How it works</p>
          <h2>What happens to a failed payment</h2>
          <p>
            Every case moves through the same six stages. A person only steps in when the
            engine is unsure or the amount is large — otherwise it runs on its own, and
            stops the moment a policy limit is reached.
          </p>

          <ol className="lp-pipeline-3d-stages">
            {STAGES.map((s, i) => (
              <li
                key={s.name}
                className={`lp-pipeline-3d-stage ${i === activeIdx ? "is-active" : ""} ${
                  i < activeIdx ? "is-done" : ""
                }`}
                style={{ ["--stage-color" as string]: s.color }}
              >
                <span className="lp-pipeline-3d-ic">
                  <Icon name={s.icon as never} size={18} />
                </span>
                <div>
                  <div className="lp-pipeline-3d-name">
                    <span className="num">{String(i + 1).padStart(2, "0")}</span>
                    {s.name}
                  </div>
                  <div className="lp-pipeline-3d-copy-line">{s.copy}</div>
                </div>
              </li>
            ))}
          </ol>

          {reduced && (
            <p style={{ marginTop: 20, fontSize: "0.85rem", opacity: 0.7 }}>
              Reduced motion is on — scroll animation disabled.
            </p>
          )}
        </div>

        <div className="lp-pipeline-3d-canvas">
          <PipelineCanvas progressRef={progressRef} colorRef={colorRef} />
        </div>
      </div>
    </section>
  );
}
