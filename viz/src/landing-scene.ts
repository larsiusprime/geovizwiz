/**
 * Landing Page 3D Scene
 * Lightweight Three.js animation for Civic Mapper landing page
 */

import * as THREE from 'three';

export class LandingScene {
  private container: HTMLElement;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private buildings: THREE.Mesh[] = [];
  private particles: THREE.Points | null = null;
  private animationId: number | null = null;
  private mouseX = 0;
  private mouseY = 0;
  private targetX = 0;
  private targetY = 0;

  constructor(containerId: string) {
    const el = document.getElementById(containerId);
    if (!el) throw new Error(`Container #${containerId} not found`);
    this.container = el;

    // Scene setup
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0xf8fafc, 10, 50);

    // Camera setup
    this.camera = new THREE.PerspectiveCamera(
      60,
      this.container.clientWidth / this.container.clientHeight,
      0.1,
      100
    );
    this.camera.position.set(0, 8, 15);
    this.camera.lookAt(0, 0, 0);

    // Renderer setup
    this.renderer = new THREE.WebGLRenderer({ 
      alpha: true, 
      antialias: true,
      powerPreference: 'low-power'
    });
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0xf8fafc, 0);
    this.container.appendChild(this.renderer.domElement);

    // Lighting
    this.setupLights();

    // Create scene elements
    this.createBuildings();
    this.createParticles();
    this.createGround();

    // Event listeners
    this.setupEventListeners();

    // Start animation
    this.animate();
  }

  private setupLights(): void {
    // Ambient light
    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambient);

    // Directional light (sun)
    const sun = new THREE.DirectionalLight(0xffffff, 0.8);
    sun.position.set(5, 10, 5);
    sun.castShadow = false; // Keep it performant
    this.scene.add(sun);

    // Accent light (blue)
    const accentLight = new THREE.PointLight(0x3b82f6, 1, 20);
    accentLight.position.set(-5, 5, 5);
    this.scene.add(accentLight);
  }

  private createBuildings(): void {
    const buildingData = [
      { x: -4, z: -2, w: 1.5, h: 3, d: 1.5, color: 0x3b82f6 },
      { x: -2, z: -3, w: 1.2, h: 5, d: 1.2, color: 0x2563eb },
      { x: 0, z: -2.5, w: 1.8, h: 2.5, d: 1.8, color: 0x14b8a6 },
      { x: 2, z: -3, w: 1.3, h: 6, d: 1.3, color: 0x0d9488 },
      { x: 4, z: -2, w: 1.6, h: 4, d: 1.6, color: 0x3b82f6 },
      { x: -3, z: 0, w: 1.4, h: 3.5, d: 1.4, color: 0x2dd4bf },
      { x: 1, z: 0.5, w: 1.7, h: 2.8, d: 1.7, color: 0x60a5fa },
      { x: 3.5, z: 1, w: 1.2, h: 4.5, d: 1.2, color: 0x1d4ed8 },
    ];

    buildingData.forEach((data, i) => {
      const geometry = new THREE.BoxGeometry(data.w, data.h, data.d);
      const material = new THREE.MeshPhongMaterial({
        color: data.color,
        specular: 0x444444,
        shininess: 30,
      });

      const building = new THREE.Mesh(geometry, material);
      building.position.set(data.x, data.h / 2, data.z);
      
      // Add subtle random rotation
      building.rotation.y = (Math.random() - 0.5) * 0.1;
      
      // Store initial Y position for animation
      (building as any).initialY = building.position.y;
      (building as any).phase = i * 0.5;

      this.buildings.push(building);
      this.scene.add(building);
    });
  }

  private createParticles(): void {
    const particleCount = 200;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const colors = new Float32Array(particleCount * 3);

    for (let i = 0; i < particleCount; i++) {
      // Random position in a sphere around the buildings
      positions[i * 3] = (Math.random() - 0.5) * 20;
      positions[i * 3 + 1] = Math.random() * 15;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 20;

      // Random color (blue to teal)
      const color = new THREE.Color();
      color.setHSL(0.55 + Math.random() * 0.1, 0.7, 0.6);
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({
      size: 0.1,
      vertexColors: true,
      transparent: true,
      opacity: 0.6,
      blending: THREE.AdditiveBlending,
    });

    this.particles = new THREE.Points(geometry, material);
    this.scene.add(this.particles);
  }

  private createGround(): void {
    // Simple grid plane
    const gridHelper = new THREE.GridHelper(20, 20, 0xdbeafe, 0xe2e8f0);
    gridHelper.position.y = 0;
    gridHelper.material.opacity = 0.3;
    gridHelper.material.transparent = true;
    this.scene.add(gridHelper);
  }

  private setupEventListeners(): void {
    // Mouse move for parallax
    window.addEventListener('mousemove', (e) => {
      this.mouseX = (e.clientX / window.innerWidth) * 2 - 1;
      this.mouseY = -(e.clientY / window.innerHeight) * 2 + 1;
    });

    // Resize handler
    window.addEventListener('resize', () => this.onResize());
  }

  private onResize(): void {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();

    this.renderer.setSize(width, height);
  }

  private animate = (): void => {
    this.animationId = requestAnimationFrame(this.animate);

    const time = Date.now() * 0.001;

    // Smooth camera movement based on mouse
    this.targetX = this.mouseX * 2;
    this.targetY = this.mouseY * 1;
    
    this.camera.position.x += (this.targetX - this.camera.position.x) * 0.05;
    this.camera.position.y += ((8 + this.targetY) - this.camera.position.y) * 0.05;
    this.camera.lookAt(0, 2, 0);

    // Animate buildings (gentle float)
    this.buildings.forEach((building) => {
      const phase = (building as any).phase || 0;
      const initialY = (building as any).initialY || 0;
      building.position.y = initialY + Math.sin(time + phase) * 0.2;
      building.rotation.y += 0.001;
    });

    // Rotate particles
    if (this.particles) {
      this.particles.rotation.y = time * 0.05;
    }

    this.renderer.render(this.scene, this.camera);
  };

  public dispose(): void {
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
    }

    // Clean up Three.js resources
    this.buildings.forEach(building => {
      building.geometry.dispose();
      (building.material as THREE.Material).dispose();
    });

    if (this.particles) {
      this.particles.geometry.dispose();
      (this.particles.material as THREE.Material).dispose();
    }

    this.renderer.dispose();
    this.container.removeChild(this.renderer.domElement);
  }
}

// Auto-initialize if canvas exists
let sceneInstance: LandingScene | null = null;

export function initLandingScene(): void {
  const container = document.getElementById('hero-scene');
  if (container && !sceneInstance) {
    try {
      sceneInstance = new LandingScene('hero-scene');
    } catch (error) {
      console.warn('Failed to initialize 3D scene:', error);
      // Show fallback static image
      container.innerHTML = '<div style="width: 100%; height: 100%; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 1rem;"></div>';
    }
  }
}

// Clean up on page unload
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    if (sceneInstance) {
      sceneInstance.dispose();
      sceneInstance = null;
    }
  });
}

