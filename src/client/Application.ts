import * as THREE from 'three';
import { Renderer } from './Renderer';
import { io, Socket } from 'socket.io-client';
import { GameState } from '../server/socket-packets';
import { SceneEditor } from './SceneEditor';

enum AppMode {
    DISPLAY,
    PLAYER,
    CATCHER_VIEW
}

export class Application {
    private renderer: Renderer;
    private editor?: SceneEditor;
    private socket: Socket;
    private mode: AppMode;
    private role: 'player' | 'catcher' | 'display' | 'catcher-view' = 'display';
    
    private myId: string | null = null;
    private myName: string = '';
    private caughtPlayerIds: Set<string> = new Set();
    private serverStartTime: number | undefined = undefined;
    private isGameOver: boolean = false;
    private catcherId: string | null = null;
    
    private statusContainer!: HTMLDivElement;
    private timerText!: HTMLDivElement;
    private ammoText!: HTMLDivElement;
    private caughtList!: HTMLDivElement;
    private gameStatusText!: HTMLDivElement;
    private lobbyContainer!: HTMLDivElement;
    private gameOverOverlay!: HTMLDivElement;
    private editorOverlay!: HTMLDivElement;
    private inLobby: boolean = true;
    private isEditorView: boolean = false;
    
    private joystickContainer!: HTMLDivElement;
    private joystickRenderer: THREE.WebGLRenderer | undefined;
    private joystickScene: THREE.Scene | undefined;
    private joystickCamera: THREE.OrthographicCamera | undefined;
    private joystickBase: THREE.Mesh | undefined;
    private joystickKnob: THREE.Mesh | undefined;
    private joystickVector: THREE.Vector2 = new THREE.Vector2(0, 0);
    private isTouchingJoystick: boolean = false;

    private backgroundMusic: HTMLAudioElement;
    private hasUserInteracted: boolean = false;
    private shouldPlayMusic: boolean = window.location.pathname === '/';

    private stamina: number = 100;
    private maxStamina: number = 100;
    private isBoosting: boolean = false;
    private currentAmmo: number = 0;
    private staminaBarContainer!: HTMLDivElement;
    private staminaBarFill!: HTMLDivElement;
    private boostButton!: HTMLButtonElement;
    private boostUIContainer!: HTMLDivElement;
    private shootButton!: HTMLButtonElement;
    private shootCooldown: number = 0;

    private lastTimestamp: number = 0;
    private players: string[] = [];
    private teleportCooldown: number = 0;
    private teleportGracePeriod: number = 0;
    private keys: { [key: string]: boolean } = {};
    private wasMoving: boolean = false;

    constructor() {
        if (window.location.pathname === '/player') {
            this.mode = AppMode.PLAYER;
            this.role = 'player';
        } else if (window.location.pathname === '/catcher') {
            this.mode = AppMode.PLAYER;
            this.role = 'catcher';
        } else if (window.location.pathname === '/catcher-view') {
            this.mode = AppMode.CATCHER_VIEW;
            this.role = 'catcher-view';
        } else if (window.location.pathname === '/editor') {
            this.mode = AppMode.DISPLAY;
            this.role = 'display';
            this.isEditorView = true;
        } else {
            this.mode = AppMode.DISPLAY;
            this.role = 'display';
        }

        this.renderer = new Renderer();
        this.backgroundMusic = new Audio();
        if (this.shouldPlayMusic) {
            this.backgroundMusic.src = 'music.mp3';
            this.backgroundMusic.loop = true;
            this.backgroundMusic.volume = 0.25;
            this.backgroundMusic.preload = 'auto';
        }
        this.socket = io();
        if (this.isEditorView) {
            this.editor = new SceneEditor(this.renderer, this.socket);
        }
        this.createLobbyUI();
        this.createGameOverUI();
        this.setupBackgroundMusic();
        if (this.isEditorView) {
            this.createEditorUI();
            this.createGameUI();
        } else if (this.mode === AppMode.DISPLAY || this.mode === AppMode.CATCHER_VIEW) {
            this.createGameUI();
        } else {
            this.createJoystickUI();
            this.createBoostUI();
        }
        this.setupSocket();
        window.addEventListener('keydown', (e) => this.keys[e.key.toLowerCase()] = true);
        window.addEventListener('keyup', (e) => this.keys[e.key.toLowerCase()] = false);
        requestAnimationFrame((t) => this.update(timestampToNumber(t)));
    }

    private setupSocket() {
        this.socket.on('connect', () => {
            if (this.mode === AppMode.PLAYER || this.isEditorView) {
                this.socket.emit('private-join', { role: this.role });
            }
        });
        this.socket.on('init', (data: { yourId: string, gameState: GameState }) => {
            this.myId = data.yourId;
            this.renderer.setMyId(data.yourId);
            this.handleGameState(data.gameState);
            
            // Re-run alignment logic immediately
            const boostUI = document.getElementById('boost-ui-container');
            if (boostUI && !this.inLobby && !this.isGameOver) {
                const isCatcher = this.myId === this.catcherId;
                if (this.boostButton) this.boostButton.style.display = isCatcher ? 'block' : 'none';
                if (this.staminaBarContainer) this.staminaBarContainer.style.display = isCatcher ? 'block' : 'none';
                if (this.shootButton) this.shootButton.style.display = !isCatcher ? 'block' : 'none';
                if (this.ammoText) this.ammoText.style.display = !isCatcher ? 'block' : 'none';
            }
        });
        this.socket.on('broadcast', (state: GameState) => {
            this.handleGameState(state);
        });
    }

