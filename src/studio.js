import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';

const FT_TO_M = 0.3048;
const IN_TO_M = 0.0254;
const URL_PARAMS = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
const SYNC_ROOM_PARAM = URL_PARAMS.get('syncRoom') === 'verify' ? 'verify' : '';
const DISABLE_CLOUD_SYNC_PARAM = URL_PARAMS.get('nosync') === '1';
const ROOM_KEY_SUFFIX = SYNC_ROOM_PARAM ? `_room_${SYNC_ROOM_PARAM}` : '';
const STORAGE_KEY = `apt_studio_layout_v1${ROOM_KEY_SUFFIX}`;
const SAVED_LAYOUTS_KEY = `apt_studio_saved_layouts_v1${ROOM_KEY_SUFFIX}`;
const LEIF_LIVING_MIGRATED_KEY = `apt_studio_leif_living_v1${ROOM_KEY_SUFFIX}`;
const CLOUD_SYNC_ENABLED_KEY = `apt_studio_cloud_sync_enabled_v1${ROOM_KEY_SUFFIX}`;
const CLOUD_SYNC_BASE_URL = 'https://apartment-studio-sync.vercel.app/api/layout';
const CLIENT_ID = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
  ? crypto.randomUUID()
  : `c_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const SYNC_CHANNEL_NAME = `apt_studio_sync_v1${ROOM_KEY_SUFFIX}`;
const IDB_NAME = 'apt_studio_handles_v1';
const IDB_STORE = 'handles';
const IDB_FILE_KEY = 'syncFile';
const UI_PREFS_KEY = 'apt_studio_ui_prefs_v1';

function loadUiPrefs() {
  const defaults = { showLabels: false, showLeft: true, showRight: true };
  try {
    const raw = localStorage.getItem(UI_PREFS_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw);
    return {
      showLabels: parsed?.showLabels === true,
      showLeft: parsed?.showLeft !== false,
      showRight: parsed?.showRight !== false,
    };
  } catch (_) {
    return defaults;
  }
}

// ---------------------------------------------------------------------------
// Embedded payloads
// ---------------------------------------------------------------------------
const spec = JSON.parse(document.getElementById('embedded-spec').textContent);
const glbBase64 = document.getElementById('embedded-glb').textContent.trim();
const floorplanBase64 = document.getElementById('embedded-floorplan').textContent.trim();

function base64ToArrayBuffer(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

// ---------------------------------------------------------------------------
// Formatting & Unit Helpers
// ---------------------------------------------------------------------------
let unitMode = 'imperial'; // 'imperial' | 'metric'

function fmtFeet(ft) {
  if (unitMode === 'metric') return `${(ft * FT_TO_M).toFixed(2)} m`;
  const sign = ft < 0 ? '-' : '';
  const totalIn = Math.round(Math.abs(ft) * 12);
  const f = Math.floor(totalIn / 12);
  const i = totalIn % 12;
  return `${sign}${f}'-${i}"`;
}

function fmtMeters(m) {
  if (unitMode === 'metric') return m < 1 ? `${Math.round(m * 100)} cm` : `${m.toFixed(2)} m`;
  return fmtFeet(m / FT_TO_M);
}

function fmtInVal(v) {
  return String(Number(Number(v).toFixed(2)));
}

function fmtInchesDims(wIn, dIn, hIn) {
  if (unitMode === 'metric') {
    return `${Math.round(wIn * 2.54)}×${Math.round(dIn * 2.54)}×${Math.round(hIn * 2.54)} cm`;
  }
  return `${fmtInVal(wIn)}"×${fmtInVal(dIn)}"×${fmtInVal(hIn)}"`;
}

// ---------------------------------------------------------------------------
// Furniture Catalog (real-world dimensions in inches)
// ---------------------------------------------------------------------------
const SWATCHES = [
  '#475569', '#64748b', '#8b5e3c', '#a16207', '#1e3a5f',
  '#3f6212', '#7c2d12', '#e2e8f0', '#cbd5e1', '#1e293b',
  '#9c6b3b', '#dfd5c3', '#7a6a5b',
];

const CATALOG = [
  // Living
  { id: 'sofa_3', cat: 'Living', name: '3-Seat Sofa', style: 'sofa', w: 90, d: 38, h: 34, color: '#475569' },
  { id: 'sectional_l', cat: 'Living', name: 'L-Sectional Sofa (Right)', style: 'sectional', w: 114, d: 78, h: 34, color: '#475569' },
  { id: 'sectional_left', cat: 'Living', name: 'L-Sectional Sofa (Left)', style: 'sectional_left', w: 114, d: 78, h: 34, color: '#475569' },
  { id: 'leif_modular_4pc', cat: 'Living', name: 'Leif 4-Piece Curved Sectional w/ Ottoman (Right)', style: 'leif_modular_4pc', w: 124.5, d: 88.75, h: 32.25, color: '#7a6a5b' },
  { id: 'leif_modular_4pc_l', cat: 'Living', name: 'Leif 4-Piece Curved Sectional w/ Ottoman (Left)', style: 'leif_modular_4pc_left', w: 124.5, d: 88.75, h: 32.25, color: '#7a6a5b' },
  { id: 'leif_wedge', cat: 'Living', name: 'Leif Curved Wedge', style: 'leif_wedge', w: 50, d: 50, h: 32.25, color: '#7a6a5b' },
  { id: 'leif_arm_chair_r', cat: 'Living', name: 'Leif Right-Arm Chair', style: 'leif_arm_chair_right', w: 38.75, d: 38.75, h: 32.25, color: '#7a6a5b' },
  { id: 'leif_arm_chair_l', cat: 'Living', name: 'Leif Left-Arm Chair', style: 'leif_arm_chair_left', w: 38.75, d: 38.75, h: 32.25, color: '#7a6a5b' },
  { id: 'leif_armless', cat: 'Living', name: 'Leif Armless Single', style: 'leif_armless', w: 35.75, d: 38.75, h: 32.25, color: '#7a6a5b' },
  { id: 'leif_ottoman', cat: 'Living', name: 'Leif Ottoman', style: 'leif_ottoman', w: 38.75, d: 38.75, h: 17.75, color: '#7a6a5b' },
  { id: 'loveseat', cat: 'Living', name: 'Loveseat', style: 'sofa', w: 66, d: 36, h: 33, color: '#64748b' },
  { id: 'lounge_chair', cat: 'Living', name: 'Lounge Chair', style: 'armchair', w: 34, d: 36, h: 32, color: '#8b5e3c' },
  { id: 'coffee_rect', cat: 'Living', name: 'Coffee Table', style: 'table', w: 48, d: 26, h: 17, color: '#a16207' },
  { id: 'coffee_round', cat: 'Living', name: 'Round Coffee Table', style: 'round_table', w: 36, d: 36, h: 16, color: '#8b5e3c' },
  { id: 'coffee_marble', cat: 'Living', name: 'Marble Top Coffee Table (48"×30")', style: 'marble_coffee_table', w: 48, d: 30, h: 16.5, color: '#e2e8f0' },
  { id: 'media_tv', cat: 'Living', name: 'TV Console (82") + 82" TV', style: 'console_tv', w: 82, d: 16, h: 67, color: '#1e293b' },
  { id: 'standing_speaker', cat: 'Living', name: 'Standing Speaker', style: 'floor_speaker', w: 10, d: 14, h: 42, color: '#1e293b' },
  { id: 'media_console', cat: 'Living', name: 'Media Console (77.5")', style: 'cabinet', w: 77.5, d: 18, h: 32, color: '#8b5e3c' },
  { id: 'bookcase', cat: 'Living', name: 'Bookcase', style: 'bookcase', w: 36, d: 14, h: 78, color: '#8b5e3c' },
  { id: 'bookshelf_38', cat: 'Living', name: 'Bookshelf (38")', style: 'bookcase', w: 38, d: 16, h: 78, color: '#8b5e3c' },
  { id: 'rug_8x10', cat: 'Living', name: "Area Rug (8'×10')", style: 'rug', w: 120, d: 96, h: 0.5, color: '#cbd5e1' },
  { id: 'rug_9x12', cat: 'Living', name: "Area Rug (9'×12')", style: 'rug', w: 144, d: 108, h: 0.5, color: '#94a3b8' },
  { id: 'floor_lamp', cat: 'Living', name: 'Floor Lamp', style: 'lamp', w: 16, d: 16, h: 66, color: '#fbbf24' },
  { id: 'plant', cat: 'Living', name: 'Potted Floor Plant', style: 'plant', w: 18, d: 18, h: 54, color: '#3f6212' },
  { id: 'baby_grand', cat: 'Living', name: 'Baby Grand Piano', style: 'baby_grand', w: 58, d: 60, h: 52, color: '#1e293b' },
  { id: 'piano_bench', cat: 'Living', name: 'Piano Bench', style: 'piano_bench', w: 30, d: 14, h: 19, color: '#1e293b' },

  // Dining
  { id: 'dining_6', cat: 'Dining', name: 'Dining Table (72"×39")', style: 'table', w: 72, d: 39, h: 31, color: '#8b5e3c' },
  { id: 'dining_8', cat: 'Dining', name: 'Dining Table (8p)', style: 'table', w: 96, d: 42, h: 30, color: '#8b5e3c' },
  { id: 'dining_round', cat: 'Dining', name: 'Round Dining Table', style: 'round_table', w: 54, d: 54, h: 30, color: '#a16207' },
  { id: 'dining_chair', cat: 'Dining', name: 'Dining Chair', style: 'dining_chair', w: 19, d: 20, h: 34, color: '#64748b' },
  { id: 'barstool', cat: 'Dining', name: 'Counter Barstool', style: 'barstool', w: 17, d: 17, h: 26, color: '#475569' },
  { id: 'sideboard', cat: 'Dining', name: 'Sideboard / Buffet', style: 'cabinet', w: 60, d: 18, h: 32, color: '#8b5e3c' },
  { id: 'combs_marble_bistro', cat: 'Dining', name: 'Combs Marble Bistro Table (36")', style: 'combs_bistro_table', w: 36, d: 36, h: 29.5, color: '#dfd5c3' },
  { id: 'tilda_banquette_small', cat: 'Dining', name: 'Tilda 2-Piece Storage Banquette (Right)', style: 'tilda_banquette_right', w: 53.5, d: 56, h: 30.75, color: '#9c6b3b' },
  { id: 'tilda_banquette_small_l', cat: 'Dining', name: 'Tilda 2-Piece Storage Banquette (Left)', style: 'tilda_banquette_left', w: 53.5, d: 56, h: 30.75, color: '#9c6b3b' },
  { id: 'craig_dining_chair', cat: 'Dining', name: 'Craig Expressed Wood Dining Chair', style: 'craig_dining_chair', w: 23.6, d: 20.6, h: 27.9, color: '#9c6b3b' },

  // Bedroom & Office
  { id: 'bed_king', cat: 'Bedroom', name: 'King Bed', style: 'bed', w: 80, d: 83, h: 44, color: '#e2e8f0' },
  { id: 'bed_queen', cat: 'Bedroom', name: 'Queen Bed', style: 'bed', w: 64, d: 83, h: 44, color: '#e2e8f0' },
  { id: 'bed_full', cat: 'Bedroom', name: 'Full Bed', style: 'bed', w: 57, d: 80, h: 42, color: '#e2e8f0' },
  { id: 'bed_twin', cat: 'Bedroom', name: 'Twin / Daybed', style: 'bed', w: 42, d: 80, h: 38, color: '#cbd5e1' },
  { id: 'nightstand', cat: 'Bedroom', name: 'Nightstand', style: 'cabinet', w: 22, d: 18, h: 24, color: '#8b5e3c' },
  { id: 'dresser', cat: 'Bedroom', name: '6-Drawer Dresser', style: 'cabinet', w: 60, d: 20, h: 34, color: '#8b5e3c' },
  { id: 'dresser_70', cat: 'Bedroom', name: 'Dresser (70")', style: 'cabinet', w: 70, d: 16, h: 35, color: '#8b5e3c' },
  { id: 'desk_64', cat: 'Bedroom', name: 'Desk (64")', style: 'table', w: 64, d: 31, h: 30, color: '#a16207' },
  { id: 'desk_60', cat: 'Bedroom', name: 'Work Desk (60")', style: 'table', w: 60, d: 30, h: 30, color: '#a16207' },
  { id: 'desk_48', cat: 'Bedroom', name: 'Compact Desk (48")', style: 'table', w: 48, d: 24, h: 30, color: '#a16207' },
  { id: 'office_chair', cat: 'Bedroom', name: 'Office Chair', style: 'office_chair', w: 26, d: 26, h: 38, color: '#1e293b' },
  { id: 'wardrobe', cat: 'Bedroom', name: 'Wardrobe Armoire', style: 'cabinet', w: 42, d: 24, h: 80, color: '#64748b' },

  // Outdoor
  { id: 'bistro_set', cat: 'Outdoor', name: 'Balcony Bistro Set', style: 'bistro', w: 30, d: 30, h: 29, color: '#475569' },
  { id: 'balcony_chair', cat: 'Outdoor', name: 'Balcony Lounge Chair', style: 'armchair', w: 30, d: 32, h: 30, color: '#64748b' },
];

// Curated starter layout verified collision-free inside this 4BR/3BA floorplan
const STARTER_LAYOUT = [
  // Living Room
  { catalogId: 'rug_9x12', x: -2.25, z: -8.25, rot: 0, color: '#cbd5e1' },
  { catalogId: 'leif_modular_4pc', x: -2.85, z: -8.40, rot: 270, color: '#7a6a5b' },
  { catalogId: 'coffee_rect', x: -2.05, z: -7.95, rot: 90, color: '#8b5e3c' },
  { catalogId: 'media_tv', x: 0.72, z: -8.25, rot: 90, color: '#1e293b' },
  { catalogId: 'standing_speaker', x: 0.74, z: -9.57, rot: 90, color: '#1e293b' },
  { catalogId: 'standing_speaker', x: 0.74, z: -6.93, rot: 90, color: '#1e293b' },
  { catalogId: 'lounge_chair', x: -0.95, z: -6.70, rot: 145, color: '#8b5e3c' },
  { catalogId: 'floor_lamp', x: -4.85, z: -9.85, rot: 0, color: '#fbbf24' },
  { catalogId: 'plant', x: 0.54, z: -10.18, rot: 0, color: '#3f6212' },

  // Dining Area + Kitchen Island overhang
  { catalogId: 'dining_6', x: -3.65, z: -3.30, rot: 90, color: '#8b5e3c' },
  { catalogId: 'dining_chair', x: -4.26, z: -3.72, rot: 90, color: '#64748b' },
  { catalogId: 'dining_chair', x: -4.26, z: -2.88, rot: 90, color: '#64748b' },
  { catalogId: 'dining_chair', x: -3.04, z: -3.72, rot: 270, color: '#64748b' },
  { catalogId: 'dining_chair', x: -3.04, z: -2.88, rot: 270, color: '#64748b' },
  { catalogId: 'dining_chair', x: -3.65, z: -4.34, rot: 0, color: '#64748b' },
  { catalogId: 'dining_chair', x: -3.65, z: -2.26, rot: 180, color: '#64748b' },
  { catalogId: 'barstool', x: -1.78, z: -4.32, rot: 90, color: '#475569' },
  { catalogId: 'barstool', x: -1.78, z: -3.62, rot: 90, color: '#475569' },

  // Bedroom (NE)
  { catalogId: 'bed_queen', x: 3.03, z: -7.40, rot: 270, color: '#e2e8f0' },
  { catalogId: 'nightstand', x: 3.85, z: -8.62, rot: 270, color: '#8b5e3c' },
  { catalogId: 'nightstand', x: 3.85, z: -6.18, rot: 270, color: '#8b5e3c' },
  { catalogId: 'desk_48', x: 1.46, z: -5.00, rot: 90, color: '#a16207' },
  { catalogId: 'office_chair', x: 2.05, z: -5.00, rot: 270, color: '#1e293b' },

  // Primary Bedroom
  { catalogId: 'bed_king', x: -4.42, z: 7.50, rot: 90, color: '#e2e8f0' },
  { catalogId: 'nightstand', x: -5.24, z: 6.08, rot: 90, color: '#8b5e3c' },
  { catalogId: 'nightstand', x: -5.24, z: 8.92, rot: 90, color: '#8b5e3c' },
  { catalogId: 'dresser_70', x: -2.11, z: 7.50, rot: 270, color: '#8b5e3c' },
  { catalogId: 'desk_64', x: -3.61, z: 10.17, rot: 0, color: '#a16207' },

  // Center Bedroom
  { catalogId: 'bed_full', x: -0.65, z: 8.20, rot: 90, color: '#e2e8f0' },
  { catalogId: 'nightstand', x: -1.44, z: 9.32, rot: 90, color: '#8b5e3c' },
  { catalogId: 'desk_48', x: -1.36, z: 6.05, rot: 90, color: '#a16207' },
  { catalogId: 'office_chair', x: -0.74, z: 6.05, rot: 270, color: '#1e293b' },

  // Bedroom (SE)
  { catalogId: 'bed_queen', x: 4.42, z: 7.80, rot: 270, color: '#e2e8f0' },
  { catalogId: 'nightstand', x: 5.24, z: 6.58, rot: 270, color: '#8b5e3c' },
  { catalogId: 'nightstand', x: 5.24, z: 9.02, rot: 270, color: '#8b5e3c' },
  { catalogId: 'desk_60', x: 1.95, z: 7.60, rot: 90, color: '#a16207' },
  { catalogId: 'office_chair', x: 2.62, z: 7.60, rot: 270, color: '#1e293b' },
  { catalogId: 'bookcase', x: 1.75, z: 5.75, rot: 90, color: '#8b5e3c' },

  // Bottom Balcony
  { catalogId: 'bistro_set', x: 2.65, z: 11.45, rot: 0, color: '#475569' },
];

// ---------------------------------------------------------------------------
// Three.js Scene Setup
// ---------------------------------------------------------------------------
const viewportWrap = document.getElementById('viewport-wrap');
const canvasHost = document.getElementById('canvas-host');
const labelsLayer = document.getElementById('labels-layer');

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(canvasHost.clientWidth, canvasHost.clientHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.localClippingEnabled = true;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.06;
canvasHost.appendChild(renderer.domElement);

const scene = new THREE.Scene();

const perspCamera = new THREE.PerspectiveCamera(44, canvasHost.clientWidth / canvasHost.clientHeight, 0.25, 85);
perspCamera.position.set(-14.5, 19.0, 17.5);

const aspect0 = canvasHost.clientWidth / Math.max(1, canvasHost.clientHeight);
const orthoHalfH = 13.0;
const orthoCamera = new THREE.OrthographicCamera(
  -orthoHalfH * aspect0,
  orthoHalfH * aspect0,
  orthoHalfH,
  -orthoHalfH,
  0.1,
  100
);
orthoCamera.position.set(0, 32, 0);
orthoCamera.up.set(0, 0, -1);
orthoCamera.lookAt(0, 0, 0);

let activeCamera = perspCamera;
let activeCamMode = 'dollhouse';

const controls = new OrbitControls(perspCamera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.target.set(0, 0.4, 0.2);
controls.maxPolarAngle = Math.PI * 0.49;

// Lighting
scene.add(new THREE.HemisphereLight(0xf1f5f9, 0x334155, 0.78));
const keyLight = new THREE.DirectionalLight(0xfffaf0, 1.35);
keyLight.position.set(12, 24, 10);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(2048, 2048);
keyLight.shadow.camera.near = 2;
keyLight.shadow.camera.far = 55;
const dCam = 16;
keyLight.shadow.camera.left = -dCam;
keyLight.shadow.camera.right = dCam;
keyLight.shadow.camera.top = dCam;
keyLight.shadow.camera.bottom = -dCam;
keyLight.shadow.bias = -0.0004;
keyLight.shadow.normalBias = 0.03;
scene.add(keyLight);

const fillLight = new THREE.DirectionalLight(0xbae6fd, 0.45);
fillLight.position.set(-14, 12, -10);
scene.add(fillLight);

// Clipping plane for Wall Cutaway Slice
const slicePlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 9.0 * FT_TO_M + 0.05);
const clippableNodes = new Set(['Walls_Main', 'Window_Frames', 'Windows_Glass', 'Doors', 'Fixtures_DiningShelf']);
const clippableMaterials = [];
const heightScalableNodes = new Set(['Walls_Main', 'Window_Frames', 'Windows_Glass', 'Fixtures_DiningShelf']);
const nodeRefs = {};

// Apartment root & overlays
const apartmentGroup = new THREE.Group();
scene.add(apartmentGroup);

// 1-Foot Grid (36' x 80' centered on apartment)
const gridGroup = new THREE.Group();
{
  const gridMat = new THREE.LineBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.14 });
  const pts = [];
  const halfX = 20;
  const minZ = -38;
  const maxZ = 42;
  for (let gx = -halfX; gx <= halfX; gx++) {
    const xm = gx * FT_TO_M;
    pts.push(xm, 0.005, minZ * FT_TO_M, xm, 0.005, maxZ * FT_TO_M);
  }
  for (let gz = minZ; gz <= maxZ; gz++) {
    const zm = gz * FT_TO_M;
    pts.push(-halfX * FT_TO_M, 0.005, zm, halfX * FT_TO_M, 0.005, zm);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  gridGroup.add(new THREE.LineSegments(geo, gridMat));
}
scene.add(gridGroup);

// Original Floorplan Blueprint Overlay Plane (exact 1:1 registration; flipY=true default)
let floorplanOverlayMesh = null;
{
  const [bx0, bz0, bx1, bz1] = spec.calibration.floorplan_bounds_m;
  const planeW = bx1 - bx0;
  const planeD = bz1 - bz0;
  const tex = new THREE.TextureLoader().load(`data:image/jpeg;base64,${floorplanBase64}`);
  tex.colorSpace = THREE.SRGBColorSpace;
  // Keep default tex.flipY = true so PlaneGeometry rotated -PI/2 maps North(-Z) to top of image
  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    opacity: 0.0,
    depthWrite: false,
  });
  floorplanOverlayMesh = new THREE.Mesh(new THREE.PlaneGeometry(planeW, planeD), mat);
  floorplanOverlayMesh.rotation.x = -Math.PI / 2;
  floorplanOverlayMesh.position.set(0.5 * (bx0 + bx1), 0.009, 0.5 * (bz0 + bz1));
  floorplanOverlayMesh.visible = false;
  scene.add(floorplanOverlayMesh);
}

