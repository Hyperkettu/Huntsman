import * as THREE from 'three';
import { Renderer } from './Renderer';
import { Socket } from 'socket.io-client';

export class SceneEditor {
    private renderer: Renderer;
    private socket: Socket;
    private selectedObstacle: THREE.Mesh | null = null;
    private highlight: THREE.BoxHelper | null = null;
    private raycaster = new THREE.Raycaster();
    private mouse = new THREE.Vector2();
    
    // Set of keys that trigger a save when released
    private transformKeys: Set<string> = new Set([
        'arrowup', 'arrowdown', 'arrowleft', 'arrowright',
        'u', 'j', 'i', 'k', 'o', 'l', '+', '-', '='
    ]);

    constructor(renderer: Renderer, socket: Socket) {
        this.renderer = renderer;
        this.socket = socket;
        window.addEventListener('keydown', (e) => this.handleKeyDown(e));
        window.addEventListener('keyup', (e) => this.handleKeyUp(e));
        window.addEventListener('mousedown', (e) => this.handleMouseDown(e));
    }

    public getSelectedId(): string | null {
        if (!this.selectedObstacle) return null;
        return this.renderer.getObstacleId(this.selectedObstacle);
    }

    private handleMouseDown(e: MouseEvent) {
        const rect = this.renderer.getDomElement().getBoundingClientRect();
        this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

        this.raycaster.setFromCamera(this.mouse, this.renderer.getCamera());
        const intersects = this.raycaster.intersectObjects(this.renderer.getObstacles());

        if (intersects.length > 0) {
            this.selectObstacle(intersects[0].object as THREE.Mesh);
        } else {
            this.deselectObstacle();
        }
    }

    private selectObstacle(obstacle: THREE.Mesh) {
        if (this.selectedObstacle === obstacle) return;
        
        this.deselectObstacle();
        this.selectedObstacle = obstacle;
        
        this.highlight = new THREE.BoxHelper(obstacle, 0xffff00);
        this.renderer.getScene().add(this.highlight);
    }

    private deselectObstacle() {
        if (this.highlight) {
            this.renderer.getScene().remove(this.highlight);
            this.highlight = null;
        }
        this.selectedObstacle = null;
    }

    private handleKeyUp(e: KeyboardEvent) {
        const key = e.key.toLowerCase();
        if (this.selectedObstacle && this.transformKeys.has(key)) {
            this.emitUpdate();
            console.log("Transformation saved on key up:", key);
        }
    }

    private emitUpdate() {
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

        if (!this.selectedObstacle) return;

        const moveStep = 0.5;
        const scaleStep = 0.1;
        let changed = false;

        if (e.key === 'ArrowUp') { this.selectedObstacle.position.z -= moveStep; changed = true; }
        if (e.key === 'ArrowDown') { this.selectedObstacle.position.z += moveStep; changed = true; }
        if (e.key === 'ArrowLeft') { this.selectedObstacle.position.x -= moveStep; changed = true; }
        if (e.key === 'ArrowRight') { this.selectedObstacle.position.x += moveStep; changed = true; }

        if (key === 'u') { this.selectedObstacle.scale.x += scaleStep; changed = true; }
        if (key === 'j') { this.selectedObstacle.scale.x -= scaleStep; changed = true; }
        if (key === 'i') { this.selectedObstacle.scale.y += scaleStep; changed = true; }
        if (key === 'k') { this.selectedObstacle.scale.y -= scaleStep; changed = true; }
        if (key === 'o') { this.selectedObstacle.scale.z += scaleStep; changed = true; }
        if (key === 'l') { this.selectedObstacle.scale.z -= scaleStep; changed = true; }

        // Robust check for + and - keys
        if (e.key === '+' || e.key === '=' || e.code === 'Equal' || e.code === 'NumpadAdd') { 
            this.selectedObstacle.position.y += moveStep; 
            changed = true; 
        }
        if (e.key === '-' || e.code === 'Minus' || e.code === 'NumpadSubtract') { 
            this.selectedObstacle.position.y -= moveStep; 
            changed = true; 
        }

        if (changed) {
            this.selectedObstacle.scale.x = Math.max(0.1, this.selectedObstacle.scale.x);
            this.selectedObstacle.scale.y = Math.max(0.1, this.selectedObstacle.scale.y);
            this.selectedObstacle.scale.z = Math.max(0.1, this.selectedObstacle.scale.z);

            if (this.highlight) this.highlight.update();
            
            // Update the renderer and physics collider immediately
            const id = this.renderer.getObstacleId(this.selectedObstacle);
            if (id) {
                this.renderer.updateObstacle(id, this.selectedObstacle.position, this.selectedObstacle.scale);
            }

            this.emitUpdate();
        }
    }
}
