// Monumental holographic globe (DESIGN.md). One elapsed-time controller owns
// camera, picking and effects; per-frame transforms never enter React state.
//
// Data-to-geometry pipeline: countries render as procedural landmasses from
// world children; the selection subtree (states, districts, buildings,
// floors, rooms) renders from live children data. Geometry rebuilds on any
// data change, so late data can never leave a bare sphere with floating
// labels. Verified tile payloads become instanced file buildings; the
// inspected subtree owns the detailed floors and rooms.
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { animate } from "animejs";
import { api } from "../api/http";
import type { EntityDetail } from "../api/types";
import {
  clampRadius,
  easeOutCubic,
  flightKind,
  FLIGHT_DURATION_MS,
  normalize,
  surfaceCameraPose,
  type Vec3,
} from "../scene/cameraMath";
import { levelForDistance, lodForLevel, shouldSwitchLevel, type CameraLevel } from "../scene/lod";
import { orbitRadiusFor, targetRadiusFor } from "../scene/framing";
import {
  buildingSize,
  countryAngularRadius,
  frameForCountry,
  framePoint,
  gridSlot,
  hash01,
  stateAngularRadius,
  subFrame,
  tangentBasis,
  type LocalFrame,
} from "../scene/hierarchy";
import {
  boundaryRadius,
  buildLandGeometry,
  landHeight,
  projectLandPositions,
  seedFromId,
  type CoastSpec,
} from "../scene/geography";
import { placeLabels } from "../scene/labels";
import { useWorld } from "../state/store";
import type { TileHeader } from "../streaming/decode";
import { TileDecoder } from "../streaming/workerClient";
import { buildTileScene } from "./tileScene";
import { TileQueue } from "../streaming/queue";

export interface HistoryDiff {
  added: string[];
  modified: string[];
  removed: string[];
  gen: number;
}

interface GlobeProps {
  snapshotId: string;
  countries: EntityDetail[];
  selection: EntityDetail | null;
  childrenOfSelection: EntityDetail[];
  trail: EntityDetail[];
  diff: HistoryDiff;
  inspectorOpen: boolean;
  onSelect: (entityId: string) => void;
}

interface Flight {
  fromTheta: number;
  fromPhi: number;
  fromRadius: number;
  toTheta: number;
  toPhi: number;
  toRadius: number;
  startedAt: number;
  duration: number;
}

interface LabelSpec {
  id: string;
  text: string;
  pos: Vec3;
  priority: number;
}

interface Placement {
  pos: Vec3;
  quat: THREE.Quaternion;
  footprint: number;
  height: number;
  entityId: string;
  selected: boolean;
  tint: string;
}

const FOV = 50;
const MAX_RADIUS = 4.5;

function anchorOf(country: EntityDetail): Vec3 {
  const xyz = country.bounds?.anchor?.xyz;
  if (xyz && xyz.length === 3) return normalize([xyz[0], xyz[1], xyz[2]]);
  const t = hash01(country.entity_id) * Math.PI * 2;
  return normalize([Math.cos(t), 0.35, Math.sin(t)]);
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Archetype = "tower" | "top" | "block" | "slab" | "spire" | "hall";

function archetypeFor(file: EntityDetail): Archetype {
  const ext = file.path.split(".").pop()?.toLowerCase() ?? "";
  const lines = file.metrics.source_lines ?? 10;
  if (ext === "tsx" || ext === "jsx") return "tower";
  if (ext === "json" || ext === "yaml" || ext === "yml" || ext === "cfg" || lines < 25)
    return "spire";
  if (ext === "md" || ext === "txt" || ext === "rst") return "slab";
  if (lines > 900) return "hall";
  return "block";
}

function tintFor(file: EntityDetail, selected: boolean): string {
  if (selected) return "#55deff";
  const ext = file.path.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "py") return "#4fd6c0";
  if (ext === "tsx" || ext === "jsx") return "#5fb6dd";
  if (ext === "md" || ext === "txt") return "#7d99a8";
  return "#3d6a86";
}