// Door Swing Clearance Arcs
const swingGroup = new THREE.Group();
const hingedArcs = [];
{
  const arcMat = new THREE.LineBasicMaterial({ color: 0xf59e0b, transparent: true, opacity: 0.85 });
  const fillMat = new THREE.MeshBasicMaterial({
    color: 0xf59e0b,
    transparent: true,
    opacity: 0.12,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  for (const op of spec.openings) {
    if (op.kind !== 'hinged') continue;
    const [hx, hz] = op.hinge_m;
    const r = op.width_m;
    let a0 = (op.closed_angle_deg * Math.PI) / 180;
    let sRad = (op.swing_dir_deg * Math.PI) / 180;
    let diff = ((sRad - a0 + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    const segs = 24;
    const linePts = [new THREE.Vector3(hx, 0.016, hz)];
    const shapePts = [new THREE.Vector3(hx, 0.013, hz)];
    for (let i = 0; i <= segs; i++) {
      const ang = a0 + (diff * i) / segs;
      const px = hx + r * Math.cos(ang);
      const pz = hz + r * Math.sin(ang);
      linePts.push(new THREE.Vector3(px, 0.016, pz));
      shapePts.push(new THREE.Vector3(px, 0.013, pz));
    }
    linePts.push(new THREE.Vector3(hx, 0.012, hz));
    swingGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(linePts), arcMat));

    const triPos = [];
    for (let i = 1; i < shapePts.length - 1; i++) {
      triPos.push(
        shapePts[0].x, shapePts[0].y, shapePts[0].z,
        shapePts[i].x, shapePts[i].y, shapePts[i].z,
        shapePts[i + 1].x, shapePts[i + 1].y, shapePts[i + 1].z
      );
    }
    const fGeo = new THREE.BufferGeometry();
    fGeo.setAttribute('position', new THREE.Float32BufferAttribute(triPos, 3));
    swingGroup.add(new THREE.Mesh(fGeo, fillMat));

    hingedArcs.push({
      id: op.id,
      label: op.label,
      hx,
      hz,
      r,
      midX: hx + 0.55 * r * Math.cos(a0 + 0.5 * diff),
      midZ: hz + 0.55 * r * Math.sin(a0 + 0.5 * diff),
    });
  }
}
scene.add(swingGroup);

// Load apartment_exact.glb
const loader = new GLTFLoader();
loader.parse(base64ToArrayBuffer(glbBase64), '', (gltf) => {
  clippableMaterials.length = 0;
  gltf.scene.traverse((obj) => {
    if (obj.isMesh) {
      obj.castShadow = obj.name !== 'Floor_Wood' && obj.name !== 'Floor_Tile' && obj.name !== 'Floor_Balcony';
      obj.receiveShadow = true;
      nodeRefs[obj.name] = obj;
      if (clippableNodes.has(obj.name)) {
        obj.material = obj.material.clone();
        const defaultSide = obj.material.side;
        obj.material.clippingPlanes = null;
        obj.material.clipShadows = true;
        clippableMaterials.push({ mat: obj.material, defaultSide });
      }
    }
  });
  apartmentGroup.add(gltf.scene);
  applyCeilingHeight(Number(ceilingSelect.value), false);
});

// ---------------------------------------------------------------------------
// Procedural Realistic Furniture Builder
// ---------------------------------------------------------------------------
function makeMat(colorHex, roughness = 0.65, metalness = 0.05) {
  return new THREE.MeshStandardMaterial({ color: colorHex, roughness, metalness });
}

function addPart(group, geo, mat, x, y, z) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  group.add(m);
  return m;
}

const STRUT_UP = new THREE.Vector3(0, 1, 0);

function addStrut(group, pA, pB, rTop, rBot, mat, segs = 12) {
  const dir = new THREE.Vector3().subVectors(pB, pA);
  const len = dir.length();
  if (len <= 1e-5 || rTop <= 0 || rBot <= 0) return null;
  const geo = new THREE.CylinderGeometry(rTop, rBot, len, segs);
  const m = new THREE.Mesh(geo, mat);
  m.position.copy(pA).add(pB).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(STRUT_UP, dir.normalize());
  m.castShadow = true;
  m.receiveShadow = true;
  group.add(m);
  return m;
}

function addBoxSpan(group, x0, x1, y0, y1, z0, z1, mat) {
  const bw = x1 - x0;
  const bh = y1 - y0;
  const bd = z1 - z0;
  if (bw <= 0.003 || bh <= 0.003 || bd <= 0.003) return null;
  return addPart(group, new THREE.BoxGeometry(bw, bh, bd), mat, 0.5 * (x0 + x1), 0.5 * (y0 + y1), 0.5 * (z0 + z1));
}

function makeAnnularSectorGeo(rInner, rOuter, ang0, ang1, height, segs = 22) {
  const sh = new THREE.Shape();
  sh.moveTo(Math.cos(ang0) * rInner, Math.sin(ang0) * rInner);
  sh.lineTo(Math.cos(ang0) * rOuter, Math.sin(ang0) * rOuter);
  sh.absarc(0, 0, rOuter, ang0, ang1, false);
  sh.lineTo(Math.cos(ang1) * rInner, Math.sin(ang1) * rInner);
  sh.absarc(0, 0, rInner, ang1, ang0, true);
  sh.closePath();
  const geo = new THREE.ExtrudeGeometry(sh, { depth: height, bevelEnabled: false, curveSegments: segs });
  geo.rotateX(-Math.PI * 0.5);
  return geo;
}

function makeLeifMats(colorHex) {
  const uphMat = makeMat(colorHex, 0.86, 0.02);
  const pilCol = new THREE.Color(colorHex).lerp(new THREE.Color('#ffffff'), 0.06);
  const pilMat = new THREE.MeshStandardMaterial({ color: pilCol, roughness: 0.88, metalness: 0.01 });
  const footMat = makeMat('#1e293b', 0.65, 0.05);
  return { uphMat, pilMat, footMat };
}

function getLeifMetrics(w, d, h, isOttomanOnly = false) {
  const legH = Math.min(1.25 * IN_TO_M, h * (isOttomanOnly ? 0.14 : 0.08));
  const baseY0 = 0.002 + legH;
  const seatTop = isOttomanOnly
    ? h
    : Math.min(h - 0.08, Math.max(baseY0 + 0.04, h * (17.75 / 32.25)));
  const backTop = Math.min(h - 0.02, Math.max(seatTop + 0.04, h * (28.25 / 32.25)));
  const armTop = Math.min(backTop - 0.015, Math.max(seatTop + 0.03, h * (26.5 / 32.25)));
  const cushH = Math.min(7.5 * IN_TO_M, Math.max(0.015, (seatTop - baseY0) * 0.48));
  const deckTop = Math.max(baseY0 + 0.004, seatTop - cushH - 0.003);
  const footR = Math.min(0.022, w * 0.05, d * 0.05);
  return { legH, baseY0, seatTop, backTop, armTop, cushH, deckTop, footR };
}

function addLeifWedgeModule(g, cx, cz, rIn, rBackIn, rOut, sign, h, m, mats) {
  const ang0 = sign === 1 ? 0 : Math.PI * 0.5;
  const ang1 = sign === 1 ? Math.PI * 0.5 : Math.PI;
  addPart(g, makeAnnularSectorGeo(rBackIn, rOut, ang0, ang1, m.backTop - m.baseY0), mats.uphMat, cx, m.baseY0, cz);
  addPart(g, makeAnnularSectorGeo(rIn, rBackIn - 0.003, ang0, ang1, m.deckTop - m.baseY0), mats.uphMat, cx, m.baseY0, cz);
  addPart(g, makeAnnularSectorGeo(rIn, rBackIn - 0.003, ang0, ang1, m.cushH), mats.uphMat, cx, m.seatTop - m.cushH, cz);

  for (const [fAng, fRad] of [
    [ang0 + 0.14, rOut - m.footR * 3],
    [0.5 * (ang0 + ang1), rOut - m.footR * 3],
    [ang1 - 0.14, rOut - m.footR * 3],
    [ang0 + 0.25, rIn + m.footR * 2],
    [ang1 - 0.25, rIn + m.footR * 2],
  ]) {
    const fx = cx + Math.cos(fAng) * fRad;
    const fz = cz - Math.sin(fAng) * fRad;
    addPart(g, new THREE.CylinderGeometry(m.footR, m.footR * 0.85, m.legH, 8), mats.footMat, fx, 0.002 + m.legH * 0.5, fz);
  }

  const pilH = Math.max(0.02, h - m.seatTop - 0.004);
  const pilD = Math.min(5.2 * IN_TO_M, (rBackIn - rIn) * 0.28);
  const pilY = m.seatTop + 0.004 + pilH * 0.5;
  const wPilW = Math.min(20 * IN_TO_M, Math.max(0.03, (rBackIn - 0.01 - pilD) * 0.45));
  const wPilBackLim = Math.sqrt(Math.max(0.01, (rBackIn - 0.005) ** 2 - (wPilW * 0.5) ** 2));
  const wPilR = Math.max(rIn + pilD * 0.5, wPilBackLim - pilD * 0.5);
  for (const frac of [1 / 6, 3 / 6, 5 / 6]) {
    const ang = ang0 + (ang1 - ang0) * frac;
    const px = cx + Math.cos(ang) * wPilR;
    const pz = cz - Math.sin(ang) * wPilR;
    const pm = addPart(g, new THREE.BoxGeometry(wPilW, pilH, pilD), mats.pilMat, px, pilY, pz);
    pm.rotation.y = ang + Math.PI * 0.5;
  }
}

function addLeifGlidesRect(g, x0, x1, z0, z1, m, mats) {
  const fInset = Math.min(0.06, (x1 - x0) * 0.2, (z1 - z0) * 0.2);
  for (const fx of [x0 + fInset, x1 - fInset]) {
    for (const fz of [z0 + fInset, z1 - fInset]) {
      addPart(g, new THREE.CylinderGeometry(m.footR, m.footR * 0.85, m.legH, 8), mats.footMat, fx, 0.002 + m.legH * 0.5, fz);
    }
  }
}

function addLeifStraightBackZ(g, x0, x1, z0, z1, armSide, h, m, mats) {
  const span = x1 - x0;
  const depth = z1 - z0;
  if (span <= 0.02 || depth <= 0.02) return;
  const backD = Math.min(8.75 * IN_TO_M, depth * 0.28);
  const pilD = Math.min(5.2 * IN_TO_M, (depth - backD) * 0.28);
  const armW = armSide === 'none' ? 0 : Math.min(6.0 * IN_TO_M, span * 0.24);
  let inX0 = x0;
  let inX1 = x1;
  if (armSide === 'minX') {
    addBoxSpan(g, x0, x0 + armW, m.baseY0, m.armTop, z0, z1, mats.uphMat);
    inX0 = x0 + armW + 0.002;
  } else if (armSide === 'maxX') {
    addBoxSpan(g, x1 - armW, x1, m.baseY0, m.armTop, z0, z1, mats.uphMat);
    inX1 = x1 - armW - 0.002;
  }
  const zBack1 = z0 + backD;
  const zSeat0 = zBack1 + 0.003;
  addBoxSpan(g, inX0, inX1, m.baseY0, m.backTop, z0, zBack1, mats.uphMat);
  addBoxSpan(g, inX0, inX1, m.baseY0, m.deckTop, zSeat0, z1, mats.uphMat);
  addBoxSpan(g, inX0, inX1, m.seatTop - m.cushH, m.seatTop, zSeat0, z1, mats.uphMat);
  addBoxSpan(g, inX0 + 0.01, inX1 - 0.01, m.seatTop + 0.004, h, zSeat0 + 0.002, zSeat0 + 0.002 + pilD, mats.pilMat);
  addLeifGlidesRect(g, x0, x1, z0, z1, m, mats);
}

function addLeifStraightBackX(g, x0, x1, z0, z1, backSide, armSide, h, m, mats) {
  const depth = x1 - x0;
  const span = z1 - z0;
  if (depth <= 0.02 || span <= 0.02) return;
  const backD = Math.min(8.75 * IN_TO_M, depth * 0.28);
  const pilD = Math.min(5.2 * IN_TO_M, (depth - backD) * 0.28);
  const armW = armSide === 'none' ? 0 : Math.min(6.0 * IN_TO_M, span * 0.24);
  let inZ0 = z0;
  let inZ1 = z1;
  if (armSide === 'minZ') {
    addBoxSpan(g, x0, x1, m.baseY0, m.armTop, z0, z0 + armW, mats.uphMat);
    inZ0 = z0 + armW + 0.002;
  } else if (armSide === 'maxZ') {
    addBoxSpan(g, x0, x1, m.baseY0, m.armTop, z1 - armW, z1, mats.uphMat);
    inZ1 = z1 - armW - 0.002;
  }
  const bx0 = backSide === 'maxX' ? x1 - backD : x0;
  const bx1 = backSide === 'maxX' ? x1 : x0 + backD;
  const sx0 = backSide === 'maxX' ? x0 : bx1 + 0.003;
  const sx1 = backSide === 'maxX' ? bx0 - 0.003 : x1;
  const px0 = backSide === 'maxX' ? bx0 - 0.005 - pilD : bx1 + 0.005;
  const px1 = backSide === 'maxX' ? bx0 - 0.005 : bx1 + 0.005 + pilD;
  addBoxSpan(g, bx0, bx1, m.baseY0, m.backTop, inZ0, inZ1, mats.uphMat);
  addBoxSpan(g, sx0, sx1, m.baseY0, m.deckTop, inZ0, inZ1, mats.uphMat);
  addBoxSpan(g, sx0, sx1, m.seatTop - m.cushH, m.seatTop, inZ0, inZ1, mats.uphMat);
  addBoxSpan(g, px0, px1, m.seatTop + 0.004, h, inZ0 + 0.01, inZ1 - 0.01, mats.pilMat);
  addLeifGlidesRect(g, x0, x1, z0, z1, m, mats);
}

function addLeifOttomanBlock(g, x0, x1, z0, z1, topY, m, mats) {
  if (x1 - x0 <= 0.02 || z1 - z0 <= 0.02) return;
  addBoxSpan(g, x0, x1, m.baseY0, m.deckTop, z0, z1, mats.uphMat);
  addBoxSpan(g, x0, x1, topY - m.cushH, topY, z0, z1, mats.uphMat);
  addLeifGlidesRect(g, x0, x1, z0, z1, m, mats);
}

function buildFurnitureVisual(item) {
  const w = item.wIn * IN_TO_M;
  const d = item.dIn * IN_TO_M;
  const h = item.hIn * IN_TO_M;
  const g = new THREE.Group();

  const mainMat = makeMat(item.color, 0.72, 0.04);
  const darkMat = makeMat('#1e293b', 0.45, 0.4);
  const woodMat = makeMat('#8b5e3c', 0.6, 0.05);
  const whiteMat = makeMat('#f8fafc', 0.85, 0.0);
  const pillowMat = makeMat('#cbd5e1', 0.82, 0.0);
  const accentMat = makeMat(item.color, 0.6, 0.08);

  switch (item.style) {
    case 'rug': {
      const baseH = Math.max(0.008, h * 0.65);
      const pileH = Math.max(0.004, h * 0.35);
      addPart(g, new THREE.BoxGeometry(w, baseH, d), makeMat('#475569', 0.95, 0), 0, 0.002 + baseH * 0.5, 0);
      addPart(g, new THREE.BoxGeometry(w * 0.92, pileH, d * 0.92), mainMat, 0, 0.004 + baseH + pileH * 0.5, 0);
      break;
    }

    case 'sofa': {
      const footH = Math.min(0.12, h * 0.20);
      const bodyY0 = footH + 0.002;
      const baseTop = Math.max(bodyY0 + 0.006, h * 0.42);
      const armTop = Math.max(baseTop + 0.004, h * 0.68);
      const armW = Math.min(0.18, w * 0.12);
      const backD = Math.min(0.22, d * 0.24);
      const frontD = Math.max(0.01, d - backD - 0.003);
      const deckW = Math.max(0.01, w - armW * 2 - 0.006);
      const legRTop = Math.min(0.022, w * 0.06, d * 0.06);
      const legRBot = legRTop * 0.72;
      for (const lx of [-w * 0.42, w * 0.42]) {
        for (const lz of [-d * 0.38, d * 0.38]) {
          addPart(g, new THREE.CylinderGeometry(legRTop, legRBot, footH, 10), woodMat, lx, 0.002 + footH * 0.5, lz);
        }
      }
      // Full-width backrest (-Z)
      const backH = Math.max(0.004, h - bodyY0);
      addPart(g, new THREE.BoxGeometry(w, backH, backD), mainMat, 0, bodyY0 + backH * 0.5, -d * 0.5 + backD * 0.5);
      // Left/right arms strictly in front of backrest
      const armH = Math.max(0.004, armTop - bodyY0);
      const frontZ = d * 0.5 - frontD * 0.5;
      addPart(g, new THREE.BoxGeometry(armW, armH, frontD), mainMat, -w * 0.5 + armW * 0.5, bodyY0 + armH * 0.5, frontZ);
      addPart(g, new THREE.BoxGeometry(armW, armH, frontD), mainMat, w * 0.5 - armW * 0.5, bodyY0 + armH * 0.5, frontZ);
      // Seat deck strictly between arms and in front of backrest
      const deckH = Math.max(0.004, baseTop - bodyY0);
      addPart(g, new THREE.BoxGeometry(deckW, deckH, frontD), mainMat, 0, bodyY0 + deckH * 0.5, frontZ);
      // Cushions separated above seat deck
      const innerW = Math.max(0.01, deckW - 0.016);
      const numCush = w > 1.9 ? 3 : 2;
      const cw = Math.max(0.004, innerW / numCush - 0.012);
      const cushH = Math.min(0.13, Math.max(0.004, h * 0.16));
      const cushD = Math.max(0.006, frontD - 0.02);
      for (let i = 0; i < numCush; i++) {
        const cx = -innerW * 0.5 + (i + 0.5) * (innerW / numCush);
        addPart(g, new THREE.BoxGeometry(cw, cushH, cushD), mainMat, cx, baseTop + 0.003 + cushH * 0.5, frontZ);
      }
      break;
    }

    case 'sectional':
    case 'sectional_left': {
      const sign = item.style === 'sectional_left' ? -1 : 1;
      const footH = Math.min(0.045, h * 0.08);
      const footS = Math.min(0.05, w * 0.08, d * 0.08);
      const bodyY0 = footH + 0.002;
      const backD = Math.min(0.22, d * 0.22);
      const armW = Math.min(0.16, w * 0.12);
      const seatD = Math.min(0.96, Math.max(backD + 0.02, d * 0.5));
      const chaiseW = Math.min(1.05, Math.max(armW + 0.02, w * 0.36));
      const baseTop = Math.max(bodyY0 + 0.006, h * 0.42);
      const armTop = Math.max(baseTop + 0.004, h * 0.72);
      for (const [fx, fz] of [
        [-w * 0.44 * sign, -d * 0.42],
        [w * 0.44 * sign, -d * 0.42],
        [-w * 0.44 * sign, -d * 0.5 + seatD - footS],
        [(w * 0.5 - chaiseW + footS) * sign, d * 0.44],
        [w * 0.44 * sign, d * 0.44],
      ]) {
        addPart(g, new THREE.BoxGeometry(footS, footH, footS), woodMat, fx, 0.002 + footH * 0.5, fz);
      }
      const backH = Math.max(0.004, h - bodyY0);
      addPart(g, new THREE.BoxGeometry(w, backH, backD), mainMat, 0, bodyY0 + backH * 0.5, -d * 0.5 + backD * 0.5);
      const wingFrontD = Math.max(0.01, seatD - backD - 0.003);
      const chaiseFrontD = Math.max(0.01, d - backD - 0.003);
      const armH = Math.max(0.004, armTop - bodyY0);
      const wingZ = -d * 0.5 + backD + 0.003 + wingFrontD * 0.5;
      const chaiseZ = -d * 0.5 + backD + 0.003 + chaiseFrontD * 0.5;
      // Non-chaise arm & chaise arm in front of backrest
      addPart(g, new THREE.BoxGeometry(armW, armH, wingFrontD), mainMat, (-w * 0.5 + armW * 0.5) * sign, bodyY0 + armH * 0.5, wingZ);
      addPart(g, new THREE.BoxGeometry(armW, armH, chaiseFrontD), mainMat, (w * 0.5 - armW * 0.5) * sign, bodyY0 + armH * 0.5, chaiseZ);
      // Main seat base strictly between non-chaise arm and chaise
      const deckH = Math.max(0.004, baseTop - bodyY0);
      const centerW = Math.max(0.01, w - armW - chaiseW - 0.006);
      const centerX = (-w * 0.5 + armW + 0.003 + centerW * 0.5) * sign;
      addPart(g, new THREE.BoxGeometry(centerW, deckH, wingFrontD), mainMat, centerX, bodyY0 + deckH * 0.5, wingZ);
      // Chaise base strictly between center seat and chaise arm
      const chaiseInnerW = Math.max(0.01, chaiseW - armW - 0.003);
      const chaiseX = (w * 0.5 - armW - 0.003 - chaiseInnerW * 0.5) * sign;
      addPart(g, new THREE.BoxGeometry(chaiseInnerW, deckH, chaiseFrontD), mainMat, chaiseX, bodyY0 + deckH * 0.5, chaiseZ);
      // Cushions on main wing and chaise
      const cushH = Math.min(0.11, Math.max(0.004, h * 0.14));
      addPart(g, new THREE.BoxGeometry(Math.max(0.006, centerW - 0.015), cushH, Math.max(0.006, wingFrontD - 0.02)), pillowMat, centerX, baseTop + 0.003 + cushH * 0.5, wingZ);
      addPart(g, new THREE.BoxGeometry(Math.max(0.006, chaiseInnerW - 0.015), cushH, Math.max(0.006, chaiseFrontD - 0.02)), pillowMat, chaiseX, baseTop + 0.003 + cushH * 0.5, chaiseZ);
      break;
    }

    case 'leif_curved_sectional':
    case 'leif_curved_sectional_left': {
      const sign = item.style === 'leif_curved_sectional_left' ? -1 : 1;
      const mats = makeLeifMats(item.color);
      const m = getLeifMetrics(w, d, h);
      const rOut = Math.min(50 * IN_TO_M, Math.min(w, d) * (50 / 88.75));
      const chairD = Math.min(38.75 * IN_TO_M, rOut * 0.775);
      const rIn = Math.max(0.02, rOut - chairD);
      const backD = Math.min(8.75 * IN_TO_M, chairD * 0.28);
      const rBackIn = Math.max(rIn + 0.02, rOut - backD);
      const cx = sign * (w * 0.5 - rOut);
      const cz = -d * 0.5 + rOut;

      addLeifWedgeModule(g, cx, cz, rIn, rBackIn, rOut, sign, h, m, mats);
      if (sign === 1) {
        addLeifStraightBackZ(g, -w * 0.5, cx - 0.004, -d * 0.5, -d * 0.5 + chairD, 'minX', h, m, mats);
        addLeifStraightBackX(g, w * 0.5 - chairD, w * 0.5, cz + 0.004, d * 0.5, 'maxX', 'maxZ', h, m, mats);
      } else {
        addLeifStraightBackZ(g, cx + 0.004, w * 0.5, -d * 0.5, -d * 0.5 + chairD, 'maxX', h, m, mats);
        addLeifStraightBackX(g, -w * 0.5, -w * 0.5 + chairD, cz + 0.004, d * 0.5, 'minX', 'maxZ', h, m, mats);
      }
      break;
    }

    case 'leif_modular_4pc':
    case 'leif_modular_4pc_left': {
      const sign = item.style === 'leif_modular_4pc_left' ? -1 : 1;
      const mats = makeLeifMats(item.color);
      const m = getLeifMetrics(w, d, h);
      const rOut = Math.min(50 * IN_TO_M, w * (50 / 124.5), d * (50 / 88.75));
      const chairD = Math.min(38.75 * IN_TO_M, rOut * 0.775);
      const rIn = Math.max(0.02, rOut - chairD);
      const backD = Math.min(8.75 * IN_TO_M, chairD * 0.28);
      const rBackIn = Math.max(rIn + 0.02, rOut - backD);
      const cx = sign * (w * 0.5 - rOut);
      const cz = -d * 0.5 + rOut;

      addLeifWedgeModule(g, cx, cz, rIn, rBackIn, rOut, sign, h, m, mats);

      const wingSpan = Math.max(0.04, w - rOut - 0.004);
      const armlessW = Math.max(0.02, (wingSpan - 0.004) * (35.75 / 74.5));
      if (sign === 1) {
        addLeifStraightBackX(g, w * 0.5 - chairD, w * 0.5, cz + 0.004, d * 0.5, 'maxX', 'maxZ', h, m, mats);
        addLeifStraightBackZ(g, cx - 0.004 - armlessW, cx - 0.004, -d * 0.5, -d * 0.5 + chairD, 'none', h, m, mats);
        addLeifOttomanBlock(g, -w * 0.5, cx - 0.004 - armlessW - 0.004, -d * 0.5, -d * 0.5 + chairD, m.seatTop, m, mats);
      } else {
        addLeifStraightBackX(g, -w * 0.5, -w * 0.5 + chairD, cz + 0.004, d * 0.5, 'minX', 'maxZ', h, m, mats);
        addLeifStraightBackZ(g, cx + 0.004, cx + 0.004 + armlessW, -d * 0.5, -d * 0.5 + chairD, 'none', h, m, mats);
        addLeifOttomanBlock(g, cx + 0.004 + armlessW + 0.004, w * 0.5, -d * 0.5, -d * 0.5 + chairD, m.seatTop, m, mats);
      }
      break;
    }

    case 'leif_wedge':
    case 'leif_wedge_left': {
      const sign = item.style === 'leif_wedge_left' ? -1 : 1;
      const mats = makeLeifMats(item.color);
      const m = getLeifMetrics(w, d, h);
      const rOut = Math.min(w, d);
      const chairD = Math.min(38.75 * IN_TO_M, rOut * 0.775);
      const rIn = Math.max(0.02, rOut - chairD);
      const backD = Math.min(8.75 * IN_TO_M, chairD * 0.28);
      const rBackIn = Math.max(rIn + 0.02, rOut - backD);
      const cx = sign * (w * 0.5 - rOut);
      const cz = -d * 0.5 + rOut;
      addLeifWedgeModule(g, cx, cz, rIn, rBackIn, rOut, sign, h, m, mats);
      break;
    }

    case 'leif_arm_chair_right':
    case 'leif_arm_chair_left': {
      const armSide = item.style === 'leif_arm_chair_left' ? 'minX' : 'maxX';
      addLeifStraightBackZ(g, -w * 0.5, w * 0.5, -d * 0.5, d * 0.5, armSide, h, getLeifMetrics(w, d, h), makeLeifMats(item.color));
      break;
    }

    case 'leif_armless': {
      addLeifStraightBackZ(g, -w * 0.5, w * 0.5, -d * 0.5, d * 0.5, 'none', h, getLeifMetrics(w, d, h), makeLeifMats(item.color));
      break;
    }

    case 'leif_ottoman': {
      addLeifOttomanBlock(g, -w * 0.5, w * 0.5, -d * 0.5, d * 0.5, h, getLeifMetrics(w, d, h, true), makeLeifMats(item.color));
      break;
    }

    case 'armchair': {
      const footH = Math.min(0.12, h * 0.20);
      const bodyY0 = footH + 0.002;
      const baseTop = Math.max(bodyY0 + 0.006, h * 0.44);
      const armTop = Math.max(baseTop + 0.004, h * 0.65);
      const armW = Math.min(0.15, w * 0.16);
      const backD = Math.min(0.20, d * 0.22);
      const frontD = Math.max(0.01, d - backD - 0.003);
      const deckW = Math.max(0.01, w - armW * 2 - 0.006);
      const legRTop = Math.min(0.02, w * 0.06, d * 0.06);
      for (const lx of [-w * 0.38, w * 0.38]) {
        for (const lz of [-d * 0.36, d * 0.36]) {
          addPart(g, new THREE.CylinderGeometry(legRTop, legRTop * 0.75, footH, 8), woodMat, lx, 0.002 + footH * 0.5, lz);
        }
      }
      const backH = Math.max(0.004, h - bodyY0);
      addPart(g, new THREE.BoxGeometry(w, backH, backD), mainMat, 0, bodyY0 + backH * 0.5, -d * 0.5 + backD * 0.5);
      const armH = Math.max(0.004, armTop - bodyY0);
      const frontZ = d * 0.5 - frontD * 0.5;
      addPart(g, new THREE.BoxGeometry(armW, armH, frontD), mainMat, -w * 0.5 + armW * 0.5, bodyY0 + armH * 0.5, frontZ);
      addPart(g, new THREE.BoxGeometry(armW, armH, frontD), mainMat, w * 0.5 - armW * 0.5, bodyY0 + armH * 0.5, frontZ);
      const deckH = Math.max(0.004, baseTop - bodyY0);
      addPart(g, new THREE.BoxGeometry(deckW, deckH, frontD), mainMat, 0, bodyY0 + deckH * 0.5, frontZ);
      const cushH = Math.min(0.11, Math.max(0.004, h * 0.14));
      addPart(g, new THREE.BoxGeometry(Math.max(0.006, deckW - 0.014), cushH, Math.max(0.006, frontD - 0.02)), mainMat, 0, baseTop + 0.003 + cushH * 0.5, frontZ);
      break;
    }

    case 'table': {
      const topT = Math.min(0.055, h * 0.18);
      const lThick = Math.min(0.055, Math.min(w, d) * 0.08);
      const legSpanH = Math.max(0.003, h - topT - 0.004);
      const apronH = Math.min(topT * 0.9, Math.max(0.003, legSpanH * 0.25));
      const apronW = Math.max(0.006, w - lThick * 3.2 - 0.004);
      const apronD = Math.max(0.006, d - lThick * 3.2 - 0.004);
      addPart(g, new THREE.BoxGeometry(w, topT, d), mainMat, 0, h - topT * 0.5, 0);
      addPart(g, new THREE.BoxGeometry(apronW, apronH, apronD), darkMat, 0, h - topT - 0.002 - apronH * 0.5, 0);
      for (const lx of [-w * 0.5 + lThick, w * 0.5 - lThick]) {
        for (const lz of [-d * 0.5 + lThick, d * 0.5 - lThick]) {
          addPart(g, new THREE.BoxGeometry(lThick, legSpanH, lThick), darkMat, lx, 0.002 + legSpanH * 0.5, lz);
        }
      }
      break;
    }

    case 'round_table': {
      const r = Math.min(w, d) * 0.5;
      const topT = Math.min(0.05, h * 0.18);
      const baseH = Math.min(0.03, h * 0.16);
      const pedH = Math.max(0.003, h - topT - baseH - 0.006);
      addPart(g, new THREE.CylinderGeometry(r, r, topT, 28), mainMat, 0, h - topT * 0.5, 0);
      addPart(g, new THREE.CylinderGeometry(r * 0.12, r * 0.15, pedH, 16), darkMat, 0, 0.004 + baseH + pedH * 0.5, 0);
      addPart(g, new THREE.CylinderGeometry(r * 0.55, r * 0.6, baseH, 24), darkMat, 0, 0.002 + baseH * 0.5, 0);
      break;
    }

    case 'marble_coffee_table': {
      const marbleMat = makeMat(item.color, 0.28, 0.04);
      const frameMat = makeMat('#292524', 0.35, 0.55);

      const topT = Math.min(1.25 * IN_TO_M, h * 0.14);
      const bevelT = Math.min(0.006, topT * 0.25);
      const bevelS = Math.min(0.008, w * 0.02, d * 0.02);
      const hw = Math.max(0.01, w * 0.5 - bevelS);
      const hd = Math.max(0.01, d * 0.5 - bevelS);
      const ch = Math.min(0.012, hw * 0.15, hd * 0.15);

      const slabShape = new THREE.Shape();
      slabShape.moveTo(-hw + ch, -hd);
      slabShape.lineTo(hw - ch, -hd);
      slabShape.lineTo(hw, -hd + ch);
      slabShape.lineTo(hw, hd - ch);
      slabShape.lineTo(hw - ch, hd);
      slabShape.lineTo(-hw + ch, hd);
      slabShape.lineTo(-hw, hd - ch);
      slabShape.lineTo(-hw, -hd + ch);
      slabShape.closePath();

      let slabGeo = new THREE.ExtrudeGeometry(slabShape, {
        depth: Math.max(0.002, topT - 2 * bevelT),
        bevelEnabled: true,
        bevelThickness: bevelT,
        bevelSize: bevelS,
        bevelSegments: 1,
      });
      slabGeo.rotateX(-Math.PI / 2);
      if (slabGeo.index) slabGeo = slabGeo.toNonIndexed();
      slabGeo.computeVertexNormals();
      addPart(g, slabGeo, marbleMat, 0, h - topT + bevelT, 0);

      // Inset metal perimeter frame with corner posts + upper apron & lower stretcher rails
      const yBot = 0.002;
      const yTop = Math.max(yBot + 0.006, h - topT - 0.002);
      const frameSpanH = yTop - yBot;
      const legT = Math.min(0.028, w * 0.04, d * 0.04);
      const inset = Math.min(0.038, w * 0.05, d * 0.05);
      const legX = Math.max(legT * 0.6, w * 0.5 - inset - legT * 0.5);
      const legZ = Math.max(legT * 0.6, d * 0.5 - inset - legT * 0.5);

      for (const lx of [-legX, legX]) {
        for (const lz of [-legZ, legZ]) {
          addPart(g, new THREE.BoxGeometry(legT, frameSpanH, legT), frameMat, lx, yBot + frameSpanH * 0.5, lz);
        }
      }

      const railT = Math.min(0.024, frameSpanH * 0.18);
      const railXLen = Math.max(0.004, 2 * legX - legT - 0.002);
      const railZLen = Math.max(0.004, 2 * legZ - legT - 0.002);
      const railYs = [yTop - railT * 0.5];
      if (frameSpanH > railT * 2.8) {
        railYs.push(Math.min(yTop - railT - 0.004, yBot + Math.min(0.045, frameSpanH * 0.25)));
      }
      for (const ry of railYs) {
        for (const sz of [-legZ, legZ]) {
          addPart(g, new THREE.BoxGeometry(railXLen, railT, legT * 0.72), frameMat, 0, ry, sz);
        }
        for (const sx of [-legX, legX]) {
          addPart(g, new THREE.BoxGeometry(legT * 0.72, railT, railZLen), frameMat, sx, ry, 0);
        }
      }
      break;
    }

    case 'bistro': {
      const r = Math.min(w, d) * 0.42;
      const topT = Math.min(0.04, h * 0.16);
      const baseH = Math.min(0.025, h * 0.14);
      const stemH = Math.max(0.003, h - topT - baseH - 0.006);
      addPart(g, new THREE.CylinderGeometry(r, r, topT, 24), mainMat, 0, h - topT * 0.5, 0);
      addPart(g, new THREE.CylinderGeometry(Math.min(0.03, r * 0.18), Math.min(0.04, r * 0.22), stemH, 12), darkMat, 0, 0.004 + baseH + stemH * 0.5, 0);
      addPart(g, new THREE.CylinderGeometry(r * 0.55, r * 0.55, baseH, 16), darkMat, 0, 0.002 + baseH * 0.5, 0);
      for (const side of [-1, 1]) {
        const cx = side * (r + 0.18);
        addPart(g, new THREE.CylinderGeometry(0.18, 0.18, 0.035, 16), mainMat, cx, 0.4495, 0);
        addPart(g, new THREE.CylinderGeometry(0.02, 0.02, 0.428, 8), darkMat, cx, 0.002 + 0.214, 0);
        addPart(g, new THREE.BoxGeometry(0.04, 0.36, 0.30), mainMat, cx + side * 0.16, 0.469 + 0.18, 0);
      }
      break;
    }

    case 'dining_chair':
    case 'office_chair': {
      const seatH = Math.min(0.055, Math.max(0.004, h * 0.12));
      const seatBottom = Math.max(0.006, h * 0.44);
      const seatTop = Math.min(h - 0.006, seatBottom + seatH);
      const legSpanH = Math.max(0.003, seatBottom - 0.004);
      const legT = Math.min(0.035, w * 0.12, d * 0.12);
      for (const lx of [-w * 0.38, w * 0.38]) {
        for (const lz of [-d * 0.38, d * 0.38]) {
          addPart(g, new THREE.BoxGeometry(legT, legSpanH, legT), darkMat, lx, 0.002 + legSpanH * 0.5, lz);
        }
      }
      addPart(g, new THREE.BoxGeometry(w, Math.max(0.004, seatTop - seatBottom), d), mainMat, 0, (seatBottom + seatTop) * 0.5, 0);
      const backH = Math.max(0.004, h - seatTop - 0.002);
      const backD = Math.min(0.06, d * 0.18);
      addPart(g, new THREE.BoxGeometry(w, backH, backD), mainMat, 0, seatTop + 0.002 + backH * 0.5, -d * 0.5 + backD * 0.5);
      break;
    }

    case 'barstool': {
      const r = Math.min(w, d) * 0.46;
      const seatT = Math.min(0.06, h * 0.18);
      const baseT = Math.min(0.025, h * 0.14);
      const stemH = Math.max(0.003, h - seatT - baseT - 0.006);
      addPart(g, new THREE.CylinderGeometry(r, r * 0.95, seatT, 18), mainMat, 0, h - seatT * 0.5, 0);
      addPart(g, new THREE.CylinderGeometry(Math.min(0.028, r * 0.25), Math.min(0.035, r * 0.3), stemH, 12), darkMat, 0, 0.004 + baseT + stemH * 0.5, 0);
      addPart(g, new THREE.CylinderGeometry(r * 0.85, r * 0.85, baseT, 18), darkMat, 0, 0.002 + baseT * 0.5, 0);
      break;
    }

    case 'console_tv': {
      const credH = Math.min(22 * IN_TO_M, h * 0.44);
      const plinthH = Math.min(0.055, credH * 0.14);
      const topT = Math.min(0.036, credH * 0.12);
      const bodyY0 = 0.004 + plinthH;
      const bodyY1 = Math.max(bodyY0 + 0.004, credH - topT - 0.002);
      const bodyH = bodyY1 - bodyY0;
      addPart(g, new THREE.BoxGeometry(w * 0.94, plinthH, d * 0.90), darkMat, 0, 0.002 + plinthH * 0.5, 0);
      addPart(g, new THREE.BoxGeometry(w * 0.98, bodyH, d * 0.97), mainMat, 0, (bodyY0 + bodyY1) * 0.5, 0);
      addPart(g, new THREE.BoxGeometry(w, topT, d), darkMat, 0, credH - topT * 0.5, 0);

      const tvW = Math.min(w * 0.88, 72.2 * IN_TO_M);
      const standH = Math.min(3.5 * IN_TO_M, Math.max(0.006, (h - credH) * 0.12));
      const tvY0 = credH + standH + 0.004;
      const tvH = Math.max(0.006, h - tvY0);
      const tvD = Math.min(0.042, d * 0.24);
      const tvZ = 0;

      // Wide-stance TV stand feet and vertical risers on top of console
      const footH = Math.min(0.014, standH * 0.25);
      const footW = Math.min(0.05, w * 0.05);
      const footD = Math.min(0.24, d * 0.65);
      const riserH = Math.max(0.003, standH - footH - 0.002);
      const riserW = Math.min(0.034, footW * 0.8);
      const riserD = Math.min(0.036, footD * 0.4);
      for (const sx of [-1, 1]) {
        const lx = sx * tvW * 0.32;
        addPart(g, new THREE.BoxGeometry(footW, footH, footD), darkMat, lx, credH + 0.002 + footH * 0.5, tvZ);
        addPart(g, new THREE.BoxGeometry(riserW, riserH, riserD), darkMat, lx, credH + 0.004 + footH + riserH * 0.5, tvZ);
      }

      // Slim 82" TV chassis + glossy +Z front screen panel separated by 0.002 m
      const bezelMat = makeMat('#111827', 0.42, 0.35);
      const screenMat = makeMat('#070b14', 0.12, 0.35);
      addPart(g, new THREE.BoxGeometry(tvW, tvH, tvD), bezelMat, 0, tvY0 + tvH * 0.5, tvZ);
      const scrW = Math.max(0.004, tvW - Math.min(0.036, tvW * 0.04));
      const scrH = Math.max(0.004, tvH - Math.min(0.036, tvH * 0.06));
      const scrMaxZ = d * 0.5 - 0.002;
      const scrD = Math.min(0.005, Math.max(0.001, scrMaxZ - (tvZ + tvD * 0.5 + 0.002)));
      if (tvZ + tvD * 0.5 + 0.002 + scrD <= scrMaxZ + 1e-6) {
        addPart(g, new THREE.BoxGeometry(scrW, scrH, scrD), screenMat, 0, tvY0 + tvH * 0.5, tvZ + tvD * 0.5 + 0.002 + scrD * 0.5);
      }
      break;
    }

    case 'floor_speaker': {
      const plinthH = Math.min(0.032, h * 0.08);
      addPart(g, new THREE.BoxGeometry(w, plinthH, d), darkMat, 0, 0.002 + plinthH * 0.5, 0);

      const cabW = w * 0.88;
      const cabD = d * 0.86;
      const cabY0 = 0.004 + plinthH;
      const cabH = Math.max(0.01, h - cabY0);
      const cabZ = -d * 0.03;
      addPart(g, new THREE.BoxGeometry(cabW, cabH, cabD), mainMat, 0, cabY0 + cabH * 0.5, cabZ);

      // Front acoustic baffle and 4 Hi-Fi drivers strictly within +d/2
      const cabFrontZ = cabZ + cabD * 0.5;
      const solidBudget = Math.max(0, d * 0.5 - cabFrontZ - 0.006);
      if (solidBudget > 0.003) {
        const baffleMat = makeMat('#0f172a', 0.55, 0.15);
        const trimMat = makeMat('#94a3b8', 0.32, 0.65);
        const tweeterMat = makeMat('#090d16', 0.35, 0.25);
        const wooferMat = makeMat('#b45309', 0.38, 0.45);

        const baffleT = Math.min(0.010, solidBudget * 0.48);
        const trimT = Math.min(0.006, solidBudget * 0.28);
        const coneT = Math.min(0.005, solidBudget * 0.24);

        const baffleZ = cabFrontZ + 0.002 + baffleT * 0.5;
        const baffleW = cabW * 0.88;
        const baffleH = Math.max(0.01, cabH * 0.94);
        addPart(g, new THREE.BoxGeometry(baffleW, baffleH, baffleT), baffleMat, 0, cabY0 + cabH * 0.5, baffleZ);

        const trimZ = cabFrontZ + 0.004 + baffleT + trimT * 0.5;
        const coneZ = cabFrontZ + 0.006 + baffleT + trimT + coneT * 0.5;
        const drivers = [
          [0.85, 0.16, tweeterMat],
          [0.67, 0.25, tweeterMat],
          [0.46, 0.34, wooferMat],
          [0.25, 0.34, wooferMat],
        ];
        for (const [yFrac, rFrac, innerMat] of drivers) {
          const rTrim = Math.max(0.005, Math.min(baffleW * rFrac, cabH * 0.085));
          const rCone = Math.max(0.003, rTrim * 0.72);
          const cy = cabY0 + cabH * yFrac;
          const trimMesh = addPart(g, new THREE.CylinderGeometry(rTrim, rTrim, trimT, 20), trimMat, 0, cy, trimZ);
          trimMesh.rotation.x = Math.PI * 0.5;
          const coneMesh = addPart(g, new THREE.CylinderGeometry(rCone, rCone * 0.74, coneT, 20), innerMat, 0, cy, coneZ);
          coneMesh.rotation.x = Math.PI * 0.5;
        }
      }
      break;
    }

    case 'cabinet': {
      const plinthH = Math.min(0.055, h * 0.10);
      const topT = Math.min(0.036, h * 0.08);
      const bodyY0 = 0.004 + plinthH;
      const bodyY1 = Math.max(bodyY0 + 0.004, h - topT - 0.002);
      const bodyH = bodyY1 - bodyY0;
      addPart(g, new THREE.BoxGeometry(w * 0.92, plinthH, d * 0.90), darkMat, 0, 0.002 + plinthH * 0.5, 0);
      addPart(g, new THREE.BoxGeometry(w * 0.98, bodyH, d * 0.97), mainMat, 0, (bodyY0 + bodyY1) * 0.5, 0);
      addPart(g, new THREE.BoxGeometry(w, topT, d), darkMat, 0, h - topT * 0.5, 0);
      break;
    }

    case 'bookcase': {
      const t = Math.min(0.028, w * 0.08);
      const tbH = Math.min(t, h * 0.15);
      const sideH = Math.max(0.006, h - 0.002);
      const inW = Math.max(0.01, w - t * 2 - 0.004);
      const bt = Math.min(0.016, d * 0.12);
      const innerY0 = 0.002 + tbH + 0.002;
      const innerY1 = Math.max(innerY0 + 0.006, h - tbH - 0.002);
      const backH = innerY1 - innerY0;
      // Left & right side panels
      addPart(g, new THREE.BoxGeometry(t, sideH, d), mainMat, -w * 0.5 + t * 0.5, 0.002 + sideH * 0.5, 0);
      addPart(g, new THREE.BoxGeometry(t, sideH, d), mainMat, w * 0.5 - t * 0.5, 0.002 + sideH * 0.5, 0);
      // Bottom, top, and back panels strictly inside sides
      addPart(g, new THREE.BoxGeometry(inW, tbH, d), mainMat, 0, 0.002 + tbH * 0.5, 0);
      addPart(g, new THREE.BoxGeometry(inW, tbH, d), mainMat, 0, h - tbH * 0.5, 0);
      addPart(g, new THREE.BoxGeometry(inW, backH, bt), mainMat, 0, (innerY0 + innerY1) * 0.5, -d * 0.5 + bt * 0.5);
      // 3 interior shelves evenly spaced inside cavity
      const shelfW = Math.max(0.006, inW - 0.002);
      const shelfT = Math.min(0.026, Math.max(0.001, backH * 0.14));
      const shelfD = Math.max(0.01, d - bt - 0.012);
      const shelfZ = -d * 0.5 + bt + 0.004 + shelfD * 0.5;
      for (let s = 1; s < 4; s++) {
        addPart(g, new THREE.BoxGeometry(shelfW, shelfT, shelfD), darkMat, 0, innerY0 + (backH * s) / 4, shelfZ);
      }
      break;
    }

    case 'bed': {
      const hbH = Math.max(0.006, h - 0.002);
      const hbD = Math.min(0.12, d * 0.14);
      const baseH = Math.min(0.34, h * 0.38);
      const frameH = Math.max(0.004, baseH - 0.002);
      const frameD = Math.max(0.02, d - hbD - 0.003);
      const mattH = Math.min(0.24, Math.max(0.004, h * 0.25));
      const mattY0 = baseH + 0.002;
      const mattD = Math.max(0.01, d - hbD - Math.min(0.06, d * 0.25));
      // Headboard at -Z
      addPart(g, new THREE.BoxGeometry(w, hbH, hbD), woodMat, 0, 0.002 + hbH * 0.5, -d * 0.5 + hbD * 0.5);
      // Frame in front of headboard
      addPart(g, new THREE.BoxGeometry(w, frameH, frameD), woodMat, 0, 0.002 + frameH * 0.5, d * 0.5 - frameD * 0.5);
      // Mattress
      addPart(g, new THREE.BoxGeometry(w * 0.95, mattH, mattD), whiteMat, 0, mattY0 + mattH * 0.5, hbD * 0.5);
      // Duvet cover overhanging sides & stopping past mattress foot
      const duvetLen = Math.min(mattD * 0.60, Math.max(0.012, mattD - Math.min(0.46, mattD * 0.38)));
      const duvetBot = mattY0 + mattH * 0.55;
      const duvetTop = mattY0 + mattH + Math.min(0.018, h * 0.08);
      const duvetZEnd = d * 0.5 - Math.min(0.016, frameD * 0.08);
      addPart(g, new THREE.BoxGeometry(w * 0.97, duvetTop - duvetBot, duvetLen), accentMat, 0, (duvetBot + duvetTop) * 0.5, duvetZEnd - duvetLen * 0.5);
      // Pillows near headboard
      const pCount = w > 1.25 ? 2 : 1;
      const pH = Math.min(0.11, Math.max(0.003, h * 0.12));
      const pD = Math.min(0.36, mattD * 0.26);
      const pZ = -d * 0.5 + hbD + Math.min(0.05, frameD * 0.2) + pD * 0.5;
      for (let p = 0; p < pCount; p++) {
        const px = pCount === 1 ? 0 : (p === 0 ? -w * 0.24 : w * 0.24);
        addPart(g, new THREE.BoxGeometry(w * (pCount === 1 ? 0.65 : 0.38), pH, pD), pillowMat, px, mattY0 + mattH + 0.003 + pH * 0.5, pZ);
      }
      break;
    }

    case 'lamp': {
      const r = Math.min(w, d) * 0.42;
      const baseH = Math.min(0.04, h * 0.15);
      const shadeH = Math.min(0.34, h * 0.32);
      const poleBot = 0.004 + baseH;
      const poleH = Math.max(0.004, h - shadeH * 0.5 - poleBot);
      addPart(g, new THREE.CylinderGeometry(r * 0.7, r * 0.75, baseH, 16), darkMat, 0, 0.002 + baseH * 0.5, 0);
      addPart(g, new THREE.CylinderGeometry(Math.min(0.02, r * 0.2), Math.min(0.02, r * 0.2), poleH, 10), darkMat, 0, poleBot + poleH * 0.5, 0);
      addPart(g, new THREE.CylinderGeometry(r * 0.7, r, shadeH, 18), makeMat('#fef3c7', 0.5, 0), 0, h - shadeH * 0.5, 0);
      break;
    }

    case 'plant': {
      const r = Math.min(w, d) * 0.42;
      const potH = Math.max(0.004, h * 0.34 - 0.002);
      const trunkH = Math.max(0.004, h * 0.45);
      const canopyR = Math.min(r * 1.15, Math.max(0.003, h * 0.55));
      const accentR = Math.min(r * 0.85, Math.max(0.0025, h * 0.45));
      addPart(g, new THREE.CylinderGeometry(r * 0.85, r * 0.6, potH, 16), makeMat('#d6d3d1', 0.8, 0), 0, 0.002 + potH * 0.5, 0);
      addPart(g, new THREE.CylinderGeometry(Math.min(0.03, r * 0.25), Math.min(0.04, r * 0.35), trunkH, 8), woodMat, 0, Math.max(0.002 + trunkH * 0.5, h * 0.48), 0);
      addPart(g, new THREE.SphereGeometry(canopyR, 14, 12), mainMat, 0, Math.max(0.002 + canopyR, h * 0.72), 0);
      addPart(g, new THREE.SphereGeometry(accentR, 12, 10), makeMat('#4d7c0f', 0.8, 0), canopyR * 0.30, Math.max(0.002 + accentR, h * 0.82), -canopyR * 0.17);
      break;
    }

    case 'baby_grand': {
      const pianoMat = makeMat(item.color, 0.18, 0.12);
      const brassMat = makeMat('#d4af37', 0.32, 0.65);
      const ebonyMat = makeMat('#0f172a', 0.25, 0.10);

      function makeGrandShape(sw, sd) {
        const s = new THREE.Shape();
        s.moveTo(-sw * 0.50, -sd * 0.28);
        s.lineTo(sw * 0.50, -sd * 0.28);
        s.lineTo(sw * 0.50, -sd * 0.15);
        s.bezierCurveTo(sw * 0.50, sd * 0.02, sw * 0.15, sd * 0.06, sw * 0.12, sd * 0.28);
        s.bezierCurveTo(sw * 0.10, sd * 0.53, -sw * 0.48, sd * 0.53, -sw * 0.50, sd * 0.22);
        s.lineTo(-sw * 0.50, -sd * 0.28);
        return s;
      }

      const rimBot = Math.min(0.64, h * 0.48);
      const rimTop = Math.min(0.97, Math.max(rimBot + 0.005, h * 0.74));
      const rimH = rimTop - rimBot;

      // 3 Tapered Legs + Brass Casters
      const casterH = Math.min(0.032, Math.max(0.002, (rimBot - 0.006) * 0.08));
      const casterR = Math.min(0.024, w * 0.05, d * 0.05);
      const legY0 = 0.004 + casterH;
      const legH2 = Math.max(0.003, rimBot - 0.002 - legY0);
      for (const [lx, lz] of [[-w * 0.36, d * 0.15], [w * 0.36, d * 0.15], [-w * 0.16, -d * 0.32]]) {
        addPart(g, new THREE.CylinderGeometry(casterR, casterR, casterH, 10), brassMat, lx, 0.002 + casterH * 0.5, lz);
        addPart(g, new THREE.CylinderGeometry(Math.min(0.042, w * 0.07), Math.min(0.024, w * 0.045), legH2, 12), pianoMat, lx, legY0 + legH2 * 0.5, lz);
      }

      // Pedal Lyre
      if (h >= 0.30 && w >= 0.30 && d >= 0.30) {
        const lyreZ = d * 0.08;
        addPart(g, new THREE.BoxGeometry(0.16, 0.038, 0.055), pianoMat, 0, 0.055, lyreZ);
        const lyreH = Math.max(0.02, rimBot - 0.002 - 0.076);
        for (const rx of [-0.05, 0.05]) {
          addPart(g, new THREE.CylinderGeometry(0.011, 0.011, lyreH, 8), pianoMat, rx, 0.076 + lyreH * 0.5, lyreZ);
        }
        for (const px of [-0.045, 0, 0.045]) {
          addPart(g, new THREE.BoxGeometry(0.018, 0.012, 0.055), brassMat, px, 0.050, lyreZ + 0.057);
        }
      }

      // Curved Rim Case
      const rimGeo = new THREE.ExtrudeGeometry(makeGrandShape(w, d), { depth: rimH, bevelEnabled: false, curveSegments: 18 });
      rimGeo.rotateX(-Math.PI / 2);
      addPart(g, rimGeo, pianoMat, 0, rimBot, 0);

      // Golden Cast-Iron Harp / Soundboard Plate
      const harpH = Math.min(0.014, Math.max(0.001, (h - rimTop) * 0.10));
      const harpGeo = new THREE.ExtrudeGeometry(makeGrandShape(w * 0.86, d * 0.84), { depth: harpH, bevelEnabled: false, curveSegments: 16 });
      harpGeo.rotateX(-Math.PI / 2);
      addPart(g, harpGeo, brassMat, -w * 0.03, rimTop + 0.002, -d * 0.02);

      // Angled Propped Lid + Brass Prop Stick (hinged along bass spine -X)
      const lidT = Math.min(0.020, Math.max(0.001, (h - rimTop) * 0.12));
      const hingeY = rimTop + harpH + 0.004;
      const openAngle = Math.max(0, Math.min(0.38, Math.asin(Math.max(0, Math.min(0.85, (h - hingeY - lidT) / Math.max(w, 0.01))))));
      const lidW = Math.max(0.01, w - 0.004);
      const lidD = Math.max(0.01, d - 0.004);
      const lidGeo = new THREE.ExtrudeGeometry(makeGrandShape(lidW, lidD), { depth: lidT, bevelEnabled: false, curveSegments: 18 });
      lidGeo.rotateX(-Math.PI / 2);
      lidGeo.translate(lidW * 0.50, 0, 0);
      const lidMesh = addPart(g, lidGeo, pianoMat, -w * 0.50 + lidT * Math.sin(openAngle) + 0.002, hingeY, 0);
      lidMesh.rotation.z = openAngle;

      if (openAngle > 0.08 && w >= 0.30) {
        const stickY0 = rimTop + harpH + 0.004;
        const stickX = -w * 0.50 + w * 0.68;
        const stickY1 = hingeY + (stickX - (-w * 0.50 + lidT * Math.sin(openAngle) + 0.002)) * Math.sin(openAngle) - 0.008;
        const stickH = stickY1 - stickY0;
        if (stickH > 0.02) {
          addPart(g, new THREE.CylinderGeometry(0.008, 0.008, stickH, 8), brassMat, w * 0.18, stickY0 + stickH * 0.5, d * 0.05);
        }
      }

      // Front Keyboard Action, Cheek Blocks, Ivory/Ebony Keys & Music Desk (strictly in z >= d*0.28 + 0.002)
      const frontZ0 = d * 0.28 + 0.002;
      const frontD = Math.max(0.006, d * 0.50 - frontZ0);
      const frontZ = frontZ0 + frontD * 0.5;
      const keyBedH = Math.max(0.002, rimH * 0.34);
      addPart(g, new THREE.BoxGeometry(w, keyBedH, frontD), pianoMat, 0, rimBot + keyBedH * 0.5, frontZ);

      const keyBedTop = rimBot + keyBedH;
      const upperKeyH = Math.max(0.002, rimTop - keyBedTop - 0.002);
      const cheekW = w * 0.065;
      for (const side of [-1, 1]) {
        addPart(g, new THREE.BoxGeometry(cheekW, upperKeyH, frontD), pianoMat, side * (w * 0.5 - cheekW * 0.5), keyBedTop + 0.002 + upperKeyH * 0.5, frontZ);
      }

      const inKeyW = Math.max(0.01, w - cheekW * 2 - 0.006);
      const fbD = Math.max(0.002, frontD * 0.28);
      const fbCenterZ = frontZ0 + fbD * 0.5;
      addPart(g, new THREE.BoxGeometry(inKeyW, upperKeyH, fbD), pianoMat, 0, keyBedTop + 0.002 + upperKeyH * 0.5, fbCenterZ);

      const wkZ0 = frontZ0 + fbD + 0.002;
      const wkD = Math.max(0.002, d * 0.494 - wkZ0);
      const wkH = Math.min(0.022, Math.max(0.001, upperKeyH * 0.45));
      const wkY0 = keyBedTop + 0.002;
      addPart(g, new THREE.BoxGeometry(inKeyW, wkH, wkD), whiteMat, 0, wkY0 + wkH * 0.5, wkZ0 + wkD * 0.5);

      if (w >= 0.30 && d >= 0.30) {
        const bkH = Math.min(0.012, upperKeyH * 0.25);
        const bkD = Math.max(0.004, wkD * 0.54);
        const bkY = wkY0 + wkH + 0.002 + bkH * 0.5;
        const bkZ = wkZ0 + 0.002 + bkD * 0.5;
        const pattern = [1, 1, 0, 1, 1, 1, 0];
        const totalSlots = 21;
        const step = (inKeyW * 0.90) / totalSlots;
        for (let i = 0; i < totalSlots; i++) {
          if (pattern[i % 7]) {
            const bx = -inKeyW * 0.45 + (i + 0.5) * step;
            addPart(g, new THREE.BoxGeometry(step * 0.56, bkH, bkD), ebonyMat, bx, bkY, bkZ);
          }
        }
      }

      if (h - rimTop > 0.03 && w >= 0.30) {
        const deskH = Math.min(0.13, h - rimTop - 0.006);
        addPart(g, new THREE.BoxGeometry(w * 0.46, deskH, Math.min(0.018, fbD * 0.5)), pianoMat, 0, rimTop + 0.003 + deskH * 0.5, fbCenterZ);
      }
      break;
    }

    case 'piano_bench': {
      const benchMat = makeMat(item.color, 0.22, 0.10);
      const seatT = Math.min(0.065, h * 0.18);
      const legT = Math.min(0.038, w * 0.08, d * 0.12);
      const legSpanH = Math.max(0.003, h - seatT - 0.004);
      const apronH = Math.min(0.055, h * 0.14, legSpanH);
      const apronW = Math.max(0.006, w - legT * 3.2 - 0.004);
      const apronD = Math.max(0.006, d - legT * 3.2 - 0.004);
      addPart(g, new THREE.BoxGeometry(w, seatT, d), darkMat, 0, h - seatT * 0.5, 0);
      addPart(g, new THREE.BoxGeometry(apronW, apronH, apronD), benchMat, 0, h - seatT - 0.002 - apronH * 0.5, 0);
      for (const lx of [-w * 0.5 + legT, w * 0.5 - legT]) {
        for (const lz of [-d * 0.5 + legT, d * 0.5 - legT]) {
          addPart(g, new THREE.BoxGeometry(legT, legSpanH, legT), benchMat, lx, 0.002 + legSpanH * 0.5, lz);
        }
      }
      break;
    }

    case 'combs_bistro_table': {
      const marbleMat = makeMat(item.color, 0.34, 0.03);
      const walnutMat = makeMat('#4a2e1f', 0.55, 0.05);
      const shadowWalnutMat = makeMat('#352015', 0.62, 0.04);

      const r = Math.min(w, d) * 0.5;
      const topT = Math.min(1.4 * IN_TO_M, h * 0.16);
      const bevelT = Math.min(0.010, topT * 0.30);
      const bevelS = Math.min(0.012, r * 0.06);
      const plinthH = Math.min(0.022, h * 0.08);
      const collarH = Math.min(0.022, h * 0.08);
      const pedY0 = 0.002 + plinthH + 0.002;
      const pedY1 = Math.max(pedY0 + 0.006, h - topT - collarH - 0.004);
      const pedH = pedY1 - pedY0;

      // 1. Beveled 8-sided ivory marble tabletop (flat edges aligned with X/Z axes)
      const rCore = Math.max(0.01, r - bevelS / Math.cos(Math.PI / 8));
      const octShape = new THREE.Shape();
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4 + Math.PI / 8;
        const px = rCore * Math.cos(a);
        const py = rCore * Math.sin(a);
        if (i === 0) octShape.moveTo(px, py);
        else octShape.lineTo(px, py);
      }
      octShape.closePath();

      let topGeo = new THREE.ExtrudeGeometry(octShape, {
        depth: Math.max(0.002, topT - 2 * bevelT),
        bevelEnabled: true,
        bevelThickness: bevelT,
        bevelSize: bevelS,
        bevelSegments: 1,
      });
      topGeo.rotateX(-Math.PI / 2);
      if (topGeo.index) topGeo = topGeo.toNonIndexed();
      topGeo.computeVertexNormals();
      addPart(g, topGeo, marbleMat, 0, h - topT + bevelT, 0);

      // 2. Under-top mounting collar
      const collarMesh = addPart(
        g,
        new THREE.CylinderGeometry(r * 0.44, r * 0.38, collarH, 8),
        shadowWalnutMat,
        0,
        h - topT - 0.002 - collarH * 0.5,
        0
      );
      collarMesh.rotation.y = Math.PI / 8;

      // 3. Faceted flared Dark Walnut pedestal
      let pedGeo = new THREE.CylinderGeometry(r * 0.30, r * 0.44, pedH, 8);
      pedGeo = pedGeo.toNonIndexed();
      pedGeo.computeVertexNormals();
      const pedMesh = addPart(g, pedGeo, walnutMat, 0, pedY0 + pedH * 0.5, 0);
      pedMesh.rotation.y = Math.PI / 8;

      // 4. Floor plinth ring
      const plinthMesh = addPart(
        g,
        new THREE.CylinderGeometry(r * 0.41, r * 0.42, plinthH, 8),
        shadowWalnutMat,
        0,
        0.002 + plinthH * 0.5,
        0
      );
      plinthMesh.rotation.y = Math.PI / 8;
      break;
    }

    case 'tilda_banquette_right':
    case 'tilda_banquette_left': {
      const sign = item.style === 'tilda_banquette_left' ? -1 : 1;
      const uphMat = makeMat(item.color, 0.82, 0.02);
      const seamCol = new THREE.Color(item.color).multiplyScalar(0.76);
      const seamMat = new THREE.MeshStandardMaterial({ color: seamCol, roughness: 0.90, metalness: 0.02 });
      const coolWalnutMat = makeMat('#5a3d2b', 0.58, 0.04);

      const legH = Math.min(2.5 * IN_TO_M, h * 0.14);
      const baseY0 = 0.002 + legH + 0.002;
      const seatTop = Math.min(h - 0.06, Math.max(baseY0 + 0.04, h * (18.75 / 30.75)));
      const cushH = Math.min(4.25 * IN_TO_M, Math.max(0.015, (seatTop - baseY0) * 0.34));
      const boxTop = Math.max(baseY0 + 0.004, seatTop - cushH - 0.004);
      const benchD = Math.min(25.25 * IN_TO_M, w * 0.48, d * 0.48);
      const backD = Math.min(7.0 * IN_TO_M, benchD * 0.32);
      const backY0 = seatTop + 0.004;
      const midBackY = 0.5 * (backY0 + h);
      const seamHalf = Math.min(0.005, Math.max(0.001, (h - backY0) * 0.06));

      const addHorizontalChannelSpine = (x0, x1, z0, z1, seamInsetSide) => {
        const sw = x1 - x0;
        const sd = z1 - z0;
        if (sw <= 0.003 || sd <= 0.003) return;
        const cx = 0.5 * (x0 + x1);
        const cz = 0.5 * (z0 + z1);

        // Lower back frame behind seat
        const lowerH = seatTop - baseY0;
        if (lowerH > 0.002) {
          addPart(g, new THREE.BoxGeometry(sw, lowerH, sd), uphMat, cx, baseY0 + lowerH * 0.5, cz);
        }

        // Lower horizontal channel
        const ch1Y1 = midBackY - seamHalf - 0.001;
        const ch1H = ch1Y1 - backY0;
        if (ch1H > 0.002) {
          addPart(g, new THREE.BoxGeometry(sw, ch1H, sd), uphMat, cx, backY0 + ch1H * 0.5, cz);
        }

        // Recessed horizontal channel seam
        const seamH = seamHalf * 2;
        const inset = Math.min(0.012, (seamInsetSide === '+z' ? sd : sw) * 0.28);
        if (seamInsetSide === '+z') {
          const rsd = Math.max(0.003, sd - inset);
          addPart(g, new THREE.BoxGeometry(sw, seamH, rsd), seamMat, cx, midBackY, z0 + rsd * 0.5);
        } else if (seamInsetSide === '-x') {
          const rsw = Math.max(0.003, sw - inset);
          addPart(g, new THREE.BoxGeometry(rsw, seamH, sd), seamMat, x1 - rsw * 0.5, midBackY, cz);
        } else {
          const rsw = Math.max(0.003, sw - inset);
          addPart(g, new THREE.BoxGeometry(rsw, seamH, sd), seamMat, x0 + rsw * 0.5, midBackY, cz);
        }

        // Upper horizontal channel
        const ch2Y0 = midBackY + seamHalf + 0.001;
        const ch2H = h - ch2Y0;
        if (ch2H > 0.002) {
          addPart(g, new THREE.BoxGeometry(sw, ch2H, sd), uphMat, cx, ch2Y0 + ch2H * 0.5, cz);
        }
      };

      const addStorageSeatBlock = (x0, x1, z0, z1) => {
        const sw = x1 - x0;
        const sd = z1 - z0;
        if (sw <= 0.003 || sd <= 0.003) return;
        const cx = 0.5 * (x0 + x1);
        const cz = 0.5 * (z0 + z1);
        const boxH = boxTop - baseY0;
        if (boxH > 0.002) {
          addPart(g, new THREE.BoxGeometry(sw, boxH, sd), uphMat, cx, baseY0 + boxH * 0.5, cz);
        }
        const cushY0 = seatTop - cushH;
        addPart(g, new THREE.BoxGeometry(sw, cushH, sd), uphMat, cx, cushY0 + cushH * 0.5, cz);
      };

      const zBack0 = -d * 0.5;
      const zBack1 = zBack0 + backD;
      const zSeat0 = zBack1 + 0.003;
      const zBench1 = zBack0 + benchD;
      const sideSeamDir = sign === 1 ? '-x' : '+x';
      const sideX0 = sign === 1 ? w * 0.5 - backD : -w * 0.5;
      const sideX1 = sign === 1 ? w * 0.5 : -w * 0.5 + backD;
      const benchSeatX0 = sign === 1 ? -w * 0.5 : -w * 0.5 + backD + 0.003;
      const benchSeatX1 = sign === 1 ? w * 0.5 - backD - 0.003 : w * 0.5;

      // 1. Back Bench piece (back spine + corner return spine + bench storage seat)
      addHorizontalChannelSpine(-w * 0.5, w * 0.5, zBack0, zBack1, '+z');
      addHorizontalChannelSpine(sideX0, sideX1, zSeat0, zBench1, sideSeamDir);
      addStorageSeatBlock(benchSeatX0, benchSeatX1, zSeat0, zBench1);

      const legR = Math.min(0.022, benchD * 0.06);
      const legInsetB = Math.min(0.06, Math.max(legR + 0.004, benchD * 0.18));
      for (const lx of [-w * 0.5 + legInsetB, w * 0.5 - legInsetB]) {
        for (const lz of [zBack0 + legInsetB, zBench1 - legInsetB]) {
          addPart(g, new THREE.CylinderGeometry(legR, legR * 0.85, legH, 10), coolWalnutMat, lx, 0.002 + legH * 0.5, lz);
        }
      }

      // 2. Armless Wing piece (wing side spine + wing storage seat)
      const zWing0 = zBench1 + 0.004;
      const zWing1 = d * 0.5;
      const wingLen = zWing1 - zWing0;
      if (wingLen > 0.02) {
        addHorizontalChannelSpine(sideX0, sideX1, zWing0, zWing1, sideSeamDir);
        const wingSeatX0 = sign === 1 ? w * 0.5 - benchD : -w * 0.5 + backD + 0.003;
        const wingSeatX1 = sign === 1 ? w * 0.5 - backD - 0.003 : -w * 0.5 + benchD;
        addStorageSeatBlock(wingSeatX0, wingSeatX1, zWing0, zWing1);

        const wingOuterX0 = sign === 1 ? w * 0.5 - benchD : -w * 0.5;
        const wingOuterX1 = sign === 1 ? w * 0.5 : -w * 0.5 + benchD;
        const legInsetW = Math.min(0.06, wingLen * 0.25, benchD * 0.22);
        for (const lx of [wingOuterX0 + legInsetW, wingOuterX1 - legInsetW]) {
          for (const lz of [zWing0 + legInsetW, zWing1 - legInsetW]) {
            addPart(g, new THREE.CylinderGeometry(legR, legR * 0.85, legH, 10), coolWalnutMat, lx, 0.002 + legH * 0.5, lz);
          }
        }
      }
      break;
    }

    case 'craig_dining_chair': {
      const uphMat = makeMat(item.color, 0.82, 0.02);
      const walnutMat = makeMat('#42291b', 0.52, 0.05);
      const endGrainMat = makeMat('#b88e68', 0.60, 0.03);

      const seatTop = Math.min(h * 0.74, Math.max(0.08, h * (18.75 / 27.9)));
      const seatT = Math.min(0.072, seatTop * 0.20);
      const seatBot = seatTop - seatT;
      const cutoutGap = Math.min(0.062, Math.max(0.015, (h - seatTop) * 0.26));
      const backBot = seatTop + cutoutGap;
      const backBandH = Math.max(0.03, h - backBot);
      const legR = Math.min(0.019, w * 0.04, d * 0.04);

      // 1. Curved horseshoe wraparound backrest with open cutout above seat
      const backBevelT = Math.min(0.008, backBandH * 0.12);
      const backThickTarget = Math.min(0.056, Math.min(w, d) * 0.12);
      const backBevelS = Math.min(0.006, backThickTarget * 0.12);
      const rxOut = Math.max(0.03, w * 0.5 - legR * 1.25 - backBevelS);
      const syCenter = -d * 0.02;
      const syBackMax = Math.max(syCenter + 0.03, d * 0.5 - legR * 2.35 - backBevelS);
      const rzOut = syBackMax - syCenter;
      const backThick = Math.min(backThickTarget, Math.min(rxOut, rzOut) * 0.42);
      const rxIn = Math.max(0.01, rxOut - backThick);
      const rzIn = Math.max(0.01, rzOut - backThick);

      const aStart = -0.18 * Math.PI;
      const aEnd = 1.18 * Math.PI;
      const arcSegs = 28;
      const capSegs = 8;

      const backShape = new THREE.Shape();
      for (let i = 0; i <= arcSegs; i++) {
        const t = aStart + ((aEnd - aStart) * i) / arcSegs;
        const px = rxOut * Math.cos(t);
        const py = syCenter + rzOut * Math.sin(t);
        if (i === 0) backShape.moveTo(px, py);
        else backShape.lineTo(px, py);
      }
      {
        const pOut = new THREE.Vector2(rxOut * Math.cos(aEnd), syCenter + rzOut * Math.sin(aEnd));
        const pIn = new THREE.Vector2(rxIn * Math.cos(aEnd), syCenter + rzIn * Math.sin(aEnd));
        const m = pOut.clone().add(pIn).multiplyScalar(0.5);
        const v = pOut.clone().sub(pIn).multiplyScalar(0.5);
        const tan = new THREE.Vector2(-v.y, v.x);
        for (let j = 1; j <= capSegs; j++) {
          const phi = (Math.PI * j) / capSegs;
          const pt = m.clone().addScaledVector(v, Math.cos(phi)).addScaledVector(tan, Math.sin(phi));
          backShape.lineTo(pt.x, pt.y);
        }
      }
      for (let i = arcSegs - 1; i >= 0; i--) {
        const t = aStart + ((aEnd - aStart) * i) / arcSegs;
        backShape.lineTo(rxIn * Math.cos(t), syCenter + rzIn * Math.sin(t));
      }
      {
        const pIn = new THREE.Vector2(rxIn * Math.cos(aStart), syCenter + rzIn * Math.sin(aStart));
        const pOut = new THREE.Vector2(rxOut * Math.cos(aStart), syCenter + rzOut * Math.sin(aStart));
        const m = pIn.clone().add(pOut).multiplyScalar(0.5);
        const u = pIn.clone().sub(pOut).multiplyScalar(0.5);
        const tan = new THREE.Vector2(-u.y, u.x);
        for (let j = 1; j < capSegs; j++) {
          const phi = (Math.PI * j) / capSegs;
          const pt = m.clone().addScaledVector(u, Math.cos(phi)).addScaledVector(tan, Math.sin(phi));
          backShape.lineTo(pt.x, pt.y);
        }
      }
      backShape.closePath();

      const backDepth = Math.max(0.008, backBandH - 2 * backBevelT);
      const backGeo = new THREE.ExtrudeGeometry(backShape, {
        depth: backDepth,
        bevelEnabled: true,
        bevelThickness: backBevelT,
        bevelSize: backBevelS,
        bevelSegments: 2,
      });
      backGeo.rotateX(-Math.PI / 2);
      addPart(g, backGeo, uphMat, 0, backBot + backBevelT, 0);

      // 2. Front & back leg target positions
      const clampX = (val) => Math.max(-w * 0.5 + legR, Math.min(w * 0.5 - legR, val));
      const clampZ = (val) => Math.max(-d * 0.5 + legR, Math.min(d * 0.5 - legR, val));

      const backTheta = 0.21 * Math.PI;
      const backLegAngleR = 0.5 * Math.PI - backTheta;
      const backLegAngleL = 0.5 * Math.PI + backTheta;
      const backRadX = rxOut + backBevelS + legR * 0.85;
      const backRadZ = rzOut + backBevelS + legR * 0.85;

      const backTopY = h - 0.006;
      const backTopR = new THREE.Vector3(
        clampX(backRadX * Math.cos(backLegAngleR)),
        backTopY,
        clampZ(-(syCenter + backRadZ * Math.sin(backLegAngleR)))
      );
      const backTopL = new THREE.Vector3(
        clampX(backRadX * Math.cos(backLegAngleL)),
        backTopY,
        clampZ(-(syCenter + backRadZ * Math.sin(backLegAngleL)))
      );
      const legFloorY = Math.max(0.004, legR * 0.25);
      const backBotR = new THREE.Vector3(
        clampX(backTopR.x + Math.min(0.024, w * 0.05)),
        legFloorY,
        clampZ(backTopR.z - Math.min(0.026, d * 0.06))
      );
      const backBotL = new THREE.Vector3(
        clampX(backTopL.x - Math.min(0.024, w * 0.05)),
        legFloorY,
        clampZ(backTopL.z - Math.min(0.026, d * 0.06))
      );

      const frontTopXMag = Math.min(w * 0.5 - legR, (rxOut - backThick * 0.4) * Math.cos(aStart));
      const frontTopZ = clampZ(-(syCenter + (rzOut - backThick * 0.4) * Math.sin(aStart)));
      const frontTopY = backBot + 0.002;
      const frontTopR = new THREE.Vector3(frontTopXMag, frontTopY, frontTopZ);
      const frontTopL = new THREE.Vector3(-frontTopXMag, frontTopY, frontTopZ);
      const frontBotR = new THREE.Vector3(
        clampX(frontTopXMag + Math.min(0.018, w * 0.04)),
        legFloorY,
        clampZ(frontTopZ + Math.min(0.045, d * 0.10))
      );
      const frontBotL = new THREE.Vector3(
        clampX(-frontTopXMag - Math.min(0.018, w * 0.04)),
        legFloorY,
        clampZ(frontTopZ + Math.min(0.045, d * 0.10))
      );

      // 3. Rounded upholstered seat cushion (strictly inside front & back legs)
      const seatBevel = Math.min(0.008, seatT * 0.20);
      const maxSeatHalfW = Math.max(0.02, Math.min(w * 0.38, rxIn - 0.010, frontTopXMag - legR - 0.004));
      const seatW = Math.max(0.03, maxSeatHalfW * 2 - 2 * seatBevel);
      const seatBackZ = Math.max(-d * 0.36, backTopR.z + legR + 0.015);
      const seatFrontZ = Math.min(d * 0.44, frontBotR.z + 0.08);
      const seatD = Math.max(0.03, (seatFrontZ - seatBackZ) - 2 * seatBevel);
      const seatCenterZ = 0.5 * (seatBackZ + seatFrontZ);

      const hw = seatW * 0.5;
      const hd = seatD * 0.5;
      const cr = Math.min(hw * 0.45, hd * 0.45, 0.055);
      const seatShape = new THREE.Shape();
      seatShape.moveTo(-hw + cr, -hd);
      seatShape.lineTo(hw - cr, -hd);
      seatShape.quadraticCurveTo(hw, -hd, hw, -hd + cr);
      seatShape.lineTo(hw, hd - cr);
      seatShape.quadraticCurveTo(hw, hd, hw - cr, hd);
      seatShape.lineTo(-hw + cr, hd);
      seatShape.quadraticCurveTo(-hw, hd, -hw, hd - cr);
      seatShape.lineTo(-hw, -hd + cr);
      seatShape.quadraticCurveTo(-hw, -hd, -hw + cr, -hd);
      seatShape.closePath();

      const seatDepth = Math.max(0.004, seatT - 2 * seatBevel);
      const seatGeo = new THREE.ExtrudeGeometry(seatShape, {
        depth: seatDepth,
        bevelEnabled: true,
        bevelThickness: seatBevel,
        bevelSize: seatBevel,
        bevelSegments: 2,
      });
      seatGeo.rotateX(-Math.PI / 2);
      addPart(g, seatGeo, uphMat, 0, seatBot + seatBevel, seatCenterZ);

      // 4. Four expressed Dark Walnut legs & exposed circular end-grain caps on back leg tops
      addStrut(g, backBotL, backTopL, legR, legR * 0.82, walnutMat, 12);
      addStrut(g, backBotR, backTopR, legR, legR * 0.82, walnutMat, 12);
      addStrut(g, frontBotL, frontTopL, legR * 0.92, legR * 0.78, walnutMat, 12);
      addStrut(g, frontBotR, frontTopR, legR * 0.92, legR * 0.78, walnutMat, 12);

      for (const [botPt, topPt] of [[backBotL, backTopL], [backBotR, backTopR]]) {
        const dir = new THREE.Vector3().subVectors(topPt, botPt).normalize();
        const capH = 0.003;
        const capMesh = addPart(
          g,
          new THREE.CylinderGeometry(legR * 0.96, legR * 0.96, capH, 12),
          endGrainMat,
          topPt.x + dir.x * (capH * 0.5 + 0.0008),
          topPt.y + dir.y * (capH * 0.5 + 0.0008),
          topPt.z + dir.z * (capH * 0.5 + 0.0008)
        );
        capMesh.quaternion.setFromUnitVectors(STRUT_UP, dir);
      }

      // 5. Under-seat wood apron rails connecting the legs cleanly below the cushion
      const railR = Math.min(0.013, legR * 0.72);
      const railY = Math.max(0.015, seatBot - railR - 0.006);
      const lerpLegAtY = (botPt, topPt, yVal) => {
        const t = Math.max(0, Math.min(1, (yVal - botPt.y) / Math.max(1e-4, topPt.y - botPt.y)));
        return new THREE.Vector3().lerpVectors(botPt, topPt, t);
      };
      const fRailL = lerpLegAtY(frontBotL, frontTopL, railY);
      const fRailR = lerpLegAtY(frontBotR, frontTopR, railY);
      const bRailL = lerpLegAtY(backBotL, backTopL, railY);
      const bRailR = lerpLegAtY(backBotR, backTopR, railY);
      addStrut(g, fRailL, bRailL, railR, railR, walnutMat, 10);
      addStrut(g, fRailR, bRailR, railR, railR, walnutMat, 10);
      addStrut(g, fRailL, fRailR, railR, railR, walnutMat, 10);
      addStrut(g, bRailL, bRailR, railR, railR, walnutMat, 10);
      break;
    }
  }

  return g;
}