    private createGameUI() {
        const container = document.createElement('div');
        container.style.position = 'absolute';
        container.style.left = '16px';
        container.style.top = '16px';
        container.style.zIndex = '100';
        container.style.color = '#ffffff';
        container.style.fontFamily = 'Arial, sans-serif';
        container.style.fontSize = '14px';
        container.style.textShadow = '0 0 6px rgba(0,0,0,0.8)';
        container.style.pointerEvents = 'none';
        container.style.maxWidth = '320px';
        this.timerText = document.createElement('div');
        this.timerText.style.marginBottom = '8px';
        this.timerText.textContent = 'Time: 0s';
        container.appendChild(this.timerText);
        this.ammoText = document.createElement('div');
        this.ammoText.style.marginBottom = '8px';
        this.ammoText.textContent = 'Ammo: 0';
        container.appendChild(this.ammoText);
        this.gameStatusText = document.createElement('div');
        this.gameStatusText.style.marginBottom = '8px';
        this.gameStatusText.style.fontWeight = '600';
        container.appendChild(this.gameStatusText);
        const caughtTitle = document.createElement('div');
        caughtTitle.textContent = 'Caught players:';
        caughtTitle.style.marginBottom = '4px';
        container.appendChild(caughtTitle);
        this.caughtList = document.createElement('div');
        this.caughtList.style.display = 'flex';
        this.caughtList.style.flexWrap = 'wrap';
        this.caughtList.style.gap = '6px';
        container.appendChild(this.caughtList);
        document.body.appendChild(container);
        this.statusContainer = container;
    }