export default function GlobeView({
  snapshotId,
  countries,
  selection,
  childrenOfSelection,
  trail,
  diff,
  inspectorOpen,
  onSelect,
}: GlobeProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const labelLayerRef = useRef<HTMLDivElement>(null);
  const leaderRef = useRef<SVGLineElement>(null);
  const leaderDotRef = useRef<SVGCircleElement>(null);
  const reducedMotion = useWorld((s) => s.reducedMotion);
  const lowDetail = useWorld((s) => s.lowDetail);
  const cameraIntent = useWorld((s) => s.camera);
  const set = useWorld((s) => s.set);
  const stateRef = useRef({
    snapshotId,
    countries,
    selection,
    childrenOfSelection,
    trail,
    diff,
    inspectorOpen,
    onSelect,
    reducedMotion,
    lowDetail,
  });
  const intentRef = useRef(cameraIntent);

  useEffect(() => {
    stateRef.current = {
      snapshotId,
      countries,
      selection,
      childrenOfSelection,
      trail,
      diff,
      inspectorOpen,
      onSelect,
      reducedMotion,
      lowDetail,
    };
  });
  useEffect(() => {
    intentRef.current = cameraIntent;
  }, [cameraIntent]);

  useEffect(() => {
    const mountNode = mountRef.current;
    const labelNode = labelLayerRef.current;
    if (!mountNode || !labelNode) return;
    const mountEl: HTMLDivElement = mountNode;
    const labelEl: HTMLDivElement = labelNode;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: !stateRef.current.lowDetail, alpha: true });
    } catch {
      set({ webglFailed: true });
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, stateRef.current.lowDetail ? 1 : 1.5));
    mountEl.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = null;
    const camera = new THREE.PerspectiveCamera(FOV, 1, 0.05, 100);

    const fail = (event: Event) => {
      event.preventDefault();
      set({ webglFailed: true });
    };
    renderer.domElement.addEventListener("webglcontextlost", fail);

    // Lighting that reveals craftsmanship: key + sky/ground fill + ambient.
    // The terminator stays soft so geography remains readable everywhere.
    const key = new THREE.DirectionalLight("#e2ffff", 2.4);
    key.position.set(3, 4, 5);
    const hemi = new THREE.HemisphereLight("#b5e2ed", "#132b46", 1.5);
    scene.add(key, hemi, new THREE.AmbientLight("#8db3c2", 0.7));

    const detail = stateRef.current.lowDetail ? 40 : 72;
    const globe = new THREE.Mesh(
      new THREE.SphereGeometry(1, detail, Math.round(detail * 0.66)),
      new THREE.MeshStandardMaterial({ color: "#0b2331", roughness: 0.82, metalness: 0.2 }),
    );
    scene.add(globe);
    const grid = new THREE.LineSegments(
      new THREE.WireframeGeometry(new THREE.SphereGeometry(1.002, 64, 36)),
      new THREE.LineBasicMaterial({ color: "#438b9c", transparent: true, opacity: 0.13 }),
    );
    scene.add(grid);
    const rim = new THREE.Mesh(
      new THREE.SphereGeometry(1.035, 64, 48),
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        vertexShader: `varying vec3 n; varying vec3 v;
          void main() { vec4 p = modelViewMatrix * vec4(position, 1.0);
            n = normalize(normalMatrix * normal); v = normalize(-p.xyz);
            gl_Position = projectionMatrix * p; }`,
        fragmentShader: `varying vec3 n; varying vec3 v;
          void main() { float edge = pow(1.0 - max(0.0, dot(normalize(n), normalize(v))), 4.0);
            gl_FragColor = vec4(0.18, 0.76, 0.95, edge * 0.48); }`,
      }),
    );
    scene.add(rim);
    if (!stateRef.current.lowDetail) scene.add(starfield());
    scene.add(orbitalArcs());
    scene.add(graticule());

    // Shared materials (one set per mount; geometries dispose per rebuild).
    const MATS = {
      land: new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.8,
        metalness: 0.2,
        side: THREE.DoubleSide,
      }),
      landSelected: new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.65,
        metalness: 0.3,
        side: THREE.DoubleSide,
        emissive: "#06222e",
        emissiveIntensity: 0.7,
      }),
      landDim: new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.85,
        metalness: 0.15,
        transparent: true,
        opacity: 0.5,
        side: THREE.DoubleSide,
      }),
      border: new THREE.LineBasicMaterial({ color: "#3fa9c9", transparent: true, opacity: 0.85 }),
      borderSelected: new THREE.LineBasicMaterial({
        color: "#55deff",
        transparent: true,
        opacity: 1,
      }),
      tower: new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.5, metalness: 0.45 }),
      block: new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.6, metalness: 0.35 }),
      slab: new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.7, metalness: 0.3 }),
      spire: new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.45, metalness: 0.5 }),
      hall: new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.6, metalness: 0.35 }),
      floor: new THREE.MeshStandardMaterial({
        color: "#1c5a74",
        roughness: 0.5,
        metalness: 0.4,
        transparent: true,
        opacity: 0.92,
      }),
      room: new THREE.MeshStandardMaterial({ color: "#2f7ea3", roughness: 0.5, metalness: 0.4 }),
      pad: new THREE.MeshStandardMaterial({
        color: "#12303f",
        roughness: 0.8,
        metalness: 0.2,
        transparent: true,
        opacity: 0.85,
        side: THREE.DoubleSide,
      }),
      points: new THREE.PointsMaterial({
        color: "#6fd8ef",
        size: 0.011,
        transparent: true,
        opacity: 0.7,
        sizeAttenuation: true,
      }),
    };

    const countryGroup = new THREE.Group();
    const hierGroup = new THREE.Group();
    const fxGroup = new THREE.Group();
    const tileGroup = new THREE.Group();
    scene.add(countryGroup, hierGroup, tileGroup, fxGroup);
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const queue = new TileQueue(stateRef.current.lowDetail ? 2 : 4);
    const decoder = new TileDecoder();
    let detailGeneration = 0;
    queue.onSettled = () => {
      useWorld.getState().set({ pendingTiles: queue.pendingCount() });
    };

    // -- orbit state (never in React state) --------------------------------
    let theta = 0.7;
    let phi = 1.05;
    function overviewRadius(): number {
      const aspect = (mountEl.clientWidth || 1) / (mountEl.clientHeight || 1);
      return orbitRadiusFor(FOV) / Math.min(1, aspect);
    }
    let radius = overviewRadius();
    let flight: Flight | null = null;
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    let downX = 0;
    let downY = 0;
    let needsFrame = true;
    let raf = 0;
    let disposed = false;
    let currentLevel: CameraLevel = "world";
    const labelPool: HTMLDivElement[] = [];
    const labelSpecs: LabelSpec[] = [];
    const posById = new Map<string, { pos: Vec3; normal: Vec3 }>();
    let prevPositions = new Map<string, { pos: Vec3; normal: Vec3 }>();
    let sceneBytes = 0;
    let buildGen = 0;
    let lastDiffGen = -1;
    const childrenCache = new Map<string, EntityDetail[]>();
    let cacheSnapshot = "";
    let emaMs = 16;
    let frameCount = 0;
    let wasFlying = false;
    let lastT = 0;

    const applyFraming = () => {
      const w = mountEl.clientWidth || 1;
      const h = mountEl.clientHeight || 1;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      // The inspector already owns a grid column; don't subtract its width twice.
      camera.clearViewOffset();
      if (!stateRef.current.selection) {
        radius = overviewRadius();
        if (flight) flight.toRadius = radius;
        if (w < h) camera.setViewOffset(w, h, 0, h * 0.08, w, h);
      }
      if (!stateRef.current.selection && w > 1000) camera.setViewOffset(w, h, -w * 0.06, 0, w, h);
      camera.updateProjectionMatrix();
      needsFrame = true;
    };
    applyFraming();
    const resizeObserver = new ResizeObserver(applyFraming);
    resizeObserver.observe(mountEl);
    const visibility = () => {
      if (!document.hidden) needsFrame = true;
    };
    document.addEventListener("visibilitychange", visibility);

    function cameraPosition(): Vec3 {
      return [
        radius * Math.sin(phi) * Math.cos(theta),
        radius * Math.cos(phi),
        radius * Math.sin(phi) * Math.sin(theta),
      ];
    }

    function startFlight(target: Vec3, toRadius: number, duration: number): void {
      if (stateRef.current.reducedMotion) {
        const next = normalize(target);
        theta = Math.atan2(next[2], next[0]);
        phi = Math.acos(Math.min(1, Math.max(-1, next[1])));
        radius = clampRadius(toRadius, 1.08, MAX_RADIUS);
        needsFrame = true;
        return;
      }
      const next = normalize(target);
      let toTheta = Math.atan2(next[2], next[0]);
      while (toTheta - theta > Math.PI) toTheta -= Math.PI * 2;
      while (toTheta - theta < -Math.PI) toTheta += Math.PI * 2;
      flight = {
        fromTheta: theta,
        fromPhi: phi,
        fromRadius: radius,
        toTheta,
        toPhi: Math.acos(Math.min(1, Math.max(-1, next[1]))),
        toRadius: clampRadius(toRadius, 1.08, MAX_RADIUS),
        startedAt: performance.now(),
        duration: Math.min(duration, 1100),
      };
      needsFrame = true;
    }

    // -- geometry helpers ----------------------------------------------------
    function disposeGroup(group: THREE.Group): void {
      const shared = new Set<THREE.Material>(Object.values(MATS));
      for (let i = group.children.length - 1; i >= 0; i--) {
        const child = group.children[i];
        group.remove(child);
        child.traverse((object) => {
          const mesh = object as THREE.Mesh;
          mesh.geometry?.dispose();
          const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
          if (Array.isArray(material)) {
            material.forEach((m) => {
              if (!shared.has(m)) m.dispose();
            });
          } else if (material && !shared.has(material)) {
            material.dispose();
          }
        });
      }
    }

    function estimateBytes(object: THREE.Object3D): number {
      let bytes = 0;
      object.traverse((child) => {
        const mesh = child as THREE.Mesh;
        const geometry = mesh.geometry as THREE.BufferGeometry | undefined;
        if (!geometry) return;
        const position = geometry.getAttribute("position");
        const normal = geometry.getAttribute("normal");
        const uv = geometry.getAttribute("uv");
        const color = geometry.getAttribute("color");
        const index = geometry.getIndex();
        if (position) bytes += position.count * position.itemSize * 4;
        if (normal) bytes += normal.count * normal.itemSize * 4;
        if (uv) bytes += uv.count * uv.itemSize * 4;
        if (color) bytes += color.count * color.itemSize * 4;
        if (index) bytes += index.count * (index.array.BYTES_PER_ELEMENT || 2);
        const instanced = mesh as THREE.InstancedMesh;
        if (instanced.isInstancedMesh) bytes += instanced.count * 16 * 4;
      });
      return bytes;
    }

    function track<T extends THREE.Object3D>(
      parent: THREE.Group,
      object: T,
      entityId?: string,
      pos?: { pos: Vec3; normal: Vec3 },
    ): T {
      if (entityId) {
        object.userData.entityId = entityId;
        if (pos) posById.set(entityId, pos);
      }
      parent.add(object);
      sceneBytes += estimateBytes(object);
      return object;
    }

    function projectToGlobe(
      local: number[],
      frame: LocalFrame,
      anchor: Vec3,
      spec: CoastSpec,
      maxElev: number,
    ): number[] {
      // Local fan coords are tangent-plane offsets; project onto the sphere
      // so edges hug the planet instead of hovering in space.
      void anchor;
      void spec;
      // Directory overlays sit above parent terrain; mainland uses its exact
      // sampled height. Elevation is no longer discarded during projection.
      return projectLandPositions(local, frame, maxElev < 0.006 ? 0.009 : 0);
    }

    function buildLandMesh(
      spec: CoastSpec,
      anchor: Vec3,
      frame: LocalFrame,
      selected: boolean,
      dim: boolean,
      entityId: string,
      maxElev = 0.006,
    ): THREE.Group {
      const group = new THREE.Group();
      const geo = buildLandGeometry(spec, stateRef.current.lowDetail ? 40 : 72, maxElev);
      const positions = projectToGlobe(geo.positions, frame, anchor, spec, maxElev);
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      geometry.setAttribute("color", new THREE.Float32BufferAttribute(geo.colors, 3));
      geometry.setIndex(geo.indices);
      geometry.computeVertexNormals();
      const mesh = new THREE.Mesh(
        geometry,
        selected ? MATS.landSelected : dim ? MATS.landDim : MATS.land,
      );
      mesh.userData.entityId = entityId;
      group.add(mesh);
      if (!stateRef.current.lowDetail) {
        const survey = new THREE.LineSegments(
          new THREE.WireframeGeometry(geometry),
          new THREE.LineBasicMaterial({
            color: "#8cddd4",
            transparent: true,
            opacity: selected ? 0.085 : 0.035,
            depthWrite: false,
          }),
        );
        survey.scale.setScalar(1.0005);
        survey.userData.surveyOpacity = selected ? 0.085 : 0.035;
        group.add(survey);
      }
      const rimWorld = projectToGlobe(geo.rim, frame, anchor, spec, maxElev + 0.0012);
      const rimPoints: THREE.Vector3[] = [];
      for (let i = 0; i < rimWorld.length; i += 3) {
        rimPoints.push(new THREE.Vector3(rimWorld[i], rimWorld[i + 1], rimWorld[i + 2]));
      }
      group.add(
        new THREE.LineLoop(
          new THREE.BufferGeometry().setFromPoints(rimPoints),
          selected ? MATS.borderSelected : MATS.border,
        ),
      );
      return group;
    }

    function selectionRing(
      position: Vec3,
      normal: Vec3,
      size: number,
      color = "#55deff",
    ): THREE.Mesh {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(size, size + 0.012, 48),
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.95,
          side: THREE.DoubleSide,
        }),
      );
      ring.position.set(position[0], position[1], position[2]);
      ring.lookAt(normal[0] * 2, normal[1] * 2, normal[2] * 2);
      return ring;
    }

    function flashRing(
      position: Vec3,
      normal: Vec3,
      size: number,
      color: string,
      duration = 900,
    ): void {
      if (stateRef.current.reducedMotion) return;
      const ring = selectionRing(position, normal, size, color);
      const material = ring.material as THREE.MeshBasicMaterial;
      fxGroup.add(ring);
      animate(material, {
        opacity: [0.95, 0],
        duration,
        ease: "outCubic",
        onUpdate: () => {
          needsFrame = true;
        },
        onComplete: () => {
          fxGroup.remove(ring);
          ring.geometry.dispose();
          material.dispose();
        },
      });
      const start = Math.max(0.01, size * 0.6);
      ring.scale.setScalar(0.6);
      animate(ring.scale, {
        x: size / start,
        y: size / start,
        z: 1,
        duration,
        ease: "outCubic",
        onUpdate: () => {
          needsFrame = true;
        },
      });
      needsFrame = true;
    }

    function ghostBox(position: Vec3, normal: Vec3, color = "#ff8999"): void {
      if (stateRef.current.reducedMotion) return;
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.BoxGeometry(0.05, 0.05, 0.05)),
        new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 }),
      );
      edges.position.set(position[0], position[1], position[2]);
      edges.lookAt(normal[0] * 2, normal[1] * 2, normal[2] * 2);
      fxGroup.add(edges);
      const material = edges.material as THREE.LineBasicMaterial;
      animate(material, {
        opacity: 0,
        duration: 1400,
        ease: "outCubic",
        onUpdate: () => {
          needsFrame = true;
        },
        onComplete: () => {
          fxGroup.remove(edges);
          edges.geometry.dispose();
          material.dispose();
        },
      });
      needsFrame = true;
    }

    // -- hierarchy rebuild (driven by entity data, not camera) ---------------
    async function fetchChildren(
      entityId: string,
      snapshot: string,
      gen: number,
    ): Promise<EntityDetail[]> {
      const cached = cacheSnapshot === snapshot ? childrenCache.get(entityId) : undefined;
      if (cached) return cached;
      const items = await api.childrenAll(snapshot, entityId, 1000);
      if (gen !== buildGen || snapshot !== stateRef.current.snapshotId) return [];
      if (cacheSnapshot !== snapshot) {
        cacheSnapshot = snapshot;
        childrenCache.clear();
      }
      childrenCache.set(entityId, items);
      return items;
    }

    function pushLabel(id: string, text: string, pos: Vec3, priority: number): void {
      labelSpecs.push({ id, text, pos, priority });
    }

    async function rebuildAll(): Promise<void> {
      const gen = ++buildGen;
      detailGeneration++;
      queue.cancelAll();
      const state = stateRef.current;
      const snapshot = state.snapshotId;
      prevPositions = new Map(posById);
      posById.clear();
      disposeGroup(countryGroup);
      disposeGroup(hierGroup);
      disposeGroup(tileGroup);
      useWorld.getState().set({ decodedBytes: 0 });
      labelSpecs.length = 0;
      sceneBytes = 0;
      if (state.countries.length === 0) {
        reportStats();
        return;
      }
      const countryFrames = new Map<
        string,
        { frame: LocalFrame; anchor: Vec3; spec: CoastSpec; entity: EntityDetail }
      >();
      const selectedId = state.selection?.entity_id ?? null;
      const trailIds = new Set(state.trail.map((t) => t.entity_id));
      for (const country of state.countries) {
        const anchor = anchorOf(country);
        const spec: CoastSpec = {
          seed: seedFromId(`${country.entity_id}:country`),
          baseRadius: countryAngularRadius(country.metrics.source_bytes),
        };
        const frame = frameForCountry(anchor, spec.baseRadius);
        countryFrames.set(country.entity_id, { frame, anchor, spec, entity: country });
        const active = country.entity_id === selectedId || trailIds.has(country.entity_id);
        const group = buildLandMesh(spec, anchor, frame, active, false, country.entity_id);
        track(countryGroup, group);
        posById.set(country.entity_id, {
          pos: [anchor[0] * 1.05, anchor[1] * 1.05, anchor[2] * 1.05],
          normal: anchor,
        });
        pushLabel(
          country.entity_id,
          country.name,
          [anchor[0] * 1.09, anchor[1] * 1.09, anchor[2] * 1.09],
          active ? 0 : 10,
        );
        if (!stateRef.current.lowDetail) buildSettlements(country, anchor, spec, frame);
      }
      // Brief selection reticle on the selected country boundary.
      const selCountry = selectedId
        ? state.countries.find((c) => c.entity_id === selectedId)
        : undefined;
      if (selCountry) {
        const anchor = anchorOf(selCountry);
        track(
          hierGroup,
          selectionRing(
            [anchor[0] * 1.012, anchor[1] * 1.012, anchor[2] * 1.012],
            anchor,
            countryAngularRadius(selCountry.metrics.source_bytes) * 1.12,
          ),
        );
      }
      const selection = state.selection;
      if (selection) {
        await buildSubtree(selection, countryFrames, snapshot, gen);
      }
      if (gen !== buildGen) return;
      applyHistoryDiff(state.diff);
      prevPositions = new Map(posById);
      reportStats();
      revealHierarchy();
      needsFrame = true;
      if (selection) {
        // Selected-country previews may show a bounded coarse city; complete
        // symbol detail still waits until the user inspects a building.
        void loadDetail(
          selection.kind === "repository" ? "district" : levelForDistance(radius),
          selection,
          snapshot,
          useWorld.getState().timeline.sequence,
        );
      }
    }

    function buildSettlements(
      country: EntityDetail,
      anchor: Vec3,
      spec: CoastSpec,
      frame: LocalFrame,
    ): void {
      // Aggregated settlement glimpse: dot density scales with region size.
      // Decorative (labeled in legend), never individual entities.
      const count = Math.min(90, Math.max(18, Math.round(spec.baseRadius * 130)));
      const rng = mulberry32(spec.seed ^ 0x7f4a7c15);
      const positions = new Float32Array(count * 3);
      let placed = 0;
      let guard = 0;
      while (placed < count && guard++ < count * 12) {
        const theta = rng() * Math.PI * 2;
        const rr = Math.sqrt(rng()) * spec.baseRadius * 0.9;
        if (rr > boundaryRadius(spec, theta) * 0.92) continue;
        const dir = normalize([
          frame.normal[0] + frame.u[0] * rr * Math.cos(theta) + frame.v[0] * rr * Math.sin(theta),
          frame.normal[1] + frame.u[1] * rr * Math.cos(theta) + frame.v[1] * rr * Math.sin(theta),
          frame.normal[2] + frame.u[2] * rr * Math.cos(theta) + frame.v[2] * rr * Math.sin(theta),
        ]);
        const h = landHeight(spec, anchor, dir, 0.006) + 0.004;
        positions[placed * 3] = dir[0] * (1 + h);
        positions[placed * 3 + 1] = dir[1] * (1 + h);
        positions[placed * 3 + 2] = dir[2] * (1 + h);
        placed++;
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      const points = new THREE.Points(geometry, MATS.points);
      countryGroup.add(points);
      sceneBytes += estimateBytes(points);
      void country;
    }

    function reportStats(): void {
      let objects = 0;
      countryGroup.traverse((o) => {
        if ((o as THREE.Mesh).isMesh || (o as THREE.Line).isLine || (o as THREE.Points).isPoints)
          objects++;
      });
      hierGroup.traverse((o) => {
        if ((o as THREE.Mesh).isMesh || (o as THREE.Line).isLine || (o as THREE.Points).isPoints)
          objects++;
      });
      tileGroup.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) objects++;
      });
      sceneBytes =
        estimateBytes(countryGroup) + estimateBytes(hierGroup) + estimateBytes(tileGroup);
      useWorld.getState().set({ sceneObjects: objects, sceneBytes });
    }

    function revealHierarchy(): void {
      if (stateRef.current.reducedMotion || hierGroup.children.length === 0) return;
      hierGroup.scale.setScalar(0.94);
      animate(hierGroup.scale, {
        x: 1,
        y: 1,
        z: 1,
        duration: 380,
        ease: "outCubic",
        onUpdate: () => {
          needsFrame = true;
        },
      });
      needsFrame = true;
    }

    function applyHistoryDiff(diff: HistoryDiff): void {
      if (diff.gen === lastDiffGen) return;
      lastDiffGen = diff.gen;
      for (const id of diff.modified) {
        const found = posById.get(id);
        if (found) flashRing(found.pos, found.normal, 0.045, "#ffc16a");
      }
      for (const id of diff.added) {
        const found = posById.get(id);
        if (found) flashRing(found.pos, found.normal, 0.045, "#84e2b8");
      }
      for (const id of diff.removed) {
        const found = prevPositions.get(id);
        if (found) ghostBox(found.pos, found.normal);
      }
    }

    function siblingSlot(
      siblings: EntityDetail[],
      entityId: string,
    ): { index: number; total: number } {
      const index = siblings.findIndex((s) => s.entity_id === entityId);
      return { index: Math.max(0, index), total: Math.max(1, siblings.length) };
    }

    interface ChainCtx {
      country: EntityDetail;
      anchor: Vec3;
      spec: CoastSpec;
      frame: LocalFrame;
    }

    async function buildSubtree(
      selection: EntityDetail,
      countryFrames: Map<
        string,
        { frame: LocalFrame; anchor: Vec3; spec: CoastSpec; entity: EntityDetail }
      >,
      snapshot: string,
      gen: number,
    ): Promise<void> {
      const state = stateRef.current;
      const chain = state.trail.some((node) => node.entity_id === selection.entity_id)
        ? state.trail
        : [...state.trail, selection];
      const countryNode = chain.find((n) => n.kind === "repository") ?? null;
      const countryId = countryNode?.entity_id ?? selection.repository_id ?? null;
      const ctx = (countryId && countryFrames.get(countryId)) || null;
      if (!ctx) return;
      let frame = ctx.frame;
      // Descend through directory ancestors, computing nested frames.
      const dirChain = chain.filter((n) => n.kind === "directory");
      for (const dir of dirChain) {
        const parentId = dir.parent_entity_id;
        const siblings = parentId ? await fetchChildren(parentId, snapshot, gen) : state.countries;
        if (gen !== buildGen) return;
        const slot = siblingSlot(siblings, dir.entity_id);
        const extent = stateAngularRadius(ctx.spec.baseRadius, slot.total);
        frame = subFrame(frame, slot.index, slot.total, extent);
        posById.set(dir.entity_id, { pos: framePoint(frame, 0, 0, 0.01), normal: frame.normal });
        if (dir.entity_id !== selection.entity_id) {
          // Ancestor context: dim sub-region for the descended path.
          const ghost = buildLandMesh(
            { seed: seedFromId(`${dir.entity_id}:district`), baseRadius: extent },
            frame.normal,
            frame,
            false,
            true,
            dir.entity_id,
            0.002,
          );
          track(hierGroup, ghost);
        } else {
          const center = framePoint(frame, 0, 0, 0.006);
          track(hierGroup, selectionRing(center, frame.normal, Math.max(0.03, extent * 0.5)));
          pushLabel(dir.entity_id, dir.name, framePoint(frame, 0, 0, 0.05), 1);
        }
      }
      if (gen !== buildGen) return;
      const nodeCtx: ChainCtx = { country: ctx.entity, anchor: ctx.anchor, spec: ctx.spec, frame };
      await renderSelectionNode(selection, nodeCtx, snapshot, gen);
      if (gen !== buildGen) return;
      const kids =
        state.childrenOfSelection.length > 0 || selection.child_count === 0
          ? state.childrenOfSelection
          : await fetchChildren(selection.entity_id, snapshot, gen);
      if (gen !== buildGen) return;
      await renderChildren(selection, kids, nodeCtx, snapshot, gen);
    }

    /** World position of a chain node (chain frames recomputed cheaply). */
    async function nodeWorldPosition(
      node: EntityDetail,
      ctx: ChainCtx,
      snapshot: string,
      gen: number,
    ): Promise<{ pos: Vec3; normal: Vec3 }> {
      const state = stateRef.current;
      if (node.kind === "repository") {
        const anchor = anchorOf(
          state.countries.find((c) => c.entity_id === node.entity_id) ?? ctx.country,
        );
        return { pos: [anchor[0] * 1.05, anchor[1] * 1.05, anchor[2] * 1.05], normal: anchor };
      }
      if (node.kind === "directory") {
        const found = posById.get(node.entity_id);
        if (found) return found;
        return { pos: framePoint(ctx.frame, 0, 0, 0.01), normal: ctx.frame.normal };
      }
      // Files/symbols: slot within the parent frame.
      const parentId = node.parent_entity_id;
      const siblings = parentId ? await fetchChildren(parentId, snapshot, gen) : [];
      const slot = siblingSlot(siblings, node.entity_id);
      const [ox, oy] = gridSlot(slot.index, slot.total, ctx.frame.extent * 0.6);
      const dir = normalize([
        ctx.frame.normal[0] + ctx.frame.u[0] * ox + ctx.frame.v[0] * oy,
        ctx.frame.normal[1] + ctx.frame.u[1] * ox + ctx.frame.v[1] * oy,
        ctx.frame.normal[2] + ctx.frame.u[2] * ox + ctx.frame.v[2] * oy,
      ]);
      const h = Math.max(0.028, landHeight(ctx.spec, ctx.anchor, dir, 0.014) + 0.012);
      const pos: Vec3 = [dir[0] * (1 + h), dir[1] * (1 + h), dir[2] * (1 + h)];
      return { pos, normal: dir };
    }

    async function renderSelectionNode(
      selection: EntityDetail,
      ctx: ChainCtx,
      snapshot: string,
      gen: number,
    ): Promise<void> {
      const at = await nodeWorldPosition(selection, ctx, snapshot, gen);
      if (gen !== buildGen) return;
      posById.set(selection.entity_id, at);
      if (selection.kind === "file") {
        const size = buildingSize(selection.metrics);
        const box = new THREE.Mesh(
          new THREE.BoxGeometry(size.w * 2, size.h, size.d * 2),
          MATS.block,
        );
        const selected = new THREE.Mesh(
          new THREE.BoxGeometry(size.w * 2 + 0.006, size.h + 0.006, size.d * 2 + 0.006),
          new THREE.MeshBasicMaterial({
            color: "#55deff",
            wireframe: true,
            transparent: true,
            opacity: 0.9,
          }),
        );
        selected.position.set(
          at.pos[0] + at.normal[0] * (size.h / 2),
          at.pos[1] + at.normal[1] * (size.h / 2),
          at.pos[2] + at.normal[2] * (size.h / 2),
        );
        selected.quaternion.setFromUnitVectors(
          new THREE.Vector3(0, 1, 0),
          new THREE.Vector3(...at.normal),
        );
        box.position.copy(selected.position);
        box.quaternion.copy(selected.quaternion);
        box.userData.entityId = selection.entity_id;
        track(hierGroup, box);
        track(hierGroup, selected);
        pushLabel(
          selection.entity_id,
          selection.name,
          framePoint(ctx.frame, 0, 0, size.h + 0.05),
          1,
        );
      } else if (
        selection.kind === "class" ||
        selection.kind === "component" ||
        selection.kind === "function"
      ) {
        track(hierGroup, selectionRing(at.pos, at.normal, 0.03));
        pushLabel(selection.entity_id, selection.name, at.pos, 1);
      }
      // Countries/directories already highlighted during the chain walk.
    }

    async function renderChildren(
      selection: EntityDetail,
      kids: EntityDetail[],
      ctx: ChainCtx,
      snapshot: string,
      gen: number,
    ): Promise<void> {
      if (kids.length === 0 || gen !== buildGen) return;
      if (selection.kind === "repository" || selection.kind === "directory") {
        const dirs = kids.filter((k) => k.kind === "directory");
        const files = kids.filter((k) => k.kind === "file");
        dirs.forEach((dir, i) => {
          const extent = stateAngularRadius(ctx.spec.baseRadius, Math.max(1, dirs.length));
          const childFrame = subFrame(ctx.frame, i, Math.max(1, dirs.length), extent);
          const group = buildLandMesh(
            { seed: seedFromId(`${dir.entity_id}:district`), baseRadius: extent },
            childFrame.normal,
            childFrame,
            false,
            false,
            dir.entity_id,
            0.003,
          );
          track(hierGroup, group);
          posById.set(dir.entity_id, {
            pos: framePoint(childFrame, 0, 0, 0.01),
            normal: childFrame.normal,
          });
          pushLabel(dir.entity_id, dir.name, framePoint(childFrame, 0, 0, 0.045), 20);
        });
        buildInstancedFiles(files, ctx, selection.entity_id);
      } else if (selection.kind === "file") {
        const self = await nodeWorldPosition(selection, ctx, snapshot, gen);
        if (gen !== buildGen) return;
        const size = buildingSize(selection.metrics);
        const base: Vec3 = [
          self.pos[0] + self.normal[0] * size.h,
          self.pos[1] + self.normal[1] * size.h,
          self.pos[2] + self.normal[2] * size.h,
        ];
        const floorKinds = new Set(["class", "component"]);
        const floors = kids.filter((k) => floorKinds.has(k.kind));
        const floorIds = new Set(floors.map((f) => f.entity_id));
        const directRooms = kids.filter(
          (k) => k.kind === "function" && !floorIds.has(k.parent_entity_id ?? ""),
        );
        floors.forEach((floor, i) => {
          const lift = 0.012 * (i + 1);
          const center: Vec3 = [
            base[0] + self.normal[0] * lift,
            base[1] + self.normal[1] * lift,
            base[2] + self.normal[2] * lift,
          ];
          const slab = new THREE.Mesh(
            new THREE.BoxGeometry(
              size.w * 1.7 * (1 - i * 0.07),
              0.008,
              size.d * 1.7 * (1 - i * 0.07),
            ),
            MATS.floor,
          );
          slab.position.set(center[0], center[1], center[2]);
          slab.quaternion.setFromUnitVectors(
            new THREE.Vector3(0, 1, 0),
            new THREE.Vector3(...self.normal),
          );
          track(hierGroup, slab, floor.entity_id, { pos: center, normal: self.normal });
          pushLabel(
            floor.entity_id,
            floor.name,
            [
              center[0] + self.normal[0] * 0.02,
              center[1] + self.normal[1] * 0.02,
              center[2] + self.normal[2] * 0.02,
            ],
            40,
          );
        });
        directRooms.forEach((room, i) => {
          const [ox, oy] = gridSlot(i, Math.max(1, directRooms.length), size.w * 1.6);
          const dir = normalize([
            self.normal[0] + ctx.frame.u[0] * ox + ctx.frame.v[0] * oy,
            self.normal[1] + ctx.frame.u[1] * ox + ctx.frame.v[1] * oy,
            self.normal[2] + ctx.frame.u[2] * ox + ctx.frame.v[2] * oy,
          ]);
          const lift = size.h + 0.012 * (floors.length + 1);
          const center: Vec3 = [
            self.pos[0] + dir[0] * lift,
            self.pos[1] + dir[1] * lift,
            self.pos[2] + dir[2] * lift,
          ];
          const marker = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.014, 0.014), MATS.room);
          marker.position.set(center[0], center[1], center[2]);
          track(hierGroup, marker, room.entity_id, { pos: center, normal: dir });
          if (directRooms.length <= 8) pushLabel(room.entity_id, room.name, center, 45);
        });
      } else if (selection.kind === "class" || selection.kind === "component") {
        const self =
          posById.get(selection.entity_id) ??
          (await nodeWorldPosition(selection, ctx, snapshot, gen));
        if (gen !== buildGen) return;
        const rooms = kids.filter((k) => k.kind === "function");
        rooms.forEach((room, i) => {
          const [ox, oy] = gridSlot(i, rooms.length, ctx.frame.extent * 0.4);
          const center = framePoint(ctx.frame, ox, oy, 0.06);
          const marker = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.016, 0.016), MATS.room);
          marker.position.set(center[0], center[1], center[2]);
          track(hierGroup, marker, room.entity_id, { pos: center, normal: self.normal });
          pushLabel(room.entity_id, room.name, center, 45);
        });
      }
      void snapshot;
    }

    // -- instanced architectural vocabulary ------------------------------------
    // One InstancedMesh per archetype: single-digit draw calls for hundreds
    // of buildings. Archetype derives from file type + metrics with caps.
    function buildInstancedFiles(files: EntityDetail[], ctx: ChainCtx, selectedId: string): void {
      if (files.length === 0) return;
      const buckets = new Map<Archetype, Placement[]>();
      files.forEach((file, i) => {
        const [ox, oy] = gridSlot(i, files.length, ctx.frame.extent * 0.62);
        const dir = normalize([
          ctx.frame.normal[0] + ctx.frame.u[0] * ox + ctx.frame.v[0] * oy,
          ctx.frame.normal[1] + ctx.frame.u[1] * ox + ctx.frame.v[1] * oy,
          ctx.frame.normal[2] + ctx.frame.u[2] * ox + ctx.frame.v[2] * oy,
        ]);
        const ground = Math.max(0.028, landHeight(ctx.spec, ctx.anchor, dir, 0.014) + 0.012);
        const pos: Vec3 = [dir[0] * (1 + ground), dir[1] * (1 + ground), dir[2] * (1 + ground)];
        const size = buildingSize(file.metrics);
        const selected = file.entity_id === selectedId;
        const quat = new THREE.Quaternion().setFromUnitVectors(
          new THREE.Vector3(0, 1, 0),
          new THREE.Vector3(...dir),
        );
        const arch = archetypeFor(file);
        const placement: Placement = {
          pos,
          quat,
          footprint: Math.min(size.w * 2, (ctx.frame.extent * 0.85) / Math.sqrt(files.length)),
          height: size.h,
          entityId: file.entity_id,
          selected,
          tint: tintFor(file, selected),
        };
        if (!buckets.get(arch)) buckets.set(arch, []);
        buckets.get(arch)?.push(placement);
        posById.set(file.entity_id, { pos, normal: dir });
        pushLabel(
          file.entity_id,
          file.name,
          [
            pos[0] + dir[0] * (size.h + 0.025),
            pos[1] + dir[1] * (size.h + 0.025),
            pos[2] + dir[2] * (size.h + 0.025),
          ],
          selected ? 1 : 30,
        );
      });
      const geos: Record<Archetype, THREE.BufferGeometry> = {
        tower: new THREE.BoxGeometry(0.55, 1, 0.55).translate(0, 0.5, 0),
        top: new THREE.BoxGeometry(0.36, 0.5, 0.36).translate(0, 0.25, 0),
        block: new THREE.BoxGeometry(0.85, 0.62, 0.85).translate(0, 0.31, 0),
        slab: new THREE.BoxGeometry(1.1, 0.16, 1.1).translate(0, 0.08, 0),
        spire: new THREE.ConeGeometry(0.32, 1, 7).translate(0, 0.5, 0),
        hall: new THREE.BoxGeometry(1.5, 0.42, 1.15).translate(0, 0.21, 0),
      };
      const mats: Record<Archetype, THREE.Material> = {
        tower: MATS.tower,
        top: MATS.tower,
        block: MATS.block,
        slab: MATS.slab,
        spire: MATS.spire,
        hall: MATS.hall,
      };
      const matrix = new THREE.Matrix4();
      const color = new THREE.Color();
      const offset = new THREE.Vector3();
      const up = new THREE.Vector3();
      const emit = (arch: Archetype, list: Placement[], yOffset: (p: Placement) => number) => {
        if (list.length === 0) return;
        const mesh = new THREE.InstancedMesh(geos[arch], mats[arch], list.length);
        list.forEach((p, i) => {
          up.set(0, 1, 0).applyQuaternion(p.quat);
          offset.set(p.pos[0], p.pos[1], p.pos[2]).addScaledVector(up, yOffset(p));
          matrix.compose(offset, p.quat, new THREE.Vector3(p.footprint, p.height, p.footprint));
          mesh.setMatrixAt(i, matrix);
          mesh.setColorAt(i, color.set(p.tint));
        });
        mesh.userData.picks = list.map((p) => p.entityId);
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        hierGroup.add(mesh);
        sceneBytes += estimateBytes(mesh);
      };
      for (const [arch, list] of buckets) {
        // A ground parcel and facade bands add readable architectural scale.
        // They are decoration on one file, never extra floors or entities.
        const pads = new THREE.InstancedMesh(
          new THREE.BoxGeometry(1, 0.002, 1),
          new THREE.MeshBasicMaterial({ color: "#215362", transparent: true, opacity: 0.8 }),
          list.length,
        );
        const bands = new THREE.InstancedMesh(
          new THREE.BoxGeometry(1, 0.0015, 1),
          new THREE.MeshBasicMaterial({ color: "#83dcd8" }),
          list.length * 3,
        );
        const widths = { tower: 0.56, top: 0.37, block: 0.86, slab: 1.11, spire: 0.25, hall: 1.51 };
        const heights = { tower: 1, top: 0.5, block: 0.62, slab: 0.16, spire: 0.7, hall: 0.42 };
        list.forEach((p, i) => {
          up.set(0, 1, 0).applyQuaternion(p.quat);
          offset.set(...p.pos);
          matrix.compose(
            offset,
            p.quat,
            new THREE.Vector3(p.footprint * 1.65, 1, p.footprint * 1.65),
          );
          pads.setMatrixAt(i, matrix);
          for (let band = 0; band < 3; band++) {
            offset.set(...p.pos).addScaledVector(up, (p.height * heights[arch] * (band + 1)) / 4);
            matrix.compose(
              offset,
              p.quat,
              new THREE.Vector3(p.footprint * widths[arch], 1, p.footprint * widths[arch]),
            );
            bands.setMatrixAt(i * 3 + band, matrix);
          }
        });
        pads.userData.picks = list.map((p) => p.entityId);
        bands.userData.picks = list.flatMap((p) => [p.entityId, p.entityId, p.entityId]);
        hierGroup.add(pads, bands);
        if (arch === "tower") {
          emit("tower", list, () => 0);
          emit(
            "top",
            list.map((p) => ({ ...p })),
            (p) => p.height,
          );
        } else {
          emit(arch, list, () => 0);
        }
      }
    }

    // -- verified tile streaming: payload -> worker -> GPU -> picking ----------
    async function loadDetail(
      level: CameraLevel,
      scope: EntityDetail | null,
      snapshot: string,
      sequence: number,
    ): Promise<void> {
      // Country and state views retain a bounded file preview. A camera-band
      // update must not replace that preview with a surface-only L1 tile.
      const requestedLod = lodForLevel(level);
      const lod = scope && requestedLod === "L1" ? "L2" : requestedLod;
      if (lod === "L0" || !scope) return;
      const generation = ++detailGeneration;
      const sceneGeneration = buildGen;
      queue.cancelAll();
      const scopeId = scope?.entity_id;
      const isCurrent = () =>
        !disposed &&
        generation === detailGeneration &&
        sceneGeneration === buildGen &&
        snapshot === stateRef.current.snapshotId &&
        scopeId === stateRef.current.selection?.entity_id &&
        sequence === useWorld.getState().timeline.sequence;
      const key = `${snapshot}:${lod}:${scopeId ?? "world"}`;
      queue.enqueue({
        key,
        priority: scope ? 0 : 1,
        run: async (signal) => {
          useWorld.getState().set({ pendingTiles: queue.pendingCount() });
          const manifest = await api.manifest(snapshot, lod, scopeId);
          if (signal.aborted || !isCurrent() || manifest.snapshot_id !== snapshot) return;
          const nextTiles = new THREE.Group();
          let decodedBytes = 0;
          try {
            for (const tile of manifest.tiles) {
              if (signal.aborted || !isCurrent()) break;
              if (tile.uncompressed_byte_length > 1024 * 1024) throw new Error("Oversize tile");
              const [header, payload] = await Promise.all([
                api.assetBytes(tile.header_asset_id).then((b) => new TextDecoder().decode(b)),
                api.assetBytes(tile.payload_asset_id),
              ]);
              if (signal.aborted || !isCurrent()) break;
              const parsed = JSON.parse(header) as TileHeader;
              if (parsed.snapshot_id !== snapshot || parsed.tile_id !== tile.tile_id)
                throw new Error("Mismatched tile identity");
              const byteLength = payload.byteLength;
              const instances = await decoder.decode(payload, parsed, tile.content_sha256);
              if (signal.aborted || !isCurrent()) break;
              nextTiles.add(buildTileScene(instances, parsed.picks, new Set(posById.keys())));
              decodedBytes += byteLength;
            }
            if (!signal.aborted && isCurrent()) {
              disposeGroup(tileGroup);
              while (nextTiles.children.length) tileGroup.add(nextTiles.children[0]);
              useWorld.getState().set({ decodedBytes });
              renderer.domElement.dataset.streamedBuildings = String(
                tileGroup.children.reduce(
                  (sum, child) => sum + (child.userData.entityIds?.length ?? 0),
                  0,
                ),
              );
              reportStats();
              needsFrame = true;
            }
          } finally {
            disposeGroup(nextTiles);
          }
        },
      });
    }

    // -- picking (raycast first, nearest-screen fallback for tiny targets) ----
    function pick(clientX: number, clientY: number): string | null {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects([globe, countryGroup, hierGroup, tileGroup], true);
      for (const hit of hits) {
        if (hit.object === globe) return null;
        const instanced = hit.object as THREE.InstancedMesh;
        if (typeof hit.instanceId === "number" && Array.isArray(instanced.userData.picks)) {
          return (instanced.userData.picks[hit.instanceId] as string) ?? null;
        }
        let object: THREE.Object3D | null = hit.object;
        while (object) {
          if (object.userData.entityId) return object.userData.entityId as string;
          object = object.parent;
        }
      }
      const vector = new THREE.Vector3();
      let best: string | null = null;
      let bestDist = 28; // px minimum screen-space hit target
      for (const [id, found] of posById) {
        vector.set(found.pos[0], found.pos[1], found.pos[2]).project(camera);
        if (vector.z > 1) continue;
        const sx = ((vector.x + 1) / 2) * rect.width + rect.left;
        const sy = ((-vector.y + 1) / 2) * rect.height + rect.top;
        const dist = Math.hypot(sx - clientX, sy - clientY);
        if (dist < bestDist) {
          bestDist = dist;
          best = id;
        }
      }
      return best;
    }

    renderer.domElement.addEventListener("pointerdown", (event) => {
      flight = null;
      dragging = true;
      lastX = event.clientX;
      lastY = event.clientY;
      downX = event.clientX;
      downY = event.clientY;
      renderer.domElement.setPointerCapture(event.pointerId);
    });
    renderer.domElement.addEventListener("pointermove", (event) => {
      if (!dragging) return;
      theta += (event.clientX - lastX) * 0.005;
      phi = Math.min(Math.PI - 0.15, Math.max(0.15, phi - (event.clientY - lastY) * 0.005));
      lastX = event.clientX;
      lastY = event.clientY;
      needsFrame = true;
    });
    renderer.domElement.addEventListener("pointerup", (event) => {
      dragging = false;
      const moved = Math.hypot(event.clientX - downX, event.clientY - downY);
      if (moved < 4) {
        const hit = pick(event.clientX, event.clientY);
        if (hit) stateRef.current.onSelect(hit);
      }
    });
    renderer.domElement.addEventListener("pointercancel", () => {
      dragging = false;
    });
    renderer.domElement.addEventListener(
      "wheel",
      (event) => {
        event.preventDefault();
        flight = null;
        radius = clampRadius(radius * (1 + Math.sign(event.deltaY) * 0.12), 1.08, MAX_RADIUS);
        needsFrame = true;
      },
      { passive: false },
    );
    renderer.domElement.tabIndex = 0;
    renderer.domElement.setAttribute("role", "application");
    renderer.domElement.setAttribute(
      "aria-label",
      "DevWorld globe. Arrow keys rotate, plus and minus zoom, Enter selects the first country.",
    );
    renderer.domElement.addEventListener("keydown", (event) => {
      const step = 0.12;
      if (event.key === "ArrowLeft") theta -= step;
      else if (event.key === "ArrowRight") theta += step;
      else if (event.key === "ArrowUp") phi = Math.max(0.15, phi - step);
      else if (event.key === "ArrowDown") phi = Math.min(Math.PI - 0.15, phi + step);
      else if (event.key === "+" || event.key === "=")
        radius = clampRadius(radius * 0.9, 1.08, MAX_RADIUS);
      else if (event.key === "-" || event.key === "_")
        radius = clampRadius(radius * 1.1, 1.08, MAX_RADIUS);
      else if (event.key === "Enter") {
        const first = stateRef.current.countries[0];
        if (first) stateRef.current.onSelect(first.entity_id);
        else return;
      } else return;
      event.preventDefault();
      needsFrame = true;
    });

    // -- labels from real mesh positions + selection leader line ---------------
    function updateLabels(): void {
      const state = stateRef.current;
      const cap = state.lowDetail ? 30 : 100;
      const w = mountEl.clientWidth;
      const h = mountEl.clientHeight;
      const vector = new THREE.Vector3();
      const cam = camera.position.toArray();
      const candidates = labelSpecs.map((item) => {
        vector.set(item.pos[0], item.pos[1], item.pos[2]).project(camera);
        const facing = item.pos[0] * cam[0] + item.pos[1] * cam[1] + item.pos[2] * cam[2];
        return {
          id: item.id,
          text: item.text,
          x: ((vector.x + 1) / 2) * w,
          y: ((-vector.y + 1) / 2) * h,
          priority: item.priority,
          behind:
            vector.z > 1 ||
            facing < 1 ||
            (radius < 1.8 &&
              state.countries.some((country) => country.entity_id === item.id) &&
              state.selection?.entity_id !== item.id),
        };
      });
      const placed = placeLabels(candidates, cap);
      const selectedId = state.selection?.entity_id;
      while (labelPool.length < placed.length) {
        const div = document.createElement("div");
        div.className = "dw-label";
        labelEl.appendChild(div);
        labelPool.push(div);
      }
      let leaderDrawn = false;
      placed.forEach((item, i) => {
        const div = labelPool[i];
        div.style.display = "block";
        div.style.left = `${item.x}px`;
        div.style.top = `${item.y}px`;
        if (div.textContent !== item.text) div.textContent = item.text;
        const selected = item.id === selectedId;
        div.classList.toggle("selected", selected);
        if (selected && leaderRef.current && leaderDotRef.current) {
          const anchor = posById.get(item.id);
          if (anchor) {
            vector.set(anchor.pos[0], anchor.pos[1], anchor.pos[2]).project(camera);
            const ax = ((vector.x + 1) / 2) * w;
            const ay = ((-vector.y + 1) / 2) * h;
            leaderRef.current.setAttribute("x1", `${ax}`);
            leaderRef.current.setAttribute("y1", `${ay}`);
            leaderRef.current.setAttribute("x2", `${item.x}`);
            leaderRef.current.setAttribute("y2", `${item.y - 12}`);
            leaderRef.current.style.display = "block";
            leaderDotRef.current.setAttribute("cx", `${ax}`);
            leaderDotRef.current.setAttribute("cy", `${ay}`);
            leaderDotRef.current.style.display = "block";
            leaderDrawn = true;
          }
        }
      });
      for (let i = placed.length; i < labelPool.length; i++) labelPool[i].style.display = "none";
      if (!leaderDrawn && leaderRef.current && leaderDotRef.current) {
        leaderRef.current.style.display = "none";
        leaderDotRef.current.style.display = "none";
      }
    }

    // -- main loop (demand rendering + telemetry) -------------------------------
    function frame(now: number): void {
      if (disposed) return;
      raf = requestAnimationFrame(frame);
      const dt = now - (lastT || now);
      lastT = now;
      emaMs = emaMs * 0.95 + Math.min(100, dt) * 0.05;
      let active = false;
      if (flight) {
        const t = Math.min(1, (now - flight.startedAt) / flight.duration);
        theta = flight.fromTheta + (flight.toTheta - flight.fromTheta) * easeOutCubic(t);
        phi = flight.fromPhi + (flight.toPhi - flight.fromPhi) * easeOutCubic(t);
        radius = clampRadius(
          flight.fromRadius + (flight.toRadius - flight.fromRadius) * easeOutCubic(t),
          1.08,
          MAX_RADIUS,
        );
        if (t >= 1) {
          flight = null;
          reportAltitude();
        }
        wasFlying = true;
        active = true;
      } else if (wasFlying) {
        wasFlying = false;
        reportAltitude();
      }
      if (dragging) active = true;
      // Amber history sweep: owned here; flash/ghost effects self-dispose.
      for (let i = fxGroup.children.length - 1; i >= 0; i--) {
        const child = fxGroup.children[i] as THREE.Mesh;
        if (child.userData.ring !== true) continue;
        const age = now - (child.userData.born as number);
        const material = child.material as THREE.MeshBasicMaterial;
        material.opacity = Math.max(0, 0.7 * (1 - age / 600));
        const s = 1 + age / 900;
        child.scale.set(s, s, s);
        if (age > 700) {
          fxGroup.remove(child);
          child.geometry.dispose();
          material.dispose();
        }
        active = true;
      }
      if (!needsFrame && !active) return;
      needsFrame = false;
      const radial = cameraPosition();
      const pose = surfaceCameraPose(
        radial,
        tangentBasis(normalize(radial)).v,
        Boolean(stateRef.current.selection),
      );
      const surfaceBlend = stateRef.current.selection
        ? Math.min(1, Math.max(0, (2.15 - radius) / 0.8))
        : 0;
      camera.up
        .set(0, 1, 0)
        .lerp(new THREE.Vector3(...normalize(radial)), surfaceBlend)
        .normalize();
      camera.position.set(...pose.position);
      camera.lookAt(...pose.target);
      const groundTint = 1 - surfaceBlend * 0.5;
      MATS.land.color.setScalar(groundTint);
      MATS.landSelected.color.setScalar(groundTint);
      MATS.landDim.color.setScalar(groundTint);
      for (const group of [countryGroup, hierGroup]) {
        group.traverse((object) => {
          if (typeof object.userData.surveyOpacity === "number") {
            ((object as THREE.LineSegments).material as THREE.LineBasicMaterial).opacity =
              object.userData.surveyOpacity * (1 - surfaceBlend * 0.9);
          }
        });
      }
      const level = stateRef.current.selection ? levelForDistance(radius) : "world";
      if (shouldSwitchLevel(currentLevel, level, radius)) {
        currentLevel = level;
        const state = stateRef.current;
        reportAltitude(level);
        void loadDetail(
          level,
          state.selection,
          state.snapshotId,
          useWorld.getState().timeline.sequence,
        );
      }
      renderer.render(scene, camera);
      renderer.domElement.dataset.terrainTriangles = String(
        countryGroup.children.reduce((count, group) => {
          group.traverse((object) => {
            if ((object as THREE.Mesh).isMesh)
              count += ((object as THREE.Mesh).geometry.index?.count ?? 0) / 3;
          });
          return count;
        }, 0),
      );
      updateLabels();
      frameCount++;
      if (frameCount % 90 === 0) {
        const info = renderer.info.render;
        useWorld.getState().set({
          perf: {
            fps: Math.round(1000 / Math.max(1, emaMs)),
            ms: Math.round(emaMs * 10) / 10,
            calls: info.calls,
            tris: info.triangles,
          },
        });
      }
    }

    function reportAltitude(level?: CameraLevel): void {
      const lod = lodForLevel(level ?? levelForDistance(radius));
      useWorld.getState().set({ altitude: `ALT ${radius.toFixed(2)} · ${lod}` });
    }

    raf = requestAnimationFrame(frame);

    // -- rebuild triggers: any data change rebuilds geometry --------------------
    let lastCountriesKey = "";
    let lastSelectionId: string | null = null;
    let lastSnapshot = "";
    let lastChildrenKey = "";
    let lastTrailKey = "";
    let lastFlightId = intentRef.current.flightId;
    let lastInspector = stateRef.current.inspectorOpen;
    let lastLowDetail = stateRef.current.lowDetail;
    let lastSweptSnapshot = stateRef.current.snapshotId;
    const keyOf = (list: EntityDetail[]) => list.map((e) => e.entity_id).join(",");
    const intentTimer = window.setInterval(() => {
      if (disposed) return;
      const intent = intentRef.current;
      const state = stateRef.current;
      if (state.inspectorOpen !== lastInspector) {
        lastInspector = state.inspectorOpen;
        applyFraming();
      }
      const countriesKey = `${state.snapshotId}|${keyOf(state.countries)}`;
      const selectionId = state.selection?.entity_id ?? null;
      const childrenKey = keyOf(state.childrenOfSelection);
      const trailKey = keyOf(state.trail);
      if (
        state.snapshotId !== lastSnapshot ||
        countriesKey !== lastCountriesKey ||
        selectionId !== lastSelectionId ||
        childrenKey !== lastChildrenKey ||
        trailKey !== lastTrailKey ||
        state.diff.gen !== lastDiffGen ||
        state.lowDetail !== lastLowDetail
      ) {
        lastSnapshot = state.snapshotId;
        lastCountriesKey = countriesKey;
        lastSelectionId = selectionId;
        lastChildrenKey = childrenKey;
        lastTrailKey = trailKey;
        lastDiffGen = state.diff.gen;
        lastLowDetail = state.lowDetail;
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, state.lowDetail ? 1 : 1.5));
        if (state.snapshotId !== lastSweptSnapshot) {
          lastSweptSnapshot = state.snapshotId;
          amberSweep();
        }
        void rebuildAll();
      }
      if (intent.flightId !== lastFlightId) {
        // Selection geometry is asynchronous. Wait for its exact position
        // rather than flying to the host country and never correcting it.
        if (intent.targetEntityId && !posById.has(intent.targetEntityId)) return;
        lastFlightId = intent.flightId;
        const target = intent.targetEntityId;
        if (target === null) {
          startFlight([0.4, 0.5, 0.75], overviewRadius(), FLIGHT_DURATION_MS["distant-jump"]);
        } else {
          const anchor = anchorForEntity(target, state);
          const kind = flightKind(radius, 1.6);
          const entity =
            [...state.countries, ...state.childrenOfSelection].find(
              (e) => e.entity_id === target,
            ) ?? state.selection;
          startFlight(
            anchor,
            targetRadiusFor(entity?.semantic_level, mountEl.clientHeight),
            FLIGHT_DURATION_MS[kind] ?? 650,
          );
        }
      }
    }, 60);

    function amberSweep(): void {
      if (stateRef.current.reducedMotion) return;
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(1.25, 0.008, 8, 128),
        new THREE.MeshBasicMaterial({ color: "#ffc16a", transparent: true, opacity: 0.7 }),
      );
      ring.rotation.x = Math.PI / 2;
      ring.userData.born = performance.now();
      ring.userData.amber = true;
      ring.userData.ring = true;
      fxGroup.add(ring);
      needsFrame = true;
    }

    function anchorForEntity(target: string, state: typeof stateRef.current): Vec3 {
      const country = state.countries.find((c) => c.entity_id === target);
      if (country) return anchorOf(country);
      const known = posById.get(target);
      if (known) return normalize(known.pos);
      if (state.countries.length > 0) {
        const host =
          state.trail.find((t) => t.kind === "repository") ??
          state.countries.find((c) => c.entity_id === state.selection?.repository_id) ??
          state.countries[0];
        return anchorOf(host);
      }
      return [0.4, 0.5, 0.75];
    }

    void rebuildAll();
    reportAltitude();
    useWorld.getState().announce("Globe ready. Use the atlas tree for full keyboard navigation.");

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      window.clearInterval(intentTimer);
      resizeObserver.disconnect();
      document.removeEventListener("visibilitychange", visibility);
      renderer.domElement.removeEventListener("webglcontextlost", fail);
      queue.cancelAll();
      decoder.dispose();
      camera.clearViewOffset();
      Object.values(MATS).forEach((m) => (m as THREE.Material).dispose());
      scene.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
      });
      renderer.dispose();
      mountEl.removeChild(renderer.domElement);
      labelEl.replaceChildren();
      labelPool.length = 0;
    };
    // Mount once; live data flows through stateRef/intent polling.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="dw-scene-wrap">
      <div className="dw-view-caption">
        {selection ? `${selection.semantic_level.toUpperCase()} VIEW` : "ORBITAL VIEW"}
        <strong>{selection?.name ?? "Demo World / spherical atlas"}</strong>
      </div>
      <div className="dw-navigation-hint">
        Drag to orbit <span aria-hidden="true">·</span> Scroll to zoom{" "}
        <span aria-hidden="true">·</span> Select to descend
      </div>
      <div ref={mountRef} style={{ position: "absolute", inset: 0 }} />
      <div
        ref={labelLayerRef}
        style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
        aria-hidden="true"
      />
      <svg
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          pointerEvents: "none",
        }}
        aria-hidden="true"
      >
        <line
          ref={leaderRef}
          stroke="#55deff"
          strokeOpacity="0.6"
          strokeWidth="1"
          style={{ display: "none" }}
        />
        <circle ref={leaderDotRef} r="2.5" fill="#55deff" style={{ display: "none" }} />
      </svg>
      <div className="dw-legend" aria-label="Map legend">
        <span>
          <i className="sw country" />
          Country · repository
        </span>
        <span>
          <i className="sw state" />
          State · top-level folder
        </span>
        <span>
          <i className="sw building" />
          Building · file
        </span>
        <span>
          <i className="sw floor" />
          Floor · class / room · function
        </span>
        <span>
          <i className="sw added" />
          Added
        </span>
        <span>
          <i className="sw modified" />
          Modified
        </span>
        <span className="dw-faint">
          Area encodes size; coastline relief is procedural dressing.
        </span>
      </div>
      {countries.length === 0 && (
        <p className="dw-muted" style={{ position: "absolute", left: 16, bottom: 12, margin: 0 }}>
          No countries in this snapshot.
        </p>
      )}
    </div>
  );
}