// ---------------------------------------------------------------------------
// Furniture State, Dragging, Snapping & Wall Clearances
// ---------------------------------------------------------------------------
const furnitureGroup = new THREE.Group();
scene.add(furnitureGroup);

const clearanceGroup = new THREE.Group();
scene.add(clearanceGroup);

let placedItems = []; // { uid, catalogId, name, style, wIn, dIn, hIn, x, z, rot, color, group }
let selectedUid = null;
let uidSeq = 1;

const selectionOutline = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
  new THREE.LineBasicMaterial({ color: 0x38bdf8 })
);
selectionOutline.visible = false;
scene.add(selectionOutline);

function getOrientedExtents(item) {
  const hw = item.wIn * IN_TO_M * 0.5;
  const hd = item.dIn * IN_TO_M * 0.5;
  const rad = (item.rot * Math.PI) / 180;
  const ac = Math.abs(Math.cos(rad));
  const as = Math.abs(Math.sin(rad));
  return {
    ex: hw * ac + hd * as,
    ez: hw * as + hd * ac,
  };
}

function getObbCorners(item) {
  const hw = item.wIn * IN_TO_M * 0.5;
  const hd = item.dIn * IN_TO_M * 0.5;
  const rad = (item.rot * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return [
    [-hw, -hd],
    [hw, -hd],
    [hw, hd],
    [-hw, hd],
  ].map(([lx, lz]) => [item.x + lx * c - lz * s, item.z + lx * s + lz * c]);
}

function pointInObb(px, pz, item) {
  const dx = px - item.x;
  const dz = pz - item.z;
  const rad = (-item.rot * Math.PI) / 180;
  const lx = dx * Math.cos(rad) - dz * Math.sin(rad);
  const lz = dx * Math.sin(rad) + dz * Math.cos(rad);
  return Math.abs(lx) <= item.wIn * IN_TO_M * 0.5 && Math.abs(lz) <= item.dIn * IN_TO_M * 0.5;
}

function obbIntersectsRect(item, r) {
  const [rx0, rz0, rx1, rz1] = r;
  const { ex, ez } = getOrientedExtents(item);
  if (item.x + ex <= rx0 || item.x - ex >= rx1 || item.z + ez <= rz0 || item.z - ez >= rz1) {
    return false;
  }
  const corners = getObbCorners(item);
  for (const [cx, cz] of corners) {
    if (cx > rx0 && cx < rx1 && cz > rz0 && cz < rz1) return true;
  }
  const rCorners = [[rx0, rz0], [rx1, rz0], [rx1, rz1], [rx0, rz1]];
  for (const [cx, cz] of rCorners) {
    if (pointInObb(cx, cz, item)) return true;
  }
  // Check edge overlap via segment midpoint sampling
  for (let i = 0; i < 4; i++) {
    const [ax, az] = corners[i];
    const [bx, bz] = corners[(i + 1) % 4];
    for (let t = 0.25; t <= 0.75; t += 0.25) {
      const mx = ax + (bx - ax) * t;
      const mz = az + (bz - az) * t;
      if (mx > rx0 && mx < rx1 && mz > rz0 && mz < rz1) return true;
    }
  }
  return false;
}

function analyzeItemClearances(item) {
  const { ex, ez } = getOrientedExtents(item);
  const minX = item.x - ex;
  const maxX = item.x + ex;
  const minZ = item.z - ez;
  const maxZ = item.z + ez;

  let northWall = -20;
  let southWall = 20;
  let westWall = -20;
  let eastWall = 20;

  let wallHit = false;
  for (const r of spec.wall_rects_m) {
    const [rx0, rz0, rx1, rz1] = r;
    if (obbIntersectsRect(item, r)) wallHit = true;
    // X-overlap with item AABB -> North/South walls
    if (rx1 > minX && rx0 < maxX) {
      if (rz1 <= item.z && rz1 > northWall) northWall = rz1;
      if (rz0 >= item.z && rz0 < southWall) southWall = rz0;
    }
    // Z-overlap with item AABB -> West/East walls
    if (rz1 > minZ && rz0 < maxZ) {
      if (rx1 <= item.x && rx1 > westWall) westWall = rx1;
      if (rx0 >= item.x && rx0 < eastWall) eastWall = rx0;
    }
  }

  let doorSwingHit = false;
  if (item.style !== 'rug') {
    for (const arc of hingedArcs) {
      const dx = Math.max(minX - arc.midX, 0, arc.midX - maxX);
      const dz = Math.max(minZ - arc.midZ, 0, arc.midZ - maxZ);
      if (Math.hypot(dx, dz) < arc.r * 0.55 && pointInObb(arc.midX, arc.midZ, item)) {
        doorSwingHit = arc.label;
      }
    }
  }

  return {
    northDist: Math.max(0, minZ - northWall),
    southDist: Math.max(0, southWall - maxZ),
    westDist: Math.max(0, minX - westWall),
    eastDist: Math.max(0, eastWall - maxX),
    northWall,
    southWall,
    westWall,
    eastWall,
    wallHit,
    doorSwingHit,
  };
}

function updateClearancesAndSelectionVisuals() {
  clearanceGroup.clear();
  const item = placedItems.find((i) => i.uid === selectedUid);
  if (!item) {
    selectionOutline.visible = false;
    return;
  }

  const info = analyzeItemClearances(item);
  const wM = item.wIn * IN_TO_M;
  const hM = Math.max(0.04, item.hIn * IN_TO_M);
  const dM = item.dIn * IN_TO_M;
  selectionOutline.scale.set(wM + 0.03, hM + 0.03, dM + 0.03);
  selectionOutline.position.set(item.x, hM * 0.5, item.z);
  selectionOutline.rotation.y = (-item.rot * Math.PI) / 180;
  selectionOutline.material.color.setHex(info.wallHit || info.doorSwingHit ? 0xf87171 : 0x38bdf8);
  selectionOutline.visible = true;

  const { ex, ez } = getOrientedExtents(item);
  const lineY = 0.026;
  const addCLine = (x0, z0, x1, z1, col) => {
    const pts = [new THREE.Vector3(x0, lineY, z0), new THREE.Vector3(x1, lineY, z1)];
    clearanceGroup.add(
      new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: col }))
    );
  };
  if (info.northDist < 6) addCLine(item.x, item.z - ez, item.x, info.northWall, 0x38bdf8);
  if (info.southDist < 6) addCLine(item.x, item.z + ez, item.x, info.southWall, 0x38bdf8);
  if (info.westDist < 6) addCLine(item.x - ex, item.z, info.westWall, item.z, 0x34d399);
  if (info.eastDist < 6) addCLine(item.x + ex, item.z, info.eastWall, item.z, 0x34d399);
}