    private createEditorUI() {
        const overlay = document.createElement('div');
        overlay.id = 'editor-overlay';
        overlay.style.position = 'absolute';
        overlay.style.left = '16px';
        overlay.style.bottom = '16px';
        overlay.style.zIndex = '250';
        overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.75)';
        overlay.style.color = '#fff';
        overlay.style.fontFamily = 'Arial, sans-serif';
        overlay.style.fontSize = '14px';
        overlay.style.padding = '14px 16px';
        overlay.style.borderRadius = '12px';
        overlay.style.maxWidth = '360px';
        overlay.style.lineHeight = '1.5';
        overlay.innerHTML = '<strong>Editor Mode</strong><br>Click obstacles to select, use arrow keys to move, U/J/I/K/O/L to scale, N to add obstacle, T to add teleport pair.';
        document.body.appendChild(overlay);
        this.editorOverlay = overlay;
    }

    private createLobbyUI() {
        const container = document.createElement('div');
        container.id = 'lobby-container';
        container.style.position = 'absolute';
        container.style.top = '50%';
        container.style.left = '50%';
        container.style.transform = 'translate(-50%, -50%)';
        container.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
        container.style.padding = '32px';
        container.style.borderRadius = '16px';
        container.style.color = '#fff';
        container.style.fontFamily = 'Arial, sans-serif';
        container.style.textAlign = 'center';
        container.style.zIndex = '200';
        container.style.minWidth = '300px';
        const title = document.createElement('h1');
        title.textContent = 'GAME LOBBY';
        title.style.marginTop = '0';
        container.appendChild(title);
        const playerList = document.createElement('div');
        playerList.id = 'lobby-player-list';
        playerList.style.marginBottom = '24px';
        playerList.style.display = 'flex';
        playerList.style.flexDirection = 'column';
        playerList.style.gap = '8px';
        playerList.style.maxHeight = '300px';
        playerList.style.overflowY = 'auto';
        container.appendChild(playerList);
        const startButton = document.createElement('button');
        startButton.textContent = 'START GAME';
        startButton.style.padding = '12px 24px';
        startButton.style.fontSize = '18px';
        startButton.style.fontWeight = 'bold';
        startButton.style.cursor = 'pointer';
        startButton.style.backgroundColor = '#4CAF50';
        startButton.style.color = 'white';
        startButton.style.border = 'none';
        startButton.style.borderRadius = '4px';
        startButton.onclick = () => {
            this.socket.emit('start-game');
        };
        container.appendChild(startButton);
        document.body.appendChild(container);
        this.lobbyContainer = container;
        if (this.isEditorView) {
            this.lobbyContainer.style.display = 'none';
        }
    }

    private createJoystickUI() {
        this.joystickContainer = document.createElement('div');
        this.joystickContainer.id = 'joystick-container';
        this.joystickContainer.style.position = 'absolute';
        this.joystickContainer.style.top = '0';
        this.joystickContainer.style.left = '0';
        this.joystickContainer.style.width = '100%';
        this.joystickContainer.style.height = '100%';
        this.joystickContainer.style.zIndex = '150';
        this.joystickContainer.style.display = 'none';
        this.joystickContainer.style.backgroundColor = '#222';
        document.body.appendChild(this.joystickContainer);
        this.renderer.getDomElement().style.display = 'none';
        const width = window.innerWidth;
        const height = window.innerHeight;
        this.joystickScene = new THREE.Scene();
        this.joystickCamera = new THREE.OrthographicCamera(-width/2, width/2, height/2, -height/2, 0.1, 100);
        this.joystickCamera.position.z = 10;
        this.joystickRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        this.joystickRenderer.setSize(width, height);
        this.joystickRenderer.setClearColor(0x000000, 0);
        this.joystickContainer.appendChild(this.joystickRenderer.domElement);
        const baseGeo = new THREE.RingGeometry(150, 200, 32); 
        const baseMat = new THREE.MeshBasicMaterial({ color: 0x888888, transparent: true, opacity: 0.5 });
        this.joystickBase = new THREE.Mesh(baseGeo, baseMat);
        this.joystickScene.add(this.joystickBase);
        const knobGeo = new THREE.CircleGeometry(100, 32);
        const knobMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 });
        this.joystickKnob = new THREE.Mesh(knobGeo, knobMat);
        this.joystickScene.add(this.joystickKnob);
        const center = new THREE.Vector2(-width * 0.25, -height * 0.25);
        this.joystickBase.position.set(center.x, center.y, 0);
        this.joystickKnob.position.set(center.x, center.y, 0);
        const handleTouch = (e: TouchEvent | MouseEvent) => {
            if (!this.isTouchingJoystick || !this.joystickBase || !this.joystickKnob) return;
            let clientX: number;
            let clientY: number;
            if ('touches' in e) {
                const touch = e.touches[0];
                if (!touch) return;
                clientX = touch.clientX;
                clientY = touch.clientY;
            } else {
                clientX = e.clientX;
                clientY = e.clientY;
            }
            const rect = this.joystickContainer.getBoundingClientRect();
            const touchX = clientX - rect.left - width/2;
            const touchY = -(clientY - rect.top - height/2);
            const dx = touchX - this.joystickBase.position.x;
            const dy = touchY - this.joystickBase.position.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const maxDist = 200;
            if (dist > 0.01) {
                if (dist > maxDist) {
                    this.joystickVector.set(dx / dist, dy / dist);
                    this.joystickKnob.position.set(this.joystickBase.position.x + this.joystickVector.x * maxDist, this.joystickBase.position.y + this.joystickVector.y * maxDist, 0);
                } else {
                    this.joystickVector.set(dx / maxDist, dy / maxDist);
                    this.joystickKnob.position.set(touchX, touchY, 0);
                }
            } else {
                this.joystickVector.set(0, 0);
                this.joystickKnob.position.copy(this.joystickBase.position);
            }
        };
        this.joystickContainer.addEventListener('touchstart', (e) => { this.isTouchingJoystick = true; handleTouch(e); });
        this.joystickContainer.addEventListener('touchmove', (e) => { e.preventDefault(); handleTouch(e); }, { passive: false });
        this.joystickContainer.addEventListener('touchend', () => {
            this.isTouchingJoystick = false; this.joystickVector.set(0, 0);
            if (this.joystickKnob && this.joystickBase) this.joystickKnob.position.copy(this.joystickBase.position);
        });
        this.joystickContainer.addEventListener('mousedown', (e) => { this.isTouchingJoystick = true; handleTouch(e); });
        window.addEventListener('mousemove', (e) => { if (this.isTouchingJoystick) handleTouch(e); });
        window.addEventListener('mouseup', () => {
            this.isTouchingJoystick = false; this.joystickVector.set(0, 0);
            if (this.joystickKnob && this.joystickBase) this.joystickKnob.position.copy(this.joystickBase.position);
        });
        window.addEventListener('resize', () => {
            const w = window.innerWidth; const h = window.innerHeight;
            if (this.joystickRenderer) this.joystickRenderer.setSize(w, h);
            if (this.joystickBase && this.joystickKnob) {
                const c = new THREE.Vector2(-w * 0.25, -h * 0.25);
                this.joystickBase.position.set(c.x, c.y, 0);
                this.joystickKnob.position.set(c.x, c.y, 0);
            }
        });
    }

    private createBoostUI() {
        const container = document.createElement('div');
        container.id = 'boost-ui-container';
        container.style.position = 'absolute';
        container.style.bottom = '40px';
        container.style.right = '40px';
        container.style.display = 'none';
        container.style.flexDirection = 'column';
        container.style.alignItems = 'center';
        container.style.gap = '20px';
        container.style.zIndex = '200';
        document.body.appendChild(container);

        this.ammoText = document.createElement('div');
        this.ammoText.style.color = '#fff';
        this.ammoText.style.fontSize = '24px';
        this.ammoText.style.fontWeight = 'bold';
        this.ammoText.style.textShadow = '0 0 10px rgba(0,0,0,0.8)';
        this.ammoText.textContent = 'AMMO: 0';
        container.appendChild(this.ammoText);

        this.shootButton = document.createElement('button');
        this.shootButton.textContent = 'SHOOT';
        this.shootButton.style.width = '150px';
        this.shootButton.style.height = '150px';
        this.shootButton.style.borderRadius = '50%';
        this.shootButton.style.border = '6px solid #fff';
        this.shootButton.style.backgroundColor = '#4444ff';
        this.shootButton.style.color = '#fff';
        this.shootButton.style.fontSize = '24px';
        this.shootButton.style.fontWeight = 'bold';
        this.shootButton.style.cursor = 'pointer';
        this.shootButton.style.boxShadow = '0 0 25px rgba(0,0,255,0.6)';
        this.shootButton.style.userSelect = 'none';
        this.shootButton.style.touchAction = 'none';
        const shoot = () => { if (this.shootCooldown <= 0) this.handleShoot(); };
        this.shootButton.addEventListener('mousedown', shoot);
        this.shootButton.addEventListener('touchstart', (e) => { e.preventDefault(); shoot(); });
        container.appendChild(this.shootButton);

        this.staminaBarContainer = document.createElement('div');
        this.staminaBarContainer.style.width = '120px';
        this.staminaBarContainer.style.height = '12px';
        this.staminaBarContainer.style.backgroundColor = 'rgba(0,0,0,0.5)';
        this.staminaBarContainer.style.borderRadius = '6px';
        this.staminaBarContainer.style.overflow = 'hidden';
        this.staminaBarContainer.style.border = '2px solid #fff';
        container.appendChild(this.staminaBarContainer);
        this.staminaBarFill = document.createElement('div');
        this.staminaBarFill.style.width = '100%';
        this.staminaBarFill.style.height = '100%';
        this.staminaBarFill.style.backgroundColor = '#ffcc00';
        this.staminaBarFill.style.transition = 'width 0.1s linear';
        this.staminaBarContainer.appendChild(this.staminaBarFill);
        this.boostButton = document.createElement('button');
        this.boostButton.textContent = 'BOOST';
        this.boostButton.style.width = '150px';
        this.boostButton.style.height = '150px';
        this.boostButton.style.borderRadius = '50%';
        this.boostButton.style.border = '6px solid #fff';
        this.boostButton.style.backgroundColor = '#ff4444';
        this.boostButton.style.color = '#fff';
        this.boostButton.style.fontSize = '24px';
        this.boostButton.style.fontWeight = 'bold';
        this.boostButton.style.cursor = 'pointer';
        this.boostButton.style.boxShadow = '0 0 25px rgba(255,0,0,0.6)';
        this.boostButton.style.userSelect = 'none';
        this.boostButton.style.touchAction = 'none';
        const startBoost = () => { this.isBoosting = true; this.boostButton.style.transform = 'scale(0.9)'; };
        const stopBoost = () => { this.isBoosting = false; this.boostButton.style.transform = 'scale(1.0)'; };
        this.boostButton.addEventListener('touchstart', (e) => { e.preventDefault(); startBoost(); });
        this.boostButton.addEventListener('touchend', stopBoost);
        this.boostButton.addEventListener('mousedown', startBoost);
        this.boostButton.addEventListener('mouseup', stopBoost);
        this.boostButton.addEventListener('mouseleave', stopBoost);
        container.appendChild(this.boostButton);
    }

    private handleShoot() {
        const cube = this.renderer.getCube(this.myId!);
        if (!cube) return;
        const shootDir = new THREE.Vector3(0, 0, -1);
        if (this.joystickVector.lengthSq() > 0.01) {
            shootDir.set(this.joystickVector.x, 0, -this.joystickVector.y).normalize();
        } else {
            let x = 0; let z = 0;
            if (this.keys['w'] || this.keys['arrowup']) z = -1;
            if (this.keys['s'] || this.keys['arrowdown']) z = 1;
            if (this.keys['a'] || this.keys['arrowleft']) x = -1;
            if (this.keys['d'] || this.keys['arrowright']) x = 1;
            if (x !== 0 || z !== 0) shootDir.set(x, 0, z).normalize();
        }
        this.socket.emit('shoot', {
            position: { x: cube.position.x, y: cube.position.y, z: cube.position.z },
            direction: { x: shootDir.x, y: shootDir.y, z: shootDir.z }
        });
        this.shootCooldown = 2.0;
    }

    private updateLobbyUI(state: GameState) {
        const playerList = document.getElementById('lobby-player-list');
        if (!playerList) return;
        const currentIds = new Set(state.players.map(p => p.id));
        Array.from(playerList.children).forEach(row => {
            const playerId = (row as HTMLElement).getAttribute('data-player-id');
            if (playerId && !currentIds.has(playerId)) row.remove();
        });
        state.players.forEach(player => {
            let row = playerList.querySelector(`[data-player-id="${player.id}"]`) as HTMLDivElement;
            if (!row) {
                row = document.createElement('div');
                row.setAttribute('data-player-id', player.id);
                row.style.display = 'flex';
                row.style.alignItems = 'center';
                row.style.gap = '12px';
                row.style.padding = '8px';
                row.style.backgroundColor = 'rgba(255, 255, 255, 0.1)';
                row.style.borderRadius = '4px';
                playerList.appendChild(row);
                const colorDot = document.createElement('div');
                colorDot.className = 'color-dot';
                colorDot.style.width = '24px';
                colorDot.style.height = '24px';
                colorDot.style.borderRadius = '50%';
                colorDot.style.border = '2px solid #fff';
                colorDot.style.cursor = player.id === this.myId ? 'pointer' : 'default';
                if (player.id === this.myId) {
                    colorDot.onclick = () => {
                        const colors = [0xff0000, 0x00ff00, 0x0000ff, 0xffff00, 0xff00ff, 0x00ffff, 0xffa500, 0x800080];
                        const currentIndex = colors.indexOf(player.color);
                        const nextColor = colors[(currentIndex + 1) % colors.length];
                        this.socket.emit('set-color', nextColor);
                    };
                }
                row.appendChild(colorDot);
                if (player.id === this.myId) {
                    const nameInput = document.createElement('input');
                    nameInput.type = 'text';
                    nameInput.className = 'name-input';
                    nameInput.style.flexGrow = '1';
                    nameInput.style.backgroundColor = 'transparent';
                    nameInput.style.border = 'none';
                    nameInput.style.borderBottom = '1px solid #666';
                    nameInput.style.color = '#fff';
                    nameInput.style.fontSize = '16px';
                    nameInput.style.outline = 'none';
                    nameInput.style.padding = '2px 4px';
                    nameInput.oninput = () => { this.myName = nameInput.value; this.socket.emit('set-name', this.myName); };
                    row.appendChild(nameInput);
                } else {
                    const nameLabel = document.createElement('span');
                    nameLabel.className = 'name-label';
                    nameLabel.style.flexGrow = '1';
                    nameLabel.style.textAlign = 'left';
                    row.appendChild(nameLabel);
                }
            }
            const colorDot = row.querySelector('.color-dot') as HTMLDivElement;
            if (colorDot) colorDot.style.backgroundColor = `#${player.color.toString(16).padStart(6, '0')}`;
            if (player.id === this.myId) {
                const nameInput = row.querySelector('.name-input') as HTMLInputElement;
                if (nameInput && document.activeElement !== nameInput) nameInput.value = player.name || this.myName || `Player ${player.id.substring(0, 4)}`;
            } else {
                const nameLabel = row.querySelector('.name-label') as HTMLSpanElement;
                if (nameLabel) nameLabel.textContent = player.name || `Player ${player.id.substring(0, 4)}`;
            }
        });
    }

    private createGameOverUI() {
        const overlay = document.createElement('div');
        overlay.id = 'game-over-overlay';
        overlay.style.position = 'absolute';
        overlay.style.top = '50%';
        overlay.style.left = '50%';
        overlay.style.transform = 'translate(-50%, -50%)';
        overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.85)';
        overlay.style.padding = '48px';
        overlay.style.borderRadius = '24px';
        overlay.style.color = '#ff4444';
        overlay.style.fontFamily = 'Arial, sans-serif';
        overlay.style.textAlign = 'center';
        overlay.style.zIndex = '300';
        overlay.style.display = 'none';
        overlay.style.border = '4px solid #ff4444';
        overlay.style.boxShadow = '0 0 20px rgba(255, 68, 68, 0.5)';
        const title = document.createElement('h1');
        title.textContent = 'GAME OVER';
        title.style.fontSize = '64px';
        title.style.margin = '0 0 16px 0';
        overlay.appendChild(title);
        const subText = document.createElement('div');
        subText.id = 'game-over-timer';
        subText.style.fontSize = '24px';
        subText.style.color = '#fff';
        overlay.appendChild(subText);
        document.body.appendChild(overlay);
        this.gameOverOverlay = overlay;
    }

    private setupBackgroundMusic() {
        if (!this.shouldPlayMusic) return;
        const resumeMusic = () => {
            this.hasUserInteracted = true;
            this.startBackgroundMusic();
            window.removeEventListener('pointerdown', resumeMusic);
            window.removeEventListener('keydown', resumeMusic);
        };

        window.addEventListener('pointerdown', resumeMusic, { once: true });
        window.addEventListener('keydown', resumeMusic, { once: true });
        this.backgroundMusic.addEventListener('error', () => {
            console.warn('Background music could not be loaded.', this.backgroundMusic.error);
        });
    }

    private startBackgroundMusic() {
        if (!this.shouldPlayMusic || !this.hasUserInteracted) return;
        if (this.backgroundMusic.paused) {
            void this.backgroundMusic.play().catch(() => {
                // Autoplay denied until user interacts.
            });
        }
    }

    private stopBackgroundMusic() {
        if (!this.backgroundMusic.paused) {
            this.backgroundMusic.pause();
            this.backgroundMusic.currentTime = 0;
        }
    }

    private updateGameUI(state: GameState) {
        if (this.mode !== AppMode.DISPLAY && this.mode !== AppMode.CATCHER_VIEW) return;
        this.serverStartTime = state.startTime;
        this.isGameOver = !!state.isGameOver;
        this.catcherId = state.catcherId || null;
        this.caughtPlayerIds = new Set(state.caughtPlayerIds || []);
        
        if (this.isEditorView) {
            this.timerText.textContent = 'Time: ∞';
            this.gameOverOverlay.style.display = 'none';
        } else {
            if (!this.isGameOver) {
                const elapsedSeconds = this.serverStartTime ? Math.floor((Date.now() - this.serverStartTime) / 1000) : 0;
                this.timerText.textContent = `Time: ${elapsedSeconds}s`;
            }
            if (this.isGameOver) {
                this.gameOverOverlay.style.display = 'block';
                const timerElem = document.getElementById('game-over-timer');
                if (timerElem) timerElem.textContent = `Final Time: ${this.timerText.textContent.split(': ')[1] || '0s'}. Returning to lobby...`;
            } else {
                this.gameOverOverlay.style.display = 'none';
            }
        }
        
        this.gameStatusText.innerHTML = '';
        if (this.catcherId) {
            const catcherPlayer = state.players.find(p => p.id === this.catcherId);
            const catcherName = (catcherPlayer && catcherPlayer.name) || `Player ${this.catcherId.substring(0, 4)}`;
            const catcherLabel = document.createElement('span');
            catcherLabel.textContent = `Catcher: ${catcherName} `;
            this.gameStatusText.appendChild(catcherLabel);
            if (catcherPlayer) {
                const colorDot = document.createElement('span');
                colorDot.style.width = '12px'; colorDot.style.height = '12px';
                colorDot.style.borderRadius = '50%'; colorDot.style.display = 'inline-block';
                colorDot.style.backgroundColor = `#${catcherPlayer.color.toString(16).padStart(6, '0')}`;
                colorDot.style.border = '1px solid #fff'; colorDot.style.verticalAlign = 'middle';
                this.gameStatusText.appendChild(colorDot);
            }
        }
        const myStatus = document.createElement('div');
        myStatus.style.marginTop = '4px';
        myStatus.textContent = this.mode === AppMode.CATCHER_VIEW ? 'Catcher View' : 'Spectating';
        this.gameStatusText.appendChild(myStatus);
        this.caughtList.innerHTML = '';
        const caughtPlayers = state.players ? state.players.filter(p => this.caughtPlayerIds.has(p.id)) : [];
        if (caughtPlayers.length === 0) {
            const emptyNode = document.createElement('div');
            emptyNode.textContent = 'None';
            emptyNode.style.opacity = '0.8';
            this.caughtList.appendChild(emptyNode);
        } else {
            caughtPlayers.forEach(player => {
                const playerDot = document.createElement('span');
                playerDot.style.width = '18px'; playerDot.style.height = '18px';
                playerDot.style.borderRadius = '50%'; playerDot.style.display = 'inline-block';
                playerDot.style.backgroundColor = `#${player.color.toString(16).padStart(6, '0')}`;
                playerDot.title = player.name || `Player ${player.id}`;
                playerDot.style.border = '1px solid rgba(255,255,255,0.8)';
                this.caughtList.appendChild(playerDot);
            });
        }
    }

    private handleGameState(state: GameState) {
        if (!state) return;
        this.inLobby = !!state.inLobby;
        this.isGameOver = !!state.isGameOver;
        this.catcherId = state.catcherId || null;
        this.caughtPlayerIds = new Set(state.caughtPlayerIds || []);
        
        if (this.isEditorView) {
            this.lobbyContainer.style.display = 'none';
            if (this.statusContainer) this.statusContainer.style.display = 'block';
            if (this.joystickContainer) this.joystickContainer.style.display = 'none';
            const boostUI = document.getElementById('boost-ui-container');
            if (boostUI) boostUI.style.display = 'none';
            if (this.editorOverlay) this.editorOverlay.style.display = 'block';
            this.gameOverOverlay.style.display = 'none';
            this.updateGameUI(state);
        } else if (this.inLobby) {
            this.lobbyContainer.style.display = 'block';
            if (this.statusContainer) this.statusContainer.style.display = 'none';
            if (this.joystickContainer) this.joystickContainer.style.display = 'none';
            const boostUI = document.getElementById('boost-ui-container');
            if (boostUI) boostUI.style.display = 'none';
            this.gameOverOverlay.style.display = 'none';
            this.updateLobbyUI(state);
            this.stamina = this.maxStamina;
            this.stopBackgroundMusic();
        } else {
            this.lobbyContainer.style.display = 'none';
            if (this.mode === AppMode.DISPLAY || this.mode === AppMode.CATCHER_VIEW) {
                if (this.statusContainer) this.statusContainer.style.display = 'block';
                this.updateGameUI(state);
            } else {
                if (this.joystickContainer) this.joystickContainer.style.display = 'block';
                const boostUI = document.getElementById('boost-ui-container');
                if (boostUI) {
                    boostUI.style.display = 'flex';
                    const isCatcher = this.myId === this.catcherId;
                    
                    // Update role locally based on server state to ensure movement logic works
                    if (isCatcher) this.role = 'catcher';
                    else if (this.role === 'catcher') this.role = 'player';

                    if (this.boostButton) this.boostButton.style.display = isCatcher ? 'block' : 'none';
                    if (this.staminaBarContainer) this.staminaBarContainer.style.display = isCatcher ? 'block' : 'none';
                    if (this.shootButton) this.shootButton.style.display = !isCatcher ? 'block' : 'none';
                    if (this.ammoText) this.ammoText.style.display = !isCatcher ? 'block' : 'none';
                }
                this.gameOverOverlay.style.display = this.isGameOver ? 'block' : 'none';
            }
            if (!this.isGameOver && this.shouldPlayMusic) {
                this.startBackgroundMusic();
            } else {
                this.stopBackgroundMusic();
            }
        }

        if (state.players) {
            const currentIds = new Set(state.players.map(p => p.id));
            this.players = state.players.map(p => p.id);
            state.players.forEach(p => {
                const isLocal = p.id === this.myId;
                const cube = this.renderer.getCube(p.id);
                if (isLocal) {
                    const needsInit = !cube;
                    // For local player, if they were moved by the server (e.g. at start of game), teleport them
                    if (cube && this.teleportGracePeriod <= 0) {
                        const serverPos = new THREE.Vector3(p.position.x, p.position.y, p.position.z);
                        if (serverPos.distanceTo(cube.position) > 4.0) {
                            this.renderer.teleportPlayer(p.id, serverPos);
                        }
                    }
                    this.renderer.updatePlayer(p.id, needsInit ? p.position : undefined, needsInit ? p.quaternion : undefined, p.color, p.name);
                } else {
                    this.renderer.updatePlayer(p.id, p.position, p.quaternion, p.color, p.name);
                }
            });
            state.players.forEach(p => {
                const isCaught = this.caughtPlayerIds.has(p.id);
                const isCatcher = p.id === this.catcherId;
                this.renderer.setPlayerStatus(p.id, isCaught, isCatcher);
            });
            this.renderer.cleanupPlayers(currentIds);
        }

        if (state.obstacles) {
            const currentObsIds = new Set(state.obstacles.map(o => o.id));
            state.obstacles.forEach(o => {
                this.renderer.updateObstacle(o.id, o.position, o.scale, true, {
                    isTeleport: o.isTeleport === true, 
                    pairId: o.pairId || "", 
                    color: o.color
                });
            });
            this.renderer.cleanupObstacles(currentObsIds);
        }

        this.renderer.setCatcherSlowed(state.catcherSlowedUntil || 0);
        
        // Ensure projectiles and collectibles are updated regardless of mode
        if (state.projectiles) this.renderer.updateProjectiles(state.projectiles);
        if (state.collectibles) this.renderer.updateCollectibles(state.collectibles);

        const myPlayer = state.players.find(p => p.id === this.myId);
        if (myPlayer) {
            this.currentAmmo = myPlayer.ammo || 0;
            if (this.ammoText) {
                this.ammoText.textContent = `AMMO: ${this.currentAmmo}`;
            }
        }
    }

    private update(timestamp: number) {
        const deltaTime = Math.min((timestamp - (this.lastTimestamp || timestamp)) / 1000, 0.1);
        this.lastTimestamp = timestamp;

        if (!this.renderer.isPhysicsReady()) {
            requestAnimationFrame((t) => this.update(timestampToNumber(t)));
            return;
        }

        if (this.teleportCooldown > 0) this.teleportCooldown -= deltaTime;
        if (this.teleportGracePeriod > 0) this.teleportGracePeriod -= deltaTime;
        if (this.shootCooldown > 0) {
            this.shootCooldown -= deltaTime;
            if (this.shootButton) {
                this.shootButton.style.opacity = '0.5';
                this.shootButton.disabled = true;
                this.shootButton.textContent = `COOLDOWN (${Math.ceil(this.shootCooldown)}s)`;
            }
        } else if (this.shootButton) {
            const hasAmmo = this.currentAmmo > 0;
            this.shootButton.style.opacity = hasAmmo ? '1.0' : '0.4';
            this.shootButton.disabled = !hasAmmo;
            this.shootButton.textContent = hasAmmo ? 'SHOOT' : 'NO AMMO';
            this.shootButton.style.backgroundColor = hasAmmo ? '#4444ff' : '#444';
            this.shootButton.style.boxShadow = hasAmmo ? '0 0 25px rgba(0,0,255,0.6)' : 'none';
        }

        if (this.mode === AppMode.DISPLAY || this.mode === AppMode.CATCHER_VIEW) {
            if (this.isEditorView) {
                if (this.timerText) this.timerText.textContent = 'Time: ∞';
            } else if (this.serverStartTime && !this.isGameOver) {
                const elapsedSeconds = Math.floor((Date.now() - this.serverStartTime) / 1000);
                if (this.timerText) this.timerText.textContent = `Time: ${elapsedSeconds}s`;
            }
            this.updateCamera();
            this.updateObstacleTransparency();
            this.renderer.updatePhysics(deltaTime);
            this.renderer.render();

            if (this.mode === AppMode.CATCHER_VIEW && this.catcherId) {
                this.players.forEach(id => {
                    const isVisible = id === this.catcherId || this.renderer.checkLineOfSight(this.catcherId!, id);
                    this.renderer.setPlayerVisibility(id, isVisible);
                });
            } else {
                this.players.forEach(id => this.renderer.setPlayerVisibility(id, true));
            }
        } else if (this.myId) {
            const isCatcher = this.myId === this.catcherId;
            const myCaught = !isCatcher && this.caughtPlayerIds.has(this.myId);
            const canMove = !this.inLobby && !this.isGameOver && !myCaught;
            
            const cube = this.renderer.getCube(this.myId!);

            if (canMove) {
                this.updateStamina(deltaTime);
                this.handleMovement(deltaTime);
                this.checkTeleportLogic();
            }
            
            this.updateObstacleTransparency();
            this.renderer.updatePhysics(deltaTime);
            
            // Sync final state (position and automated rotation) to the server
            if (cube && canMove) {
                this.syncToServer(cube);
            }

            if (this.joystickRenderer && this.joystickScene && this.joystickCamera) {
                this.joystickRenderer.render(this.joystickScene, this.joystickCamera);
            }
        }
        requestAnimationFrame((t) => this.update(timestampToNumber(t)));
    }

    private updateObstacleTransparency() {
        const cam = this.renderer.getCamera();
        const camPos = cam.position;
        const transparentIds = new Set<string>();

        const isHome = window.location.pathname === '/';
        const isCatcherPath = window.location.pathname === '/catcher';
        const isCatcherView = this.mode === AppMode.CATCHER_VIEW;
        const isEditor = this.isEditorView;

        if (isHome || isEditor) {
            this.players.forEach(pid => {
                const cube = this.renderer.getCube(pid);
                if (cube) {
                    const ids = this.renderer.getObstaclesBetween(camPos, cube.position);
                    ids.forEach(id => transparentIds.add(id));
                }
            });
        } else if (isCatcherPath || isCatcherView) {
            // 1. Catcher itself (local or remote) should always trigger transparency for obstacles in front of it
            const catcherIdToTrack = isCatcherPath ? this.myId : this.catcherId;
            if (catcherIdToTrack) {
                const cube = this.renderer.getCube(catcherIdToTrack);
                if (cube) {
                    const ids = this.renderer.getObstaclesBetween(camPos, cube.position);
                    ids.forEach(id => transparentIds.add(id));
                }
            }

            // 2. Other players ONLY if the catcher has LoS to them
            if (this.catcherId) {
                this.players.forEach(pid => {
                    if (pid === this.catcherId) return;
                    if (this.renderer.checkLineOfSight(this.catcherId!, pid)) {
                        const cube = this.renderer.getCube(pid);
                        if (cube) {
                            const ids = this.renderer.getObstaclesBetween(camPos, cube.position);
                            ids.forEach(id => transparentIds.add(id));
                        }
                    }
                });
            }
        }

        this.renderer.setObstaclesTransparency(transparentIds);
    }

    private updateStamina(deltaTime: number) {
        if (this.myId !== this.catcherId) { this.isBoosting = false; return; }
        const rate = this.isBoosting && this.stamina > 0 ? -40 : 15;
        this.stamina = Math.max(0, Math.min(this.maxStamina, this.stamina + rate * deltaTime));
        if (this.stamina <= 0) this.isBoosting = false;
        if (this.staminaBarFill) {
            const p = (this.stamina / this.maxStamina) * 100;
            this.staminaBarFill.style.width = `${p}%`;
            this.staminaBarFill.style.backgroundColor = this.stamina < 20 ? '#ff0000' : '#ffcc00';
        }
        if (this.boostButton) { 
            this.boostButton.style.opacity = this.stamina <= 0 ? '0.5' : '1.0';
            this.boostButton.disabled = this.stamina <= 0;
        }
    }

    private handleMovement(deltaTime: number) {
        const moveDir = new THREE.Vector3(0, 0, 0);
        let inputMagnitude = 0;
        
        if (this.joystickVector.lengthSq() > 0.01) {
            inputMagnitude = Math.min(this.joystickVector.length(), 1.0);
            moveDir.set(this.joystickVector.x, 0, -this.joystickVector.y).normalize();
        } else {
            let x = 0; let z = 0;
            if (this.keys['w'] || this.keys['arrowup']) z = -1;
            if (this.keys['s'] || this.keys['arrowdown']) z = 1;
            if (this.keys['a'] || this.keys['arrowleft']) x = -1;
            if (this.keys['d'] || this.keys['arrowright']) x = 1;
            if (x !== 0 || z !== 0) {
                moveDir.set(x, 0, z).normalize();
                inputMagnitude = 1.0;
            }
        }

        if (moveDir.lengthSq() > 0 || true) { // Always apply gravity
            this.wasMoving = true;
            const isCatcher = this.myId === this.catcherId;
            const isSlowed = isCatcher && Date.now() < this.renderer.getCatcherSlowedUntil();
            const baseSpeed = isCatcher ? 10 : 9;
            const speedMult = isSlowed ? 0.4 : 1.0;
            const speed = ((isCatcher && this.isBoosting && this.stamina > 0) ? baseSpeed * 1.8 : baseSpeed) * inputMagnitude * speedMult;
            
            const horizontalMovement = moveDir.clone().multiplyScalar(speed * deltaTime);
            const gravity = -12.0 * deltaTime; // Slightly stronger gravity for better grounding
            const movement = new THREE.Vector3(horizontalMovement.x, gravity, horizontalMovement.z);
            
            this.renderer.movePlayer(this.myId!, movement);
        } else if (this.wasMoving) {
            this.wasMoving = false;
            const cube = this.renderer.getCube(this.myId!);
            if (cube) this.syncToServer(cube);
        }
    }

    private checkTeleportLogic() {
        if (this.teleportCooldown > 0) return;
        const cube = this.renderer.getCube(this.myId!);
        if (!cube) return;
        const info = this.renderer.checkTeleport(cube.position);
        if (info) {
            const dest = this.renderer.getTeleportDestination(info.id, info.pairId);
            if (dest) {
                this.renderer.teleportPlayer(this.myId!, dest);
                this.teleportCooldown = 3.0; this.teleportGracePeriod = 1.0;
                this.syncToServer(cube);
            }
        }
    }

    private updateCamera() {
        const cam = this.renderer.getCamera();
        const targetPos = new THREE.Vector3(0, 0, 0);
        
        if (this.mode === AppMode.CATCHER_VIEW && this.catcherId) {
            const catcherCube = this.renderer.getCube(this.catcherId);
            if (catcherCube) {
                targetPos.copy(catcherCube.position);
            }
        }
        
        cam.position.lerp(new THREE.Vector3(targetPos.x, targetPos.y + 30, targetPos.z + 30), 0.05);
        cam.lookAt(targetPos);
    }

    private syncToServer(cube: THREE.Object3D) {
        if (isNaN(cube.position.x)) return;
        const visual = cube.getObjectByName("visual") as THREE.Mesh;
        const quat = visual ? visual.quaternion : cube.quaternion;
        this.socket.emit('move-update', {
            position: { x: cube.position.x, y: cube.position.y, z: cube.position.z },
            quaternion: { x: quat.x, y: quat.y, z: quat.z, w: quat.w }
        });
    }
}

function timestampToNumber(t: DOMHighResTimeStamp): number {
    return typeof t === 'number' ? t : Date.now();
}
