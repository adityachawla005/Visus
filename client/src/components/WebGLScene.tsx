'use client';

import { useRef, useMemo, useEffect } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import { BlendFunction } from 'postprocessing';
import * as THREE from 'three';

// Preload the downloaded 3D human head model
useGLTF.preload('/model.glb');

/* ── 3D Downloaded Human Bust Model ──────────────────────────── */
function HumanBust() {
  const { scene } = useGLTF('/model.glb');

  // Traverse the downloaded model and apply an elegant obsidian wireframe material
  useEffect(() => {
    scene.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.material = new THREE.MeshBasicMaterial({
          color: '#060604',
          wireframe: true,
          transparent: true,
          opacity: 0.16,
        });
      }
    });
  }, [scene]);

  // Position and scale the LeePerrySmith bust centered in our camera space
  return <primitive object={scene} scale={18} position={[0, -11.5, 0]} />;
}

/* ── Augmented Reality Specs sitting on the 3D Face ──────────── */
function CyberSpectacles() {
  const groupRef = useRef<THREE.Group>(null!);
  const leftLensHUD = useRef<THREE.Mesh>(null!);
  const rightLensHUD = useRef<THREE.Mesh>(null!);
  const laserSweep = useRef<THREE.Mesh>(null!);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    // Subtle specs hover animation
    const pulse = 1.0 + Math.sin(t * 1.5) * 0.015;
    groupRef.current.scale.setScalar(pulse * 0.58);

    // Rotate internal circular HUDs in the lenses
    if (leftLensHUD.current) leftLensHUD.current.rotation.z = t * 0.6;
    if (rightLensHUD.current) rightLensHUD.current.rotation.z = -t * 0.6;

    // Laser sweep scan moving horizontally/vertically across spectacles
    if (laserSweep.current) {
      laserSweep.current.position.y = Math.sin(t * 2) * 2 + 1;
    }
  });

  return (
    // Spectacles positioned precisely on the nose/eyes of the downloaded human bust
    <group ref={groupRef} position={[0, 1.45, 3.8]}>
      {/* ── LEFT LENS HUDS ── */}
      <group position={[-4.5, 1, 9.8]}>
        {/* Sleek Lens mesh */}
        <mesh>
          <boxGeometry args={[6.2, 3.4, 0.08]} />
          <meshBasicMaterial color="#060604" transparent opacity={0.06} />
        </mesh>
        {/* Lens border wireframe */}
        <mesh>
          <boxGeometry args={[6.28, 3.48, 0.1]} />
          <meshBasicMaterial color="#060604" wireframe transparent opacity={0.7} />
        </mesh>
        {/* Holographic AR Circular HUD */}
        <mesh ref={leftLensHUD} position={[0, 0, 0.1]}>
          <ringGeometry args={[0.8, 1.1, 30]} />
          <meshBasicMaterial color="#060604" transparent opacity={0.8} side={THREE.DoubleSide} />
        </mesh>
        <mesh position={[0, 0, 0.12]}>
          <ringGeometry args={[0.3, 0.5, 6]} />
          <meshBasicMaterial color="#ff5500" transparent opacity={0.5} side={THREE.DoubleSide} />
        </mesh>
      </group>

      {/* ── RIGHT LENS HUDS ── */}
      <group position={[4.5, 1, 9.8]}>
        {/* Sleek Lens mesh */}
        <mesh>
          <boxGeometry args={[6.2, 3.4, 0.08]} />
          <meshBasicMaterial color="#060604" transparent opacity={0.06} />
        </mesh>
        {/* Lens border wireframe */}
        <mesh>
          <boxGeometry args={[6.28, 3.48, 0.1]} />
          <meshBasicMaterial color="#060604" wireframe transparent opacity={0.7} />
        </mesh>
        {/* Holographic AR Circular HUD */}
        <mesh ref={rightLensHUD} position={[0, 0, 0.1]}>
          <ringGeometry args={[0.8, 1.1, 30]} />
          <meshBasicMaterial color="#060604" transparent opacity={0.8} side={THREE.DoubleSide} />
        </mesh>
        <mesh position={[0, 0, 0.12]}>
          <ringGeometry args={[0.3, 0.5, 6]} />
          <meshBasicMaterial color="#ff5500" transparent opacity={0.5} side={THREE.DoubleSide} />
        </mesh>
      </group>

      {/* ── GLASSES STRUCTURE (Bridge & Temples) ── */}
      {/* Nose bridge connecting bar */}
      <mesh position={[0, 1.4, 9.8]}>
        <boxGeometry args={[2.8, 0.14, 0.14]} />
        <meshBasicMaterial color="#060604" transparent opacity={0.8} />
      </mesh>
      <mesh position={[0, 1.4, 9.9]}>
        <boxGeometry args={[1.2, 0.3, 0.05]} />
        <meshBasicMaterial color="#060604" transparent opacity={0.9} />
      </mesh>

      {/* Left Temple/Arm extending back */}
      <mesh position={[-7.64, 1.1, 4.8]} rotation={[0, 0.12, 0]}>
        <boxGeometry args={[0.08, 0.08, 10]} />
        <meshBasicMaterial color="#060604" transparent opacity={0.5} />
      </mesh>
      
      {/* Right Temple/Arm extending back */}
      <mesh position={[7.64, 1.1, 4.8]} rotation={[0, -0.12, 0]}>
        <boxGeometry args={[0.08, 0.08, 10]} />
        <meshBasicMaterial color="#060604" transparent opacity={0.5} />
      </mesh>

      {/* Dynamic Laser Scanning Line (Sweeping vertically) */}
      <mesh ref={laserSweep} position={[0, 1, 9.92]}>
        <boxGeometry args={[15.2, 0.06, 0.04]} />
        <meshBasicMaterial color="#060604" transparent opacity={0.85} />
      </mesh>
    </group>
  );
}