function rebuildItemMesh(item) {
  if (item.group) furnitureGroup.remove(item.group);
  const g = buildFurnitureVisual(item);
  g.position.set(item.x, 0, item.z);
  g.rotation.y = (-item.rot * Math.PI) / 180;
  g.userData.uid = item.uid;
  g.traverse((c) => {
    if (c.isMesh) c.userData.uid = item.uid;
  });
  furnitureGroup.add(g);
  item.group = g;
}

const MAX_HISTORY = 100;
const undoStack = [];
const redoStack = [];
let isRestoringHistory = false;
let dragStartSnapshot = null;
let dragStartPos = null;
let pendingRotSnapshot = null;
let pendingRotItemUid = null;
let pendingRotStartVal = null;

let autoSaveFileHandle = null;
let pendingReconnectHandle = null;
let fileWriteTimer = null;
let fileWriteInFlight = false;
let fileWriteQueued = false;
let lastKnownFileMtime = 0;
let lastKnownFileSize = -1;
let filePollTimer = null;
let fileObserver = null;

let cloudPushTimer = null;
let cloudPushInFlight = false;
let cloudPushQueued = false;
let cloudForceSnapshotQueued = false;
let cloudPullInFlight = false;
let cloudPollTimer = null;
let lastCloudEtag = null;
let lastCloudSyncOk = true;
let lastCloudSyncError = '';
let isCloudSyncing = false;
let historyFetchSeq = 0;

