"use client";

import { useEffect, useRef } from "react";
import type * as ThreeType from "three";

type LightSpeedCanvasProps = {
  active: boolean;
};

export function LightSpeedCanvas({ active }: LightSpeedCanvasProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!active || !mountRef.current) return;
    let cancelled = false;
    let cleanup = () => {};

    async function run() {
      const THREE = (await import("three")) as typeof ThreeType;
      if (cancelled || !mountRef.current) return;

      const container = mountRef.current;
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(58, 1, 0.1, 180);
      camera.position.set(0, 7.5, 18);
      camera.rotation.x = -0.42;

      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setClearColor(0x000000, 0);
      container.appendChild(renderer.domElement);

      const roadGroup = new THREE.Group();
      scene.add(roadGroup);

      const roadGeometry = new THREE.PlaneGeometry(14, 130, 1, 1);
      const roadMaterial = new THREE.MeshBasicMaterial({
        color: 0xdcecff,
        transparent: true,
        opacity: 0.34,
        side: THREE.DoubleSide,
      });
      const road = new THREE.Mesh(roadGeometry, roadMaterial);
      road.rotation.x = -Math.PI / 2;
      road.position.z = -36;
      roadGroup.add(road);

      const lanes: ThreeType.Line[] = [];
      const laneMaterial = new THREE.LineBasicMaterial({
        color: 0x1d6dff,
        transparent: true,
        opacity: 0.7,
      });
      for (const x of [-4.5, -1.5, 1.5, 4.5]) {
        for (let i = 0; i < 10; i += 1) {
          const z = -76 + i * 13;
          const geometry = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(x, 0.05, z),
            new THREE.Vector3(x, 0.05, z + 6),
          ]);
          const line = new THREE.Line(geometry, laneMaterial.clone());
          lanes.push(line);
          roadGroup.add(line);
        }
      }

      const lightMaterials = [
        new THREE.LineBasicMaterial({ color: 0x4cc9ff, transparent: true, opacity: 0.95 }),
        new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.78 }),
        new THREE.LineBasicMaterial({ color: 0x145cff, transparent: true, opacity: 0.82 }),
      ];
      const trails: ThreeType.Line[] = [];
      for (let i = 0; i < 58; i += 1) {
        const side = i % 2 === 0 ? -1 : 1;
        const lane = side * (5.2 + Math.random() * 2.2);
        const z = -96 + Math.random() * 118;
        const height = 0.7 + Math.random() * 2.2;
        const length = 10 + Math.random() * 22;
        const geometry = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(lane, height, z),
          new THREE.Vector3(lane + side * 0.35, height, z + length),
        ]);
        const line = new THREE.Line(geometry, lightMaterials[i % lightMaterials.length].clone());
        line.userData.speed = 0.28 + Math.random() * 0.72;
        trails.push(line);
        roadGroup.add(line);
      }

      const horizonGeometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-10, 3.4, -86),
        new THREE.Vector3(10, 3.4, -86),
      ]);
      const horizon = new THREE.Line(
        horizonGeometry,
        new THREE.LineBasicMaterial({ color: 0x7ed6ff, transparent: true, opacity: 0.5 }),
      );
      roadGroup.add(horizon);

      function resize() {
        const rect = container.getBoundingClientRect();
        const width = Math.max(1, rect.width);
        const height = Math.max(1, rect.height);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        renderer.setSize(width, height, false);
      }

      function animate() {
        for (const line of lanes) {
          line.position.z += 0.54;
          if (line.position.z > 18) line.position.z = -24;
        }
        for (const trail of trails) {
          trail.position.z += trail.userData.speed;
          if (trail.position.z > 30) trail.position.z = -88 - Math.random() * 40;
        }
        horizon.position.y = Math.sin(performance.now() * 0.0012) * 0.12;
        renderer.render(scene, camera);
      }

      resize();
      window.addEventListener("resize", resize);
      renderer.setAnimationLoop(animate);

      cleanup = () => {
        window.removeEventListener("resize", resize);
        renderer.setAnimationLoop(null);
        container.removeChild(renderer.domElement);
        roadGeometry.dispose();
        roadMaterial.dispose();
        laneMaterial.dispose();
        horizonGeometry.dispose();
        for (const material of lightMaterials) material.dispose();
        for (const line of [...lanes, ...trails, horizon]) {
          line.geometry.dispose();
          if (Array.isArray(line.material)) {
            line.material.forEach((material) => material.dispose());
          } else {
            line.material.dispose();
          }
        }
        renderer.dispose();
      };
    }

    void run();
    return () => {
      cancelled = true;
      cleanup();
    };
  }, [active]);

  if (!active) return null;

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-[18px] bg-[radial-gradient(circle_at_50%_20%,rgba(72,151,255,0.28),transparent_42%),linear-gradient(180deg,rgba(239,247,255,0.92),rgba(226,241,255,0.76))]">
      <div className="absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-white/90 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-white/90 to-transparent" />
      <div
        className="absolute inset-0 opacity-70 mix-blend-multiply"
        style={{
          backgroundImage:
            "linear-gradient(116deg, transparent 0%, transparent 22%, rgba(37,99,235,0.22) 23%, transparent 25%, transparent 45%, rgba(56,189,248,0.2) 46%, transparent 48%, transparent 66%, rgba(29,78,216,0.18) 67%, transparent 69%), linear-gradient(62deg, transparent 0%, transparent 54%, rgba(147,197,253,0.24) 55%, transparent 57%)",
        }}
      />
      <div className="absolute inset-x-0 bottom-0 h-[46%] bg-[radial-gradient(ellipse_at_center,rgba(37,99,235,0.18),transparent_64%)]" />
      <div ref={mountRef} className="absolute inset-0 opacity-95" />
      <div className="absolute left-8 top-7 rounded-full border border-blue-200/80 bg-white/72 px-3 py-1.5 text-[12px] font-semibold text-blue-800 shadow-sm backdrop-blur">
        Light Speed processing
      </div>
    </div>
  );
}
