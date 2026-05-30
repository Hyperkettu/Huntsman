import * as THREE from 'three';
import { Renderer } from './Renderer';
import { io, Socket } from 'socket.io-client';
import { GameState } from '../server/socket-packets';
import { SceneEditor } from './SceneEditor';

enum AppMode {
    DISPLAY,
    PLAYER
}

export class Application {
    private renderer: Renderer;
    private editor: SceneEditor;
    private socket: Socket;
    private mode: AppMode;
    
    private myId: string | null = null;
    private myName: string = '';
    private caughtPlayerIds: Set<string> = new Set();
    private serverStartTime: number | undefined = undefined;
    private isGameOver: boolean = false;
    private catcherId: string | null = null;
    
    private statusContainer!: HTMLDivElement;
    private timerText!: HTMLDivElement;
    private caughtList!: HTMLDivElement;
    private gameStatusText!: HTMLDivElement;
    private lobbyContainer!: HTMLDivElement;
    private gameOverOverlay!: HTMLDivElement;
    private inLobby: boolean = true;
    
    private joystickContainer!: HTMLDivElement;
    private joystickRenderer: THREE.WebGLRenderer | undefined;
    private joystickScene: THREE.Scene | undefined;
    private joystickCamera: THREE.OrthographicCamera | undefined;
    private joystickBase: THREE.Mesh | undefined;
    private joystickKnob: THREE.Mesh | undefined;
    private joystickVector: THREE.Vector2 = new THREE.Vector2(0, 0);
    private isTouchingJoystick: boolean = false;

    private stamina: number = 100;
    private maxStamina: number = 100;
    private isBoosting: boolean = false;
    private staminaBarContainer!: HTMLDivElement;
    private staminaBarFill!: HTMLDivElement;
    private boostButton!: HTMLButtonElement;

    private lastTimestamp: number = 0;
    private players: string[] = [];
    private teleportCooldown: number = 0;
    private teleportGracePeriod: number = 0;
    private keys: { [key: string]: boolean } = {};
    private wasMoving: boolean = false;