let lastAppliedSyncTs = 0;
let lastAppliedSignature = '';
let localWriteSeq = 0;
let pendingRemoteSync = null;
let hadSavedLocalOnBoot = false;
let syncChannel = null;

let lastAutoSaveIso = null;
let lastAutoSaveOk = true;
let lastAutoSaveError = '';
let liveAnnounceTimer = null;

function isCloudSyncSupported() {
  return (window.location.protocol === 'http:' || window.location.protocol === 'https:') && !DISABLE_CLOUD_SYNC_PARAM;
}

function isCloudSyncActive() {
  if (!isCloudSyncSupported()) return false;
  try {
    return localStorage.getItem(CLOUD_SYNC_ENABLED_KEY) !== '0';
  } catch (_) {
    return true;
  }
}

function getCloudSyncUrl(extraParams = null) {
  const url = new URL(CLOUD_SYNC_BASE_URL);
  if (SYNC_ROOM_PARAM) url.searchParams.set('room', SYNC_ROOM_PARAM);
  if (extraParams && typeof extraParams === 'object') {
    for (const [k, v] of Object.entries(extraParams)) {
      if (v !== undefined && v !== null && v !== '') {
        url.searchParams.set(k, String(v));
      }
    }
  }
  return url.toString();
}

function formatTimeShort(iso) {
  if (!iso || Number.isNaN(Date.parse(iso))) return '';
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function announceStatus(msg) {
  if (!msg || document.querySelector('dialog[open]')) return;
  const el = document.getElementById('live-status');
  if (!el) return;
  el.textContent = '';
  requestAnimationFrame(() => {
    if (!document.querySelector('dialog[open]')) el.textContent = msg;
  });
}

function scheduleAutoSaveAnnouncement() {
  if (liveAnnounceTimer) clearTimeout(liveAnnounceTimer);
  liveAnnounceTimer = setTimeout(() => {
    liveAnnounceTimer = null;
    announceStatus(autoSaveFileHandle ? `Layout auto-saved to browser and ${autoSaveFileHandle.name}` : 'Layout auto-saved');
  }, 800);
}

function updateAutoSaveUI({ ok = true, savedAt = null, errorMsg = '' } = {}) {
  const pill = document.getElementById('btn-autosave');
  const textEl = document.getElementById('autosave-text');
  const dialogInfo = document.getElementById('dialog-autosave-info');
  const btnCloudNow = document.getElementById('btn-cloud-sync-now');
  const btnToggleCloud = document.getElementById('btn-toggle-cloud-sync');
  const btnLinkExisting = document.getElementById('btn-link-existing-file');
  const btnLinkNew = document.getElementById('btn-link-autosave-file');
  const btnReconnectHeader = document.getElementById('btn-reconnect-file');
  const btnReconnectDialog = document.getElementById('btn-reconnect-file-dialog');
  const btnUnlink = document.getElementById('btn-unlink-autosave-file');
  if (!pill || !textEl) return;

  const t = formatTimeShort(savedAt);
  const cloudSupported = isCloudSyncSupported();
  const cloudActive = isCloudSyncActive();

  pill.classList.toggle('syncing', ok && isCloudSyncing);
  pill.classList.toggle('warn', !ok || (cloudActive && !lastCloudSyncOk));

  if (!ok) {
    textEl.textContent = 'Auto-save error';
  } else if (isCloudSyncing) {
    textEl.textContent = 'Syncing…';
  } else if (autoSaveFileHandle) {
    textEl.textContent = t ? `Synced · ${autoSaveFileHandle.name} · ${t}` : `Synced · ${autoSaveFileHandle.name}`;
  } else if (cloudActive && !lastCloudSyncOk) {
    textEl.textContent = t ? `Offline · Saved ${t}` : 'Offline · Saved locally';
  } else if (cloudActive) {
    textEl.textContent = t ? `Synced ${t}` : 'Synced (Cloud + Browser)';
  } else {
    textEl.textContent = t ? `Auto-saved ${t}` : 'Auto-saved';
  }

  if (dialogInfo) {
    const parts = [];
    parts.push(ok ? 'Browser auto-save active' : (errorMsg || 'Browser storage write failed'));
    if (cloudSupported) {
      if (!cloudActive) {
        parts.push('Cloud sync paused');
      } else if (isCloudSyncing) {
        parts.push('Cloud syncing…');
      } else if (lastCloudSyncOk) {
        parts.push(t ? `Cloud synced (${t})` : 'Cloud sync active');
      } else {
        parts.push(`Cloud offline (${lastCloudSyncError || 'retry automatically'})`);
      }
    } else {
      parts.push('Cloud sync unavailable on file://');
    }
    if (autoSaveFileHandle) {
      parts.push(`Two-way file sync: "${autoSaveFileHandle.name}"`);
    } else if (pendingReconnectHandle) {
      parts.push(`File linked: "${pendingReconnectHandle.name}" (click Reconnect)`);
    }
    dialogInfo.textContent = parts.join(' · ');
  }

  if (btnCloudNow) {
    btnCloudNow.style.display = cloudSupported ? 'inline-flex' : 'none';
    btnCloudNow.disabled = isCloudSyncing;
  }
  if (btnToggleCloud) {
    btnToggleCloud.style.display = cloudSupported ? 'inline-flex' : 'none';
    btnToggleCloud.textContent = cloudActive ? 'Cloud Sync: On' : 'Cloud Sync: Off';
  }

  const canPickOpen = typeof window.showOpenFilePicker === 'function';
  const canPickSave = typeof window.showSaveFilePicker === 'function';
  if (btnLinkExisting) btnLinkExisting.style.display = canPickOpen && !autoSaveFileHandle ? 'inline-flex' : 'none';
  if (btnLinkNew) btnLinkNew.style.display = canPickSave && !autoSaveFileHandle ? 'inline-flex' : 'none';

  const showReconnect = !autoSaveFileHandle && Boolean(pendingReconnectHandle);
  if (btnReconnectHeader) {
    btnReconnectHeader.style.display = showReconnect ? 'inline-flex' : 'none';
    if (pendingReconnectHandle) btnReconnectHeader.textContent = `Reconnect ${pendingReconnectHandle.name}`;
  }
  if (btnReconnectDialog) {
    btnReconnectDialog.style.display = showReconnect ? 'inline-flex' : 'none';
    if (pendingReconnectHandle) btnReconnectDialog.textContent = `Reconnect ${pendingReconnectHandle.name}`;
  }
  if (btnUnlink) btnUnlink.style.display = autoSaveFileHandle ? 'inline-flex' : 'none';
}

function captureHistoryState() {
  return {
    items: serializePlacedItems(),
    ceilingFt: Number(ceilingSelect.value),
    selectedIndex: selectedUid ? placedItems.findIndex((i) => i.uid === selectedUid) : -1,
  };
}

function updateUndoRedoButtons() {
  const btnUndo = document.getElementById('btn-undo');
  const btnRedo = document.getElementById('btn-redo');
  if (btnUndo) {
    const canUndo = undoStack.length > 0;
    btnUndo.setAttribute('aria-disabled', canUndo ? 'false' : 'true');
    btnUndo.title = canUndo
      ? `Undo: ${undoStack[undoStack.length - 1].label} (Ctrl/Cmd+Z)`
      : 'Nothing to undo (Ctrl/Cmd+Z)';
  }
  if (btnRedo) {
    const canRedo = redoStack.length > 0;
    btnRedo.setAttribute('aria-disabled', canRedo ? 'false' : 'true');
    btnRedo.title = canRedo
      ? `Redo: ${redoStack[redoStack.length - 1].label} (Ctrl/Cmd+Shift+Z)`
      : 'Nothing to redo (Ctrl/Cmd+Shift+Z)';
  }
}

function commitPendingRotation() {
  if (!pendingRotSnapshot) return false;
  const item = placedItems.find((i) => i.uid === pendingRotItemUid);
  const snap = pendingRotSnapshot;
  const startRot = pendingRotStartVal;
  pendingRotSnapshot = null;
  pendingRotItemUid = null;
  pendingRotStartVal = null;
  const changed = Boolean(item && item.rot !== startRot);
  if (changed) {
    commitUndoSnapshot(snap, `Rotate ${item.name}`);
  } else {
    flushPendingRemoteSync();
  }
  return changed;
}

function commitUndoSnapshot(state, label = 'Edit') {
  if (isRestoringHistory || !state) return;
  undoStack.push({ state, label });
  if (undoStack.length > MAX_HISTORY) undoStack.shift();
  redoStack.length = 0;
  updateUndoRedoButtons();
}

function pushUndoState(label = 'Edit') {
  if (isRestoringHistory) return;
  commitPendingRotation();
  commitUndoSnapshot(captureHistoryState(), label);
}

function restoreHistoryState(state) {
  isRestoringHistory = true;
  pendingRotSnapshot = null;
  pendingRotItemUid = null;
  pendingRotStartVal = null;
  loadLayoutArray(state.items, { save: false, migrate: false });
  if (Number.isFinite(Number(state.ceilingFt)) && Number(state.ceilingFt) !== Number(ceilingSelect.value)) {
    applyCeilingHeight(Number(state.ceilingFt), false);
  }
  if (state.selectedIndex >= 0 && state.selectedIndex < placedItems.length) {
    selectItem(placedItems[state.selectedIndex].uid);
  }
  isRestoringHistory = false;
  saveToLocalStorage();
  updateUndoRedoButtons();
}

function undo() {
  commitPendingRotation();
  if (undoStack.length === 0) return;
  const entry = undoStack.pop();
  redoStack.push({ state: captureHistoryState(), label: entry.label });
  restoreHistoryState(entry.state);
  const msg = `Undid: ${entry.label}`;
  showHudMessage(msg);
  announceStatus(msg);
}

function redo() {
  commitPendingRotation();
  if (redoStack.length === 0) return;
  const entry = redoStack.pop();
  undoStack.push({ state: captureHistoryState(), label: entry.label });
  restoreHistoryState(entry.state);
  const msg = `Redid: ${entry.label}`;
  showHudMessage(msg);
  announceStatus(msg);
}

function addFurnitureItem(data, selectNew = true, { save = true } = {}) {
  const item = {
    uid: `item_${uidSeq++}`,
    catalogId: data.catalogId || 'custom',
    name: data.name,
    style: data.style || 'table',
    wIn: data.wIn,
    dIn: data.dIn,
    hIn: data.hIn,
    x: data.x ?? -2.28,
    z: data.z ?? -8.23,
    rot: data.rot ?? 0,
    color: data.color || '#475569',
    group: null,
  };
  rebuildItemMesh(item);
  placedItems.push(item);
  if (selectNew) selectItem(item.uid);
  else refreshPlacedList();
  if (save) saveToLocalStorage();
  return item;
}

function selectItem(uid) {
  if (uid !== pendingRotItemUid) commitPendingRotation();
  selectedUid = uid;
  updateInspectorUI();
  updateClearancesAndSelectionVisuals();
  refreshPlacedList();
}

const LEGACY_TILDA_CATALOG_MAP = {
  tilda_banquette_large_r: 'tilda_banquette_small',
  tilda_banquette_large_l: 'tilda_banquette_small_l',
};

const LEGACY_CATALOG_DEFAULTS = {
  tilda_banquette_small: [{ dims: [56, 53.5, 30.75] }],
  tilda_banquette_small_l: [{ dims: [56, 53.5, 30.75] }],
  media_tv: [
    { dims: [72, 18, 52], migrateStyle: true, legacyName: 'Media Console + 65" TV' },
    { dims: [82, 16, 22], migrateStyle: true, legacyName: 'TV Console (82")' },
  ],
  dining_6: [{ dims: [72, 36, 30], legacyName: 'Dining Table (6p)' }],
};

const LEGACY_TILDA_NAMES = new Set([
  'Tilda 2-Piece Storage Banquette (Large, Right)',
  'Tilda 2-Piece Storage Banquette (Large, Left)',
  'Tilda 2-Piece Storage Banquette (Small)',
  'Tilda 2-Piece Storage Banquette (Small, Right)',
  'Tilda 2-Piece Storage Banquette (Small, Left)',
]);

function loadLayoutArray(arr, { save = true, migrate = true, addFlankingSpeakersOnTvUpgrade = false } = {}) {
  pendingRotSnapshot = null;
  pendingRotItemUid = null;
  pendingRotStartVal = null;
  for (const it of placedItems) {
    if (it.group) furnitureGroup.remove(it.group);
  }
  placedItems = [];
  let didMigrate = false;
  const upgradedTvItems = [];
  for (const entry of arr) {
    const migratedCatId = migrate
      ? (LEGACY_TILDA_CATALOG_MAP[entry.catalogId] || entry.catalogId || 'custom')
      : (entry.catalogId || 'custom');
    const isLegacyLargeTilda = migrate && Boolean(LEGACY_TILDA_CATALOG_MAP[entry.catalogId]);
    const cat = CATALOG.find((c) => c.id === migratedCatId);
    const legacyDefs = migrate ? LEGACY_CATALOG_DEFAULTS[migratedCatId] : null;
    const matchedDef = (cat && legacyDefs)
      ? legacyDefs.find((def) => (
          Number(entry.wIn) === def.dims[0] &&
          Number(entry.dIn) === def.dims[1] &&
          Number(entry.hIn) === def.dims[2]
        )) || null
      : null;
    const matchesLegacyDims = Boolean(matchedDef);
    const useMigratedDefaults = Boolean(cat && (isLegacyLargeTilda || matchesLegacyDims));
    const shouldMigrateName = Boolean(
      migrate &&
        cat &&
        (!entry.name || LEGACY_TILDA_NAMES.has(entry.name) || (matchedDef && entry.name === matchedDef.legacyName))
    );
    const resolvedName = shouldMigrateName ? cat.name : (entry.name || (cat ? cat.name : 'Custom Item'));
    const resolvedStyle =
      cat && matchedDef && matchedDef.migrateStyle
        ? cat.style
        : (entry.style || (cat ? cat.style : 'table'));
    let resolvedRot = entry.rot || 0;
    if (
      migrate &&
      migratedCatId === 'media_tv' &&
      matchedDef &&
      (entry.style === 'console_tv' || (entry.style === 'cabinet' && Number(entry.x) > 0 && Number(resolvedRot) === 270))
    ) {
      resolvedRot = ((Number(resolvedRot) + 180) % 360 + 360) % 360;
    }
    if (
      useMigratedDefaults ||
      (shouldMigrateName && entry.name) ||
      (resolvedStyle !== entry.style && entry.style) ||
      resolvedRot !== (entry.rot || 0)
    ) {
      didMigrate = true;
    }
    const addedItem = addFurnitureItem(
      {
        catalogId: migratedCatId,
        name: resolvedName,
        style: resolvedStyle,
        wIn: useMigratedDefaults ? cat.w : (entry.wIn ?? (cat ? cat.w : 48)),
        dIn: useMigratedDefaults ? cat.d : (entry.dIn ?? (cat ? cat.d : 24)),
        hIn: useMigratedDefaults ? cat.h : (entry.hIn ?? (cat ? cat.h : 30)),
        x: entry.x,
        z: entry.z,
        rot: resolvedRot,
        color: entry.color || (cat ? cat.color : '#475569'),
      },
      false,
      { save: false }
    );
    if (migrate && migratedCatId === 'media_tv' && matchedDef) {
      upgradedTvItems.push(addedItem);
    }
  }

  if (
    addFlankingSpeakersOnTvUpgrade &&
    upgradedTvItems.length > 0 &&
    !placedItems.some((it) => it.catalogId === 'standing_speaker')
  ) {
    const speakerCat = CATALOG.find((c) => c.id === 'standing_speaker');
    if (speakerCat) {
      const tv = upgradedTvItems[0];
      const rad = (tv.rot * Math.PI) / 180;
      const ux = Math.cos(rad);
      const uz = Math.sin(rad);
      for (const side of [-1, 1]) {
        for (const gapIn of [6, 2]) {
          const dist = (tv.wIn * 0.5 + gapIn + speakerCat.w * 0.5) * IN_TO_M;
          const cand = {
            catalogId: speakerCat.id,
            name: speakerCat.name,
            style: speakerCat.style,
            wIn: speakerCat.w,
            dIn: speakerCat.d,
            hIn: speakerCat.h,
            x: +(tv.x + side * ux * dist).toFixed(4),
            z: +(tv.z + side * uz * dist).toFixed(4),
            rot: tv.rot,
            color: speakerCat.color,
          };
          if (!spec.wall_rects_m.some((r) => obbIntersectsRect(cand, r))) {
            addFurnitureItem(cand, false, { save: false });
            didMigrate = true;
            break;
          }
        }
      }
    }
  }

  selectItem(null);
  if (save || didMigrate) saveToLocalStorage();
}

function serializePlacedItems() {
  return placedItems.map(({ catalogId, name, style, wIn, dIn, hIn, x, z, rot, color }) => ({
    catalogId, name, style, wIn, dIn, hIn, x: +x.toFixed(4), z: +z.toFixed(4), rot, color,
  }));
}

function buildLayoutPayload(name = '') {
  return {
    version: 2,
    name,
    savedAt: new Date().toISOString(),
    apartment: 'exact-12.5px-per-ft',
    ceiling_ft: Number(ceilingSelect.value),
    items: serializePlacedItems(),
  };
}

function validateAndNormalizeLayout(raw) {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Layout JSON must be an array or an object with an "items" array.');
  }
  const rawItems = Array.isArray(raw) ? raw : raw.items;
  if (!Array.isArray(rawItems)) {
    throw new Error('Layout JSON is missing an "items" array.');
  }
  const items = rawItems.map((entry, idx) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`Item #${idx + 1} is not a valid object.`);
    }
    if (entry.x !== undefined && !Number.isFinite(Number(entry.x))) {
      throw new Error(`Item #${idx + 1} has an invalid x coordinate.`);
    }
    if (entry.z !== undefined && !Number.isFinite(Number(entry.z))) {
      throw new Error(`Item #${idx + 1} has an invalid z coordinate.`);
    }
    const norm = { ...entry };
    if (norm.x !== undefined) norm.x = Number(norm.x);
    if (norm.z !== undefined) norm.z = Number(norm.z);
    if (norm.rot !== undefined && Number.isFinite(Number(norm.rot))) norm.rot = Number(norm.rot);
    for (const dimKey of ['wIn', 'dIn', 'hIn']) {
      if (norm[dimKey] !== undefined) {
        const v = Number(norm[dimKey]);
        if (!Number.isFinite(v) || v <= 0) {
          throw new Error(`Item #${idx + 1} has an invalid ${dimKey} dimension.`);
        }
        norm[dimKey] = v;
      }
    }
    return norm;
  });
  const rawCeil = !Array.isArray(raw) && raw.ceiling_ft !== undefined && raw.ceiling_ft !== null && raw.ceiling_ft !== ''
    ? Number(raw.ceiling_ft)
    : NaN;
  return {
    items,
    ceilingFt: Number.isFinite(rawCeil) ? rawCeil : null,
    name: !Array.isArray(raw) && typeof raw.name === 'string' ? raw.name : '',
  };
}

function normalizeSavedLayoutsList(rawList) {
  if (!Array.isArray(rawList)) return [];
  const out = [];
  for (const entry of rawList.slice(0, 50)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) || !Array.isArray(entry.items)) continue;
    try {
      const norm = validateAndNormalizeLayout(entry);
      const clean = {
        name: norm.name || 'Untitled Layout',
        savedAt: typeof entry.savedAt === 'string' && !Number.isNaN(Date.parse(entry.savedAt))
          ? new Date(entry.savedAt).toISOString()
          : new Date().toISOString(),
        ceiling_ft: norm.ceilingFt !== null ? norm.ceilingFt : 9,
        version: Number.isFinite(Number(entry.version)) ? Number(entry.version) : 2,
        items: norm.items,
      };
      if (typeof entry.id === 'string' && entry.id.trim()) {
        clean.id = entry.id.trim().slice(0, 64);
      }
      out.push(clean);
    } catch (_) {}
  }
  return out;
}

function canonicalizeSigItem(it) {
  const rawCatId = (it && typeof it.catalogId === 'string' && it.catalogId) ? it.catalogId : 'custom';
  const cat = CATALOG.find((c) => c.id === rawCatId);
  return {
    catalogId: rawCatId,
    name: (it && it.name) || cat?.name || 'Custom Piece',
    style: (it && it.style) || cat?.style || 'box',
    wIn: Number(it?.wIn ?? cat?.w ?? 36),
    dIn: Number(it?.dIn ?? cat?.d ?? 36),
    hIn: Number(it?.hIn ?? cat?.h ?? 30),
    x: Number(Number(it?.x ?? 0).toFixed(4)),
    z: Number(Number(it?.z ?? 0).toFixed(4)),
    rot: Number(it?.rot ?? 0),
    color: (it && it.color) || cat?.color || '#64748b',
  };
}

function computeContentSignature(ceilingFt, items, savedLayouts) {
  const normItems = (Array.isArray(items) ? items : []).map(canonicalizeSigItem);
  const normLayouts = (Array.isArray(savedLayouts) ? savedLayouts : []).map((lay) => ({
    id: lay.id || '',
    name: lay.name || '',
    ceiling_ft: Number.isFinite(Number(lay.ceiling_ft)) ? Number(lay.ceiling_ft) : 9,
    items: (Array.isArray(lay.items) ? lay.items : []).map(canonicalizeSigItem),
  }));
  return JSON.stringify({
    ceiling_ft: Number.isFinite(Number(ceilingFt)) ? Number(ceilingFt) : 9,
    items: normItems,
    savedLayouts: normLayouts,
  });
}

function buildSyncSnapshot(savedAt = new Date().toISOString()) {
  return {
    version: 3,
    savedAt,
    clientId: CLIENT_ID,
    ceiling_ft: Number(ceilingSelect.value),
    items: serializePlacedItems(),
    savedLayouts: readSavedLayouts(),
  };
}

function persistCurrentLayoutToLocalStorage(savedAt) {
  const data = {
    version: 3,
    savedAt,
    clientId: CLIENT_ID,
    ceiling_ft: Number(ceilingSelect.value),
    items: serializePlacedItems(),
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function broadcastSnapshot(snapshot) {
  if (!syncChannel) return;
  try {
    syncChannel.postMessage({ type: 'sync', snapshot });
  } catch (_) {}
}

function applySyncedSnapshot(
  raw,
  sourceLabel,
  { writeLocal = true, writeFile = false, writeCloud = false, force = false } = {}
) {
  if (!raw || typeof raw !== 'object') return false;
  if (!Array.isArray(raw) && raw.clientId && raw.clientId === CLIENT_ID && !force) return false;
  if (draggingItem || pendingRotItemUid) {
    pendingRemoteSync = {
      raw,
      sourceLabel,
      opts: { writeLocal, writeFile, writeCloud, force },
    };
    return false;
  }

  let normalized;
  try {
    normalized = validateAndNormalizeLayout(raw);
  } catch (_) {
    return false;
  }

  const hasSavedLayouts = !Array.isArray(raw) && Array.isArray(raw.savedLayouts);
  const nextSavedLayouts = hasSavedLayouts ? normalizeSavedLayoutsList(raw.savedLayouts) : readSavedLayouts();
  const targetCeil = normalized.ceilingFt !== null ? normalized.ceilingFt : Number(ceilingSelect.value);
  const incomingTs = !Array.isArray(raw) && typeof raw.savedAt === 'string' && !Number.isNaN(Date.parse(raw.savedAt))
    ? Date.parse(raw.savedAt)
    : 0;

  if (!force && incomingTs > 0 && lastAppliedSyncTs > 0 && incomingTs < lastAppliedSyncTs) {
    return false;
  }

  const currentItems = serializePlacedItems();
  const currentSavedLayouts = readSavedLayouts();
  const currentSig = computeContentSignature(Number(ceilingSelect.value), currentItems, currentSavedLayouts);
  const incomingSig = computeContentSignature(targetCeil, normalized.items, nextSavedLayouts);

  if (incomingSig === currentSig) {
    if (incomingTs > lastAppliedSyncTs) {
      lastAppliedSyncTs = incomingTs;
      lastAutoSaveIso = new Date(incomingTs).toISOString();
      if (writeLocal) {
        try { persistCurrentLayoutToLocalStorage(lastAutoSaveIso); } catch (_) {}
      }
    }
    lastAppliedSignature = currentSig;
    updateAutoSaveUI({ ok: lastAutoSaveOk, savedAt: lastAutoSaveIso, errorMsg: lastAutoSaveError });
    return false;
  }

  const sceneChanged = computeContentSignature(targetCeil, normalized.items, [])
    !== computeContentSignature(Number(ceilingSelect.value), currentItems, []);

  if (sceneChanged) {
    if (hadSavedLocalOnBoot) pushUndoState(`Sync from ${sourceLabel}`);
    loadLayoutArray(normalized.items, { save: false, migrate: false });
    if (normalized.ceilingFt !== null) {
      applyCeilingHeight(normalized.ceilingFt, false);
    }
  }

  if (hasSavedLayouts) {
    if (writeLocal) {
      try { localStorage.setItem(SAVED_LAYOUTS_KEY, JSON.stringify(nextSavedLayouts)); } catch (_) {}
    }
    updateLayoutsButtonLabel();
    if (layoutsDialog.open) renderSavedLayoutsList();
  }

  const resolvedIso = incomingTs > 0 ? new Date(incomingTs).toISOString() : new Date().toISOString();
  lastAutoSaveIso = resolvedIso;
  lastAppliedSyncTs = Date.parse(resolvedIso) || Date.now();
  lastAppliedSignature = computeContentSignature(Number(ceilingSelect.value), serializePlacedItems(), readSavedLayouts());
  lastAutoSaveOk = true;
  lastAutoSaveError = '';
  hadSavedLocalOnBoot = true;

  if (writeLocal) {
    try {
      persistCurrentLayoutToLocalStorage(resolvedIso);
    } catch (_) {}
  }

  updateAutoSaveUI({ ok: true, savedAt: lastAutoSaveIso });
  showHudMessage(`Synced layout from ${sourceLabel}`);
  announceStatus(`Synced layout from ${sourceLabel}`);

  if (writeFile && autoSaveFileHandle) scheduleLinkedFileWrite();
  if (writeCloud && isCloudSyncActive()) scheduleCloudPush();
  return true;
}

function flushPendingRemoteSync() {
  if (!pendingRemoteSync || draggingItem || pendingRotItemUid) return;
  const queued = pendingRemoteSync;
  pendingRemoteSync = null;
  applySyncedSnapshot(queued.raw, queued.sourceLabel, queued.opts);
}

// Layer 1: Same-Origin Tab Sync (BroadcastChannel + storage events)
function setupSameOriginTabSync() {
  if (typeof BroadcastChannel === 'function') {
    try {
      syncChannel = new BroadcastChannel(SYNC_CHANNEL_NAME);
      syncChannel.addEventListener('message', (e) => {
        if (e.data && e.data.type === 'sync' && e.data.snapshot) {
          applySyncedSnapshot(e.data.snapshot, 'another tab', {
            writeLocal: false,
            writeFile: false,
            writeCloud: false,
          });
        }
      });
    } catch (_) {
      syncChannel = null;
    }
  }
  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEY && e.newValue) {
      try {
        const parsed = JSON.parse(e.newValue);
        applySyncedSnapshot(parsed, 'another tab', {
          writeLocal: false,
          writeFile: false,
          writeCloud: false,
        });
      } catch (_) {}
    } else if (e.key === SAVED_LAYOUTS_KEY) {
      updateLayoutsButtonLabel();
      if (layoutsDialog.open) renderSavedLayoutsList();
    }
  });
}