/* ── Ambient Telemetry Point Cloud Vortex ─────────────────────── */
function TelemetryVortex() {
  const ref = useRef<THREE.Points>(null!);

  const positions = useMemo(() => {
    const N = 1200; // Increased density for a crazier visual impact
    const pos = new Float32Array(N * 3);
    const PHI = Math.PI * (Math.sqrt(5) - 1);
    const R = 32;
    for (let i = 0; i < N; i++) {
      const y = 1 - (i / (N - 1)) * 2;
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      pos[i * 3]     = R * r * Math.cos(PHI * i);
      pos[i * 3 + 1] = R * y;
      pos[i * 3 + 2] = R * r * Math.sin(PHI * i) - 8;
    }
    return pos;
  }, []);

  useFrame(({ clock }) => {
    const elapsed = clock.getElapsedTime();
    ref.current.rotation.y = elapsed * 0.05; // Slightly faster swifter orbit

    const positionAttr = ref.current.geometry.attributes.position as THREE.BufferAttribute;
    const array = positionAttr.array as Float32Array;

    // CRAZY SHOCKWAVE EXPLOSION / COLLAPSE ON LOAD
    if (elapsed < 3.2) {
      const progress = elapsed / 3.2;
      // Expands points out to a massive sphere, then collapses them violently back into the matrix
      const spreadFactor = 1.0 + Math.sin(progress * Math.PI) * 4.5 * (1.0 - progress);
      
      for (let i = 0; i < positions.length; i++) {
        array[i] = positions[i] * spreadFactor;
      }
      positionAttr.needsUpdate = true;
    } else {
      // Settle down to stable, clean orbit
      let needsUpdate = false;
      for (let i = 0; i < positions.length; i++) {
        if (array[i] !== positions[i]) {
          array[i] = positions[i];
          needsUpdate = true;
        }
      }
      if (needsUpdate) positionAttr.needsUpdate = true;
    }
  });

  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    return g;
  }, [positions]);

  return (
    <points ref={ref} geometry={geo}>
      <pointsMaterial color="#060604" size={0.16} sizeAttenuation transparent opacity={0.25} depthWrite={false} toneMapped={false} />
    </points>
  );
}

/* ── Orchestrator ── */
function ModelScene() {
  const outerGroup = useRef<THREE.Group>(null!);

  useFrame(({ clock, mouse }) => {
    const elapsed = clock.getElapsedTime();
    
    // CRAZY ROTATION & ELASTIC SCALE ON LOAD
    if (elapsed < 3.2) {
      const progress = elapsed / 3.2;
      // overshoot scale curve (elastic spring bounce)
      const scaleEase = Math.sin(progress * Math.PI * 0.5) * 1.05 + Math.sin(progress * Math.PI * 2.5) * 0.12;
      outerGroup.current.scale.setScalar(scaleEase);
      
      // Corkscrew triple-axis high-speed rotation settling in parallax
      outerGroup.current.rotation.y = (1.0 - progress) * Math.PI * 6.5 + mouse.x * 0.32;
      outerGroup.current.rotation.x = (1.0 - progress) * Math.PI * 1.5 - mouse.y * 0.26;
      outerGroup.current.rotation.z = (1.0 - progress) * Math.PI * 1.0;
    } else {
      outerGroup.current.scale.setScalar(1.0);
      outerGroup.current.rotation.z = 0;
      outerGroup.current.rotation.y = THREE.MathUtils.lerp(outerGroup.current.rotation.y, mouse.x * 0.32, 0.06);
      outerGroup.current.rotation.x = THREE.MathUtils.lerp(outerGroup.current.rotation.x, -mouse.y * 0.26, 0.06);
    }
  });

  return (
    <group ref={outerGroup} position={[0, -1, 0]}>
      <TelemetryVortex />
      <HumanBust />
      <CyberSpectacles />

      <EffectComposer>
        <Bloom
          luminanceThreshold={0.2}
          intensity={0.8}
          luminanceSmoothing={0.6}
          blendFunction={BlendFunction.ADD}
        />
      </EffectComposer>
    </group>
  );
}

export default function WebGLScene() {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 2, background: 'transparent', pointerEvents: 'none' }}>
      <Canvas
        dpr={[1, 1.5]}
        camera={{ position: [0, 0, 48], fov: 45 }}
        gl={{ antialias: false, alpha: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.0 }}
        onCreated={({ gl, scene }) => {
          gl.setClearColor(0x000000, 0);
          scene.background = null;
        }}
      >
        <ModelScene />
      </Canvas>
    </div>
  );
}
