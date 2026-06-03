import * as THREE from 'three';
import { Renderer } from './Renderer';
import { Socket } from 'socket.io-client';

export class SceneEditor {
    private renderer: Renderer;
    private socket: Socket;
    private selectedObstacle: THREE.Mesh | null = null;
    private selectedJail: THREE.Mesh | null = null;
    private highlight: THREE.BoxHelper | null = null;
    private raycaster = new THREE.Raycaster();
    private mouse = new THREE.Vector2();
    
    // Set of keys that trigger a save when released
    private transformKeys: Set<string> = new Set([
        'arrowup', 'arrowdown', 'arrowleft', 'arrowright',
        'u', 'j', 'i', 'k', 'o', 'l', '+', '-', '=', 'pageup', 'pagedown'
    ]);

    constructor(renderer: Renderer, socket: Socket) {
        this.renderer = renderer;
        this.socket = socket;
        window.addEventListener('keydown', (e) => this.handleKeyDown(e));
        window.addEventListener('keyup', (e) => this.handleKeyUp(e));
        window.addEventListener('mousedown', (e) => this.handleMouseDown(e));
    }

    public getSelectedId(): string | null {
        if (this.selectedJail) return "jail";
        if (!this.selectedObstacle) return null;
        return this.renderer.getObstacleId(this.selectedObstacle);
    }

    private handleMouseDown(e: MouseEvent) {
        const rect = this.renderer.getDomElement().getBoundingClientRect();
        this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

        this.raycaster.setFromCamera(this.mouse, this.renderer.getCamera());
        
        // Check for jail mesh first
        const jailMesh = this.renderer.getJailMesh();
        if (jailMesh) {
            const jailIntersects = this.raycaster.intersectObject(jailMesh);
            if (jailIntersects.length > 0) {
                this.selectJail(jailMesh);
                return;
            }
        }

        const intersects = this.raycaster.intersectObjects(this.renderer.getObstacles());
        if (intersects.length > 0) {
            this.selectObstacle(intersects[0].object as THREE.Mesh);
        } else {
            this.deselectAll();
        }
    }

    private selectObstacle(obstacle: THREE.Mesh) {
        if (this.selectedObstacle === obstacle) return;
        this.deselectAll();
        this.selectedObstacle = obstacle;
        this.highlight = new THREE.BoxHelper(obstacle, 0xffff00);
        this.renderer.getScene().add(this.highlight);
        console.log("Selected obstacle:", this.renderer.getObstacleId(obstacle));
    }

    private selectJail(jail: THREE.Mesh) {
        if (this.selectedJail === jail) return;
        this.deselectAll();
        this.selectedJail = jail;
        this.highlight = new THREE.BoxHelper(jail, 0xff0000);
        this.renderer.getScene().add(this.highlight);
        console.log("Selected jail area");
    }

    private deselectAll() {
        if (this.highlight) {
            this.renderer.getScene().remove(this.highlight);
            this.highlight = null;
        }
        this.selectedObstacle = null;
        this.selectedJail = null;
    }

    private handleKeyUp(e: KeyboardEvent) {
        const key = e.key.toLowerCase();
        if ((this.selectedObstacle || this.selectedJail) && this.transformKeys.has(key)) {
            this.emitUpdate();
        }
    }

    private emitUpdate() {
        if (this.selectedJail) {
            this.socket.emit('jail-update', {
                position: { x: this.selectedJail.position.x, y: this.selectedJail.position.y, z: this.selectedJail.position.z },
                scale: { x: this.selectedJail.scale.x, y: this.selectedJail.scale.y, z: this.selectedJail.scale.z }
            });
            return;
        }

        if (!this.selectedObstacle) return;
        const id = this.renderer.getObstacleId(this.selectedObstacle);
        if (id) {
            this.socket.emit('obstacle-update', {
                id,
                position: { 
                    x: this.selectedObstacle.position.x, 
                    y: this.selectedObstacle.position.y, 
                    z: this.selectedObstacle.position.z 
                },
                scale: { 
                    x: this.selectedObstacle.scale.x, 
                    y: this.selectedObstacle.scale.y, 
                    z: this.selectedObstacle.scale.z 
                }
            });
        }
    }