// Layer 2: IndexedDB Handle Persistence & Two-Way File Sync
function openHandlesDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(IDB_STORE)) {
        req.result.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IndexedDB open error'));
  });
}

async function saveStoredFileHandle(handle) {
  try {
    const db = await openHandlesDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(handle, IDB_FILE_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch (_) {}
}

async function loadStoredFileHandle() {
  try {
    const db = await openHandlesDb();
    const handle = await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(IDB_FILE_KEY);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return handle;
  } catch (_) {
    return null;
  }
}

async function clearStoredFileHandle() {
  try {
    const db = await openHandlesDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).delete(IDB_FILE_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch (_) {}
}

function stopLinkedFileWatch() {
  if (filePollTimer) {
    clearInterval(filePollTimer);
    filePollTimer = null;
  }
  if (fileObserver) {
    try { fileObserver.disconnect(); } catch (_) {}
    fileObserver = null;
  }
}

async function pollLinkedFileOnce({ initial = false } = {}) {
  if (!autoSaveFileHandle || fileWriteInFlight || fileWriteTimer) return false;
  try {
    const file = await autoSaveFileHandle.getFile();
    if (!initial && file.lastModified === lastKnownFileMtime && file.size === lastKnownFileSize) {
      return false;
    }
    lastKnownFileMtime = file.lastModified;
    lastKnownFileSize = file.size;
    const text = (await file.text()).trim();
    if (!text) {
      if (initial) await writeLinkedAutoSaveFileNow();
      return false;
    }
    const parsed = JSON.parse(text);
    const fileTs = !Array.isArray(parsed) && typeof parsed?.savedAt === 'string' && !Number.isNaN(Date.parse(parsed.savedAt))
      ? Date.parse(parsed.savedAt)
      : file.lastModified;

    if (!initial || !hadSavedLocalOnBoot || fileTs > lastAppliedSyncTs) {
      const didChange = applySyncedSnapshot(parsed, autoSaveFileHandle.name, {
        writeLocal: true,
        writeFile: false,
        writeCloud: true,
        force: initial && !hadSavedLocalOnBoot,
      });
      if (initial) hadSavedLocalOnBoot = true;
      return didChange;
    }
    if (initial && lastAppliedSyncTs > fileTs) {
      scheduleLinkedFileWrite();
    }
  } catch (_) {}
  return false;
}

function startLinkedFileWatch() {
  stopLinkedFileWatch();
  if (!autoSaveFileHandle) return;
  filePollTimer = setInterval(() => {
    if (document.visibilityState === 'visible') {
      pollLinkedFileOnce();
    }
  }, 2000);
  if (typeof window.FileSystemObserver === 'function') {
    try {
      fileObserver = new window.FileSystemObserver((records) => {
        if (records && records.length > 0 && !fileWriteInFlight && !fileWriteTimer) {
          pollLinkedFileOnce();
        }
      });
      fileObserver.observe(autoSaveFileHandle);
    } catch (_) {
      fileObserver = null;
    }
  }
}

async function activateLinkedFileHandle(handle, { readFirst = false } = {}) {
  autoSaveFileHandle = handle;
  pendingReconnectHandle = null;
  lastKnownFileMtime = 0;
  lastKnownFileSize = -1;
  await saveStoredFileHandle(handle);

  if (readFirst) {
    try {
      const file = await handle.getFile();
      lastKnownFileMtime = file.lastModified;
      lastKnownFileSize = file.size;
      const rawText = (await file.text()).trim();
      if (rawText) {
        const parsed = JSON.parse(rawText);
        validateAndNormalizeLayout(parsed);
        applySyncedSnapshot(parsed, handle.name, {
          writeLocal: true,
          writeFile: false,
          writeCloud: true,
          force: true,
        });
      } else {
        await writeLinkedAutoSaveFileNow();
      }
    } catch (err) {
      stopLinkedFileWatch();
      autoSaveFileHandle = null;
      await clearStoredFileHandle();
      throw err;
    }
  } else {
    await writeLinkedAutoSaveFileNow();
  }

  startLinkedFileWatch();
  updateAutoSaveUI({ ok: lastAutoSaveOk, savedAt: lastAutoSaveIso, errorMsg: lastAutoSaveError });
}

async function reconnectStoredFileHandle() {
  if (!pendingReconnectHandle) return false;
  try {
    const perm = await pendingReconnectHandle.requestPermission({ mode: 'readwrite' });
    if (perm !== 'granted') return false;
    autoSaveFileHandle = pendingReconnectHandle;
    pendingReconnectHandle = null;
    await pollLinkedFileOnce({ initial: true });
    startLinkedFileWatch();
    updateAutoSaveUI({ ok: lastAutoSaveOk, savedAt: lastAutoSaveIso, errorMsg: lastAutoSaveError });
    return true;
  } catch (_) {
    return false;
  }
}

async function unlinkLinkedFile() {
  stopLinkedFileWatch();
  if (fileWriteTimer) {
    clearTimeout(fileWriteTimer);
    fileWriteTimer = null;
  }
  fileWriteQueued = false;
  autoSaveFileHandle = null;
  pendingReconnectHandle = null;
  lastKnownFileMtime = 0;
  lastKnownFileSize = -1;
  await clearStoredFileHandle();
  updateAutoSaveUI({ ok: lastAutoSaveOk, savedAt: lastAutoSaveIso, errorMsg: lastAutoSaveError });
}

async function initStoredFileHandle() {
  const stored = await loadStoredFileHandle();
  if (!stored || typeof stored.queryPermission !== 'function') return;
  try {
    const perm = await stored.queryPermission({ mode: 'readwrite' });
    if (perm === 'granted') {
      autoSaveFileHandle = stored;
      pendingReconnectHandle = null;
      await pollLinkedFileOnce({ initial: true });
      startLinkedFileWatch();
      updateAutoSaveUI({ ok: lastAutoSaveOk, savedAt: lastAutoSaveIso, errorMsg: lastAutoSaveError });
    } else if (perm === 'prompt') {
      pendingReconnectHandle = stored;
      updateAutoSaveUI({ ok: lastAutoSaveOk, savedAt: lastAutoSaveIso, errorMsg: lastAutoSaveError });
    }
  } catch (_) {}
}

// Layer 3: Cloud Sync (Vercel Blob API)
async function pushCloudLayoutNow({ keepalive = false, forceSnapshot = false } = {}) {
  if (!isCloudSyncActive()) return false;
  if (cloudPushTimer) {
    clearTimeout(cloudPushTimer);
    cloudPushTimer = null;
  }
  if (cloudPushInFlight) {
    cloudPushQueued = true;
    if (forceSnapshot) cloudForceSnapshotQueued = true;
    return false;
  }
  cloudPushInFlight = true;
  isCloudSyncing = true;
  updateAutoSaveUI({ ok: lastAutoSaveOk, savedAt: lastAutoSaveIso, errorMsg: lastAutoSaveError });
  try {
    const payload = buildSyncSnapshot(lastAutoSaveIso || new Date().toISOString());
    const bodyStr = JSON.stringify(payload);
    const useKeepalive = Boolean(keepalive && bodyStr.length <= 60000);
    const putUrl = forceSnapshot ? getCloudSyncUrl({ forceSnapshot: '1' }) : getCloudSyncUrl();
    const res = await fetch(putUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: bodyStr,
      keepalive: useKeepalive,
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const data = await res.json();
    if (data?.etag) lastCloudEtag = data.etag;
    lastCloudSyncOk = true;
    lastCloudSyncError = '';
    return true;
  } catch (err) {
    lastCloudSyncOk = false;
    lastCloudSyncError = err?.message || 'Network error';
    return false;
  } finally {
    cloudPushInFlight = false;
    isCloudSyncing = false;
    updateAutoSaveUI({ ok: lastAutoSaveOk, savedAt: lastAutoSaveIso, errorMsg: lastAutoSaveError });
    if (cloudPushQueued) {
      const nextForce = cloudForceSnapshotQueued;
      cloudPushQueued = false;
      cloudForceSnapshotQueued = false;
      scheduleCloudPush(250, nextForce);
    }
  }
}

function scheduleCloudPush(delayMs = 1000, forceSnapshot = false) {
  if (!isCloudSyncActive()) return;
  if (cloudPushTimer) clearTimeout(cloudPushTimer);
  cloudPushTimer = setTimeout(() => {
    cloudPushTimer = null;
    pushCloudLayoutNow({ forceSnapshot });
  }, delayMs);
}

async function pullCloudLayout({ initial = false, force = false } = {}) {
  if (!isCloudSyncActive() && !(force && isCloudSyncSupported())) return false;
  if (cloudPullInFlight) return false;
  cloudPullInFlight = true;
  const reqGen = localWriteSeq;
  if (initial || force) {
    isCloudSyncing = true;
    updateAutoSaveUI({ ok: lastAutoSaveOk, savedAt: lastAutoSaveIso, errorMsg: lastAutoSaveError });
  }
  try {
    const fetchUrl = (!initial && !force && lastCloudEtag)
      ? getCloudSyncUrl({ ifNoneMatch: lastCloudEtag })
      : getCloudSyncUrl();
    const res = await fetch(fetchUrl, {
      method: 'GET',
      cache: 'no-store',
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const etag = res.headers.get('etag');
    if (etag) lastCloudEtag = etag;
    const data = await res.json();
    if (data && data.unchanged) {
      if (data.etag) lastCloudEtag = data.etag;
      lastCloudSyncOk = true;
      lastCloudSyncError = '';
      return false;
    }
    lastCloudSyncOk = true;
    lastCloudSyncError = '';

    if (data && data.empty) {
      if (initial) {
        if (!hadSavedLocalOnBoot) {
          const seedIso = new Date().toISOString();
          try {
            persistCurrentLayoutToLocalStorage(seedIso);
            lastAutoSaveIso = seedIso;
            lastAppliedSyncTs = Date.parse(seedIso) || Date.now();
            lastAppliedSignature = computeContentSignature(Number(ceilingSelect.value), serializePlacedItems(), readSavedLayouts());
            hadSavedLocalOnBoot = true;
          } catch (_) {}
        }
        await pushCloudLayoutNow();
      }
      return false;
    }

    if (reqGen !== localWriteSeq && !force) {
      return false;
    }

    const cloudTs = typeof data?.savedAt === 'string' && !Number.isNaN(Date.parse(data.savedAt))
      ? Date.parse(data.savedAt)
      : 0;

    if (!hadSavedLocalOnBoot || force || cloudTs > lastAppliedSyncTs) {
      const didChange = applySyncedSnapshot(data, 'cloud', {
        writeLocal: true,
        writeFile: Boolean(autoSaveFileHandle),
        writeCloud: false,
        force: !hadSavedLocalOnBoot || force,
      });
      hadSavedLocalOnBoot = true;
      return didChange;
    }

    if (initial && lastAppliedSyncTs > cloudTs) {
      const curSig = computeContentSignature(Number(ceilingSelect.value), serializePlacedItems(), readSavedLayouts());
      const normCloud = validateAndNormalizeLayout(data);
      const cloudLayouts = Array.isArray(data.savedLayouts) ? normalizeSavedLayoutsList(data.savedLayouts) : [];
      const cloudSig = computeContentSignature(
        normCloud.ceilingFt !== null ? normCloud.ceilingFt : 9,
        normCloud.items,
        cloudLayouts
      );
      if (curSig !== cloudSig) {
        await pushCloudLayoutNow();
      }
    }
    return false;
  } catch (err) {
    lastCloudSyncOk = false;
    lastCloudSyncError = err?.message || 'Network error';
    return false;
  } finally {
    cloudPullInFlight = false;
    isCloudSyncing = false;
    updateAutoSaveUI({ ok: lastAutoSaveOk, savedAt: lastAutoSaveIso, errorMsg: lastAutoSaveError });
  }
}

function stopCloudPolling() {
  if (cloudPollTimer) {
    clearInterval(cloudPollTimer);
    cloudPollTimer = null;
  }
}

function startCloudPolling() {
  stopCloudPolling();
  if (!isCloudSyncActive()) return;
  cloudPollTimer = setInterval(() => {
    if (document.visibilityState === 'visible') {
      pullCloudLayout();
    }
  }, 5000);
}

function importLayoutPayload(raw) {
  const normalized = validateAndNormalizeLayout(raw);
  pushUndoState(normalized.name ? `Load ${normalized.name}` : 'Load layout');
  loadLayoutArray(normalized.items, { save: false });
  if (normalized.ceilingFt !== null) {
    applyCeilingHeight(normalized.ceilingFt, false);
  }
  saveToLocalStorage();
  return normalized.items.length;
}

async function writeLinkedAutoSaveFileNow() {
  if (!autoSaveFileHandle) return;
  if (fileWriteInFlight) {
    fileWriteQueued = true;
    return;
  }
  fileWriteInFlight = true;
  try {
    const payload = buildSyncSnapshot(lastAutoSaveIso || new Date().toISOString());
    const writable = await autoSaveFileHandle.createWritable();
    await writable.write(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
    await writable.close();
    try {
      const f = await autoSaveFileHandle.getFile();
      lastKnownFileMtime = f.lastModified;
      lastKnownFileSize = f.size;
    } catch (_) {}
    lastAutoSaveIso = payload.savedAt;
    lastAutoSaveOk = true;
    lastAutoSaveError = '';
    updateAutoSaveUI({ ok: true, savedAt: lastAutoSaveIso });
  } catch (err) {
    updateAutoSaveUI({
      ok: false,
      savedAt: lastAutoSaveIso,
      errorMsg: `Disk file auto-save failed (${err?.message || 'permission lost'}). Browser auto-save is still active.`,
    });
  } finally {
    fileWriteInFlight = false;
    if (fileWriteQueued) {
      fileWriteQueued = false;
      scheduleLinkedFileWrite();
    }
  }
}

function scheduleLinkedFileWrite() {
  if (!autoSaveFileHandle) return;
  if (fileWriteTimer) clearTimeout(fileWriteTimer);
  fileWriteTimer = setTimeout(() => {
    fileWriteTimer = null;
    writeLinkedAutoSaveFileNow();
  }, 500);
}

function saveToLocalStorage() {
  const savedAt = new Date().toISOString();
  localWriteSeq++;
  pendingRemoteSync = null;
  try {
    persistCurrentLayoutToLocalStorage(savedAt);
    lastAutoSaveIso = savedAt;
    lastAppliedSyncTs = Date.parse(savedAt) || Date.now();
    lastAppliedSignature = computeContentSignature(Number(ceilingSelect.value), serializePlacedItems(), readSavedLayouts());
    lastAutoSaveOk = true;
    lastAutoSaveError = '';
    hadSavedLocalOnBoot = true;
    updateAutoSaveUI({ ok: true, savedAt });
    scheduleAutoSaveAnnouncement();
    broadcastSnapshot(buildSyncSnapshot(savedAt));
    scheduleLinkedFileWrite();
    scheduleCloudPush();
  } catch (err) {
    lastAutoSaveOk = false;
    lastAutoSaveError = `Browser auto-save failed: ${err?.message || 'Storage quota or privacy restriction'}`;
    updateAutoSaveUI({ ok: false, savedAt: lastAutoSaveIso, errorMsg: lastAutoSaveError });
  }
}

// ---------------------------------------------------------------------------
// Tape Measure Tool
// ---------------------------------------------------------------------------
let measureMode = false;
let measureStart = null;
const measureGroup = new THREE.Group();
scene.add(measureGroup);
const measurePins = []; // { a: Vector3, b: Vector3, el: HTMLElement }
let previewLine = null;

function setMeasureMode(on) {
  measureMode = on;
  measureStart = null;
  if (previewLine) {
    measureGroup.remove(previewLine);
    previewLine = null;
  }
  document.getElementById('btn-measure').classList.toggle('active', on);
  renderer.domElement.style.cursor = on ? 'crosshair' : 'default';
}

function addMeasurePin(a, b) {
  const geo = new THREE.BufferGeometry().setFromPoints([a, b]);
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xf59e0b }));
  measureGroup.add(line);
  const el = document.createElement('div');
  el.className = 'measure-pin';
  labelsLayer.appendChild(el);
  measurePins.push({ a: a.clone(), b: b.clone(), el, line });
  updateMeasurePinTexts();
}

function updateMeasurePinTexts() {
  for (const p of measurePins) {
    const distM = p.a.distanceTo(p.b);
    p.el.textContent = `${fmtFeet(distM / FT_TO_M)} (${distM.toFixed(2)} m)`;
  }
}

// ---------------------------------------------------------------------------
// Room Labels Overlay Projection
// ---------------------------------------------------------------------------
const uiPrefs = loadUiPrefs();
let showLabels = uiPrefs.showLabels;
let showLeftPanel = uiPrefs.showLeft;
let showRightPanel = uiPrefs.showRight;

function saveUiPrefs() {
  try {
    localStorage.setItem(UI_PREFS_KEY, JSON.stringify({
      showLabels,
      showLeft: showLeftPanel,
      showRight: showRightPanel,
    }));
  } catch (_) {}
}

const roomLabelEls = [];
for (const room of spec.rooms) {
  const el = document.createElement('div');
  el.className = 'room-label';
  const dimText = room.printed_label !== '—' ? room.printed_label : room.measured_str;
  const nameDiv = document.createElement('div');
  nameDiv.className = 'rl-name';
  nameDiv.textContent = room.name;
  const dimDiv = document.createElement('div');
  dimDiv.className = 'rl-dims';
  dimDiv.textContent = dimText;
  el.appendChild(nameDiv);
  el.appendChild(dimDiv);
  labelsLayer.appendChild(el);
  roomLabelEls.push({ room, el, pos: new THREE.Vector3(room.center_m[0], 0.05, room.center_m[2]) });
}

function updateProjectedLabels() {
  const w = canvasHost.clientWidth;
  const h = canvasHost.clientHeight;
  const v = new THREE.Vector3();

  for (const rl of roomLabelEls) {
    if (!showLabels) {
      rl.el.style.display = 'none';
      continue;
    }
    v.copy(rl.pos).project(activeCamera);
    if (v.z > 1 || v.z < -1) {
      rl.el.style.display = 'none';
      continue;
    }
    rl.el.style.display = 'block';
    rl.el.style.left = `${(v.x * 0.5 + 0.5) * w}px`;
    rl.el.style.top = `${(-v.y * 0.5 + 0.5) * h}px`;
  }

  for (const p of measurePins) {
    v.copy(p.a).add(p.b).multiplyScalar(0.5).project(activeCamera);
    if (v.z > 1 || v.z < -1) {
      p.el.style.display = 'none';
    } else {
      p.el.style.display = 'block';
      p.el.style.left = `${(v.x * 0.5 + 0.5) * w}px`;
      p.el.style.top = `${(-v.y * 0.5 + 0.5) * h}px`;
    }
  }
}

// ---------------------------------------------------------------------------
// Pointer Interaction (Select, Drag, Magnetic Snap, Measure, Walk Teleport)
// ---------------------------------------------------------------------------
const raycaster = new THREE.Raycaster();
const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const pointerNdc = new THREE.Vector2();
let draggingItem = null;
let dragOffset = new THREE.Vector3();

// Walkthrough state
const walkState = { yaw: 0, pitch: -0.05, looking: false, downX: 0, downY: 0, lastX: 0, lastY: 0, keys: new Set() };

function setPointerRay(clientX, clientY) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointerNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  pointerNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointerNdc, activeCamera);
}

function getFloorHit(clientX, clientY) {
  setPointerRay(clientX, clientY);
  const hit = new THREE.Vector3();
  return raycaster.ray.intersectPlane(floorPlane, hit) ? hit : null;
}

function pickFurnitureAt(clientX, clientY) {
  setPointerRay(clientX, clientY);
  const hits = raycaster.intersectObjects(furnitureGroup.children, true);
  if (hits.length === 0) return null;
  let uid = hits[0].object.userData.uid;
  let cur = hits[0].object;
  while (!uid && cur.parent) {
    cur = cur.parent;
    uid = cur.userData.uid;
  }
  return placedItems.find((i) => i.uid === uid) || null;
}

function snapPosition(item, rawX, rawZ) {
  let x = rawX;
  let z = rawZ;

  // Grid snap
  const gridIn = Number(document.getElementById('snap-grid-select').value);
  if (gridIn > 0) {
    const stepM = gridIn * IN_TO_M;
    x = Math.round(x / stepM) * stepM;
    z = Math.round(z / stepM) * stepM;
  }

  // Magnetic Wall Snap (snaps flush within ~5.5 in to nearest wall face)
  if (document.getElementById('chk-wall-snap').checked) {
    const { ex, ez } = getOrientedExtents(item);
    const snapThresh = 0.14;
    const gap = 0.015;
    let bestDx = snapThresh;
    let bestDz = snapThresh;
    let snapX = x;
    let snapZ = z;

    for (const [rx0, rz0, rx1, rz1] of spec.wall_rects_m) {
      if (rz1 > z - ez - 0.1 && rz0 < z + ez + 0.1) {
        const dWest = Math.abs((x - ex) - rx1);
        if (dWest < bestDx) { bestDx = dWest; snapX = rx1 + ex + gap; }
        const dEast = Math.abs((x + ex) - rx0);
        if (dEast < bestDx) { bestDx = dEast; snapX = rx0 - ex - gap; }
      }
      if (rx1 > x - ex - 0.1 && rx0 < x + ex + 0.1) {
        const dNorth = Math.abs((z - ez) - rz1);
        if (dNorth < bestDz) { bestDz = dNorth; snapZ = rz1 + ez + gap; }
        const dSouth = Math.abs((z + ez) - rz0);
        if (dSouth < bestDz) { bestDz = dSouth; snapZ = rz0 - ez - gap; }
      }
    }
    x = snapX;
    z = snapZ;
  }
  return { x, z };
}

renderer.domElement.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;

  if (measureMode) {
    const hit = getFloorHit(e.clientX, e.clientY);
    if (!hit) return;
    hit.y = 0.032;
    if (!measureStart) {
      measureStart = hit.clone();
      const geo = new THREE.BufferGeometry().setFromPoints([measureStart, measureStart.clone()]);
      previewLine = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xfbbf24 }));
      measureGroup.add(previewLine);
    } else {
      addMeasurePin(measureStart, hit);
      setMeasureMode(false);
    }
    return;
  }

  if (activeCamMode === 'walk') {
    walkState.looking = true;
    walkState.downX = e.clientX;
    walkState.downY = e.clientY;
    walkState.lastX = e.clientX;
    walkState.lastY = e.clientY;
    return;
  }

  if (selectedUid) {
    const hitItem = pickFurnitureAt(e.clientX, e.clientY);
    if (hitItem && hitItem.uid === selectedUid) {
      const floorHit = getFloorHit(e.clientX, e.clientY);
      if (floorHit) {
        dragStartSnapshot = captureHistoryState();
        dragStartPos = { x: hitItem.x, z: hitItem.z };
        draggingItem = hitItem;
        dragOffset.set(hitItem.x - floorHit.x, 0, hitItem.z - floorHit.z);
        controls.enabled = false;
        renderer.domElement.style.cursor = 'grabbing';
        renderer.domElement.setPointerCapture(e.pointerId);
      }
    }
  }
});

renderer.domElement.addEventListener('dblclick', (e) => {
  if (e.button !== 0 || measureMode || activeCamMode === 'walk') return;
  const item = pickFurnitureAt(e.clientX, e.clientY);
  selectItem(item ? item.uid : null);
  renderer.domElement.style.cursor = item ? 'grab' : 'default';
});

renderer.domElement.addEventListener('pointermove', (e) => {
  if (measureMode && measureStart && previewLine) {
    const hit = getFloorHit(e.clientX, e.clientY);
    if (hit) {
      hit.y = 0.032;
      previewLine.geometry.setFromPoints([measureStart, hit]);
    }
    return;
  }

  if (activeCamMode === 'walk' && walkState.looking) {
    const dx = e.clientX - walkState.lastX;
    const dy = e.clientY - walkState.lastY;
    walkState.lastX = e.clientX;
    walkState.lastY = e.clientY;
    walkState.yaw -= dx * 0.0045;
    walkState.pitch = Math.max(-1.1, Math.min(1.1, walkState.pitch - dy * 0.0045));
    return;
  }

  if (!draggingItem) {
    if (!measureMode && activeCamMode !== 'walk') {
      const sel = selectedUid ? placedItems.find((i) => i.uid === selectedUid) : null;
      if (sel && sel.group) {
        setPointerRay(e.clientX, e.clientY);
        const selHit = raycaster.intersectObject(sel.group, true).length > 0;
        renderer.domElement.style.cursor = selHit ? 'grab' : 'default';
      } else {
        renderer.domElement.style.cursor = 'default';
      }
    }
    return;
  }
  const hit = getFloorHit(e.clientX, e.clientY);
  if (!hit) return;
  const snapped = snapPosition(draggingItem, hit.x + dragOffset.x, hit.z + dragOffset.z);
  draggingItem.x = snapped.x;
  draggingItem.z = snapped.z;
  draggingItem.group.position.set(snapped.x, 0, snapped.z);
  updateClearancesAndSelectionVisuals();
  updateClearanceBoxText();
});

