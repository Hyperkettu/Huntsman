import express from 'express';
import * as exp from 'express';
import path from 'path';
import cors from 'cors';
import { config } from './environment/config/config';
import fs from 'fs';
import * as io from 'socket.io';
import http from 'http';
import { Routes } from './controllers/routes'
import { ServerSocket } from './sockets/server-socket'
import { CredentialsData, PlayerState, GameState, ObstacleState, Vector3, ShootEvent } from './socket-packets';

const COLORS = [
    0xff0000, 0x00ff00, 0x0000ff, 0xffff00, 0xff00ff, 0x00ffff, 0xffa500, 0x800080
];

export class NetworkHackServer {
    public static readonly PORT: number = config.serverPort || 2790;
    private app: exp.Application | null = null;
    private port: string | number = '';
    private server: http.Server | null = null;
    private serverSocket: ServerSocket | null = null;
    
    private players: Map<string, PlayerState> = new Map();
    private obstacles: Map<string, ObstacleState> = new Map();
    private colorIndex: number = 0;
    private catcherId: string | null = null;
    private caughtPlayerIds: Set<string> = new Set();
    private readyPlayers: Set<string> = new Set();
    private startTime?: number;
    private isGameOver: boolean = false;
    private inLobby: boolean = true;
    private catchDistance: number = 2.5;
    private singlePlayerTimer?: any;
    
    private projectiles: Map<string, { id: string, position: Vector3, velocity: Vector3 }> = new Map();
    private projectileCounter: number = 0;
    private catcherSlowedUntil: number = 0;
    private updateInterval?: any;
    
    private collectibles: Map<string, { id: string, position: Vector3 }> = new Map();
    private collectibleCounter: number = 0;
    private lastCollectibleSpawn: number = 0;

    private jailArea: { position: Vector3, scale: Vector3 } = { 
        position: { x: 0, y: 0.25, z: 0 }, 
        scale: { x: 5, y: 0.5, z: 5 } 
    };

    constructor() {
        this.createApp();
        this.configure();
        this.loadScene(); // Load after createApp to ensure path is ready
        this.createServer(); 
        this.initializeWebSockets();    
        this.initializeBackendServices();
        this.listen();
        this.startUpdateLoop();
    }

    private startUpdateLoop() {
        if (this.updateInterval) clearInterval(this.updateInterval);
        this.updateInterval = setInterval(() => {
            const hasProjectiles = this.projectiles.size > 0;
            const hasFallingCollectibles = Array.from(this.collectibles.values()).some(c => c.position.y > 0.5);
            const needsSlowUpdate = this.catcherSlowedUntil > Date.now();
            
            // Always run if game is active to handle collectible spawning
            if (!this.inLobby && !this.isGameOver) {
                this.updateGame();
            } else if (hasProjectiles || needsSlowUpdate || hasFallingCollectibles) {
                this.updateGame();
            }
        }, 50); // 20 FPS
    }

    private updateGame() {
        this.updateProjectiles();
        this.updateCollectibles();
        this.broadcastGameState();
    }

    private updateProjectiles() {
        const now = Date.now();
        const deltaTime = 0.05;
        const toDelete: string[] = [];

        this.projectiles.forEach((p, id) => {
            p.position.x += p.velocity.x * deltaTime;
            p.position.y += p.velocity.y * deltaTime;
            p.position.z += p.velocity.z * deltaTime;

            // Check boundaries (50x50 area)
            if (Math.abs(p.position.x) > 25 || Math.abs(p.position.z) > 25) {
                toDelete.push(id);
                return;
            }

            // Check hit catcher
            if (this.catcherId) {
                const catcher = this.players.get(this.catcherId);
                if (catcher) {
                    const dx = p.position.x - catcher.position.x;
                    const dy = p.position.y - catcher.position.y;
                    const dz = p.position.z - catcher.position.z;
                    const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
                    if (dist < 1.5) {
                        this.catcherSlowedUntil = now + 3000; // Slowed for 3 seconds
                        toDelete.push(id);
                        console.log(`Catcher ${this.catcherId} slowed!`);
                    }
                }
            }
        });

        toDelete.forEach(id => this.projectiles.delete(id));
    }