function starfield(): THREE.Points {
  const count = 400;
  const random = mulberry32(20260618);
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const r = 20 + random() * 30;
    const t = random() * Math.PI * 2;
    const p = Math.acos(2 * random() - 1);
    positions[i * 3] = r * Math.sin(p) * Math.cos(t);
    positions[i * 3 + 1] = r * Math.cos(p);
    positions[i * 3 + 2] = r * Math.sin(p) * Math.sin(t);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  return new THREE.Points(geometry, new THREE.PointsMaterial({ color: "#9db8c7", size: 0.08 }));
}

function orbitalArcs(): THREE.Group {
  const group = new THREE.Group();
  for (const [radius, tilt, gap] of [
    [1.2, 0.25, 0.3],
    [1.34, -0.35, 1.2],
    [1.4, -0.35, 1.2],
  ]) {
    const orbit = new THREE.Group();
    orbit.rotation.x = tilt;
    orbit.rotation.z = 0.18;
    const points: THREE.Vector3[] = [];
    const ticks: THREE.Vector3[] = [];
    for (let a = gap; a < Math.PI * 2 - 0.35; a += 0.025) {
      points.push(new THREE.Vector3(Math.cos(a) * radius, 0, Math.sin(a) * radius));
    }
    for (let degree = 0; degree < 360; degree += 3) {
      const a = (degree * Math.PI) / 180;
      if (a < gap || a > Math.PI * 2 - 0.35) continue;
      const end = radius + (degree % 15 === 0 ? 0.032 : 0.012);
      ticks.push(
        new THREE.Vector3(Math.cos(a) * radius, 0, Math.sin(a) * radius),
        new THREE.Vector3(Math.cos(a) * end, 0, Math.sin(a) * end),
      );
    }
    const material = new THREE.LineBasicMaterial({
      color: "#549cae",
      transparent: true,
      opacity: 0.48,
    });
    orbit.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), material));
    orbit.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(ticks), material));
    group.add(orbit);
  }
  return group;
}

function graticule(): THREE.Group {
  // Sparse latitude/longitude references, subordinate to geography.
  const group = new THREE.Group();
  const material = new THREE.LineBasicMaterial({
    color: "#1d4256",
    transparent: true,
    opacity: 0.4,
  });
  const circle = (radius: number, tiltX: number, y: number): THREE.LineLoop => {
    const points: THREE.Vector3[] = [];
    for (let a = 0; a < 96; a++) {
      const t = (a / 96) * Math.PI * 2;
      points.push(new THREE.Vector3(Math.cos(t) * radius, y, Math.sin(t) * radius));
    }
    const loop = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(points), material);
    loop.rotation.x = tiltX;
    return loop;
  };
  group.add(circle(1.002, Math.PI / 2, 0)); // equator
  group.add(circle(1.002, 0, 0)); // prime meridian plane
  const offset = Math.sin(Math.PI / 4);
  const yy = Math.cos(Math.PI / 4);
  group.add(circle(offset * 1.002, Math.PI / 2, yy));
  group.add(circle(offset * 1.002, Math.PI / 2, -yy));
  return group;
}