function finishDragging(pointerId) {
  if (!draggingItem) return;
  const movedItem = draggingItem;
  const snap = dragStartSnapshot;
  const startPos = dragStartPos;
  draggingItem = null;
  dragStartSnapshot = null;
  dragStartPos = null;
  controls.enabled = true;
  renderer.domElement.style.cursor = measureMode ? 'crosshair' : 'default';
  if (
    snap &&
    startPos &&
    Math.hypot(movedItem.x - startPos.x, movedItem.z - startPos.z) > 1e-4
  ) {
    commitUndoSnapshot(snap, `Move ${movedItem.name}`);
    saveToLocalStorage();
  }
  if (pointerId !== undefined) {
    try { renderer.domElement.releasePointerCapture(pointerId); } catch (_) {}
  }
  flushPendingRemoteSync();
}

renderer.domElement.addEventListener('pointerup', (e) => {
  if (walkState.looking) {
    walkState.looking = false;
    if (Math.hypot(e.clientX - walkState.downX, e.clientY - walkState.downY) < 5) {
      const hit = getFloorHit(e.clientX, e.clientY);
      if (hit && Math.abs(hit.x) < 6.2 && hit.z > -11.5 && hit.z < 12.5) {
        perspCamera.position.x = hit.x;
        perspCamera.position.z = hit.z;
      }
    }
  }
  if (draggingItem) {
    finishDragging(e.pointerId);
  }
});
renderer.domElement.addEventListener('pointercancel', (e) => {
  finishDragging(e.pointerId);
});

// Keyboard shortcuts
window.addEventListener('keydown', (e) => {
  if (
    e.target.tagName === 'INPUT' ||
    e.target.tagName === 'SELECT' ||
    e.target.tagName === 'TEXTAREA' ||
    document.querySelector('dialog[open]')
  ) return;
  if (e.metaKey || e.ctrlKey) {
    if (!e.altKey) {
      const k = e.key.toLowerCase();
      if (k === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (k === 'y') {
        e.preventDefault();
        redo();
      }
    }
    return;
  }
  if (activeCamMode === 'walk') {
    walkState.keys.add(e.key.toLowerCase());
  }
  if (e.key === 'm' || e.key === 'M') {
    setMeasureMode(!measureMode);
  } else if (e.key === '[') {
    e.preventDefault();
    toggleLeftPanel();
  } else if (e.key === ']') {
    e.preventDefault();
    toggleRightPanel();
  } else if (e.key === 'l' || e.key === 'L') {
    setLabelsVisible(!showLabels);
  } else if (e.key === 'Escape') {
    if (measureMode) setMeasureMode(false);
    else if (selectedUid) {
      selectItem(null);
      renderer.domElement.style.cursor = 'default';
    }
  } else if ((e.key === 'r' || e.key === 'R') && selectedUid) {
    rotateSelected(90);
  } else if ((e.key === 'f' || e.key === 'F') && selectedUid) {
    mirrorSelected();
  } else if ((e.key === 'd' || e.key === 'D') && selectedUid) {
    duplicateSelected();
  } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedUid) {
    deleteSelected();
  }
});
window.addEventListener('keyup', (e) => walkState.keys.delete(e.key.toLowerCase()));

// ---------------------------------------------------------------------------
// Camera Presets
// ---------------------------------------------------------------------------
function setCameraMode(mode) {
  activeCamMode = mode;
  document.querySelectorAll('.cam-btn').forEach((b) => b.classList.toggle('active', b.dataset.cam === mode));
  document.getElementById('hud-walk').style.display = mode === 'walk' ? 'block' : 'none';

  if (mode === 'top2d') {
    activeCamera = orthoCamera;
    controls.object = orthoCamera;
    controls.enableRotate = false;
    orthoCamera.position.set(0, 32, 0.2);
    orthoCamera.zoom = 1.05;
    orthoCamera.updateProjectionMatrix();
    controls.target.set(0, 0, 0.2);
    controls.update();
    return;
  }

  activeCamera = perspCamera;
  perspCamera.near = mode === 'walk' ? 0.1 : 0.25;
  perspCamera.far = 85;
  perspCamera.updateProjectionMatrix();
  controls.object = perspCamera;
  controls.enableRotate = mode !== 'walk';
  controls.enabled = mode !== 'walk';

  const presets = {
    dollhouse: [[-14.5, 19.0, 17.5], [0, 0.4, 0.2]],
    living: [[-7.2, 5.2, -3.2], [-2.2, 0.5, -8.0]],
    kitchen: [[-4.8, 4.4, -1.6], [-0.3, 0.8, -3.4]],
    primary: [[-7.8, 6.2, 12.2], [-3.6, 0.5, 7.9]],
    ne: [[7.0, 6.0, -9.8], [2.6, 0.5, -6.5]],
    south: [[2.5, 8.6, 15.6], [1.2, 0.4, 7.8]],
    walk: [[-2.2, 5.5 * FT_TO_M, -6.4], [-2.2, 5.5 * FT_TO_M, -8.5]],
  };
  const [pos, tgt] = presets[mode] || presets.dollhouse;
  perspCamera.position.set(...pos);
  if (mode === 'walk') {
    walkState.yaw = 0;
    walkState.pitch = -0.05;
  } else {
    controls.target.set(...tgt);
    controls.update();
  }
}

document.querySelectorAll('.cam-btn').forEach((btn) => {
  btn.addEventListener('click', () => setCameraMode(btn.dataset.cam));
});

// ---------------------------------------------------------------------------
// UI Wiring: Catalog, Inspector, Architecture Controls, Dialogs & Export
// ---------------------------------------------------------------------------
let activeCategory = 'All';
const categories = ['All', 'Living', 'Dining', 'Bedroom', 'Outdoor'];

function renderCategoryTabs() {
  const host = document.getElementById('cat-tabs');
  host.innerHTML = '';
  for (const cat of categories) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = cat;
    b.classList.toggle('active', cat === activeCategory);
    b.addEventListener('click', () => {
      activeCategory = cat;
      renderCategoryTabs();
      renderCatalogList();
    });
    host.appendChild(b);
  }
}

function renderCatalogList() {
  const host = document.getElementById('catalog-list');
  host.innerHTML = '';
  const items = activeCategory === 'All' ? CATALOG : CATALOG.filter((c) => c.cat === activeCategory);
  for (const c of items) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'catalog-item';
    btn.innerHTML = `<div class="meta"><span class="name">${c.name}</span><span class="dims">${fmtInchesDims(c.w, c.d, c.h)}</span></div><span class="add-tag">+ Add</span>`;
    btn.addEventListener('click', () => {
      // Drop near current camera target (or Living Room center if out of apartment bounds)
      let x = activeCamMode === 'walk' ? perspCamera.position.x : controls.target.x;
      let z = activeCamMode === 'walk' ? perspCamera.position.z : controls.target.z;
      if (Math.abs(x) > 6.5 || z < -11 || z > 12) {
        x = -2.28;
        z = -8.23;
      }
      pushUndoState(`Add ${c.name}`);
      addFurnitureItem({
        catalogId: c.id,
        name: c.name,
        style: c.style,
        wIn: c.w,
        dIn: c.d,
        hIn: c.h,
        x,
        z,
        rot: 0,
        color: c.color,
      });
    });
    host.appendChild(btn);
  }
}

function refreshPlacedList() {
  const host = document.getElementById('placed-list');
  document.getElementById('placed-count').textContent = String(placedItems.length);
  host.innerHTML = '';
  for (const it of placedItems) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `placed-item${it.uid === selectedUid ? ' selected' : ''}`;
    b.innerHTML = `<span>${it.name}</span><span style="color:var(--text-muted);font-size:10.5px;">${fmtInchesDims(it.wIn, it.dIn, it.hIn)}</span>`;
    b.addEventListener('click', () => selectItem(it.uid));
    host.appendChild(b);
  }
}

function updateClearanceBoxText() {
  const box = document.getElementById('clearance-box');
  const item = placedItems.find((i) => i.uid === selectedUid);
  if (!item) {
    box.innerHTML = '';
    return;
  }
  const info = analyzeItemClearances(item);
  const statusHtml = info.wallHit
    ? `<div class="warn">Warning: Overlaps wall structure</div>`
    : info.doorSwingHit
    ? `<div class="warn">Warning: Inside ${info.doorSwingHit} swing</div>`
    : `<div class="ok">Clear of walls &amp; door swings</div>`;

  box.innerHTML = `
    <div>North: <strong>${fmtMeters(info.northDist)}</strong></div>
    <div>South: <strong>${fmtMeters(info.southDist)}</strong></div>
    <div>West: <strong>${fmtMeters(info.westDist)}</strong></div>
    <div>East: <strong>${fmtMeters(info.eastDist)}</strong></div>
    ${statusHtml}
  `;
}

function updateInspectorUI() {
  const item = placedItems.find((i) => i.uid === selectedUid);
  const empty = document.getElementById('inspector-empty');
  const body = document.getElementById('inspector-body');
  const readout = document.getElementById('sel-dims-readout');

  if (!item) {
    empty.style.display = 'block';
    body.style.display = 'none';
    readout.textContent = 'None';
    return;
  }

  empty.style.display = 'none';
  body.style.display = 'flex';
  document.getElementById('sel-name').textContent = item.name;
  readout.textContent = fmtInchesDims(item.wIn, item.dIn, item.hIn);
  document.getElementById('inp-w').value = fmtInVal(item.wIn);
  document.getElementById('inp-d').value = fmtInVal(item.dIn);
  document.getElementById('inp-h').value = fmtInVal(item.hIn);
  document.getElementById('btn-mirror-item').style.display = MIRROR_STYLE_MAP[item.style] ? 'inline-flex' : 'none';
  const rotSlider = document.getElementById('inp-rot');
  rotSlider.value = ((item.rot % 360) + 360) % 360;
  document.getElementById('rot-val').textContent = `${rotSlider.value}°`;
  syncRangeProgress(rotSlider);

  const swatchHost = document.getElementById('swatch-row');
  swatchHost.innerHTML = '';
  for (const hex of SWATCHES) {
    const sw = document.createElement('button');
    sw.type = 'button';
    sw.className = `swatch${item.color === hex ? ' selected' : ''}`;
    sw.style.backgroundColor = hex;
    sw.title = hex;
    sw.addEventListener('click', () => {
      if (item.color === hex) return;
      pushUndoState(`Recolor ${item.name}`);
      item.color = hex;
      rebuildItemMesh(item);
      updateInspectorUI();
      saveToLocalStorage();
    });
    swatchHost.appendChild(sw);
  }
  updateClearanceBoxText();
}

const MIRROR_STYLE_MAP = {
  sectional: 'sectional_left',
  sectional_left: 'sectional',
  leif_curved_sectional: 'leif_curved_sectional_left',
  leif_curved_sectional_left: 'leif_curved_sectional',
  leif_modular_4pc: 'leif_modular_4pc_left',
  leif_modular_4pc_left: 'leif_modular_4pc',
  leif_wedge: 'leif_wedge_left',
  leif_wedge_left: 'leif_wedge',
  leif_arm_chair_right: 'leif_arm_chair_left',
  leif_arm_chair_left: 'leif_arm_chair_right',
  tilda_banquette_right: 'tilda_banquette_left',
  tilda_banquette_left: 'tilda_banquette_right',
};

const MIRROR_CATALOG_MAP = {
  sectional_l: 'sectional_left',
  sectional_left: 'sectional_l',
  leif_modular_4pc: 'leif_modular_4pc_l',
  leif_modular_4pc_l: 'leif_modular_4pc',
  leif_arm_chair_r: 'leif_arm_chair_l',
  leif_arm_chair_l: 'leif_arm_chair_r',
  tilda_banquette_small: 'tilda_banquette_small_l',
  tilda_banquette_small_l: 'tilda_banquette_small',
};

function swapSideLabel(name) {
  if (/\bRight\b/.test(name)) return name.replace(/\bRight\b/, 'Left');
  if (/\bLeft\b/.test(name)) return name.replace(/\bLeft\b/, 'Right');
  return name;
}

function mirrorSelected() {
  const item = placedItems.find((i) => i.uid === selectedUid);
  if (!item || !MIRROR_STYLE_MAP[item.style]) return;
  pushUndoState(`Mirror ${item.name}`);
  const oldCat = CATALOG.find((c) => c.id === item.catalogId);
  item.style = MIRROR_STYLE_MAP[item.style];
  const nextCatId = MIRROR_CATALOG_MAP[item.catalogId];
  if (nextCatId) {
    const nextCat = CATALOG.find((c) => c.id === nextCatId);
    item.catalogId = nextCatId;
    if (nextCat && (!oldCat || item.name === oldCat.name || item.name === 'L-Sectional Sofa' || item.name === 'Tilda 2-Piece Storage Banquette (Small)')) {
      item.name = nextCat.name;
    } else {
      item.name = swapSideLabel(item.name);
    }
  } else {
    item.name = swapSideLabel(item.name);
  }
  rebuildItemMesh(item);
  updateInspectorUI();
  updateClearancesAndSelectionVisuals();
  refreshPlacedList();
  saveToLocalStorage();
}

function rotateSelected(deltaDeg) {
  const item = placedItems.find((i) => i.uid === selectedUid);
  if (!item) return;
  pushUndoState(`Rotate ${item.name}`);
  item.rot = ((item.rot + deltaDeg) % 360 + 360) % 360;
  item.group.rotation.y = (-item.rot * Math.PI) / 180;
  updateInspectorUI();
  updateClearancesAndSelectionVisuals();
  saveToLocalStorage();
}

function duplicateSelected() {
  const item = placedItems.find((i) => i.uid === selectedUid);
  if (!item) return;
  pushUndoState(`Duplicate ${item.name}`);
  addFurnitureItem({ ...item, x: item.x + 0.35, z: item.z + 0.35 }, true);
}

function deleteSelected() {
  if (!selectedUid) return;
  const idx = placedItems.findIndex((i) => i.uid === selectedUid);
  if (idx >= 0) {
    pushUndoState(`Delete ${placedItems[idx].name}`);
    furnitureGroup.remove(placedItems[idx].group);
    placedItems.splice(idx, 1);
    selectItem(null);
    saveToLocalStorage();
  }
}

for (const [id, key] of [['inp-w', 'wIn'], ['inp-d', 'dIn'], ['inp-h', 'hIn']]) {
  document.getElementById(id).addEventListener('change', (e) => {
    const item = placedItems.find((i) => i.uid === selectedUid);
    if (!item) return;
    const val = Math.max(1, Number(e.target.value) || item[key]);
    if (val === item[key]) {
      e.target.value = fmtInVal(item[key]);
      return;
    }
    pushUndoState(`Resize ${item.name}`);
    item[key] = val;
    rebuildItemMesh(item);
    updateInspectorUI();
    updateClearancesAndSelectionVisuals();
    refreshPlacedList();
    saveToLocalStorage();
  });
}

const rotInputEl = document.getElementById('inp-rot');
rotInputEl.addEventListener('input', (e) => {
  const item = placedItems.find((i) => i.uid === selectedUid);
  if (!item) return;
  if (!pendingRotSnapshot || pendingRotItemUid !== item.uid) {
    commitPendingRotation();
    pendingRotSnapshot = captureHistoryState();
    pendingRotItemUid = item.uid;
    pendingRotStartVal = item.rot;
  }
  item.rot = Number(e.target.value);
  item.group.rotation.y = (-item.rot * Math.PI) / 180;
  document.getElementById('rot-val').textContent = `${item.rot}°`;
  updateClearancesAndSelectionVisuals();
  updateClearanceBoxText();
  saveToLocalStorage();
});
rotInputEl.addEventListener('change', commitPendingRotation);

document.getElementById('btn-rot-m45').addEventListener('click', () => rotateSelected(-45));
document.getElementById('btn-rot-p45').addEventListener('click', () => rotateSelected(45));
document.getElementById('btn-rot-p90').addEventListener('click', () => rotateSelected(90));
document.getElementById('btn-mirror-item').addEventListener('click', mirrorSelected);
document.getElementById('btn-dup-item').addEventListener('click', duplicateSelected);
document.getElementById('btn-del-item').addEventListener('click', deleteSelected);

// Architecture Controls
const cutawaySlider = document.getElementById('cutaway-slider');
const ceilingSelect = document.getElementById('ceiling-select');
let prevCeilFt = Number(ceilingSelect.value);

function updateCutaway() {
  const ft = Number(cutawaySlider.value);
  const ceilFt = Number(ceilingSelect.value);
  const isSlicing = ft < ceilFt - 0.02;
  slicePlane.constant = isSlicing ? ft * FT_TO_M + 0.0043 : ceilFt * FT_TO_M + 0.05;
  for (const { mat, defaultSide } of clippableMaterials) {
    const targetPlanes = isSlicing ? [slicePlane] : null;
    const targetSide = isSlicing ? THREE.DoubleSide : defaultSide;
    if ((mat.clippingPlanes !== null) !== isSlicing || mat.side !== targetSide) {
      mat.clippingPlanes = targetPlanes;
      mat.side = targetSide;
      mat.needsUpdate = true;
    }
  }
  document.getElementById('cutaway-val').textContent = fmtFeet(ft);
}
cutawaySlider.addEventListener('input', updateCutaway);

function applyCeilingHeight(ceilFt, persist = true) {
  const validVals = Array.from(ceilingSelect.options).map((o) => Number(o.value));
  const safeFt = validVals.includes(Number(ceilFt)) ? Number(ceilFt) : 9;
  ceilingSelect.value = String(safeFt);
  const scaleY = safeFt / spec.calibration.default_ceiling_ft;
  for (const name of heightScalableNodes) {
    if (nodeRefs[name]) nodeRefs[name].scale.y = scaleY;
  }
  cutawaySlider.max = String(safeFt);
  if (Number(cutawaySlider.value) >= prevCeilFt - 0.1 || Number(cutawaySlider.value) > safeFt) {
    cutawaySlider.value = String(safeFt);
    syncRangeProgress(cutawaySlider);
  }
  prevCeilFt = safeFt;
  updateCutaway();
  if (persist) saveToLocalStorage();
}

ceilingSelect.addEventListener('change', () => {
  const nextFt = Number(ceilingSelect.value);
  if (nextFt !== prevCeilFt) {
    commitPendingRotation();
    const snap = captureHistoryState();
    snap.ceilingFt = prevCeilFt;
    commitUndoSnapshot(snap, 'Change ceiling height');
  }
  applyCeilingHeight(nextFt, true);
});

document.getElementById('overlay-slider').addEventListener('input', (e) => {
  const pct = Number(e.target.value);
  document.getElementById('overlay-val').textContent = `${pct}%`;
  if (floorplanOverlayMesh) {
    floorplanOverlayMesh.visible = pct > 0;
    floorplanOverlayMesh.material.opacity = pct / 100;
  }
});

document.getElementById('chk-swings').addEventListener('change', (e) => {
  swingGroup.visible = e.target.checked;
});
const appEl = document.getElementById('app');
const leftPanelEl = document.getElementById('left-panel');
const rightPanelEl = document.getElementById('right-panel');
const btnToggleLeft = document.getElementById('btn-toggle-left');
const btnToggleRight = document.getElementById('btn-toggle-right');
const edgeToggleLeft = document.getElementById('edge-toggle-left');
const edgeToggleRight = document.getElementById('edge-toggle-right');
const btnToggleLabels = document.getElementById('btn-toggle-labels');
const chkLabelsEl = document.getElementById('chk-labels');

function setLabelsVisible(visible, persist = true) {
  showLabels = Boolean(visible);
  if (chkLabelsEl) chkLabelsEl.checked = showLabels;
  if (btnToggleLabels) {
    btnToggleLabels.classList.toggle('active', showLabels);
    btnToggleLabels.setAttribute('aria-pressed', showLabels ? 'true' : 'false');
  }
  updateProjectedLabels();
  if (persist) saveUiPrefs();
}

function syncPanelToggleUi(btn, edgeBtn, visible, openGlyph, closedGlyph) {
  if (btn) {
    btn.classList.toggle('active', visible);
    btn.setAttribute('aria-expanded', visible ? 'true' : 'false');
  }
  if (edgeBtn) {
    edgeBtn.setAttribute('aria-expanded', visible ? 'true' : 'false');
    edgeBtn.textContent = visible ? openGlyph : closedGlyph;
  }
}

function applyPanelVisibility(persist = true) {
  if (appEl) {
    appEl.classList.toggle('hide-left', !showLeftPanel);
    appEl.classList.toggle('hide-right', !showRightPanel);
  }
  if (leftPanelEl) leftPanelEl.hidden = !showLeftPanel;
  if (rightPanelEl) rightPanelEl.hidden = !showRightPanel;

  syncPanelToggleUi(btnToggleLeft, edgeToggleLeft, showLeftPanel, '‹', '›');
  syncPanelToggleUi(btnToggleRight, edgeToggleRight, showRightPanel, '›', '‹');

  onResize();
  updateProjectedLabels();
  requestAnimationFrame(() => {
    onResize();
    updateProjectedLabels();
  });
  if (persist) saveUiPrefs();
}

function toggleLeftPanel() {
  showLeftPanel = !showLeftPanel;
  applyPanelVisibility(true);
}

function toggleRightPanel() {
  showRightPanel = !showRightPanel;
  applyPanelVisibility(true);
}

btnToggleLeft?.addEventListener('click', toggleLeftPanel);
edgeToggleLeft?.addEventListener('click', toggleLeftPanel);
btnToggleRight?.addEventListener('click', toggleRightPanel);
edgeToggleRight?.addEventListener('click', toggleRightPanel);
btnToggleLabels?.addEventListener('click', () => setLabelsVisible(!showLabels));
chkLabelsEl?.addEventListener('change', (e) => setLabelsVisible(e.target.checked));
document.getElementById('chk-grid').addEventListener('change', (e) => {
  gridGroup.visible = e.target.checked;
});
document.getElementById('chk-fixtures').addEventListener('change', (e) => {
  for (const name of Object.keys(nodeRefs)) {
    if (name.startsWith('Fixtures_')) nodeRefs[name].visible = e.target.checked;
  }
});
document.getElementById('chk-doors').addEventListener('change', (e) => {
  if (nodeRefs.Doors) nodeRefs.Doors.visible = e.target.checked;
});

document.getElementById('unit-select').addEventListener('change', (e) => {
  unitMode = e.target.value;
  renderCatalogList();
  refreshPlacedList();
  updateInspectorUI();
  updateCutaway();
  updateMeasurePinTexts();
  for (const rl of roomLabelEls) {
    const r = rl.room;
    const dimText = unitMode === 'metric'
      ? `${(r.measured_ft[0] * FT_TO_M).toFixed(2)}×${(r.measured_ft[1] * FT_TO_M).toFixed(2)} m`
      : (r.printed_label !== '—' ? r.printed_label : r.measured_str);
    rl.el.querySelector('.rl-dims').textContent = dimText;
  }
});

// Toolbar actions
document.getElementById('btn-undo').addEventListener('click', (e) => {
  if (e.currentTarget.getAttribute('aria-disabled') === 'true') return;
  undo();
});
document.getElementById('btn-redo').addEventListener('click', (e) => {
  if (e.currentTarget.getAttribute('aria-disabled') === 'true') return;
  redo();
});
document.getElementById('btn-preset-starter').addEventListener('click', () => {
  pushUndoState('Load Starter Layout');
  loadLayoutArray(STARTER_LAYOUT);
  pushCloudLayoutNow({ forceSnapshot: true });
});
document.getElementById('btn-clear-all').addEventListener('click', () => {
  if (placedItems.length > 0) pushUndoState('Clear all furniture');
  loadLayoutArray([]);
  pushCloudLayoutNow({ forceSnapshot: true });
});
document.getElementById('btn-measure').addEventListener('click', () => setMeasureMode(!measureMode));
document.getElementById('btn-clear-measure').addEventListener('click', () => {
  for (const p of measurePins) {
    measureGroup.remove(p.line);
    p.el.remove();
  }
  measurePins.length = 0;
});

// Save / Load JSON, Named Layouts & Status Feedback
const hudStatusEl = document.getElementById('hud-status');
const defaultHudHtml = hudStatusEl.innerHTML;
let hudMsgTimer = null;

function showHudMessage(msg, isError = false) {
  if (hudMsgTimer) clearTimeout(hudMsgTimer);
  hudStatusEl.textContent = '';
  const strong = document.createElement('strong');
  strong.style.color = isError ? 'var(--warn)' : 'var(--ok)';
  strong.textContent = msg;
  hudStatusEl.appendChild(strong);
  hudMsgTimer = setTimeout(() => {
    hudStatusEl.innerHTML = defaultHudHtml;
    hudMsgTimer = null;
  }, 4500);
}

const layoutsDialog = document.getElementById('layouts-dialog');
const layoutsStatusEl = document.getElementById('layouts-status');

function showLayoutModalStatus(msg, isError = false) {
  layoutsStatusEl.textContent = msg;
  layoutsStatusEl.className = msg ? `layout-status ${isError ? 'err' : 'ok'}` : 'layout-status';
}