    private updateCollectibles() {
        const now = Date.now();
        const deltaTime = 0.05;

        // Spawn logic: Max 6 collectibles
        if (!this.inLobby && !this.isGameOver && this.collectibles.size < 6 && now - this.lastCollectibleSpawn > 2000) {
            this.lastCollectibleSpawn = now;
            const id = `collectible_${this.collectibleCounter++}`;
            const x = (Math.random() - 0.5) * 45;
            const z = (Math.random() - 0.5) * 45;
            const landingY = this.getLandingHeight(x, z);
            
            this.collectibles.set(id, {
                id,
                position: { x, y: 25, z },
                // Store landingY locally in the object to avoid recalculating every frame
                landingY: landingY 
            } as any);
            console.log(`Spawned collectible ${id} (Total: ${this.collectibles.size}/6)`);
        }

        const toDelete: string[] = [];
        this.collectibles.forEach((c: any, id) => {
            // Fall using stored landingY
            if (c.position.y > c.landingY) {
                c.position.y -= 7 * deltaTime;
                if (c.position.y < c.landingY) c.position.y = c.landingY;
            }

            // Check pickup
            this.players.forEach((p, pid) => {
                if (pid === this.catcherId || this.isPlayerCaught(pid)) return;

                const dx = p.position.x - c.position.x;
                const dy = p.position.y - c.position.y;
                const dz = p.position.z - c.position.z;
                const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);

                if (dist < 1.8) {
                    p.ammo = (p.ammo || 0) + 1;
                    toDelete.push(id);
                    console.log(`Player ${pid} picked up collectible! Ammo: ${p.ammo}`);
                }
            });
        });

