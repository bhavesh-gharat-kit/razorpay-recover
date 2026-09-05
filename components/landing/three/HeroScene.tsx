"use client";

/**
 * Hero WebGL scene — a floating Razorpay-style payment card with coins /
 * ₹ symbols orbiting it. Rendered inside an IntersectionObserver so the
 * WebGL loop only ticks when it's actually on screen.
 *
 * Loaded via `next/dynamic({ ssr: false })` from the landing page, so this
 * file never runs on the server and never adds to the initial JS chunk.
 */

import { Suspense, useMemo, useRef, useState, useEffect } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Environment, Float, Text, RoundedBox, ContactShadows } from "@react-three/drei";
import * as THREE from "three";

/* -------- Payment card ---------------------------------------------- */

function PaymentCard() {
  const group = useRef<THREE.Group>(null);
  // Gentle idle rotation + subtle breathing scale.
  useFrame((state) => {
    const g = group.current;
    if (!g) return;
    const t = state.clock.getElapsedTime();
    g.rotation.z = Math.sin(t * 0.5) * 0.04;
    g.rotation.x = -0.15 + Math.sin(t * 0.35) * 0.03;
  });

  // A canvas-drawn gradient used as an emissive map for the card face,
  // so we get the Razorpay-blue → recovery-green sheen without any assets.
  const gradientTex = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = 512;
    c.height = 320;
    const ctx = c.getContext("2d")!;
    const g = ctx.createLinearGradient(0, 0, 512, 320);
    g.addColorStop(0, "#0f2b6e");   // deep razorpay-esque blue
    g.addColorStop(0.55, "#1c7a58"); // brand accent-deep
    g.addColorStop(1, "#4fd8a6");    // accent-bright
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 512, 320);

    // A soft diagonal shimmer band.
    const band = ctx.createLinearGradient(0, 0, 512, 320);
    band.addColorStop(0, "rgba(255,255,255,0)");
    band.addColorStop(0.5, "rgba(255,255,255,0.16)");
    band.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = band;
    ctx.fillRect(0, 0, 512, 320);

    const tex = new THREE.CanvasTexture(c);
    tex.anisotropy = 8;
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }, []);

  return (
    <group ref={group} rotation={[-0.15, 0.35, 0]}>
      {/* Card body */}
      <RoundedBox args={[3.2, 2, 0.14]} radius={0.16} smoothness={6} castShadow receiveShadow>
        <meshPhysicalMaterial
          map={gradientTex}
          emissive="#0e3a2a"
          emissiveIntensity={0.35}
          metalness={0.55}
          roughness={0.28}
          clearcoat={1}
          clearcoatRoughness={0.22}
          reflectivity={0.6}
        />
      </RoundedBox>

      {/* Chip */}
      <mesh position={[-1.0, 0.15, 0.076]}>
        <boxGeometry args={[0.5, 0.38, 0.02]} />
        <meshPhysicalMaterial color="#d9b46a" metalness={0.95} roughness={0.28} />
      </mesh>

      {/* Card number (simulated) */}
      <Text
        position={[0, -0.35, 0.076]}
        fontSize={0.19}
        letterSpacing={0.14}
        color="#f4f2e6"
        anchorX="center"
        anchorY="middle"
      >
        4242  4242  4242  4242
      </Text>

      {/* Brand-ish mark bottom-right */}
      <Text
        position={[1.1, -0.78, 0.076]}
        fontSize={0.16}
        color="#f4f2e6"
        anchorX="right"
        anchorY="middle"
      >
        RECOVER
      </Text>

      {/* Cardholder name bottom-left */}
      <Text
        position={[-1.45, -0.78, 0.076]}
        fontSize={0.13}
        color="#dfe3d0"
        anchorX="left"
        anchorY="middle"
      >
        SARA NAIR
      </Text>

      {/* Contactless glyph top-right (three arcs made with rings) */}
      <group position={[1.3, 0.55, 0.08]} rotation={[0, 0, -Math.PI / 2]}>
        {[0.09, 0.16, 0.23].map((r, i) => (
          <mesh key={r} rotation={[0, 0, 0]}>
            <ringGeometry args={[r, r + 0.025, 24, 1, -0.5, 1.0]} />
            <meshBasicMaterial color="#f4f2e6" transparent opacity={0.85 - i * 0.15} side={THREE.DoubleSide} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

/* -------- Orbiting coins with ₹ ------------------------------------- */

type CoinProps = {
  radius: number;
  speed: number;
  phase: number;
  tilt: number;
  y: number;
  size: number;
};

function Coin({ radius, speed, phase, tilt, y, size }: CoinProps) {
  const group = useRef<THREE.Group>(null);
  useFrame((state) => {
    const g = group.current;
    if (!g) return;
    const t = state.clock.getElapsedTime() * speed + phase;
    g.position.x = Math.cos(t) * radius;
    g.position.z = Math.sin(t) * radius * Math.cos(tilt);
    g.position.y = y + Math.sin(t) * radius * Math.sin(tilt);
    // Face the camera on the wide axis, spin on the thin one.
    g.rotation.y = t * 1.4;
  });
  return (
    <group ref={group}>
      <mesh castShadow>
        <cylinderGeometry args={[size, size, size * 0.16, 32]} />
        <meshPhysicalMaterial color="#e0a96b" metalness={0.95} roughness={0.28} clearcoat={0.6} />
      </mesh>
      {/* ₹ on both faces */}
      <Text
        position={[0, size * 0.09, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        fontSize={size * 1.05}
        color="#3a2a12"
        anchorX="center"
        anchorY="middle"
      >
        ₹
      </Text>
      <Text
        position={[0, -size * 0.09, 0]}
        rotation={[Math.PI / 2, 0, 0]}
        fontSize={size * 1.05}
        color="#3a2a12"
        anchorX="center"
        anchorY="middle"
      >
        ₹
      </Text>
    </group>
  );
}

function CoinSwarm() {
  // Seeded configuration so the layout is stable across renders.
  const coins = useMemo<CoinProps[]>(() => {
    const arr: CoinProps[] = [];
    const N = 14;
    for (let i = 0; i < N; i++) {
      arr.push({
        radius: 2.4 + (i % 3) * 0.55 + Math.random() * 0.3,
        speed: 0.28 + Math.random() * 0.22,
        phase: (i / N) * Math.PI * 2,
        tilt: 0.35 + (i % 5) * 0.08,
        y: -0.4 + (i % 4) * 0.35,
        size: 0.18 + Math.random() * 0.06,
      });
    }
    return arr;
  }, []);
  return (
    <>
      {coins.map((c, i) => (
        <Coin key={i} {...c} />
      ))}
    </>
  );
}

/* -------- Pointer parallax rig -------------------------------------- */

function ParallaxRig({ children }: { children: React.ReactNode }) {
  const group = useRef<THREE.Group>(null);
  const target = useRef({ x: 0, y: 0 });

  useEffect(() => {
    function onMove(e: PointerEvent) {
      const nx = (e.clientX / window.innerWidth) * 2 - 1;
      const ny = (e.clientY / window.innerHeight) * 2 - 1;
      target.current.x = nx;
      target.current.y = ny;
    }
    window.addEventListener("pointermove", onMove);
    return () => window.removeEventListener("pointermove", onMove);
  }, []);

  useFrame(() => {
    const g = group.current;
    if (!g) return;
    // Ease toward target.
    g.rotation.y += (target.current.x * 0.35 - g.rotation.y) * 0.06;
    g.rotation.x += (-target.current.y * 0.2 - g.rotation.x) * 0.06;
  });

  return <group ref={group}>{children}</group>;
}

/* -------- Root scene ------------------------------------------------- */

export default function HeroScene() {
  const [inView, setInView] = useState(true);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => setInView(e.isIntersecting));
      },
      { threshold: 0.05 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div ref={wrapRef} className="lp-hero-3d" aria-hidden="true">
      <Canvas
        dpr={[1, 1.6]}
        camera={{ position: [0, 0.6, 6.2], fov: 42 }}
        gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
        frameloop={inView ? "always" : "demand"}
        shadows
      >
        {/* Lights */}
        <ambientLight intensity={0.35} />
        <directionalLight position={[4, 5, 6]} intensity={1.1} color="#ffffff" castShadow />
        <pointLight position={[-4, -2, 3]} intensity={1.4} color="#4fd8a6" />
        <pointLight position={[3.5, 3, -2]} intensity={0.9} color="#e0a96b" />

        <Suspense fallback={null}>
          <ParallaxRig>
            <Float speed={1.2} rotationIntensity={0.35} floatIntensity={0.7} floatingRange={[-0.15, 0.15]}>
              <PaymentCard />
            </Float>
            <CoinSwarm />
          </ParallaxRig>
          <Environment preset="city" />
          <ContactShadows
            position={[0, -1.6, 0]}
            opacity={0.35}
            scale={9}
            blur={2.6}
            far={3}
            color="#000000"
          />
        </Suspense>
      </Canvas>
    </div>
  );
}