    private handleKeyDown(e: KeyboardEvent) {
        const key = e.key.toLowerCase();
        
        if (key === 'n') {
            const id = "obs_" + Date.now() + "_" + Math.random().toString(36).substr(2, 9);
            const initialPos = { x: 0, y: 0.5, z: 0 };
            const initialScale = { x: 1, y: 1, z: 1 };

            const newObs = this.renderer.addObstacleWithId(
                id,
                new THREE.Vector3(initialPos.x, initialPos.y, initialPos.z),
                new THREE.Vector3(initialScale.x, initialScale.y, initialScale.z)
            );
            
            this.socket.emit('obstacle-add', {
                id,
                position: initialPos,
                scale: initialScale
            });
            this.selectObstacle(newObs);
            return;
        }

        if (key === 't') {
            const pairId = 'pair_' + Math.random().toString(36).substr(2, 5);
            const color = Math.floor(Math.random() * 0xffffff);
            
            const idA = 'tp_' + Date.now() + '_a';
            const posA = { x: -2, y: 0.05, z: 0 };
            const scaleA = { x: 1, y: 1, z: 1 };
            this.renderer.updateObstacle(idA, posA, scaleA, false, { isTeleport: true, pairId, color });
            this.socket.emit('obstacle-add', { id: idA, position: posA, scale: scaleA, isTeleport: true, pairId, color });

            const idB = 'tp_' + Date.now() + '_b';
            const posB = { x: 2, y: 0.05, z: 0 };
            const scaleB = { x: 1, y: 1, z: 1 };
            this.renderer.updateObstacle(idB, posB, scaleB, false, { isTeleport: true, pairId, color });
            this.socket.emit('obstacle-add', { id: idB, position: posB, scale: scaleB, isTeleport: true, pairId, color });
            return;
        }

        if (key === 'j' && !this.selectedJail) {
            const jailMesh = this.renderer.getJailMesh();
            if (jailMesh) {
                this.selectJail(jailMesh);
                return;
            }
        }

        const mesh = this.selectedObstacle || this.selectedJail;
        if (!mesh) return;

        const moveStep = 0.5;
        const scaleStep = 0.1;
        let changed = false;

        // Use lowercased 'key' for comparison to be safe
        if (key === 'arrowup') { mesh.position.z -= moveStep; changed = true; }
        if (key === 'arrowdown') { mesh.position.z += moveStep; changed = true; }
        if (key === 'arrowleft') { mesh.position.x -= moveStep; changed = true; }
        if (key === 'arrowright') { mesh.position.x += moveStep; changed = true; }

        if (key === 'u') { mesh.scale.x += scaleStep; changed = true; }
        if (key === 'j') { mesh.scale.x -= scaleStep; changed = true; }
        if (key === 'i') { mesh.scale.y += scaleStep; changed = true; }
        if (key === 'k') { mesh.scale.y -= scaleStep; changed = true; }
        if (key === 'o') { mesh.scale.z += scaleStep; changed = true; }
        if (key === 'l') { mesh.scale.z -= scaleStep; changed = true; }

        if (key === '+' || key === '=' || e.code === 'Equal' || e.code === 'NumpadAdd') { 
            mesh.position.y += moveStep; 
            changed = true; 
        }
        if (key === '-' || key === '_' || e.code === 'Minus' || e.code === 'NumpadSubtract') { 
            mesh.position.y -= moveStep; 
            changed = true; 
        }
        
        if (key === 'pageup') { mesh.position.y += moveStep; changed = true; }
        if (key === 'pagedown') { mesh.position.y -= moveStep; changed = true; }

        if (changed) {
            mesh.scale.x = Math.max(0.1, mesh.scale.x);
            mesh.scale.y = Math.max(0.1, mesh.scale.y);
            mesh.scale.z = Math.max(0.1, mesh.scale.z);

            if (this.highlight) this.highlight.update();
            
            if (this.selectedObstacle) {
                const id = this.renderer.getObstacleId(this.selectedObstacle);
                if (id) {
                    this.renderer.updateObstacle(id, this.selectedObstacle.position, this.selectedObstacle.scale);
                }
            } else if (this.selectedJail) {
                this.renderer.updateJailArea({ position: this.selectedJail.position, scale: this.selectedJail.scale });
            }

            this.emitUpdate();
        }
    }
}