    constructor() {
        this.mode = window.location.pathname === '/player' ? AppMode.PLAYER : AppMode.DISPLAY;
        this.renderer = new Renderer();
        this.socket = io();
        this.editor = new SceneEditor(this.renderer, this.socket);
        this.createLobbyUI();
        this.createGameOverUI();
        if (this.mode === AppMode.DISPLAY) {
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
            if (this.mode === AppMode.PLAYER) {
                this.socket.emit('private-join', {});
            }
        });
        this.socket.on('init', (data: { yourId: string, gameState: GameState }) => {
            this.myId = data.yourId;
            this.renderer.setMyId(data.yourId);
            this.handleGameState(data.gameState);
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
            const clientX = 'touches' in e ? e.touches[0].clientX : (e as MouseEvent).clientX;
            const clientY = 'touches' in e ? e.touches[0].clientY : (e as MouseEvent).clientY;
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

    private updateGameUI(state: GameState) {
        if (this.mode !== AppMode.DISPLAY) return;
        this.serverStartTime = state.startTime;
        this.isGameOver = !!state.isGameOver;
        this.catcherId = state.catcherId || null;
        this.caughtPlayerIds = new Set(state.caughtPlayerIds || []);
        if (!this.isGameOver) {
            const elapsedSeconds = this.serverStartTime ? Math.floor((Date.now() - this.serverStartTime) / 1000) : 0;
            this.timerText.textContent = `Time: ${elapsedSeconds}s`;
        }
        this.gameStatusText.innerHTML = '';
        if (this.isGameOver) {
            this.gameOverOverlay.style.display = 'block';
            const timerElem = document.getElementById('game-over-timer');
            if (timerElem) timerElem.textContent = `Final Time: ${this.timerText.textContent.split(': ')[1] || '0s'}. Returning to lobby...`;
        } else {
            this.gameOverOverlay.style.display = 'none';
        }
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
        myStatus.textContent = 'Spectating';
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
        if (this.inLobby) {
            this.lobbyContainer.style.display = 'block';
            if (this.statusContainer) this.statusContainer.style.display = 'none';
            if (this.joystickContainer) this.joystickContainer.style.display = 'none';
            const boostUI = document.getElementById('boost-ui-container');
            if (boostUI) boostUI.style.display = 'none';
            this.gameOverOverlay.style.display = 'none';
            this.updateLobbyUI(state);
            this.stamina = this.maxStamina;
        } else {
            this.lobbyContainer.style.display = 'none';
            if (this.mode === AppMode.DISPLAY) {
                if (this.statusContainer) this.statusContainer.style.display = 'block';
                this.updateGameUI(state);
            } else {
                if (this.joystickContainer) this.joystickContainer.style.display = 'block';
                const boostUI = document.getElementById('boost-ui-container');
                if (boostUI) boostUI.style.display = this.myId === this.catcherId ? 'flex' : 'none';
                this.gameOverOverlay.style.display = this.isGameOver ? 'block' : 'none';
            }
        }
        if (state.players) {
            const currentIds = new Set(state.players.map(p => p.id));
            this.players = state.players.map(p => p.id);
            state.players.forEach(p => {
                const isLocal = p.id === this.myId;
                const cube = this.renderer.getCube(p.id);
                if (isLocal) {
                    if (cube && this.teleportGracePeriod <= 0) {
                        const dist = new THREE.Vector3(p.position.x, p.position.y, p.position.z).distanceTo(cube.position);
                        if (dist > 5.0) {
                            this.renderer.teleportPlayer(p.id, new THREE.Vector3(p.position.x, p.position.y, p.position.z));
                        }
                    }
                    this.renderer.updatePlayer(p.id, undefined, undefined, p.color, p.name);
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
                    isTeleport: (o && o.isTeleport === true), pairId: (o && o.pairId) || "", color: (o && o.color)
                });
            });
            this.renderer.cleanupObstacles(currentObsIds);
        }
    }

    private update(timestamp: number) {
        const deltaTime = Math.min((timestamp - (this.lastTimestamp || timestamp)) / 1000, 0.1);
        this.lastTimestamp = timestamp;
        if (!this.renderer.isPhysicsReady()) {
            requestAnimationFrame((t) => this.update(timestampToNumber(t)));
            return;
        }
        this.renderer.updatePhysics();
        if (this.teleportCooldown > 0) this.teleportCooldown -= deltaTime;
        if (this.teleportGracePeriod > 0) this.teleportGracePeriod -= deltaTime;
        if (this.mode === AppMode.DISPLAY) {
            if (this.serverStartTime && !this.isGameOver) {
                const elapsedSeconds = Math.floor((Date.now() - this.serverStartTime) / 1000);
                if (this.timerText) this.timerText.textContent = `Time: ${elapsedSeconds}s`;
            }
            this.updateCamera();
            this.renderer.render();
            this.players.forEach(id => this.renderer.setPlayerVisibility(id, true));
        } else if (this.myId) {
            const myCaught = (this.myId && this.caughtPlayerIds.has(this.myId)) && this.myId !== this.catcherId;
            const canMove = !this.inLobby && !this.isGameOver && !myCaught;
            if (canMove) {
                this.updateStamina(deltaTime);
                this.handleMovement(deltaTime);
                this.checkTeleportLogic();
            }
            if (this.joystickRenderer && this.joystickScene && this.joystickCamera) {
                this.joystickRenderer.render(this.joystickScene, this.joystickCamera);
            }
        }
        requestAnimationFrame((t) => this.update(timestampToNumber(t)));
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
        if (this.boostButton) { this.boostButton.style.opacity = this.stamina <= 0 ? '0.5' : '1.0'; }
    }

    private handleMovement(deltaTime: number) {
        const cube = this.renderer.getCube(this.myId!);
        if (!cube) return;
        const moveDir = new THREE.Vector3(0, 0, 0);
        if (this.joystickVector.lengthSq() > 0.01) {
            moveDir.set(this.joystickVector.x, 0, -this.joystickVector.y).normalize();
        } else {
            let x = 0; let z = 0;
            if (this.keys['w'] || this.keys['arrowup']) z = -1;
            if (this.keys['s'] || this.keys['arrowdown']) z = 1;
            if (this.keys['a'] || this.keys['arrowleft']) x = -1;
            if (this.keys['d'] || this.keys['arrowright']) x = 1;
            if (x !== 0 || z !== 0) moveDir.set(x, 0, z).normalize();
        }
        if (moveDir.lengthSq() > 0) {
            this.wasMoving = true;
            const isCatcher = this.myId === this.catcherId;
            const baseSpeed = isCatcher ? 9 : 8;
            const speed = (isCatcher && this.isBoosting && this.stamina > 0) ? baseSpeed * 2 : baseSpeed;
            const posBefore = cube.position.clone();
            const movement = moveDir.clone().multiplyScalar(speed * deltaTime);
            movement.y = (cube.position.y > 0.51) ? -9.81 * deltaTime : (0.501 - cube.position.y);
            this.renderer.movePlayer(this.myId!, movement);
            if (cube.position.y < 0.5) cube.position.y = 0.5;
            const disp = cube.position.clone().sub(posBefore);
            disp.y = 0; 
            if (disp.lengthSq() > 0.000001) {
                const axis = new THREE.Vector3(disp.z, 0, -disp.x).normalize();
                const angle = disp.length() / (0.5 * cube.scale.y); 
                const visual = cube.getObjectByName("visual") as THREE.Mesh;
                if (visual) visual.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(axis, angle));
            }
            if (!isNaN(cube.position.x)) this.syncToServer(cube);
        } else if (this.wasMoving) {
            this.wasMoving = false;
            this.syncToServer(cube);
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
        cam.position.lerp(new THREE.Vector3(0, 30, 30), 0.05);
        cam.lookAt(0, 0, 0);
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