function readSavedLayouts() {
  try {
    const raw = localStorage.getItem(SAVED_LAYOUTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function updateLayoutsButtonLabel() {
  const count = readSavedLayouts().length;
  document.getElementById('btn-open-layouts').textContent = count > 0 ? `Layouts (${count})` : 'Layouts';
  document.getElementById('saved-layouts-count').textContent = String(count);
}

function writeSavedLayouts(list) {
  try {
    localStorage.setItem(SAVED_LAYOUTS_KEY, JSON.stringify(list));
    updateLayoutsButtonLabel();
    const savedAt = new Date().toISOString();
    localWriteSeq++;
    pendingRemoteSync = null;
    lastAutoSaveIso = savedAt;
    lastAppliedSyncTs = Date.parse(savedAt) || Date.now();
    lastAppliedSignature = computeContentSignature(Number(ceilingSelect.value), serializePlacedItems(), list);
    lastAutoSaveOk = true;
    lastAutoSaveError = '';
    hadSavedLocalOnBoot = true;
    try { persistCurrentLayoutToLocalStorage(savedAt); } catch (_) {}
    updateAutoSaveUI({ ok: true, savedAt });
    broadcastSnapshot(buildSyncSnapshot(savedAt));
    scheduleLinkedFileWrite();
    scheduleCloudPush();
    return true;
  } catch (_) {
    return false;
  }
}

function slugifyFilename(name) {
  const clean = String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return clean || 'apartment_furniture_layout';
}

async function saveLayoutToFile(payload, filename = 'apartment_furniture_layout.json') {
  const text = JSON.stringify(payload, null, 2);
  if (typeof window.showSaveFilePicker === 'function') {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [{ description: 'JSON Layout', accept: { 'application/json': ['.json'] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(new Blob([text], { type: 'application/json' }));
      await writable.close();
      return { saved: true, filename: handle.name || filename };
    } catch (err) {
      if (err && err.name === 'AbortError') {
        return { saved: false, cancelled: true };
      }
    }
  }
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  return { saved: true, filename };
}

async function copyTextToClipboard(text) {
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (_) {}
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch (_) {}
  ta.remove();
  return ok;
}

function formatDefaultLayoutName() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `Layout ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatLayoutSummaryMeta(count, ceilingFt, savedAt = null) {
  const ceilStr = Number.isFinite(Number(ceilingFt)) ? `${Number(ceilingFt)}'-0"` : "9'-0\"";
  let dateStr = '';
  if (savedAt && !Number.isNaN(Date.parse(savedAt))) {
    dateStr = ` · ${new Date(savedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`;
  }
  return `${count} ${count === 1 ? 'item' : 'items'} · ${ceilStr} ceiling${dateStr}`;
}

function renderSavedLayoutsList() {
  const host = document.getElementById('saved-layouts-list');
  const list = readSavedLayouts();
  host.textContent = '';
  updateLayoutsButtonLabel();

  if (list.length === 0) {
    const empty = document.createElement('div');
    empty.style.color = 'var(--text-muted)';
    empty.style.fontSize = '12px';
    empty.textContent = 'No saved layouts yet. Name your current arrangement above and click Save Current.';
    host.appendChild(empty);
    return;
  }

  for (const layout of list) {
    const row = document.createElement('div');
    row.className = 'saved-layout-row';

    const meta = document.createElement('div');
    meta.className = 'saved-layout-meta';

    const title = document.createElement('div');
    title.className = 'saved-layout-name';
    title.textContent = layout.name || 'Untitled Layout';

    const count = Array.isArray(layout.items) ? layout.items.length : 0;
    const info = document.createElement('div');
    info.className = 'saved-layout-info';
    info.textContent = formatLayoutSummaryMeta(count, layout.ceiling_ft, layout.savedAt);

    meta.appendChild(title);
    meta.appendChild(info);

    const actions = document.createElement('div');
    actions.className = 'saved-layout-actions';

    const btnLoad = document.createElement('button');
    btnLoad.type = 'button';
    btnLoad.className = 'primary';
    btnLoad.textContent = 'Load';
    btnLoad.addEventListener('click', () => {
      try {
        const n = importLayoutPayload(layout);
        layoutsDialog.close();
        showHudMessage(`Loaded "${layout.name || 'Layout'}" (${n} ${n === 1 ? 'item' : 'items'})`);
      } catch (err) {
        showLayoutModalStatus(`Failed to load layout: ${err.message}`, true);
      }
    });

    const btnUpdate = document.createElement('button');
    btnUpdate.type = 'button';
    btnUpdate.textContent = 'Update';
    btnUpdate.addEventListener('click', () => {
      const currentList = readSavedLayouts();
      const target = currentList.find((x) => x.id === layout.id) || currentList.find((x) => x.name === layout.name);
      if (!target) return;
      const updated = buildLayoutPayload(target.name || 'Untitled Layout');
      target.items = updated.items;
      target.ceiling_ft = updated.ceiling_ft;
      target.savedAt = updated.savedAt;
      target.version = updated.version;
      if (!writeSavedLayouts(currentList)) {
        showLayoutModalStatus('Could not update saved layout in browser storage.', true);
        return;
      }
      renderSavedLayoutsList();
      showLayoutModalStatus(`Updated "${target.name}" (${updated.items.length} ${updated.items.length === 1 ? 'item' : 'items'})`);
    });

    const btnExport = document.createElement('button');
    btnExport.type = 'button';
    btnExport.textContent = 'Export';
    btnExport.addEventListener('click', async () => {
      const res = await saveLayoutToFile(layout, `${slugifyFilename(layout.name)}.json`);
      if (res.saved) {
        showLayoutModalStatus(`Exported "${layout.name}" to ${res.filename}`);
      }
    });

    const btnDel = document.createElement('button');
    btnDel.type = 'button';
    btnDel.className = 'danger';
    btnDel.textContent = 'Delete';
    btnDel.addEventListener('click', () => {
      const next = readSavedLayouts().filter((x) => (layout.id ? x.id !== layout.id : x.name !== layout.name));
      writeSavedLayouts(next);
      renderSavedLayoutsList();
      showLayoutModalStatus(`Deleted "${layout.name || 'Layout'}"`);
    });

    actions.appendChild(btnLoad);
    actions.appendChild(btnUpdate);
    actions.appendChild(btnExport);
    actions.appendChild(btnDel);

    row.appendChild(meta);
    row.appendChild(actions);
    host.appendChild(row);
  }
}

function renderVersionHistoryRows(versions, { loading = false, errorMsg = '' } = {}) {
  const host = document.getElementById('version-history-list');
  const countEl = document.getElementById('version-history-count');
  if (!host || !countEl) return;

  host.textContent = '';
  if (loading) {
    countEl.textContent = '…';
    const msg = document.createElement('div');
    msg.style.color = 'var(--text-muted)';
    msg.style.fontSize = '12px';
    msg.textContent = 'Loading cloud version history…';
    host.appendChild(msg);
    return;
  }

  if (errorMsg) {
    countEl.textContent = '0';
    const msg = document.createElement('div');
    msg.style.color = 'var(--warn)';
    msg.style.fontSize = '12px';
    msg.textContent = errorMsg;
    host.appendChild(msg);
    return;
  }

  const list = Array.isArray(versions) ? versions : [];
  countEl.textContent = String(list.length);

  if (list.length === 0) {
    const empty = document.createElement('div');
    empty.style.color = 'var(--text-muted)';
    empty.style.fontSize = '12px';
    empty.textContent = 'No automatic cloud snapshots yet. Earlier states appear here automatically as edits sync.';
    host.appendChild(empty);
    return;
  }

  list.forEach((ver, idx) => {
    const row = document.createElement('div');
    row.className = 'saved-layout-row';

    const meta = document.createElement('div');
    meta.className = 'saved-layout-meta';

    const title = document.createElement('div');
    title.className = 'saved-layout-name';
    let label = 'Cloud Snapshot';
    if (ver.savedAt && !Number.isNaN(Date.parse(ver.savedAt))) {
      label = new Date(ver.savedAt).toLocaleString([], {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
    }
    title.textContent = idx === 0 ? `${label} (Previous)` : label;

    const count = Number.isFinite(Number(ver.itemCount)) ? Number(ver.itemCount) : 0;
    const info = document.createElement('div');
    info.className = 'saved-layout-info';
    info.textContent = formatLayoutSummaryMeta(count, ver.ceiling_ft);

    meta.appendChild(title);
    meta.appendChild(info);

    const actions = document.createElement('div');
    actions.className = 'saved-layout-actions';

    const btnRestore = document.createElement('button');
    btnRestore.type = 'button';
    btnRestore.className = 'primary';
    btnRestore.textContent = 'Restore';
    btnRestore.addEventListener('click', async () => {
      btnRestore.disabled = true;
      try {
        await restoreCloudVersion(ver);
      } finally {
        btnRestore.disabled = false;
      }
    });

    const btnExport = document.createElement('button');
    btnExport.type = 'button';
    btnExport.textContent = 'Export';
    btnExport.addEventListener('click', async () => {
      btnExport.disabled = true;
      try {
        await exportCloudVersion(ver);
      } finally {
        btnExport.disabled = false;
      }
    });

    actions.appendChild(btnRestore);
    actions.appendChild(btnExport);
    row.appendChild(meta);
    row.appendChild(actions);
    host.appendChild(row);
  });
}

async function fetchCloudVersionHistory() {
  const section = document.getElementById('version-history-section');
  if (!section) return;
  if (!isCloudSyncSupported()) {
    section.style.display = 'none';
    return;
  }
  section.style.display = '';
  const seq = ++historyFetchSeq;
  renderVersionHistoryRows([], { loading: true });
  try {
    const res = await fetch(getCloudSyncUrl({ history: '1' }), {
      method: 'GET',
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (seq !== historyFetchSeq) return;
    renderVersionHistoryRows(Array.isArray(data?.versions) ? data.versions : []);
  } catch (err) {
    if (seq !== historyFetchSeq) return;
    renderVersionHistoryRows([], { errorMsg: `Could not load cloud history: ${err?.message || 'Network error'}` });
  }
}

async function restoreCloudVersion(versionMeta) {
  try {
    showLayoutModalStatus('Loading saved version…');
    const res = await fetch(getCloudSyncUrl({ versionId: versionMeta.id }), {
      method: 'GET',
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data?.version) throw new Error('Version data missing');
    const normalized = validateAndNormalizeLayout(data.version);
    pushUndoState('Restore saved version');
    loadLayoutArray(normalized.items, { save: false, migrate: false });
    if (normalized.ceilingFt !== null) {
      applyCeilingHeight(normalized.ceilingFt, false);
    }
    saveToLocalStorage();
    await pushCloudLayoutNow({ forceSnapshot: true });
    await fetchCloudVersionHistory();
    const msg = `Restored version (${normalized.items.length} ${normalized.items.length === 1 ? 'item' : 'items'})`;
    showLayoutModalStatus(msg);
    showHudMessage(msg);
  } catch (err) {
    showLayoutModalStatus(`Failed to restore version: ${err?.message || 'Unknown error'}`, true);
  }
}

async function exportCloudVersion(versionMeta) {
  try {
    const res = await fetch(getCloudSyncUrl({ versionId: versionMeta.id }), {
      method: 'GET',
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data?.version) throw new Error('Version data missing');
    const stamp = (versionMeta.savedAt || '').slice(0, 19).replace(/[:T]/g, '-');
    const resSave = await saveLayoutToFile(
      data.version,
      `apartment_layout_${stamp || versionMeta.id}.json`
    );
    if (resSave.saved) {
      showLayoutModalStatus(`Exported snapshot to ${resSave.filename}`);
    }
  } catch (err) {
    showLayoutModalStatus(`Failed to export version: ${err?.message || 'Unknown error'}`, true);
  }
}

function saveCurrentAsNamedLayout(rawName) {
  const name = rawName.trim() || formatDefaultLayoutName();
  const payload = {
    id: `lay_${Date.now()}`,
    ...buildLayoutPayload(name),
  };
  const existing = readSavedLayouts();
  const idx = existing.findIndex((x) => typeof x.name === 'string' && x.name.toLowerCase() === name.toLowerCase());
  if (idx >= 0) {
    payload.id = existing[idx].id || payload.id;
    existing.splice(idx, 1);
  }
  const next = [payload, ...existing];
  if (!writeSavedLayouts(next)) {
    showLayoutModalStatus('Could not save layout to browser storage.', true);
    return;
  }
  renderSavedLayoutsList();
  document.getElementById('layout-save-name').value = '';
  showLayoutModalStatus(`Saved "${name}" (${payload.items.length} ${payload.items.length === 1 ? 'item' : 'items'})`);
}

function openLayoutsModal() {
  renderSavedLayoutsList();
  updateAutoSaveUI({ ok: lastAutoSaveOk, savedAt: lastAutoSaveIso, errorMsg: lastAutoSaveError });
  showLayoutModalStatus('');
  layoutsDialog.showModal();
  fetchCloudVersionHistory();
}

document.getElementById('btn-open-layouts').addEventListener('click', openLayoutsModal);
document.getElementById('btn-autosave').addEventListener('click', openLayoutsModal);
document.getElementById('btn-refresh-history').addEventListener('click', fetchCloudVersionHistory);

document.getElementById('btn-cloud-sync-now').addEventListener('click', async () => {
  if (!isCloudSyncSupported()) {
    showLayoutModalStatus('Cloud sync works on hosted URLs (http:// or https://).', true);
    return;
  }
  const changed = await pullCloudLayout({ initial: true, force: false });
  if (!lastCloudSyncOk) {
    showLayoutModalStatus(`Cloud sync failed: ${lastCloudSyncError || 'Network error'}`, true);
  } else if (changed) {
    showLayoutModalStatus('Synced latest layout from cloud.');
  } else {
    showLayoutModalStatus('Cloud sync is up to date.');
  }
});

document.getElementById('btn-toggle-cloud-sync').addEventListener('click', () => {
  if (!isCloudSyncSupported()) return;
  const nextActive = !isCloudSyncActive();
  try {
    localStorage.setItem(CLOUD_SYNC_ENABLED_KEY, nextActive ? '1' : '0');
  } catch (_) {}
  updateAutoSaveUI({ ok: lastAutoSaveOk, savedAt: lastAutoSaveIso, errorMsg: lastAutoSaveError });
  if (nextActive) {
    startCloudPolling();
    pullCloudLayout({ initial: true });
    showLayoutModalStatus('Cloud sync enabled.');
  } else {
    stopCloudPolling();
    if (cloudPushTimer) {
      clearTimeout(cloudPushTimer);
      cloudPushTimer = null;
    }
    showLayoutModalStatus('Cloud sync paused; browser auto-save remains active.');
  }
});

document.getElementById('btn-link-existing-file').addEventListener('click', async () => {
  if (typeof window.showOpenFilePicker !== 'function') {
    showLayoutModalStatus('Linking an existing file requires Chrome or Edge; browser & cloud sync remain active.', true);
    return;
  }
  try {
    const [handle] = await window.showOpenFilePicker({
      multiple: false,
      types: [{ description: 'JSON Layout', accept: { 'application/json': ['.json'] } }],
    });
    if (!handle) return;
    const perm = await handle.requestPermission({ mode: 'readwrite' });
    if (perm !== 'granted') {
      showLayoutModalStatus('Read/write file permission is required for two-way file sync.', true);
      return;
    }
    await activateLinkedFileHandle(handle, { readFirst: true });
    showLayoutModalStatus(`Two-way sync active with ${handle.name}`);
  } catch (err) {
    if (!err || err.name !== 'AbortError') {
      showLayoutModalStatus(`Could not link existing file: ${err?.message || 'Invalid JSON or permission denied'}`, true);
    }
  }
});

document.getElementById('btn-link-autosave-file').addEventListener('click', async () => {
  if (typeof window.showSaveFilePicker !== 'function') {
    showLayoutModalStatus('Live file auto-save requires Chrome or Edge; browser & cloud sync remain active.', true);
    return;
  }
  try {
    const handle = await window.showSaveFilePicker({
      suggestedName: 'apartment_furniture_layout.json',
      types: [{ description: 'JSON Layout', accept: { 'application/json': ['.json'] } }],
    });
    await activateLinkedFileHandle(handle, { readFirst: false });
    showLayoutModalStatus(`Two-way auto-save active with ${handle.name}`);
  } catch (err) {
    if (!err || err.name !== 'AbortError') {
      showLayoutModalStatus(`Could not link auto-save file: ${err?.message || 'Permission denied'}`, true);
    }
  }
});

async function handleReconnectFileClick() {
  const name = pendingReconnectHandle?.name || 'linked file';
  const ok = await reconnectStoredFileHandle();
  const msg = ok ? `Reconnected two-way sync with ${name}` : `Could not reconnect ${name}`;
  if (layoutsDialog.open) showLayoutModalStatus(msg, !ok);
  else showHudMessage(msg, !ok);
}

document.getElementById('btn-reconnect-file').addEventListener('click', handleReconnectFileClick);
document.getElementById('btn-reconnect-file-dialog').addEventListener('click', handleReconnectFileClick);

document.getElementById('btn-unlink-autosave-file').addEventListener('click', async () => {
  await unlinkLinkedFile();
  showLayoutModalStatus('Unlinked disk file; browser auto-save remains active.');
});

layoutsDialog.addEventListener('close', () => {
  layoutsDialog.returnValue = '';
});

document.getElementById('save-layout-form').addEventListener('submit', (e) => {
  e.preventDefault();
  saveCurrentAsNamedLayout(document.getElementById('layout-save-name').value);
});

async function triggerFileSave() {
  const payload = buildLayoutPayload();
  const res = await saveLayoutToFile(payload, 'apartment_furniture_layout.json');
  if (res.saved) {
    const msg = `Saved ${payload.items.length} ${payload.items.length === 1 ? 'item' : 'items'} to ${res.filename}`;
    if (layoutsDialog.open) showLayoutModalStatus(msg);
    else showHudMessage(msg);
  }
}

document.getElementById('btn-save-json').addEventListener('click', triggerFileSave);
document.getElementById('btn-dialog-save-file').addEventListener('click', triggerFileSave);

const fileInput = document.getElementById('file-load-json');
document.getElementById('btn-load-json').addEventListener('click', () => fileInput.click());
document.getElementById('btn-dialog-load-file').addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const n = importLayoutPayload(data);
    if (layoutsDialog.open) layoutsDialog.close();
    showHudMessage(`Loaded ${n} ${n === 1 ? 'item' : 'items'} from ${file.name}`);
  } catch (err) {
    const msg = `Failed to load JSON layout: ${err.message}`;
    if (layoutsDialog.open) showLayoutModalStatus(msg, true);
    else showHudMessage(msg, true);
  }
  fileInput.value = '';
});

document.getElementById('btn-copy-json').addEventListener('click', async () => {
  const payload = buildLayoutPayload();
  const ok = await copyTextToClipboard(JSON.stringify(payload, null, 2));
  if (ok) {
    showLayoutModalStatus(`Copied JSON (${payload.items.length} ${payload.items.length === 1 ? 'item' : 'items'}) to clipboard`);
  } else {
    showLayoutModalStatus('Could not copy to clipboard; use Save File (.json) instead.', true);
  }
});

document.getElementById('btn-paste-load-json').addEventListener('click', () => {
  const input = document.getElementById('paste-json-input');
  const rawText = input.value.trim();
  if (!rawText) {
    showLayoutModalStatus('Paste layout JSON first.', true);
    return;
  }
  try {
    const data = JSON.parse(rawText);
    const n = importLayoutPayload(data);
    input.value = '';
    layoutsDialog.close();
    showHudMessage(`Loaded ${n} ${n === 1 ? 'item' : 'items'} from pasted JSON`);
  } catch (err) {
    showLayoutModalStatus(`Invalid layout JSON: ${err.message}`, true);
  }
});

// Export combined GLB & download bare GLB
document.getElementById('btn-export-glb').addEventListener('click', () => {
  const exportScene = new THREE.Scene();
  exportScene.add(apartmentGroup.clone(true));
  exportScene.add(furnitureGroup.clone(true));
  new GLTFExporter().parse(
    exportScene,
    (result) => {
      const blob = new Blob([result], { type: 'model/gltf-binary' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'apartment_furnished.glb';
      a.click();
      URL.revokeObjectURL(url);
    },
    (err) => alert(`GLB export error: ${err}`),
    { binary: true }
  );
});

document.getElementById('btn-download-base-glb').addEventListener('click', () => {
  const blob = new Blob([base64ToArrayBuffer(glbBase64)], { type: 'model/gltf-binary' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'apartment_exact.glb';
  a.click();
  URL.revokeObjectURL(url);
});

// ---------------------------------------------------------------------------
// Native <dialog> Modals + Modern Web Guidance Fallbacks
// ---------------------------------------------------------------------------
const customDialog = document.getElementById('custom-item-dialog');
const dimsDialog = document.getElementById('dimensions-dialog');

// Populate Room Specs table
{
  const tbody = document.getElementById('dims-table-body');
  document.getElementById('dims-net-area').textContent = String(spec.area.net_interior_sqft);
  document.getElementById('dims-gross-area').textContent = String(spec.area.gross_interior_sqft);
  for (const r of spec.rooms) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td><strong>${r.name}</strong></td><td>${r.printed_label}</td><td>${r.measured_str}</td><td>${r.area_sqft} sq ft</td>`;
    tbody.appendChild(tr);
  }
}

document.getElementById('btn-open-custom').addEventListener('click', () => customDialog.showModal());
document.getElementById('btn-open-dims').addEventListener('click', () => dimsDialog.showModal());

customDialog.addEventListener('close', () => {
  if (customDialog.returnValue === 'create') {
    const customName = document.getElementById('custom-name').value.trim() || 'Custom Piece';
    pushUndoState(`Add ${customName}`);
    addFurnitureItem({
      catalogId: 'custom',
      name: customName,
      style: document.getElementById('custom-shape').value,
      wIn: Math.max(4, Number(document.getElementById('custom-w').value) || 48),
      dIn: Math.max(4, Number(document.getElementById('custom-d').value) || 24),
      hIn: Math.max(1, Number(document.getElementById('custom-h').value) || 30),
      x: -2.28,
      z: -8.23,
      rot: 0,
      color: '#64748b',
    });
  }
  customDialog.returnValue = '';
});

dimsDialog.addEventListener('close', () => {
  dimsDialog.returnValue = '';
});

// Mandatory closedby="any" fallback for browsers without native closedBy support (e.g. Safari)
if (!('closedBy' in HTMLDialogElement.prototype)) {
  const outside = (e, dialog) => {
    const r = dialog.getBoundingClientRect();
    return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
  };
  for (const dialog of document.querySelectorAll('dialog[closedby="any"]')) {
    let pressedOutside = false;
    dialog.addEventListener('pointerdown', (e) => { pressedOutside = outside(e, dialog); });
    dialog.addEventListener('pointerup', (e) => {
      if (pressedOutside && outside(e, dialog)) dialog.close();
    });
  }
}

// Mandatory dynamic range slider --progress fallback when accent-color is unsupported
function syncRangeProgress(slider) {
  const min = Number(slider.min || 0);
  const max = Number(slider.max || 100);
  const pct = max > min ? ((Number(slider.value) - min) / (max - min)) * 100 : 0;
  slider.style.setProperty('--progress', `${pct}%`);
}

if (!CSS.supports('accent-color', '#38bdf8')) {
  for (const slider of document.querySelectorAll('input[type="range"]')) {
    syncRangeProgress(slider);
    slider.addEventListener('input', () => syncRangeProgress(slider));
  }
}

// ---------------------------------------------------------------------------
// Resize & Animation Loop
// ---------------------------------------------------------------------------
function onResize() {
  const w = Math.max(1, canvasHost.clientWidth);
  const h = Math.max(1, canvasHost.clientHeight);
  const asp = w / h;
  perspCamera.aspect = asp;
  perspCamera.updateProjectionMatrix();

  orthoCamera.left = -orthoHalfH * asp;
  orthoCamera.right = orthoHalfH * asp;
  orthoCamera.top = orthoHalfH;
  orthoCamera.bottom = -orthoHalfH;
  orthoCamera.updateProjectionMatrix();

  renderer.setSize(w, h);
}
window.addEventListener('resize', onResize);
if (typeof ResizeObserver === 'function') {
  new ResizeObserver(() => {
    onResize();
    updateProjectedLabels();
  }).observe(canvasHost);
}

let lastTime = performance.now();
function animate(now) {
  requestAnimationFrame(animate);
  const dt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;

  if (activeCamMode === 'walk') {
    const speed = 3.2 * dt;
    const fwd = new THREE.Vector3(-Math.sin(walkState.yaw), 0, -Math.cos(walkState.yaw));
    const right = new THREE.Vector3(Math.cos(walkState.yaw), 0, -Math.sin(walkState.yaw));
    if (walkState.keys.has('w') || walkState.keys.has('arrowup')) perspCamera.position.addScaledVector(fwd, speed);
    if (walkState.keys.has('s') || walkState.keys.has('arrowdown')) perspCamera.position.addScaledVector(fwd, -speed);
    if (walkState.keys.has('a') || walkState.keys.has('arrowleft')) perspCamera.position.addScaledVector(right, -speed);
    if (walkState.keys.has('d') || walkState.keys.has('arrowright')) perspCamera.position.addScaledVector(right, speed);
    perspCamera.position.y = 5.5 * FT_TO_M;

    const lookDir = new THREE.Vector3(
      -Math.sin(walkState.yaw) * Math.cos(walkState.pitch),
      Math.sin(walkState.pitch),
      -Math.cos(walkState.yaw) * Math.cos(walkState.pitch)
    );
    perspCamera.lookAt(perspCamera.position.clone().add(lookDir));
  } else {
    controls.update();
  }

  renderer.render(scene, activeCamera);
  updateProjectedLabels();
}

// Page-lifecycle auto-save flush & sync refresh
function flushPendingAutoSave() {
  const rotChanged = commitPendingRotation();
  if (rotChanged) saveToLocalStorage();
  if (cloudPushTimer || cloudPushQueued) pushCloudLayoutNow({ keepalive: true });
  if (fileWriteTimer || fileWriteQueued) writeLinkedAutoSaveFileNow();
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    flushPendingAutoSave();
  } else if (document.visibilityState === 'visible') {
    pollLinkedFileOnce();
    pullCloudLayout();
  }
});
window.addEventListener('pagehide', flushPendingAutoSave);
window.addEventListener('focus', () => {
  pollLinkedFileOnce();
  pullCloudLayout();
});
window.addEventListener('online', () => {
  pullCloudLayout();
});

// ---------------------------------------------------------------------------
// Initial Boot
// ---------------------------------------------------------------------------
renderCategoryTabs();
renderCatalogList();
updateCutaway();
document.getElementById('area-pill').textContent = `${spec.area.net_interior_sqft.toLocaleString()} sq ft · 4BR / 3BA`;

updateLayoutsButtonLabel();
updateUndoRedoButtons();

/**
 * One-time boot migration swapping the old Living Room L-sectional (and
 * nudging the nearby default lounge chair) to the 4-piece Leif curved sectional.
 */
function applyOneTimeLivingLeifMigration(items) {
  let migrated = false;
  try {
    if (localStorage.getItem(LEIF_LIVING_MIGRATED_KEY)) return false;
    const hasLeif = items.some((it) =>
      it && (it.catalogId === 'leif_modular_4pc' || it.catalogId === 'leif_modular_4pc_l')
    );
    const sectionalIdx = items.findIndex((it) =>
      it && (it.catalogId === 'sectional_l' || it.catalogId === 'sectional_left') && Number(it.z) < -5.5
    );
    if (!hasLeif && sectionalIdx !== -1) {
      items[sectionalIdx] = { catalogId: 'leif_modular_4pc', x: -2.85, z: -8.40, rot: 270, color: '#7a6a5b' };
      const chair = items.find((it) =>
        it && it.catalogId === 'lounge_chair' &&
        Math.hypot(Number(it.x) - (-4.40), Number(it.z) - (-6.95)) < 0.25
      );
      if (chair) {
        chair.x = -0.95;
        chair.z = -6.70;
        chair.rot = 145;
      }
      migrated = true;
    }
    localStorage.setItem(LEIF_LIVING_MIGRATED_KEY, '1');
  } catch (_) {}
  return migrated;
}

let restored = false;
try {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved !== null) {
    const parsed = JSON.parse(saved);
    const restoredItems = Array.isArray(parsed)
      ? parsed
      : (parsed && Array.isArray(parsed.items) ? parsed.items : null);
    if (restoredItems) {
      const migrated = applyOneTimeLivingLeifMigration(restoredItems);
      loadLayoutArray(restoredItems, { save: migrated, migrate: true, addFlankingSpeakersOnTvUpgrade: true });
      if (!Array.isArray(parsed) && Number.isFinite(Number(parsed.ceiling_ft))) {
        applyCeilingHeight(Number(parsed.ceiling_ft), migrated);
      }
      if (!migrated && !lastAutoSaveIso && !Array.isArray(parsed)) {
        lastAutoSaveIso = typeof parsed.savedAt === 'string' ? parsed.savedAt : null;
      }
      restored = true;
    }
  }
} catch (_) {}

hadSavedLocalOnBoot = restored;
if (restored) {
  lastAppliedSyncTs = lastAutoSaveIso ? (Date.parse(lastAutoSaveIso) || 0) : 0;
  lastAppliedSignature = computeContentSignature(Number(ceilingSelect.value), serializePlacedItems(), readSavedLayouts());
} else {
  try { localStorage.setItem(LEIF_LIVING_MIGRATED_KEY, '1'); } catch (_) {}
  loadLayoutArray(STARTER_LAYOUT, { save: false });
  lastAppliedSyncTs = 0;
  lastAppliedSignature = '';
  if (!isCloudSyncActive()) {
    saveToLocalStorage();
  }
}

updateAutoSaveUI({ ok: lastAutoSaveOk, savedAt: lastAutoSaveIso, errorMsg: lastAutoSaveError });
setLabelsVisible(showLabels, false);
applyPanelVisibility(false);
setupSameOriginTabSync();
initStoredFileHandle();
if (isCloudSyncActive()) {
  pullCloudLayout({ initial: true });
  startCloudPolling();
}

requestAnimationFrame(animate);
