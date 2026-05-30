import * as THREE from 'three';
import * as RAPIER from '@dimforge/rapier3d-compat';

export class Renderer {
    private scene: THREE.Scene;
    private camera: THREE.PerspectiveCamera;
    private renderer: THREE.WebGLRenderer;
    private cubes: Map<string, THREE.Object3D> = new Map();
    private playerLabels: Map<string, THREE.Sprite> = new Map();
    private obstacles: Map<string, THREE.Mesh> = new Map();
    private pendingObstacles: Set<string> = new Set();
    private plane: THREE.Mesh;
    private myId: string | null = null;
    private raycaster = new THREE.Raycaster();

    private world: RAPIER.World | null = null;
    private colliders: Map<string, RAPIER.Collider> = new Map();
    private playerBodies: Map<string, RAPIER.RigidBody> = new Map();
    private characterController: RAPIER.KinematicCharacterController | null = null;
    private physicsInitialized: boolean = false;

    private teleportRegistry: Map<string, { id: string, pairId: string, color: number }> = new Map();
    private teleportParticles: Map<string, { points: THREE.Points, basePos: THREE.Vector3, velocities: Float32Array }> = new Map();

    private lastPositions: Map<string, THREE.Vector3> = new Map();
    private targetPositions: Map<string, THREE.Vector3> = new Map();
    private targetQuaternions: Map<string, THREE.Quaternion> = new Map();

    constructor() {
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x87CEEB); 

        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.camera.position.set(0, 10, 15);
        this.camera.lookAt(0, 0, 0);

        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(window.devicePixelRatio);

        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.0;

        document.body.appendChild(this.renderer.domElement);

        this.initPhysics();