        toDelete.forEach(id => this.collectibles.delete(id));
    }

    private getLandingHeight(x: number, z: number): number {
        let maxHeight = 0.5; // Floor height
        this.obstacles.forEach(o => {
            if (o.isTeleport) return;
            const halfX = Math.abs(o.scale.x) / 2;
            const halfZ = Math.abs(o.scale.z) / 2;
            const dx = Math.abs(x - o.position.x);
            const dz = Math.abs(z - o.position.z);
            
            if (dx <= halfX && dz <= halfZ) {
                const top = o.position.y + Math.abs(o.scale.y) / 2;
                if (top > maxHeight) maxHeight = top;
            }
        });
        return maxHeight;
    }

    private getPublicPath(): string {
        // Correctly resolve the public path relative to the root directory
        const baseDir = process.cwd();
        if (config.public && config.public.length > 0) {
            return path.join(baseDir, 'dist', 'public');
        }
        return baseDir;
    }

    private getSceneFilePath(): string {
        return path.join(process.cwd(), 'scene.json');
    }

    private loadScene() {
        const filePath = this.getSceneFilePath();
        console.log(`Checking for scene.json at: ${filePath}`);
        if (fs.existsSync(filePath)) {
            try {
                const data = fs.readFileSync(filePath, 'utf8');
                const config = JSON.parse(data);
                
                // Handle both old format (array) and new format (object with obstacles and jailArea)
                if (Array.isArray(config)) {
                    config.forEach((obs: ObstacleState) => {
                        if (obs.id) this.obstacles.set(obs.id, obs);
                    });
                } else if (config.obstacles) {
                    config.obstacles.forEach((obs: ObstacleState) => {
                        if (obs.id) this.obstacles.set(obs.id, obs);
                    });
                    if (config.jailArea) {
                        this.jailArea = config.jailArea;
                        console.log("Loaded jailArea from scene.json");
                    }
                }
                console.log(`Successfully loaded ${this.obstacles.size} obstacles from ${filePath}`);
            } catch (e) {
                console.error(`Failed to load ${filePath}`, e);
            }
        } else {
            console.log("No existing scene.json found, starting with empty scene.");
        }
    }

    private saveScene() {
        console.log("Saving scene...");
        try {
            const filePath = this.getSceneFilePath();
            const obsArray = Array.from(this.obstacles.values());
            const sceneConfig = {
                obstacles: obsArray,
                jailArea: this.jailArea
            };
            
            // Ensure the directory exists before writing
            const dir = path.dirname(filePath);
            console.log(`Saving scene with ${obsArray.length} obstacles and jailArea to: ${filePath}`);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(filePath, JSON.stringify(sceneConfig, null, 2));
            console.log(`Saved ${obsArray.length} obstacles to ${filePath}`);
        } catch (e) {
            console.error("Failed to save scene.json", e);
        }
    }

    private initializeControllers() : void {}

    private initializeBackendServices(): void {
        this.initializeControllers();   
    }

    private initializeWebSockets(): void {
        this.serverSocket = new ServerSocket(this.server!);
        this.serverSocket.onNewConnection({
            onConnect: () => {},
            onJoin: async (data: CredentialsData, socket: io.Socket) => {
                console.log(`Player joined: ${socket.id} with role ${data.role}`);
                
                if (data.role !== 'display') {
                    // Random position at the edges of the 25x25 ground
                    const edge = Math.floor(Math.random() * 4);
                    let startPos = { x: 0, y: 0.5, z: 0 };
                    const spread = (Math.random() - 0.5) * 22; // Spread along the edge

                    if (edge === 0) startPos = { x: -11, y: 0.5, z: spread }; // Left
                    else if (edge === 1) startPos = { x: 11, y: 0.5, z: spread }; // Right
                    else if (edge === 2) startPos = { x: spread, y: 0.5, z: -11 }; // Top
                    else startPos = { x: spread, y: 0.5, z: 11 }; // Bottom

                    const player: PlayerState = {
                        id: socket.id,
                        position: startPos,
                        quaternion: { x: 0, y: 0, z: 0, w: 1 },
                        color: COLORS[this.colorIndex % COLORS.length] || 0xffffff
                    };
                    this.colorIndex++;
                    this.players.set(socket.id, player);

                    if (data.role === 'catcher') {
                        this.catcherId = socket.id;
                        console.log(`Manual catcher assigned: ${socket.id}`);
                    }
                }

                if (this.serverSocket) {
                    this.serverSocket.sendDataToSocket(socket, 'init', { 
                        yourId: socket.id,
                        gameState: this.getGameState()
                    });
                }

                if (data.role !== 'display') {
                    this.broadcastGameState();
                }
                
                socket.on('start-game', () => {
                    if (this.inLobby) {
                        this.startGame();
                    }
                });

                socket.on('set-name', (name: string) => {
                    const p = this.players.get(socket.id);
                    if (p) {
                        p.name = name.substring(0, 16); // Limit name length
                        this.broadcastGameState();
                    }
                });

                socket.on('set-color', (color: number) => {
                    const p = this.players.get(socket.id);
                    if (p) {
                        p.color = color;
                        this.broadcastGameState();
                    }
                });

                socket.on('move-end', (data: any) => {
                    const p = this.players.get(socket.id);
                    if (p) {
                        const caught = this.isPlayerCaught(socket.id);
                        if (!caught) {
                            p.position = data.position;
                            p.quaternion = data.quaternion;
                            this.tryCatchPlayers();
                            this.checkRescue(socket.id);
                            this.broadcastGameState();
                        } else {
                            p.quaternion = data.quaternion;
                        }
                    }
                });

                socket.on('move-update', (data: any) => {
                    const p = this.players.get(socket.id);
                    if (p) {
                        const caught = this.isPlayerCaught(socket.id);
                        if (!caught) {
                            p.position = data.position;
                            p.quaternion = data.quaternion;
                            this.tryCatchPlayers();
                            this.checkRescue(socket.id);
                            this.broadcastGameState();
                        } else {
                            p.quaternion = data.quaternion;
                        }
                    }
                });

                socket.on('jail-update', (data: { position: Vector3, scale: Vector3 }) => {
                    this.jailArea = data;
                    this.saveScene();
                    this.broadcastGameState(true);
                });

                socket.on('obstacle-add', (data: ObstacleState) => {
                    if (!data.id) return;
                    console.log(`Received obstacle-add: ${data.id}`);
                    this.obstacles.set(data.id, data);
                    this.saveScene();
                    this.broadcastGameState(true);
                });

                socket.on('obstacle-update', (data: ObstacleState) => {
                    if (!data.id) return;
                    console.log(`Received obstacle-update: ${data.id}`);
                    const existing = this.obstacles.get(data.id) || {} as ObstacleState;
                    // Preserve teleport properties during update if not provided
                    const updated = { ...existing, ...data };
                    this.obstacles.set(data.id, updated);
                    this.saveScene();
                    this.broadcastGameState(true);
                });

                socket.on('shoot', (data: ShootEvent) => {
                    const p = this.players.get(socket.id);
                    if (p && !this.isPlayerCaught(socket.id) && socket.id !== this.catcherId && (p.ammo || 0) > 0) {
                        p.ammo = (p.ammo || 0) - 1;
                        const id = `projectile_${this.projectileCounter++}`;
                        const speed = 25;
                        const velocity = {
                            x: data.direction.x * speed,
                            y: 0,
                            z: data.direction.z * speed
                        };
                        this.projectiles.set(id, {
                            id,
                            position: { ...data.position, y: 0.5 },
                            velocity
                        });
                        console.log(`Player ${socket.id} shot! Ammo remaining: ${p.ammo}`);
                    }
                });
            },
            onResetServer: (data: CredentialsData, socket: io.Socket) => {},
             onDisconnect: async (socket: io.Socket) => {
                console.log(`Player disconnected: ${socket.id}`);
                this.players.delete(socket.id);
                this.caughtPlayerIds.delete(socket.id);
                if (this.catcherId === socket.id) {
                    const nextPlayer = this.players.keys().next();
                    this.catcherId = nextPlayer.done ? null : nextPlayer.value;
                    if (this.catcherId) {
                        console.log(`New catcher assigned: ${this.catcherId}`);
                    }
                }
                this.checkGameOver();
                this.broadcastGameState();
             },
        });
    }

    private getGameState(): GameState {
        return {
            players: Array.from(this.players.values()),
            obstacles: Array.from(this.obstacles.values()).map(o => ({
                id: o.id,
                position: o.position,
                scale: o.scale,
                isTeleport: o.isTeleport,
                pairId: o.pairId,
                color: o.color
            })),
            projectiles: Array.from(this.projectiles.values()).map(p => ({
                id: p.id,
                position: p.position
            })),
            collectibles: Array.from(this.collectibles.values()).map(c => ({
                id: c.id,
                position: c.position
            })),
            jailArea: this.jailArea,
            catcherId: this.catcherId || undefined,
            catcherSlowedUntil: this.catcherSlowedUntil,
            caughtPlayerIds: Array.from(this.caughtPlayerIds),
            startTime: this.startTime,
            isGameOver: this.isGameOver,
            inLobby: this.inLobby,
            readyPlayers: Array.from(this.readyPlayers)
        };
    }

    private startGame(): void {
        this.inLobby = false;
        this.isGameOver = false;
        this.startTime = Date.now();
        this.caughtPlayerIds.clear();
        this.collectibles.clear();
        this.lastCollectibleSpawn = 0;
        
        if (this.singlePlayerTimer) {
            clearTimeout(this.singlePlayerTimer);
            this.singlePlayerTimer = undefined;
        }

        // Pick a random catcher ONLY if one wasn't manually assigned via /catcher path
        if (!this.catcherId || !this.players.has(this.catcherId)) {
            const playerIds = Array.from(this.players.keys());
            if (playerIds.length > 0) {
                this.catcherId = playerIds[Math.floor(Math.random() * playerIds.length)];
            }
        }

        // Single player mode: Game lasts 30 seconds
        if (this.players.size === 1) {
            console.log('Single player game started: 30s limit active');
            this.singlePlayerTimer = setTimeout(() => {
                if (!this.inLobby && this.players.size === 1) {
                    this.triggerGameOver();
                }
            }, 30000);
        }

        // Randomize player positions at start of game
        this.players.forEach(p => {
            p.ammo = 0;
            const edge = Math.floor(Math.random() * 4);
            const spread = (Math.random() - 0.5) * 45;
            if (edge === 0) p.position = { x: -22, y: 0.5, z: spread };
            else if (edge === 1) p.position = { x: 22, y: 0.5, z: spread };
            else if (edge === 2) p.position = { x: spread, y: 0.5, z: -22 };
            else p.position = { x: spread, y: 0.5, z: 22 };
        });

        console.log('Game started');
        this.broadcastGameState();
    }

    private resetToLobby(): void {
        this.inLobby = true;
        this.isGameOver = false;
        this.startTime = undefined;
        this.caughtPlayerIds.clear();
        this.readyPlayers.clear();
        if (this.singlePlayerTimer) {
            clearTimeout(this.singlePlayerTimer);
            this.singlePlayerTimer = undefined;
        }
        console.log('Returned to lobby');
        this.broadcastGameState();
    }

    private isPlayerCaught(playerId: string): boolean {
        return playerId !== this.catcherId && this.caughtPlayerIds.has(playerId);
    }

    private tryCatchPlayers(): void {
        if (this.inLobby || this.isGameOver || !this.catcherId) return;
        const catcher = this.players.get(this.catcherId);
        if (!catcher) return;

        for (const [id, player] of this.players.entries()) {
            if (id === this.catcherId) continue;
            if (this.caughtPlayerIds.has(id)) continue;

            const dx = player.position.x - catcher.position.x;
            const dy = player.position.y - catcher.position.y;
            const dz = player.position.z - catcher.position.z;
            const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
            if (distance <= this.catchDistance) {
                this.caughtPlayerIds.add(id);
                // Teleport to jail
                player.position = { 
                    x: this.jailArea.position.x + (Math.random() - 0.5) * (this.jailArea.scale.x * 0.5),
                    y: 0.5,
                    z: this.jailArea.position.z + (Math.random() - 0.5) * (this.jailArea.scale.z * 0.5)
                };
                console.log(`Player ${id} caught and jailed!`);
            }
        }

        this.checkGameOver();
    }

    private checkRescue(playerId: string): void {
        if (this.inLobby || this.isGameOver || this.caughtPlayerIds.size === 0) return;
        if (playerId === this.catcherId || this.caughtPlayerIds.has(playerId)) return;

        const player = this.players.get(playerId);
        if (!player) return;

        // Check if player is touching jail area
        const halfX = this.jailArea.scale.x / 2 + 1.0; // Slightly larger for easier rescue
        const halfZ = this.jailArea.scale.z / 2 + 1.0;
        const dx = Math.abs(player.position.x - this.jailArea.position.x);
        const dz = Math.abs(player.position.z - this.jailArea.position.z);

        if (dx <= halfX && dz <= halfZ) {
            console.log(`Player ${playerId} RESCUED EVERYONE!`);
            this.caughtPlayerIds.clear();
            this.broadcastGameState();
        }
    }

    private triggerGameOver(): void {
        if (this.isGameOver) return;
        this.isGameOver = true;
        console.log('Game over triggered');
        this.broadcastGameState(true); // Full state on game over
        
        // Wait 5 seconds then return to lobby
        setTimeout(() => {
            this.resetToLobby();
        }, 5000);
    }

    private checkGameOver(): void {
        if (this.inLobby || this.isGameOver) return;
        if (this.players.size === 0) {
            this.isGameOver = false;
            return;
        }

        // If only 1 player, game only ends via the 30s timer started in startGame
        if (this.players.size === 1) return;

        const allCaught = Array.from(this.players.keys()).every(id => {
            return id === this.catcherId || this.caughtPlayerIds.has(id);
        });

        if (allCaught) {
            this.triggerGameOver();
        }
    }

    private broadcastGameState(forceStatic: boolean = false): void {
        if (this.serverSocket) {
            const state = this.getGameState();
            
            // Optimization: Remove static data from frequent updates to reduce lag
            if (!forceStatic) {
                (state as any).obstacles = undefined;
                (state as any).jailArea = undefined;
            }

            this.serverSocket.broadcast(state as any);
        }
    }

    private createApp(): void {
       this.app = express();
       this.app!.use(cors({ credentials: false }));
       const publicPath = this.getPublicPath();
       this.app!.use(express.static(publicPath));
       this.app!.get([Routes.HOME, Routes.PLAYER, Routes.CATCHER, Routes.CATCHER_VIEW, Routes.EDITOR], (req, res) => {
            res.sendFile(path.join(publicPath, 'index.html'));
       });
    }

    private configure(): void {
        this.port = process.env.PORT || config.serverPort || NetworkHackServer.PORT;
    }

    private listen(): void {
        this.server!.listen(this.port, () => {
            console.log('Running data server on port %s', this.port);
        });
    }

    private createServer(): void {
        this.server = http.createServer(this.app!);
    }
}
