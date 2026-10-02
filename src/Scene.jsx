import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

function polygon(points) {
  const shape = new THREE.Shape();
  points.forEach(([x, y], i) => i ? shape.lineTo(x, y) : shape.moveTo(x, y));
  shape.closePath();
  return shape;
}
function model(kind) {
  const group = new THREE.Group();
  const copper = new THREE.MeshStandardMaterial({ color: '#c48c69', metalness: 0.8, roughness: 0.28 });
  const navy = new THREE.MeshStandardMaterial({ color: '#233d53', metalness: 0.65, roughness: 0.35 });
  const ice = new THREE.MeshStandardMaterial({ color: '#b7e9f6', emissive: '#5cbed7', emissiveIntensity: 0.7, metalness: 0.4, roughness: 0.2 });
  const box = (x, y, z, w, h, d, material = navy) => { const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material); mesh.position.set(x, y, z); group.add(mesh); return mesh; };
  if (kind === 'brand') {
    const letters = [
      [[0,0],[0.9,0],[0.9,0.35],[0.3,0.35],[0.3,0.7],[0.9,0.7],[0.9,1.65],[0,1.65],[0,1.3],[0.6,1.3],[0.6,1.05],[0,1.05]],
      [[0,1.65],[0.32,1.65],[0.55,0.4],[0.8,1.65],[1.12,1.65],[0.74,0],[0.36,0]],
      [[0,0],[0.95,0],[1.1,0.22],[1.1,0.7],[0.9,0.86],[1.1,1.03],[1.1,1.43],[0.9,1.65],[0,1.65]],
      [[0,1.65],[1.12,1.65],[1.12,1.32],[0.72,1.32],[0.72,0],[0.4,0],[0.4,1.32],[0,1.32]]
    ];
    letters.forEach((points, i) => {
      const shape = polygon(points);
      if (i === 2) { shape.holes.push(polygon([[0.3,0.3],[0.75,0.3],[0.75,0.63],[0.3,0.63]]), polygon([[0.3,1],[0.75,1],[0.75,1.34],[0.3,1.34]])); }
      const mesh = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.38, bevelEnabled: true, bevelSize: 0.045, bevelThickness: 0.045, bevelSegments: 3, steps: 1 }), i === 1 ? ice : copper);
      mesh.position.set(i * 1.25 - 2.4, -0.8, 0);
      group.add(mesh);
    });
    for (let i = 0; i < 3; i++) { const ring = new THREE.Mesh(new THREE.TorusGeometry(3.05 + i * 0.32, 0.012, 8, 120), i === 1 ? ice : navy); ring.rotation.set(1.05 + i * 0.2, i * 0.6, 0.2); group.add(ring); }
    group.rotation.set(0.12, -0.22, -0.08);
  } else {
    box(0, -0.8, 0, 4.8, 0.2, 3.4, copper);
    if (kind === 'data') {
      for (let x = 0; x < 4; x++) for (let z = 0; z < 2; z++) { box(x * 1.05 - 1.6, 0.1, z * 1.4 - 0.65, 0.72, 1.7, 0.85); for (let y = 0; y < 6; y++) { box(x * 1.05 - 1.6, y * 0.22 - 0.45, z * 1.4 - 0.21, 0.55, 0.05, 0.03, ice); } }
    } else if (kind === 'reits') {
      for (let i = 0; i < 5; i++) { const h = 1.2 + (i % 3) * 0.65; const x = (i % 3) * 1.45 - 1.45; const z = Math.floor(i / 3) * 1.5 - 0.65; box(x, h / 2 - 0.7, z, 0.95, h, 0.95); for (let y = 0; y < h * 4; y++) box(x, y * 0.23 - 0.5, z + 0.48, 0.75, 0.08, 0.02, ice); }
    } else if (kind === 'homes') {
      for (let i = 0; i < 4; i++) { const x = (i % 2) * 2.3 - 1.15; const z = Math.floor(i / 2) * 1.6 - 0.8; box(x, -0.2, z, 1.4, 1, 1); const roof = new THREE.Mesh(new THREE.ConeGeometry(1.05, 0.7, 4), copper); roof.rotation.y = Math.PI / 4; roof.position.set(x, 0.65, z); group.add(roof); box(x, -0.2, z + 0.51, 0.3, 0.65, 0.03, ice); }
    } else {
      const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.72, 1), copper); core.position.y = 0.3; group.add(core);
      for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; const p = new THREE.Vector3(Math.cos(a) * 1.8, Math.sin(a * 2) * 0.5 + 0.3, Math.sin(a) * 1.4); const node = new THREE.Mesh(new THREE.IcosahedronGeometry(0.2, 0), ice); node.position.copy(p); group.add(node); const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0.3, 0), p]), new THREE.LineBasicMaterial({ color: '#94cdda' })); group.add(line); }
    }
    group.rotation.y = -0.35;
  }
  return group;
}