        const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 1.0);
        hemiLight.position.set(0, 20, 0);
        this.scene.add(hemiLight);

        const dirLight = new THREE.DirectionalLight(0xffffff, 1.5);
        dirLight.position.set(10, 20, 10);
        dirLight.castShadow = true;
        dirLight.shadow.mapSize.width = 2048;
        dirLight.shadow.mapSize.height = 2048;
        dirLight.shadow.camera.left = -30;
        dirLight.shadow.camera.right = 30;
        dirLight.shadow.camera.top = 30;
        dirLight.shadow.camera.bottom = -30;
        this.scene.add(dirLight);

        const planeGeometry = new THREE.PlaneGeometry(50, 50);
        const planeMaterial = new THREE.MeshStandardMaterial({ 
            color: 0x555555,
            roughness: 0.8,
            metalness: 0.2
        });
        this.plane = new THREE.Mesh(planeGeometry, planeMaterial);
        this.plane.rotation.x = -Math.PI / 2;
        this.plane.receiveShadow = true;
        this.scene.add(this.plane);

        const gridHelper = new THREE.GridHelper(50, 50, 0xffffff, 0x333333);
        gridHelper.position.y = 0.01;
        this.scene.add(gridHelper);

        window.addEventListener('resize', () => this.onWindowResize(), false);
        this.addEdgeObstacles();
    }

    private addEdgeObstacles() {
        const thickness = 2;
        const size = 50;
        const height = 3;

        const edges: Array<{pos: [number, number, number], scale: [number, number, number]}> = [
            { pos: [0, height/2, size/2 + thickness/2], scale: [size + thickness*2, height, thickness] },
            { pos: [0, height/2, -size/2 - thickness/2], scale: [size + thickness*2, height, thickness] },
            { pos: [size/2 + thickness/2, height/2, 0], scale: [thickness, height, size] },
            { pos: [-size/2 - thickness/2, height/2, 0], scale: [thickness, height, size] }
        ];

        edges.forEach((edge, i) => {
            const id = `edge_wall_${i}`;
            const mesh = new THREE.Mesh(
                new THREE.BoxGeometry(1, 1, 1),
                new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.9, metalness: 0.1 })
            );
            mesh.position.set(edge.pos[0], edge.pos[1], edge.pos[2]);
            mesh.scale.set(edge.scale[0], edge.scale[1], edge.scale[2]);
            this.scene.add(mesh);
            this.updateObstacleCollider(id, mesh);
        });
    }

    private async initPhysics() {
        await RAPIER.init();
        const gravity = { x: 0.0, y: -9.81, z: 0.0 };
        this.world = new RAPIER.World(gravity);
        this.characterController = this.world.createCharacterController(0.01);
        this.characterController.setSlideEnabled(true);
        this.characterController.setMaxSlopeClimbAngle(45 * Math.PI / 180);
        this.characterController.setMinSlopeSlideAngle(30 * Math.PI / 180);
        this.characterController.enableAutostep(0.7, 0.3, true);
        this.characterController.enableSnapToGround(0.0); // Disable snap to ground to avoid fighting with manual gravity

        this.physicsInitialized = true;
        console.log("Rapier physics initialized");

        const groundColliderDesc = RAPIER.ColliderDesc.cuboid(25, 5, 25)
            .setTranslation(0, -5, 0);
        this.world.createCollider(groundColliderDesc);

        for (const [id, obstacle] of this.obstacles.entries()) {
            this.updateObstacleCollider(id, obstacle);
        }
    }

    public teleportPlayer(id: string, position: THREE.Vector3) {
        const body = this.playerBodies.get(id);
        const group = this.cubes.get(id);
        if (body) {
            body.setTranslation({ x: position.x, y: position.y, z: position.z }, true);
            body.setNextKinematicTranslation({ x: position.x, y: position.y, z: position.z });
        }
        if (group) group.position.copy(position);
    }

    public movePlayer(id: string, movement: THREE.Vector3): { position: THREE.Vector3 } | null {
        if (!this.world || !this.characterController) return null;
        const body = this.playerBodies.get(id);
        if (!body) return null;
        const collider = body.collider(0);
        if (!collider) return null;

        this.characterController.computeColliderMovement(collider, movement);
        const correctedMovement = this.characterController.computedMovement();
        
        const currentPos = body.translation();
        const newPos = {
            x: currentPos.x + correctedMovement.x,
            y: currentPos.y + correctedMovement.y,
            z: currentPos.z + correctedMovement.z
        };
        
        body.setNextKinematicTranslation(newPos);
        
        // Immediate visual update for the local mover to prevent lag and ensure disp is calculated correctly
        const group = this.cubes.get(id);
        if (group && id === this.myId) {
            group.position.set(newPos.x, newPos.y, newPos.z);
        }

        return { position: new THREE.Vector3(newPos.x, newPos.y, newPos.z) };
    }

    private updateObstacleCollider(id: string, mesh: THREE.Mesh) {
        if (!this.world) return;
        const existingCollider = this.colliders.get(id);
        if (existingCollider) { this.world.removeCollider(existingCollider, false); this.colliders.delete(id); }
        if (mesh.userData.isTeleport) return;
        const scale = mesh.scale;
        const pos = mesh.position;
        const colliderDesc = RAPIER.ColliderDesc.cuboid(scale.x / 2, scale.y / 2, scale.z / 2).setTranslation(pos.x, pos.y, pos.z);
        const collider = this.world.createCollider(colliderDesc);
        this.colliders.set(id, collider);
    }

    public setMyId(id: string) { this.myId = id; }
    private onWindowResize() { this.camera.aspect = window.innerWidth / window.innerHeight; this.camera.updateProjectionMatrix(); this.renderer.setSize(window.innerWidth, window.innerHeight); }

    public updatePlayer(id: string, position: any, quaternion: any, color: number, name?: string) {
        if (!id) return;
        let group: any = this.cubes.get(id);
        if (!group) {
            group = new THREE.Group();
            const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: color || 0xffffff, roughness: 0.4, metalness: 0.7 }));
            mesh.name = "visual"; mesh.castShadow = true;
            group.add(mesh); this.scene.add(group); this.cubes.set(id, group as any);
            this.lastPositions.set(id, group.position.clone());
        }
        const visual = group.getObjectByName("visual") as THREE.Mesh;
        if (visual && visual.material instanceof THREE.MeshStandardMaterial) visual.material.color.setHex(color);
        
        const isLocal = id === this.myId;
        
        if (position) {
            if (isLocal) {
                // Keep physics synced for local mover
                if (this.physicsInitialized && this.world) {
                    this.updatePlayerPhysics(id, new THREE.Vector3(position.x, position.y, position.z), group.scale.y);
                }
            } else {
                // Set targets for remote interpolation
                this.targetPositions.set(id, new THREE.Vector3(position.x, position.y, position.z));
                // Update physics body so collisions are still accurate even if visual is lerping
                if (this.physicsInitialized && this.world) {
                    this.updatePlayerPhysics(id, new THREE.Vector3(position.x, position.y, position.z), group.scale.y);
                }
            }
        }

        if (quaternion) {
            if (isLocal) {
                // Snap visual roll if it's the mover's first initialization or forced reset
                if (visual) visual.quaternion.set(quaternion.x, quaternion.y, quaternion.z, quaternion.w);
            } else {
                // Set target for rotation interpolation
                this.targetQuaternions.set(id, new THREE.Quaternion(quaternion.x, quaternion.y, quaternion.z, quaternion.w));
            }
        }

        let label = this.playerLabels.get(id);
        const displayName = name || `Player ${id.substring(0, 4)}`;
        if (!label || label.userData.name !== displayName) {
            if (label) this.scene.remove(label);
            label = this.createNameLabel(displayName); label.userData.name = displayName;
            this.scene.add(label); this.playerLabels.set(id, label);
        }
        if (label) { const offset = (group.scale.y * 0.5) + 0.8; label.position.set(group.position.x, group.position.y + offset, group.position.z); }
    }

    private createNameLabel(name: string): THREE.Sprite {
        const canvas = document.createElement('canvas'); const context = canvas.getContext('2d'); const fontSize = 48; canvas.width = 512; canvas.height = 128;
        if (context) {
            context.fillStyle = 'rgba(0, 0, 0, 0.4)';
            const textWidth = context.measureText(name).width; const rectWidth = Math.min(canvas.width, textWidth + 60); const rectHeight = fontSize + 20; const x = (canvas.width - rectWidth) / 2; const y = (canvas.height - rectHeight) / 2;
            context.beginPath(); context.roundRect(x, y, rectWidth, rectHeight, 15); context.fill();
            context.font = `Bold ${fontSize}px Arial`; context.textAlign = 'center'; context.textBaseline = 'middle'; context.fillStyle = 'white'; context.fillText(name, canvas.width / 2, canvas.height / 2);
        }
        const texture = new THREE.CanvasTexture(canvas); const spriteMaterial = new THREE.SpriteMaterial({ map: texture, transparent: true }); const sprite = new THREE.Sprite(spriteMaterial);
        sprite.scale.set(3, 0.75, 1); return sprite;
    }

    public setPlayerStatus(id: string, isCaught: boolean, isCatcher: boolean) {
        const group = this.cubes.get(id); if (!group) return;
        if (group.scale) { const scale = isCatcher ? 1.2 : 1.0; group.scale.set(scale, scale, scale); }
        const visual = group.getObjectByName("visual") as THREE.Mesh;
        if (visual && visual.material instanceof THREE.MeshStandardMaterial) {
            visual.material.transparent = isCaught; visual.material.opacity = isCaught ? 0.35 : 1.0;
            visual.material.emissive = new THREE.Color(isCatcher ? 0x222222 : 0x000000); visual.material.emissiveIntensity = isCatcher ? 0.45 : 0.0; visual.material.roughness = isCaught ? 0.8 : 0.4;
        }
    }

    private updatePlayerPhysics(id: string, position: THREE.Vector3 | undefined, scale: number = 1.0) {
        if (!this.world) return;
        let body = this.playerBodies.get(id);
        if (!body) {
            const startPos = position || new THREE.Vector3(0, 0.5, 0);
            const rigidBodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(startPos.x, startPos.y, startPos.z);
            body = this.world.createRigidBody(rigidBodyDesc);
            const colliderDesc = RAPIER.ColliderDesc.ball(0.5 * scale);
            this.world.createCollider(colliderDesc, body);
            this.playerBodies.set(id, body);
        } else {
            const collider = body.collider(0); const shape = collider.shape() as any;
            if (shape && shape.radius && Math.abs(shape.radius - 0.5 * scale) > 0.01) {
                this.world.removeCollider(collider, false);
                const colliderDesc = RAPIER.ColliderDesc.ball(0.5 * scale);
                this.world.createCollider(colliderDesc, body);
            }
            if (position) {
                body.setTranslation(position, true);
                body.setNextKinematicTranslation(position);
            }
        }
    }

    public updateObstacle(id: string, position: any, scale: any, fromServer: boolean = false, extra?: any) {
        if (fromServer && this.pendingObstacles.has(id)) this.pendingObstacles.delete(id);
        let obstacle = this.obstacles.get(id);
        const isTeleport = (extra && extra.isTeleport === true) || (obstacle && obstacle.userData.isTeleport === true);
        const pairId = (extra && extra.pairId) || (obstacle && obstacle.userData.pairId) || "";
        const color = (extra && extra.color) || (obstacle && obstacle.userData.color) || (isTeleport ? 0x00ffff : 0x888888);
        if (!obstacle) {
            const geometry = isTeleport ? new THREE.CylinderGeometry(1, 1, 0.1, 32) : new THREE.BoxGeometry(1, 1, 1);
            const material = new THREE.MeshStandardMaterial({ color: color, roughness: 0.5, metalness: 0.5, transparent: isTeleport, opacity: isTeleport ? 0.6 : 1.0 });
            obstacle = new THREE.Mesh(geometry, material); obstacle.userData.id = id; obstacle.castShadow = !isTeleport; obstacle.receiveShadow = true;
            this.scene.add(obstacle); this.obstacles.set(id, obstacle);
        }
        if (position) obstacle.position.set(position.x, position.y, position.z);
        if (scale) obstacle.scale.set(scale.x, scale.y, scale.z);
        obstacle.userData.isTeleport = isTeleport; obstacle.userData.pairId = pairId; obstacle.userData.color = color;
        if (isTeleport) {
            this.teleportRegistry.set(id, { id, pairId, color });
            const particleData = this.teleportParticles.get(id);
            if (particleData) particleData.basePos.copy(obstacle.position); else this.addTeleportParticles(id, obstacle.position, color);
            if (obstacle.material instanceof THREE.MeshStandardMaterial) obstacle.material.color.setHex(color);
        } else this.teleportRegistry.delete(id);
        if (this.physicsInitialized) this.updateObstacleCollider(id, obstacle);
    }

    public cleanupObstacles(activeIds: Set<string>) {
        const toDelete: string[] = []; for (const id of this.obstacles.keys()) { if (this.pendingObstacles.has(id)) continue; if (!activeIds.has(id)) toDelete.push(id); }
        toDelete.forEach(id => {
            const obstacle = this.obstacles.get(id); if (obstacle) this.scene.remove(obstacle); this.obstacles.delete(id);
            const collider = this.colliders.get(id); if (collider && this.world) { this.world.removeCollider(collider, false); this.colliders.delete(id); }
            this.teleportRegistry.delete(id); const particleData = this.teleportParticles.get(id);
            if (particleData) { this.scene.remove(particleData.points); this.teleportParticles.delete(id); }
        });
    }

    public setPlayerVisibility(id: string, visible: boolean) { const group = this.cubes.get(id); if (group) group.visible = visible; const label = this.playerLabels.get(id); if (label) label.visible = visible; }
    public removePlayer(id: string) {
        const group = this.cubes.get(id); if (group) { this.scene.remove(group); this.cubes.delete(id); }
        const label = this.playerLabels.get(id); if (label) { this.scene.remove(label); this.playerLabels.delete(id); }
        const body = this.playerBodies.get(id); if (body && this.world) { this.world.removeRigidBody(body); this.playerBodies.delete(id); }
    }

    public cleanupPlayers(activeIds: Set<string>) { const toDelete: string[] = []; for (const id of this.cubes.keys()) { if (id === this.myId) continue; if (!activeIds.has(id)) toDelete.push(id); } toDelete.forEach(id => this.removePlayer(id)); }
    public getCube(id: string): THREE.Object3D | undefined { return this.cubes.get(id); }

    public checkTeleport(position: THREE.Vector3): { id: string, pairId: string } | null {
        if (this.teleportRegistry.size === 0) return null;
        let result: { id: string, pairId: string } | null = null;
        this.teleportRegistry.forEach((data, id) => {
            if (result) return;
            const mesh = this.obstacles.get(id); if (!mesh) return;
            const dist = new THREE.Vector3(position.x, position.y, position.z).distanceTo(new THREE.Vector3(mesh.position.x, mesh.position.y, mesh.position.z));
            if (dist < 1.50) result = { id, pairId: data.pairId };
        }); return result;
    }

    public getTeleportDestination(padId: string, pairId: string): THREE.Vector3 | null {
        let result: THREE.Vector3 | null = null;
        this.teleportRegistry.forEach((data, id) => { if (result) return; if (data.pairId === pairId && id !== padId) { const mesh = this.obstacles.get(id); if (mesh) result = mesh.position.clone().add(new THREE.Vector3(0, 0.5, 0)); } });
        return result;
    }

    private updateParticles(deltaTime: number) {
        this.teleportParticles.forEach(data => {
            const positionAttr = data.points.geometry.attributes.position as THREE.BufferAttribute | undefined; const velocities = data.velocities; const basePos = data.basePos;
            if (!positionAttr || !velocities) return;
            for (let i = 0; i < velocities.length; i++) {
                const currentY = positionAttr.getY(i); const nextY = currentY + velocities[i] * deltaTime;
                if (nextY > 2) { positionAttr.setY(i, 0); const angle = Math.random() * Math.PI * 2; const radius = Math.random() * 1.0; positionAttr.setX(i, basePos.x + Math.cos(angle) * radius); positionAttr.setZ(i, basePos.z + Math.sin(angle) * radius); } else positionAttr.setY(i, nextY);
            } positionAttr.needsUpdate = true;
        });
    }

    public updatePhysics(deltaTime: number = 1/60) {
        if (!this.world || !this.physicsInitialized) return;
        this.world.step();
        
        this.cubes.forEach((group, id) => {
            const isLocal = id === this.myId;
            const visual = group.getObjectByName("visual") as THREE.Mesh;
            
            // 1. Position Authority & Interpolation
            if (!isLocal) {
                const targetPos = this.targetPositions.get(id);
                if (targetPos) {
                    const dist = group.position.distanceTo(targetPos);
                    if (dist > 4.0) {
                        group.position.copy(targetPos); // Snap for teleports
                    } else {
                        group.position.lerp(targetPos, 0.2); // Smooth glide
                    }
                }
            }

            // 2. Automated Rolling (Authoritative for speed-matching)
            const lastPos = this.lastPositions.get(id);
            if (lastPos && visual) {
                const disp = group.position.clone().sub(lastPos);
                disp.y = 0;
                if (disp.lengthSq() > 0.000001) {
                    const axis = new THREE.Vector3(disp.z, 0, -disp.x).normalize();
                    const angle = disp.length() / 0.5; // Radius 0.5
                    visual.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(axis, angle));
                }
            }
            this.lastPositions.set(id, group.position.clone());

            // 3. Rotation Sync (Corrective to prevent drift)
            if (!isLocal && visual) {
                const targetQuat = this.targetQuaternions.get(id);
                if (targetQuat) {
                    // Gently pull towards network rotation without fighting the active roll
                    visual.quaternion.slerp(targetQuat, 0.05);
                }
            }

            // 4. Update Labels
            const label = this.playerLabels.get(id);
            if (label) {
                const offset = (group.scale.y * 0.5) + 0.8;
                label.position.set(group.position.x, group.position.y + offset, group.position.z);
            }
        });

        this.updateParticles(deltaTime);
    }

    public isPhysicsReady(): boolean { return this.physicsInitialized && !!this.world; }
    public render() { this.renderer.render(this.scene, this.camera); }

    public checkCollision(position: THREE.Vector3): boolean {
        if (!this.world || !this.physicsInitialized) return false;
        const shape = new RAPIER.Ball(0.45);
        const shapePos = { x: position.x, y: position.y, z: position.z };
        const shapeRot = { x: 0, y: 0, z: 0, w: 1 };
        let hasCollision = false;
        this.world.intersectionsWithShape(shapePos, shapeRot, shape, (handle) => {
            for (const [id, collider] of this.colliders.entries()) { if (collider === handle) { const obstacle = this.obstacles.get(id); if (obstacle && !obstacle.userData.isTeleport) { hasCollision = true; return false; } } }
            return true;
        });
        return hasCollision;
    }

    public getObstacles() { return Array.from(this.obstacles.values()); }
    public getScene() { return this.scene; }
    public getMyId() { return this.myId; }
    public getCamera() { return this.camera; }
    public getDomElement() { return this.renderer.domElement; }

    public checkLineOfSight(observerId: string, targetId: string): boolean {
        const observer = this.cubes.get(observerId);
        const target = this.cubes.get(targetId);
        if (!observer || !target) return false;

        const start = observer.position.clone().add(new THREE.Vector3(0, 0.25, 0)); // Slightly above ground
        const end = target.position.clone().add(new THREE.Vector3(0, 0.25, 0));
        const direction = end.clone().sub(start);
        const distance = direction.length();
        direction.normalize();

        this.raycaster.set(start, direction);
        this.raycaster.far = distance;

        // Check against obstacles only
        const obstacleMeshes = Array.from(this.obstacles.values()).filter(m => !m.userData.isTeleport);
        const intersects = this.raycaster.intersectObjects(obstacleMeshes, false);

        return intersects.length === 0;
    }
}