export default function Scene({ kind = 'brand', label }) {
  const host = useRef(null);
  const engine = useRef(null);
  const [paused, setPaused] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [failed, setFailed] = useState(false);
  const pauseRef = useRef(paused);
  useEffect(() => { pauseRef.current = paused; engine.current?.sync(); }, [paused]);
  useEffect(() => {
    const container = host.current;
    let renderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' }); } catch { setFailed(true); return; }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    renderer.setClearColor(0x07111e, 0);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.4;
    container.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const object = model(kind); scene.add(object);
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    camera.position.set(kind === 'brand' ? 0.7 : 5, kind === 'brand' ? 2.4 : 4, kind === 'brand' ? 10.8 : 7);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableZoom = false; controls.enablePan = false; controls.enableDamping = false; controls.target.set(0, 0, 0); controls.update();
    scene.add(new THREE.HemisphereLight(0xb8e7ff, 0x172033, 2.8));
    const key = new THREE.DirectionalLight(0xffceaa, 5); key.position.set(2, 5, 5); scene.add(key);
    const rim = new THREE.DirectionalLight(0x8edbff, 4); rim.position.set(-4, 2, -3); scene.add(rim);
    let visible = false, frame = 0, last = 0, phase = 0, dirty = true;
    function draw() { if (visible && !document.hidden) renderer.render(scene, camera); }
    function tick(time) { frame = 0; if (!visible || document.hidden || pauseRef.current) return; if (time - last >= 1000 / 30) { phase += 0.006; object.rotation.y += 0.002; key.position.x = Math.cos(phase) * 5; rim.intensity = 3.5 + Math.sin(phase) * 0.7; draw(); last = time; } frame = requestAnimationFrame(tick); }
    function sync() { cancelAnimationFrame(frame); frame = 0; if (visible && !document.hidden) { if (dirty || pauseRef.current) { draw(); dirty = false; } if (!pauseRef.current) frame = requestAnimationFrame(tick); } }
    engine.current = { sync, orbit: delta => { const offset = camera.position.clone().sub(controls.target); offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), delta); camera.position.copy(offset.add(controls.target)); controls.update(); draw(); } };
    const observer = new IntersectionObserver(entries => { visible = entries[0].isIntersecting; dirty = true; sync(); }); observer.observe(container);
    const resize = new ResizeObserver(() => { const w = container.clientWidth, h = container.clientHeight; if (!w || !h) return; renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); dirty = true; sync(); }); resize.observe(container);
    const media = matchMedia('(prefers-reduced-motion: reduce)'); const change = () => { setPaused(media.matches); }; media.addEventListener('change', change);
    controls.addEventListener('change', draw); document.addEventListener('visibilitychange', sync);
    const loss = e => { e.preventDefault(); pauseRef.current = true; setPaused(true); setFailed(true); cancelAnimationFrame(frame); }; renderer.domElement.addEventListener('webglcontextlost', loss);
    return () => { engine.current = null; cancelAnimationFrame(frame); observer.disconnect(); resize.disconnect(); media.removeEventListener('change', change); document.removeEventListener('visibilitychange', sync); controls.dispose(); scene.traverse(o => { o.geometry?.dispose(); if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose()); }); renderer.dispose(); renderer.domElement.remove(); };
  }, [kind]);
  return <><div ref={host} className="scene-canvas" role="img" aria-label={label} />{failed && <div className="scene-fallback">{kind === 'brand' ? 'SVBT' : kind === 'data' ? 'INFRASTRUCTURE' : kind === 'homes' ? 'BUILD' : kind === 'reits' ? 'REAL ASSETS' : 'SEED'}<span>Spatial view unavailable · {label}</span></div>}<div className="scene-controls">{!failed && <><button aria-label="Orbit model left" onClick={() => engine.current?.orbit(-0.25)}>←</button><button aria-label="Orbit model right" onClick={() => engine.current?.orbit(0.25)}>→</button><button aria-pressed={paused} onClick={() => setPaused(!paused)}>{paused ? 'Play motion' : 'Pause motion'}</button><span>DRAG TO ORBIT</span></>}</div></>;
}
